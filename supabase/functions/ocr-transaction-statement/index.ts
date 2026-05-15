// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
// @ts-ignore - Deno runtime imports
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts"
import { matchTransactionItems } from "../_shared/transaction-matching.ts"

declare const Deno: {
  env: {
    get(key: string): string | undefined
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type OCRMode = "process_specific" | "process_next"

interface OCRRequest {
  statementId?: string
  imageUrl?: string
  reset_before_extract?: boolean
  mode?: OCRMode
  fast_mode?: boolean
  statement_mode?: "default" | "receipt"
}

interface ExtractedItem {
  line_number: number
  item_name: string
  specification?: string
  quantity?: number | null
  unit_price?: number | null
  amount: number
  tax_amount?: number | null
  po_number?: string
  po_line_number?: number
  remark?: string
  confidence: "low" | "med" | "high"
}

interface ExtractionResult {
  statement_date?: string
  vendor_name?: string
  vendor_name_english?: string
  total_amount?: number
  tax_amount?: number
  grand_total?: number
  items: ExtractedItem[]
  raw_text?: string
}

type ClaimOutcome =
  | {
      kind: "claimed"
      statement: any
      statementId: string
      imageUrl: string
    }
  | {
      kind: "queued"
      response: Response
    }

type ImagePreparationResult = {
  base64Image: string
  tileImages: string[]
  tableBodyImage: string | null
  width: number | null
  height: number | null
  rotated: boolean
  rotatedPngBytes: Uint8Array | null
  mediaType: "image/png" | "image/jpeg"
}

type InferredPoInfo = {
  inferred_po_number: string
  inferred_po_source: "per_item" | "global"
  inferred_po_confidence: number
  inferred_po_group_id?: string
}

type ParsedOrderToken = {
  normalized: string
  kind: "po" | "so"
  lineNumber?: number
}

type VendorResolution = {
  vendorName?: string
  vendorId?: number
  source: "gpt_extract" | "text_scan" | "po_infer" | "not_found"
}

type OrderCorrectionHints = {
  preferredVendorId?: number
  vendorNameHints?: string[]
}

type OrderCorrectionResult = {
  items: ExtractedItem[]
  inferredVendorName?: string
  inferredVendorId?: number
  matchedPurchaseId?: number
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  let statementId: string | null = null
  let claimedStatement: any | null = null
  let supabaseUrl = ""
  let supabaseServiceKey = ""
  let currentStage = "init"
  const startedAt = Date.now()

  try {
    supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
    supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") || ""
    const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6"

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    }
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set")
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: OCRRequest = await req.json().catch(() => ({}))
    const mode: OCRMode = requestData.mode || "process_specific"
    const fastMode = requestData.fast_mode === true
    const statementMode = requestData.statement_mode || "default"
    const workerId = crypto.randomUUID()
    statementId = requestData.statementId || null
    let imageUrl = requestData.imageUrl || null

    const perfDebug: Record<string, number | string | null> = {
      total_ms: 0,
      download_preprocess_ms: 0,
      claude_extract_ms: 0,
      claude_refine_ms: 0,
      normalize_and_correction_ms: 0,
      processed_width: null,
      processed_height: null,
      tile_count: 0,
      model: anthropicModel,
      fast_mode: fastMode ? 1 : 0,
    }

    currentStage = "cleanup_stale"
    try {
      await supabase.rpc("mark_stale_transaction_statements_failed", {
        processing_timeout: "15 minutes",
      })
    } catch (_) {
      // stale cleanup failure should not block extraction
    }

    currentStage = "claim_statement"
    const claimOutcome = await claimStatementForProcessing(
      supabase,
      mode,
      workerId,
      requestData,
      statementId
    )

    if (claimOutcome.kind === "queued") {
      return claimOutcome.response
    }

    claimedStatement = claimOutcome.statement
    statementId = claimOutcome.statementId
    imageUrl = claimOutcome.imageUrl || imageUrl

    if (!statementId || !imageUrl) {
      throw new Error("Missing statementId or imageUrl")
    }

    currentStage = "reset_statement"
    const resetResult = await resetStatementForProcessing(supabase, statementId)

    currentStage = "download_image"
    const downloadStartedAt = Date.now()
    const imageBuffer = await downloadImage(imageUrl)
    let preparedImage = await prepareImageInputs(imageBuffer)
    perfDebug.download_preprocess_ms = Date.now() - downloadStartedAt
    perfDebug.processed_width = preparedImage.width
    perfDebug.processed_height = preparedImage.height
    perfDebug.tile_count = preparedImage.tileImages.length

    // 스캐너 업로드(EXIF 미처리)만 방향 감지 수행, 프론트엔드 업로드는 prepareOcrImage에서 EXIF 이미 적용됨
    currentStage = "check_source"
    let isScanner = false
    try {
      const { data: stmtRow } = await supabase
        .from("transaction_statements")
        .select("extracted_data")
        .eq("id", statementId)
        .single()
      isScanner = stmtRow?.extracted_data?.source === "scanner"
    } catch (_) {
      // source 확인 실패 시 방향 감지 건너뜀
    }
    perfDebug.is_scanner = isScanner ? 1 : 0

    // 모든 이미지에 대해 방향 감지 및 회전 보정 수행
    // 1단계: EXIF (폰 카메라 - 즉시, 100% 정확)
    // 2단계: AI 비전 (스캐너/PNG - 문서 제목 위치 기반)
    currentStage = "detect_orientation"
    const orientationStartedAt = Date.now()
    const orientationResult = await detectImageOrientation(preparedImage.base64Image, anthropicApiKey, preparedImage.mediaType, anthropicModel, imageBuffer)
    const rotationDegrees = orientationResult.degrees
    perfDebug.orientation_detect_ms = Date.now() - orientationStartedAt
    perfDebug.rotation_degrees = rotationDegrees
    perfDebug.rotation_source = orientationResult.source
    if (orientationResult.exifHint) perfDebug.exif_hint = orientationResult.exifHint

    if (rotationDegrees > 0) {
      currentStage = "rotate_image"
      try {
        const decodedImage = await decodeImageFromBuffer(imageBuffer)
        if (decodedImage) {
          // imagescript rotate()는 반시계방향 기준이므로, 시계방향 각도를 변환
          // 예: 시계방향 90도 필요 → rotate(360-90=270) → 내부 270 반시계 = 시계방향 90도
          const rotatedImage = decodedImage.rotate(360 - (rotationDegrees % 360))
          const rotatedPngBytes = await rotatedImage.encode(1)
          const rotatedBase64 = uint8ArrayToBase64(rotatedPngBytes)
          preparedImage = {
            ...preparedImage,
            base64Image: rotatedBase64,
            width: rotatedImage.width,
            height: rotatedImage.height,
            rotated: true,
            rotatedPngBytes,
            mediaType: "image/png",
          }
          perfDebug.processed_width = rotatedImage.width
          perfDebug.processed_height = rotatedImage.height
          perfDebug.rotation_applied = rotationDegrees

          currentStage = "upload_rotated_image"
          try {
            const storagePath = imageUrl.split("/receipt-images/")[1]?.split("?")[0]
            if (storagePath) {
              const decodedPath = decodeURIComponent(storagePath)
              const { error: uploadErr } = await supabase.storage
                .from("receipt-images")
                .upload(decodedPath, rotatedPngBytes, {
                  contentType: "image/png",
                  upsert: true,
                })
              if (uploadErr) {
                perfDebug.rotation_save_error = uploadErr.message
              } else {
                perfDebug.rotation_saved = true
              }
            }
          } catch (saveErr: any) {
            perfDebug.rotation_save_error = saveErr?.message ?? "unknown_save_error"
            // 저장 실패해도 OCR은 메모리상 교정된 이미지로 계속 진행
          }
        } else {
          perfDebug.rotation_decode_failed = true
        }
      } catch (rotateErr: any) {
        perfDebug.rotation_error = rotateErr?.message ?? "unknown_rotation_error"
        // 회전 실패 시 원본 이미지로 진행
      }
    }

    currentStage = "claude_extract"
    const claudeStartedAt = Date.now()
    const rawExtraction = await extractWithClaudeSonnet({
      base64Image: preparedImage.base64Image,
      tileImages: preparedImage.tileImages,
      apiKey: anthropicApiKey,
      model: anthropicModel,
      poScope: resetResult.poScope,
      mediaType: preparedImage.mediaType,
      receiptMode: statementMode === "receipt",
    })
    perfDebug.claude_extract_ms = Date.now() - claudeStartedAt

    let extractionResult = rawExtraction
    if (!fastMode && preparedImage.tableBodyImage) {
      currentStage = "claude_table_items"
      try {
        const tableItems = await extractItemsFromTableCropWithClaude({
          tableBodyImage: preparedImage.tableBodyImage,
          apiKey: anthropicApiKey,
          model: anthropicModel,
        })
        const mergedCandidate: ExtractionResult = {
          ...rawExtraction,
          items: tableItems,
        }
        if (scoreExtractionQuality(mergedCandidate.items) > scoreExtractionQuality(extractionResult.items)) {
          extractionResult = mergedCandidate
      }
    } catch (_) {
        extractionResult = rawExtraction
      }
    }

    currentStage = "claude_refine"
    const refineStartedAt = Date.now()
    if (!fastMode) {
      try {
        const refinedExtraction = await refineExtractionWithClaudeSonnet({
          base64Image: preparedImage.base64Image,
          tileImages: preparedImage.tileImages,
          apiKey: anthropicApiKey,
          model: anthropicModel,
          poScope: resetResult.poScope,
          initialResult: rawExtraction,
        })

        const refinedScore = scoreExtractionQuality(refinedExtraction.items)
        const baseScore = scoreExtractionQuality(rawExtraction.items)
        extractionResult = refinedScore >= baseScore ? refinedExtraction : rawExtraction
      } catch (_) {
        extractionResult = rawExtraction
      }
    }
    perfDebug.claude_refine_ms = Date.now() - refineStartedAt

    if (!fastMode && shouldRunTableBodyFallback(extractionResult.items)) {
      currentStage = "claude_table_fallback"
      try {
        const tableFallback = await extractTableBodyFallbackWithClaude({
          base64Image: preparedImage.base64Image,
          tileImages: preparedImage.tileImages,
          apiKey: anthropicApiKey,
          model: anthropicModel,
        })
        const fallbackScore = scoreExtractionQuality(tableFallback.items)
        const currentScore = scoreExtractionQuality(extractionResult.items)
        if (fallbackScore > currentScore) {
          extractionResult = tableFallback
        }
        } catch (_) {
        // fallback failure should not block base extraction
      }
    }

    if (shouldRecoverItemNames(extractionResult.items)) {
      currentStage = "claude_recover_item_names"
      try {
        const recoveredNames = await recoverItemNamesWithClaude({
          base64Image: preparedImage.base64Image,
          tileImages: preparedImage.tileImages,
          apiKey: anthropicApiKey,
          model: anthropicModel,
        })
        if (recoveredNames.length > 0) {
          extractionResult = {
            ...extractionResult,
            items: mergeRecoveredItemNames(extractionResult.items, recoveredNames),
          }
        }
      } catch (_) {
        // name recovery failure should not block extraction
      }
    }

    currentStage = "normalize_output"
    const normalizeStartedAt = Date.now()
    const normalizedItems = normalizePoNumbers(extractionResult.items, extractionResult.raw_text, resetResult.poScope)
    const vendorHints = collectVendorHints(extractionResult)
    const correctionResult = await correctOrderNumbersByDb(supabase, normalizedItems, {
      vendorNameHints: vendorHints,
    })
    const enrichedItems = await enrichItemsWithPurchaseLines(supabase, correctionResult.items)
    const resolvedVendor = await resolveVendor(
      supabase,
      extractionResult,
      correctionResult.inferredVendorName,
      correctionResult.inferredVendorId
    )
    const vendorNameForPatterns = resolvedVendor.vendorName || extractionResult.vendor_name || ""
    const charCorrectedItems = vendorNameForPatterns
      ? await applyCharPatternCorrections(supabase, enrichedItems, vendorNameForPatterns)
      : enrichedItems
    const finalItems = charCorrectedItems
    const inferredPoMap = buildInferredPoMap(finalItems)
    perfDebug.normalize_and_correction_ms = Date.now() - normalizeStartedAt

    const rowCountTrace = {
      claude_raw: extractionResult.items.length,
      after_normalize_po: finalItems.length,
      after_correction: finalItems.length,
      before_insert: finalItems.length,
    }

    currentStage = "db_update"
    const extractedDataPayload: Record<string, unknown> = {
      ...extractionResult,
      ...(resetResult.preservedActualReceivedDate
        ? { actual_received_date: resetResult.preservedActualReceivedDate }
        : {}),
      items: finalItems,
      raw_vision_text: extractionResult.raw_text || "",
      debug_row_counts: rowCountTrace,
      debug_perf_ms: {
        ...perfDebug,
        total_ms: Date.now() - startedAt,
      },
      ocr_vendor_name: extractionResult.vendor_name || null,
      vendor_validated: Boolean(resolvedVendor.vendorName),
      vendor_match_source: resolvedVendor.source,
      vendor_mismatch: !resolvedVendor.vendorName,
    }

    const { error: updateError } = await supabase
      .from("transaction_statements")
      .update({
        status: "extracted",
        extraction_error: null,
        processing_finished_at: new Date().toISOString(),
        locked_by: null,
        reset_before_extract: false,
        statement_date: extractionResult.statement_date || null,
        vendor_name: resolvedVendor.vendorName || null,
        total_amount: extractionResult.total_amount ?? null,
        tax_amount: extractionResult.tax_amount ?? null,
        grand_total: extractionResult.grand_total ?? null,
        extracted_data: extractedDataPayload,
      })
      .eq("id", statementId)

    if (updateError) {
      throw new Error(`DB update failed: ${updateError.message}`)
    }

    currentStage = "match_items"
    const matchInputs = finalItems.map((item, idx) => {
      const lineNumber = item.line_number || idx + 1
      const inferredInfo = inferredPoMap.get(lineNumber)
      const effectivePo = inferredInfo?.inferred_po_number || normalizeOrderToken(item.po_number || "") || null
      return {
        line_number: lineNumber,
        item_name: item.item_name,
        specification: item.specification,
        quantity: item.quantity ?? null,
        po_number: effectivePo,
        po_line_number: item.po_line_number ?? null,
      }
    })
    const matchedItems = await matchTransactionItems(supabase, matchInputs, {
      extractedVendorName: resolvedVendor.vendorName || extractionResult.vendor_name,
    })

    currentStage = "db_insert_items"
    if (finalItems.length > 0) {
      const itemsToInsert = finalItems.map((item, idx) => {
        const lineNumber = item.line_number || idx + 1
        const inferredInfo = inferredPoMap.get(lineNumber)
        const normalizedPo = normalizeOrderToken(item.po_number || "")
        const matched = matchedItems.find((m) => m.lineNumber === lineNumber)

        return {
          statement_id: statementId,
          line_number: lineNumber,
          extracted_item_name: item.item_name || "",
          extracted_specification: item.specification || null,
          extracted_quantity: item.quantity ?? null,
          extracted_unit_price: item.unit_price ?? null,
          extracted_amount: item.amount ?? 0,
          extracted_tax_amount: item.tax_amount ?? null,
          extracted_po_number: normalizedPo || null,
          extracted_po_line_number: item.po_line_number ?? null,
          extracted_remark: item.remark || null,
          match_confidence: normalizeItemConfidence(item.confidence),
          inferred_po_number: inferredInfo?.inferred_po_number || null,
          inferred_po_source: inferredInfo?.inferred_po_source || null,
          inferred_po_confidence: inferredInfo?.inferred_po_confidence ?? null,
          inferred_po_group_id: inferredInfo?.inferred_po_group_id || null,
          matched_purchase_id: matched?.matchedPurchaseId ?? null,
          matched_item_id: matched?.matchedItemId ?? null,
          match_method: matched?.matchMethod ?? null,
        }
      })

      const { error: itemsError } = await supabase
        .from("transaction_statement_items")
        .insert(itemsToInsert)

      if (itemsError) {
        throw new Error(`Items insert failed: ${itemsError.message}`)
      }

      const calculatedTotal = finalItems.reduce((sum, item) => sum + (item.amount || 0), 0)
      if (calculatedTotal > 0) {
        await supabase
          .from("transaction_statements")
          .update({ grand_total: calculatedTotal, total_amount: calculatedTotal })
          .eq("id", statementId)
      }
    }

      triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)

    return new Response(
      JSON.stringify({
        success: true,
        statementId,
        status: "extracted",
        vendor_name: resolvedVendor.vendorName || null,
        vendor_match_source: resolvedVendor.source,
        debug_row_counts: rowCountTrace,
        debug_perf_ms: {
          ...perfDebug,
          total_ms: Date.now() - startedAt,
        },
        result: {
          ...extractionResult,
          vendor_name: resolvedVendor.vendorName || null,
          items: finalItems,
          debug_row_counts: rowCountTrace,
          debug_perf_ms: {
            ...perfDebug,
            total_ms: Date.now() - startedAt,
          },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error: any) {
    const errorMessage = `[stage:${currentStage}] ${error?.message || "Unknown error"}`

    try {
      if (statementId && supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const retryCount = (claimedStatement?.retry_count ?? 0) + 1
        const delayMinutes = Math.min(30, Math.pow(2, Math.min(retryCount, 4)))
        const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()

        await supabase
          .from("transaction_statements")
          .update({ 
            status: "failed",
            extraction_error: errorMessage,
            processing_finished_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            retry_count: retryCount,
            next_retry_at: nextRetryAt,
            locked_by: null,
            reset_before_extract: false,
          })
          .eq("id", statementId)
      }
    } catch (_) {
      // ignore secondary failure
    }

    if (supabaseUrl && supabaseServiceKey) {
      triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

async function claimStatementForProcessing(
  supabase: any,
  mode: OCRMode,
  workerId: string,
  requestData: OCRRequest,
  statementId: string | null
): Promise<ClaimOutcome> {
  if (mode === "process_next") {
    const { data, error } = await supabase.rpc("claim_next_transaction_statement", {
      worker_id: workerId,
      processing_timeout: "15 minutes",
    })

    if (error) throw error
    const claimed = Array.isArray(data) ? data[0] : data
    if (!claimed?.id) {
      return {
        kind: "queued",
        response: new Response(
          JSON.stringify({ success: true, skipped: true, reason: "no_queue_or_processing_active" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        ),
      }
    }

    return {
      kind: "claimed",
      statement: claimed,
      statementId: claimed.id,
      imageUrl: claimed.image_url,
    }
  }

  if (!statementId) {
    throw new Error("statementId is required")
  }

  const { data, error } = await supabase.rpc("claim_transaction_statement", {
    statement_id: statementId,
    worker_id: workerId,
    processing_timeout: "15 minutes",
  })
  if (error) throw error

  const claimed = Array.isArray(data) ? data[0] : data
  if (!claimed?.id) {
    const queueUpdate: Record<string, unknown> = {
      status: "queued",
      queued_at: new Date().toISOString(),
      next_retry_at: new Date().toISOString(),
    }
    if (requestData.reset_before_extract) {
      queueUpdate.reset_before_extract = true
    }
    await supabase
      .from("transaction_statements")
      .update(queueUpdate)
      .in("status", ["pending", "queued", "failed", "extracted", "confirmed", "rejected"])
      .eq("id", statementId)

    return {
      kind: "queued",
      response: new Response(
        JSON.stringify({
          success: true,
          queued: true,
          status: "queued",
          statementId,
          reason: "claim_failed",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    }
  }

  return {
    kind: "claimed",
    statement: claimed,
    statementId: claimed.id,
    imageUrl: claimed.image_url || requestData.imageUrl || "",
  }
}

async function resetStatementForProcessing(
  supabase: any,
  statementId: string
): Promise<{ poScope: "single" | "multi" | null; preservedActualReceivedDate: string | null }> {
  const { data: existingStatement } = await supabase
    .from("transaction_statements")
    .select("extracted_data, po_scope")
    .eq("id", statementId)
    .single()

  const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date || null
  const poScope = (existingStatement?.po_scope as "single" | "multi" | null) || null

  await supabase
    .from("transaction_statement_items")
    .delete()
    .eq("statement_id", statementId)

  const extractedData = preservedActualReceivedDate
    ? { actual_received_date: preservedActualReceivedDate }
    : null

  await supabase
    .from("transaction_statements")
    .update({
      status: "processing",
      statement_date: null,
      vendor_name: null,
      total_amount: null,
      tax_amount: null,
      grand_total: null,
      extraction_error: null,
      reset_before_extract: false,
      retry_count: 0,
      next_retry_at: null,
      last_error_at: null,
      processing_finished_at: null,
      confirmed_at: null,
      confirmed_by: null,
      confirmed_by_name: null,
      manager_confirmed_at: null,
      manager_confirmed_by: null,
      manager_confirmed_by_name: null,
      quantity_match_confirmed_at: null,
      quantity_match_confirmed_by: null,
      quantity_match_confirmed_by_name: null,
      extracted_data: extractedData,
    })
    .eq("id", statementId)

  return { poScope, preservedActualReceivedDate }
}

async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`)
  }
  return await response.arrayBuffer()
}

async function prepareImageInputs(buffer: ArrayBuffer): Promise<ImagePreparationResult> {
  const decodedImage = await decodeImageFromBuffer(buffer)
  const bytes = new Uint8Array(buffer)
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47

  const MAX_BASE64_BYTES = 4_800_000
  let base64Image = arrayBufferToBase64(buffer)
  let width = decodedImage?.width ?? null
  let height = decodedImage?.height ?? null
  let mediaType: "image/png" | "image/jpeg" = isPng ? "image/png" : "image/jpeg"

  if (base64Image.length > MAX_BASE64_BYTES && decodedImage) {
    let resized = decodedImage
    let scale = 0.85
    while (scale > 0.3) {
      const newW = Math.round(decodedImage.width * scale)
      const newH = Math.round(decodedImage.height * scale)
      resized = decodedImage.clone().resize(newW, newH)
      const encoded = await resized.encode(1)
      const candidate = uint8ArrayToBase64(encoded)
      if (candidate.length <= MAX_BASE64_BYTES) {
        base64Image = candidate
        width = resized.width
        height = resized.height
        mediaType = "image/png"
        break
      }
      scale -= 0.1
    }
  }

  return {
    base64Image,
    tileImages: [],
    tableBodyImage: null,
    width,
    height,
    rotated: false,
    rotatedPngBytes: null,
    mediaType,
  }
}

/**
 * EXIF Orientation 태그를 읽어서 필요한 회전 각도를 반환합니다.
 * 폰 카메라 사진은 EXIF에 방향 정보가 있으므로 이걸 먼저 사용합니다.
 * EXIF orientation 값: 1=정상, 3=180°, 6=90°CW, 8=270°CW
 */
function getExifRotation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  // JPEG 확인 (0xFFD8)
  if (view.byteLength < 14 || view.getUint16(0) !== 0xFFD8) return 0

  let offset = 2
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset)
    if (marker === 0xFFE1) {
      // APP1 (EXIF) 세그먼트 발견
      const segmentLength = view.getUint16(offset + 2)
      const exifOffset = offset + 4

      // "Exif\0\0" 확인
      if (view.byteLength < exifOffset + 6) return 0
      const exifHeader = String.fromCharCode(
        view.getUint8(exifOffset), view.getUint8(exifOffset + 1),
        view.getUint8(exifOffset + 2), view.getUint8(exifOffset + 3)
      )
      if (exifHeader !== "Exif") return 0

      const tiffOffset = exifOffset + 6
      if (view.byteLength < tiffOffset + 8) return 0

      // 바이트 오더 확인 (II=little-endian, MM=big-endian)
      const byteOrder = view.getUint16(tiffOffset)
      const isLittleEndian = byteOrder === 0x4949

      // IFD0 오프셋
      const ifdOffset = tiffOffset + (isLittleEndian
        ? view.getUint32(tiffOffset + 4, true)
        : view.getUint32(tiffOffset + 4, false))

      if (view.byteLength < ifdOffset + 2) return 0
      const numEntries = isLittleEndian
        ? view.getUint16(ifdOffset, true)
        : view.getUint16(ifdOffset, false)

      // IFD 엔트리에서 Orientation 태그(0x0112) 검색
      for (let i = 0; i < numEntries; i++) {
        const entryOffset = ifdOffset + 2 + i * 12
        if (view.byteLength < entryOffset + 12) break

        const tag = isLittleEndian
          ? view.getUint16(entryOffset, true)
          : view.getUint16(entryOffset, false)

        if (tag === 0x0112) {
          const orientation = isLittleEndian
            ? view.getUint16(entryOffset + 8, true)
            : view.getUint16(entryOffset + 8, false)

          // orientation → 시계방향 회전 각도 변환
          switch (orientation) {
            case 3: return 180
            case 6: return 90
            case 8: return 270
            default: return 0
          }
        }
      }
      return 0
    } else if ((marker & 0xFF00) !== 0xFF00) {
      break // JPEG 마커가 아님
    } else {
      // 다른 세그먼트 건너뛰기
      if (offset + 2 >= view.byteLength) break
      const length = view.getUint16(offset + 2)
      offset += 2 + length
    }
  }
  return 0
}

/**
 * AI 기반 문서 방향 감지 (EXIF가 없는 이미지용 - 스캐너, PNG 등)
 * "몇 도 돌려야 하나" 대신 "문서 위쪽이 어느 방향인지"를 물어서 방향 혼동을 방지
 */
async function detectImageOrientationByAI(base64Image: string, apiKey: string, mediaType: "image/png" | "image/jpeg" = "image/jpeg", model = "claude-sonnet-4-6"): Promise<number> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 50,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: `이 이미지는 한국어 거래명세서/영수증 등의 문서입니다.
문서의 제목("거래명세서", "거래명세표" 등)이 이미지에서 어느 위치에 있는지 판단하세요.

- 제목이 이미지 위쪽에 있으면 → "top" (정상 방향)
- 제목이 이미지 오른쪽에 있으면 → "right" (시계 90도 회전 필요)
- 제목이 이미지 아래쪽에 있으면 → "bottom" (180도 회전 필요)
- 제목이 이미지 왼쪽에 있으면 → "left" (반시계 90도 = 시계 270도 회전 필요)

반드시 JSON만 응답: {"title_position": "top" 또는 "right" 또는 "bottom" 또는 "left"}`,
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) return 0

    const result = await response.json()
    const text = (result?.content || [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b?.text || "")
      .join("")
      .trim()

    const match = text.match(/"title_position"\s*:\s*"(top|right|bottom|left)"/)
    if (!match) return 0

    const positionToRotation: Record<string, number> = {
      "top": 0,
      "right": 270,
      "bottom": 180,
      "left": 90,
    }
    return positionToRotation[match[1]] ?? 0
  } catch (_) {
    return 0
  }
}

/**
 * 이미지 방향 감지
 * - AI 비전으로 문서 제목 위치를 판단하여 회전 각도 결정
 * - EXIF는 참고용으로만 기록 (이미지 라이브러리가 자동 적용할 수 있으므로 직접 사용 안 함)
 */
async function detectImageOrientation(base64Image: string, apiKey: string, mediaType: "image/png" | "image/jpeg" = "image/jpeg", model = "claude-sonnet-4-6", imageBuffer?: ArrayBuffer): Promise<{ degrees: number; source: "exif" | "ai" | "none"; exifHint?: number }> {
  // 1) EXIF 우선 (휴대폰 카메라는 EXIF 회전 정보가 정확함)
  let exifHint = 0
  if (imageBuffer && mediaType === "image/jpeg") {
    exifHint = getExifRotation(imageBuffer)
    if (exifHint > 0) {
      return { degrees: exifHint, source: "exif", exifHint }
    }
  }

  // 2) EXIF 없으면 (스캐너 / PNG 등) AI 비전 fallback
  const aiRotation = await detectImageOrientationByAI(base64Image, apiKey, mediaType, model)
  if (aiRotation > 0) {
    return { degrees: aiRotation, source: "ai", exifHint }
  }

  return { degrees: 0, source: "none", exifHint }
}

async function decodeImageFromBuffer(buffer: ArrayBuffer): Promise<Image | null> {
  try {
    return await Image.decode(new Uint8Array(buffer))
  } catch (_) {
    return null
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buffer))
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function encodeImageToBase64(image: Image): Promise<string> {
  const encoded = await image.encode(1)
  return uint8ArrayToBase64(encoded)
}

function applyContrast(image: Image, contrast: number): void {
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const data = image.bitmap
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampColor(factor * (data[i] - 128) + 128)
    data[i + 1] = clampColor(factor * (data[i + 1] - 128) + 128)
    data[i + 2] = clampColor(factor * (data[i + 2] - 128) + 128)
  }
}

function applySharpen(image: Image): void {
  const width = image.width
  const height = image.height
  const data = image.bitmap
  const output = new Uint8ClampedArray(data.length)
  output.set(data)

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (y * width + x) * 4
      for (let c = 0; c < 3; c += 1) {
        const center = data[idx + c]
        const top = data[((y - 1) * width + x) * 4 + c]
        const bottom = data[((y + 1) * width + x) * 4 + c]
        const left = data[(y * width + (x - 1)) * 4 + c]
        const right = data[(y * width + (x + 1)) * 4 + c]
        output[idx + c] = clampColor((5 * center) - top - bottom - left - right)
      }
    }
  }

  data.set(output)
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function detectMediaType(base64: string): "image/png" | "image/jpeg" {
  return base64.startsWith("iVBOR") ? "image/png" : "image/jpeg"
}

async function buildImageTiles(image: Image): Promise<string[]> {
  const minDim = Math.min(image.width, image.height)
  if (minDim < 700) return []

  const tiles: string[] = []

  // 가로형 거래명세서는 헤더/품목표/우측 숫자열을 분리 타일링한다.
  if (image.width > image.height * 1.1) {
    const w = image.width
    const h = image.height
    const bodyY = Math.max(0, Math.floor(h * 0.28))
    const bodyH = Math.max(220, Math.floor(h * 0.58))

    const regions = [
      { x: 0, y: 0, w, h: Math.max(180, Math.floor(h * 0.34)) }, // 상단 헤더
      { x: 0, y: bodyY, w, h: Math.min(bodyH, h - bodyY) }, // 전체 품목표
      { x: 0, y: bodyY, w: Math.floor(w * 0.58), h: Math.min(bodyH, h - bodyY) }, // 품명/규격
      { x: Math.floor(w * 0.52), y: bodyY, w: Math.ceil(w * 0.48), h: Math.min(bodyH, h - bodyY) }, // 수량/단가/금액
    ]

    for (const region of regions) {
      const x = Math.max(0, Math.min(w - 1, region.x))
      const y = Math.max(0, Math.min(h - 1, region.y))
      const width = Math.max(1, Math.min(region.w, w - x))
      const height = Math.max(1, Math.min(region.h, h - y))
      const tile = image.clone().crop(x, y, width, height)
      tiles.push(await encodeImageToBase64(tile))
    }

    return tiles
  }

  const rows = 2
  const cols = 2
  const tileWidth = Math.ceil(image.width / cols)
  const tileHeight = Math.ceil(image.height / rows)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const offsetX = col * tileWidth
      const offsetY = row * tileHeight
      const width = Math.min(tileWidth, image.width - offsetX)
      const height = Math.min(tileHeight, image.height - offsetY)
      if (width <= 0 || height <= 0) continue

      const tile = image.clone().crop(offsetX, offsetY, width, height)
      tiles.push(await encodeImageToBase64(tile))
    }
  }

  return tiles
}

async function extractWithClaudeSonnet(params: {
  base64Image: string
  tileImages: string[]
  apiKey: string
  model: string
  poScope: "single" | "multi" | null
  mediaType?: "image/png" | "image/jpeg"
  receiptMode?: boolean
}): Promise<ExtractionResult> {
  const { base64Image, tileImages, apiKey, model, poScope, mediaType = "image/jpeg", receiptMode = false } = params

  const scopeHint = poScope === "single"
    ? "이 거래명세서는 단일 발주/수주 건입니다. 발주/수주번호가 없더라도 같은 건으로 취급하세요."
    : poScope === "multi"
      ? "이 거래명세서는 다중 발주/수주 건입니다. 품목별로 번호를 분리하세요."
      : ""

  const receiptHint = receiptMode
    ? `[입고수량 모드] 이 거래명세서는 입고수량 확인용입니다. 단가(unit_price), 금액(amount), 세액(tax_amount), 합계금액(total_amount, grand_total)은 모두 null로 설정하세요. 수량(quantity)과 품목명/규격/발주번호만 정확히 추출하세요.`
    : ""

  const prompt = `거래명세서 이미지를 보고 아래 스키마로 JSON만 반환하세요.

${receiptHint ? `${receiptHint}\n` : ""}${scopeHint ? `발주/수주 범위 힌트: ${scopeHint}` : ""}

[거래처 식별 규칙]
- "귀중/귀사/귀하/貴下" 옆 회사는 받는 회사이므로 vendor_name이 아님
- "공급자/공급하는 자/(인)/도장" 쪽의 "상호" 회사명이 vendor_name
- 성명/대표자 개인 이름은 vendor_name이 아님 (회사명/상호를 찾을 것)
- raw_text에는 문서 상단의 거래처 정보(상호, 사업자번호, 주소 등)를 반드시 포함

[핵심 추출 규칙]
1) 헤더 행을 먼저 식별하고 칼럼 의미를 확정한 뒤 값 추출
2) 이 문서는 여러 페이지 중 1페이지일 수 있음. 현재 페이지에 실제로 보이는 품목 행만 추출
3) 하단 빈 여백/그림자/배경은 무시
4) 수량은 수량 칸 내부 숫자만 사용 (옆 칼럼 숫자 붙임 금지)
5) 단가가 비어있으면 null (금액 값을 단가로 이동 금지)
6) 품목명이 빈 칸이어도 규격/수량/단가/금액 중 하나가 있으면 반드시 별도 행으로 포함
7) 합계/소계/공급가액/부가세/합계금액/청구금액/인수자/입금/은행계좌 같은 푸터 행은 items에서 제외
8) item_name에는 반드시 "품명" 칼럼 OCR 원문을 그대로 기록 (재작성/치환/추정 금지)
9) 품명이 영문+숫자 코드여도 그대로 item_name에 기록 (진짜 공백행이 아니면 빈값 금지)
10) item_name에 F... 또는 HS... 발주/수주번호 패턴을 넣지 말 것 (발견 시 품명 칼럼을 다시 읽어 교정)
11) 발주/수주번호는 "비고", "규격", 별도 "발주/수주번호" 열, 우측 끝 보조열, 행 주변 수기 메모, 문서 여백/빈 공간의 손글씨 메모 등 문서 어디에 있어도 해당 행의 po_number로 추출. 특히 종이 상단/하단/좌우 여백에 수기(손글씨)로 적힌 F... 또는 HS... 패턴의 발주/수주번호를 반드시 확인하고, 발견 시 모든 품목의 po_number로 사용할 것
12) 같은 행에서 발주/수주번호가 발견되면 specification/item_name/remark에 섞지 말고 po_number로만 분리
13) "규격" 칼럼 텍스트는 specification에 기록. 규격 칼럼의 발주/수주번호 패턴은 po_number/po_line_number로 별도 분리
14) 다중 발주/수주 문서에서는 행마다 번호가 다를 수 있으므로 행별 번호를 유지하고 임의로 동일 번호를 복제하지 말 것
15) 단일 발주/수주 문서에서 공통 번호가 1개만 보이면 각 행에 동일 po_number를 채워도 됨
16) 해당 행에서 번호를 확인하지 못하면 po_number는 빈 문자열로 둘 것 (추측 금지)
17) 계좌번호(예: 632-023543-01-017)는 specification/item_name 어디에도 넣지 말고 비품목 텍스트로 무시
18) 단가의 소수점 표기를 유지 (예: 1.70, 23.00). 170/2300/1,700으로 스케일 변경 금지
19) amount는 금액 셀에 인쇄된 숫자를 그대로 사용
20) 각 행에서 quantity * unit_price가 amount와 크게 다르면(±5% 초과) 셀을 다시 읽어 교정
21) 실제 품목 행 수를 임의로 늘리지 말고, 보이지 않는 값을 추측하지 말 것 (unreadable이면 빈 문자열/null + confidence=low)
22) item_name에 "품명"/"품목"/"ITEM" 같은 헤더 라벨을 값으로 넣지 말 것
23) 테이블의 모든 행을 있는 그대로 추출할 것. 품명 칸에 "ENIG(화학금도금)", "필름", "V-CUT", "네고", "잉크비" 등 부자재/공정/할인 항목이 있으면 그대로 별도 행으로 포함. 품명 칸이 완전히 비어있어도 금액이 있으면 별도 행으로 포함 (직전 품명으로 병합 금지)
24) line_number는 거래명세서의 No/번호 칼럼에 인쇄된 숫자를 그대로 사용할 것 (예: 29, 30, 43 등). 1부터 오름차순으로 임의 부여 금지. 번호 칼럼이 없으면 행 순서대로 1부터 부여

[발주/수주번호 규칙]
- 발주번호: FYYYYMMDD_NNN (예: F20260209_003)
- 수주번호: HSYYMMDD-NN (예: HS260209-01)
- 문서에 suffix 라인번호가 함께 있으면 보존 가능 (예: F20260209_003-14)
- 문서에 인쇄된 원형이 F20260209_3 / F20260209-03 / HS260209_1 처럼 0이 빠져도 원형을 읽어 po_number에 기록

[응답 스키마]
{
  "statement_date": "YYYY-MM-DD 또는 null",
  "vendor_name": "공급자명 또는 null",
  "vendor_name_english": "영문 추정명 또는 null",
  "total_amount": 숫자 또는 null,
  "tax_amount": 숫자 또는 null,
  "grand_total": 숫자 또는 null,
  "raw_text": "문서 핵심 텍스트(선택, 현재 페이지 기준)",
  "items": [
    {
      "line_number": "문서 No/번호 칼럼 숫자 (없으면 행 순서)",
      "item_name": "",
      "specification": "",
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "tax_amount": null,
      "po_number": "",
      "remark": "",
      "confidence": "low|med|high"
    }
  ]
}

반드시 JSON만 응답하세요.`

  const contentBlocks: any[] = [
    { type: "text", text: prompt },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64Image,
      },
    },
  ]

  tileImages.slice(0, 4).forEach((tile) => {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: tile,
      },
    })
  })

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      system:
        "You are an expert at extracting structured data from Korean transaction statements. Return strict JSON only.",
      messages: [
        {
          role: "user",
          content: contentBlocks,
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Claude API request failed: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block?.text || "")
    .join("\n")
    .trim()

  if (!textContent) {
    throw new Error("No text content in Claude response")
  }

  const parsed = parseStrictJson(textContent)
  return normalizeExtractionResult(parsed)
}

async function extractItemsFromTableCropWithClaude(params: {
  tableBodyImage: string
  apiKey: string
  model: string
}): Promise<ExtractedItem[]> {
  const { tableBodyImage, apiKey, model } = params

  const prompt = `다음 이미지는 거래명세서의 품목 본문 테이블(품명/규격/수량/단가/금액) 영역만 잘라낸 것입니다.

[규칙]
- 보이는 데이터 행만 추출
- 품명은 item_name (OCR 원문 그대로), 규격은 specification
- 수량/단가/금액 숫자를 셀 그대로 읽기
- 소수점 단가 유지 (예: 1.70)
- 규격의 FYYYYMMDD_XXX-YY / HSYYMMDD-NN-YY 패턴은 po_number/po_line_number로 분리
- 발주/수주번호가 규격 외 다른 열(비고/별도열/우측열)에 있으면 해당 행 po_number로 기록
- item_name에 F.../HS... 번호를 넣지 말 것
- item_name이 "품명"/"품목"/"ITEM" 라벨이면 오인식으로 보고 실제 품명으로 교정
- 합계/공급가액/부가세/합계금액/계좌번호/서명/인수자 행은 제외
- line_number는 문서의 No/번호 칼럼에 인쇄된 숫자를 그대로 사용 (1부터 임의 부여 금지)

응답 JSON:
{
  "items":[
    {
      "line_number":"문서 No/번호 칼럼 숫자",
      "item_name":"",
      "specification":"",
      "quantity":null,
      "unit_price":null,
      "amount":0,
      "tax_amount":null,
      "po_number":"",
      "remark":"",
      "confidence":"low|med|high"
    }
  ]
}

JSON만 반환하세요.`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3072,
      temperature: 0,
      system: "Extract only table rows from this crop. Return strict JSON.",
      messages: [
        { 
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: detectMediaType(tableBodyImage),
                data: tableBodyImage,
              },
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Claude table items request failed: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block?.text || "")
    .join("\n")
    .trim()

  if (!textContent) {
    throw new Error("No text content in table items response")
  }

  const parsed = parseStrictJson(textContent)
  const rows: any[] = Array.isArray(parsed?.items) ? parsed.items : []
  return rows
    .map((row, idx) => normalizeItemRecord(row, idx + 1))
    .filter((row): row is ExtractedItem => Boolean(row))
}

async function recoverItemNamesWithClaude(params: {
  base64Image: string
  tileImages: string[]
  apiKey: string
  model: string
}): Promise<string[]> {
  const { base64Image, tileImages, apiKey, model } = params

  const prompt = `거래명세서 이미지에서 품목표의 "품명" 칼럼 값만 추출하세요.

[규칙]
- 위에서 아래 순서대로 품명 원문만 반환
- 헤더 라벨(품명/품목/규격/수량/단가/금액/비고/ITEM) 제외
- 합계/공급가액/부가세/합계금액/계좌번호/서명/인수자 행 제외
- 발주/수주번호(F.../HS...)만 있는 값은 제외
- 빈 칸 행 제외

응답 JSON:
{
  "item_names": ["...", "..."]
}

JSON만 반환하세요.`

  const contentBlocks: any[] = [
    { type: "text", text: prompt },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(base64Image),
        data: base64Image,
      },
    },
  ]

  tileImages.slice(0, 2).forEach((tile) => {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(tile),
        data: tile,
      },
    })
  })

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0,
      system: "Extract only item_name column values. Return strict JSON.",
      messages: [{ role: "user", content: contentBlocks }],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Claude item name recovery failed: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block?.text || "")
    .join("\n")
    .trim()

  if (!textContent) return []

  const parsed = parseStrictJson(textContent)
  const names = Array.isArray(parsed?.item_names) ? parsed.item_names : []
  return names
    .map((value) => sanitizeText(value))
    .filter((value) => (
      Boolean(value) &&
      !isHeaderLikeItemName(value) &&
      !looksLikeOrderToken(value) &&
      !looksLikeBankAccount(value)
    ))
}

function shouldRecoverItemNames(items: ExtractedItem[]): boolean {
  if (!items.length) return false
  const weakNameCount = items.filter((item) => (
    !item.item_name ||
    isHeaderLikeItemName(item.item_name) ||
    looksLikeOrderToken(item.item_name)
  )).length
  return weakNameCount / items.length >= 0.35
}

function mergeRecoveredItemNames(items: ExtractedItem[], recoveredNames: string[]): ExtractedItem[] {
  if (!items.length || !recoveredNames.length) return items

  const usableNames = recoveredNames
    .map((value) => sanitizeText(value))
    .filter((value) => (
      Boolean(value) &&
      !isHeaderLikeItemName(value) &&
      !looksLikeOrderToken(value) &&
      !looksLikeBankAccount(value)
    ))

  if (!usableNames.length) return items

  let cursor = 0
  return items.map((item) => {
    const needsName = !item.item_name || isHeaderLikeItemName(item.item_name) || looksLikeOrderToken(item.item_name)
    if (!needsName) return item
    if (cursor >= usableNames.length) return item

    const nextName = usableNames[cursor]
    cursor += 1
    return { ...item, item_name: nextName }
  })
}

async function refineExtractionWithClaudeSonnet(params: {
  base64Image: string
  tileImages: string[]
  apiKey: string
  model: string
  poScope: "single" | "multi" | null
  initialResult: ExtractionResult
}): Promise<ExtractionResult> {
  const { base64Image, tileImages, apiKey, model, poScope, initialResult } = params

  const scopeHint = poScope === "single"
    ? "단일 발주/수주 페이지 가능성이 높으니 동일 기준으로 검증"
    : poScope === "multi"
      ? "다중 발주/수주 번호가 섞일 수 있으니 행별 분리 유지"
      : "범위 미지정"

  const prompt = `아래는 1차 추출 결과입니다. 이미지와 대조하여 오인식만 교정하세요.

[중요 검증]
- item_name은 반드시 품명 칼럼 OCR 원문 텍스트. 규격/계좌번호/발주번호를 item_name으로 넣지 말 것
- item_name이 F.../HS... 패턴이면 오인식으로 간주하고 품명 칼럼을 다시 읽어 교정
- item_name이 "품명"/"품목"/"ITEM" 라벨이면 오인식으로 간주하고 실제 품명으로 교정
- specification은 규격 칼럼 텍스트
- 규격 칼럼의 FYYYYMMDD_XXX-YY / HSYYMMDD-NN-YY는 po_number/po_line_number로만 처리
- 발주/수주번호는 규격 외 다른 열(비고/별도열/우측열/수기 메모)에서 발견돼도 해당 행 po_number에 반영
- 다중 발주/수주 문서는 행별 번호를 유지하고, 확인되지 않은 행의 po_number는 빈 문자열 유지
- 계좌번호(예: 632-023543-01-017), 공급가액/부가세/합계금액 행은 items에서 제거
- quantity/unit_price/amount는 각 칼럼 숫자를 그대로 사용
- 단가 소수점 유지 (1.70을 170으로 바꾸지 말 것)
- amount는 금액 칼럼 인쇄값 우선
- 품목 실행 수 기준으로 교정하고, 비품목(푸터/계좌/서명) 행은 삭제 가능
- po_number는 F.../HS... 패턴만

현재 1차 결과(JSON):
${JSON.stringify(initialResult)}

동일 스키마 JSON만 반환하세요.`

  const contentBlocks: any[] = [
    { type: "text", text: prompt },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(base64Image),
        data: base64Image,
      },
    },
    {
      type: "text",
      text: `발주/수주 범위 힌트: ${scopeHint}`,
    },
  ]

  tileImages.slice(0, 4).forEach((tile) => {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(tile),
        data: tile,
      },
    })
  })

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: "You are validating OCR extraction quality. Return strict JSON only.",
      messages: [{ role: "user", content: contentBlocks }],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Claude refine request failed: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block?.text || "")
    .join("\n")
    .trim()

  if (!textContent) {
    throw new Error("No text content in Claude refine response")
  }

  return normalizeExtractionResult(parseStrictJson(textContent))
}

function scoreExtractionQuality(items: ExtractedItem[]): number {
  if (!items.length) return 0
  let score = 0
  for (const item of items) {
    const hasName = Boolean(
      item.item_name &&
      !looksLikeOrderToken(item.item_name) &&
      !isHeaderLikeItemName(item.item_name)
    )
    const hasAmount = item.amount > 0
    const consistent = !isArithmeticMismatch(item.quantity ?? null, item.unit_price ?? null, item.amount)
    const hasPoLine = Boolean(item.po_number && item.po_line_number)

    score += hasName ? 3 : 0
    score += hasAmount ? 2 : 0
    score += consistent ? 2 : 0
    score += hasPoLine ? 1 : 0
  }

  return (score / (items.length * 8)) * 100
}

function shouldRunTableBodyFallback(items: ExtractedItem[]): boolean {
  if (!items.length) return true
  const weakNameCount = items.filter((item) => (
    !item.item_name ||
    isHeaderLikeItemName(item.item_name) ||
    looksLikeOrderToken(item.item_name)
  )).length
  const noPoCount = items.filter((item) => !item.po_number).length
  const likelyFooterOnly = items.every((item) => {
    const spec = item.specification || ""
    return /^(\d{3,4}-\d{3,6}-\d{2}-\d{3}|[\d,.-]+)$/.test(spec)
  })

  return weakNameCount / items.length >= 0.5 || noPoCount === items.length || likelyFooterOnly
}

async function extractTableBodyFallbackWithClaude(params: {
  base64Image: string
  tileImages: string[]
  apiKey: string
  model: string
}): Promise<ExtractionResult> {
  const { base64Image, tileImages, apiKey, model } = params

  const prompt = `거래명세서의 "품목 본문 테이블"만 추출하세요.

[반드시 지킬 것]
- 추출 대상은 헤더(품명/규격/수량/단가/금액) 아래부터 하단 합계행(공급가액/부가세/합계금액) 위까지
- 공급가액/부가세/합계금액/인수자/기업은행 계좌번호는 절대 items에 넣지 말 것
- 계좌번호(예: 632-023543-01-017) 같은 문자열은 specification으로도 사용 금지
- 품명 칼럼 OCR 원문 텍스트를 item_name에 기록
- item_name에 F.../HS... 패턴 금지 (해당 값은 po_number/po_line_number로만 처리)
- item_name에 "품명"/"품목"/"ITEM" 라벨 금지 (실제 품명으로 교정)
- 규격 칼럼의 FYYYYMMDD_XXX-YY / HSYYMMDD-NN-YY 패턴은 po_number/po_line_number로 추출
- row를 임의 생성하지 말고 화면에 보이는 행만 추출
- line_number는 문서의 No/번호 칼럼에 인쇄된 숫자를 그대로 사용 (1부터 임의 부여 금지)

JSON 스키마:
{
  "statement_date": "YYYY-MM-DD 또는 null",
  "vendor_name": "string 또는 null",
  "vendor_name_english": "string 또는 null",
  "total_amount": number 또는 null,
  "tax_amount": number 또는 null,
  "grand_total": number 또는 null,
  "raw_text": "string",
  "items": [
    {
      "line_number": "문서 No/번호 칼럼 숫자",
      "item_name": "",
      "specification": "",
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "tax_amount": null,
      "po_number": "",
      "remark": "",
      "confidence": "low|med|high"
    }
  ]
}

JSON만 반환하세요.`

  const contentBlocks: any[] = [
    { type: "text", text: prompt },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(base64Image),
        data: base64Image,
      },
    },
  ]

  tileImages.slice(0, 4).forEach((tile) => {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: detectMediaType(tile),
        data: tile,
      },
    })
  })

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: "You extract only table body rows from Korean statement images. Return strict JSON only.",
      messages: [{ role: "user", content: contentBlocks }],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Claude table fallback failed: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block?.text || "")
    .join("\n")
    .trim()

  if (!textContent) {
    throw new Error("No text content in table fallback response")
  }

  return normalizeExtractionResult(parseStrictJson(textContent))
}

function parseStrictJson(content: string): any {
  try {
    return JSON.parse(content)
  } catch (_) {
    // Continue to relaxed extraction
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch (_) {
      // Continue to fallback
    }
  }

  const firstBrace = content.indexOf("{")
  const lastBrace = content.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = content.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(sliced)
    } catch (_) {
      // Continue to throw
    }
  }

  throw new Error("Failed to parse JSON from Claude response")
}

function normalizeExtractionResult(raw: any): ExtractionResult {
  const rawItems: any[] = Array.isArray(raw?.items) ? raw.items : []
  const normalizedItems = rawItems
    .map((item, idx) => normalizeItemRecord(item, idx + 1))
    .filter((item): item is ExtractedItem => Boolean(item))

  const items = fillEmptyItemNames(normalizedItems)

  const summedAmount = items.reduce((acc, item) => acc + (item.amount || 0), 0)
  const summedTax = items.reduce((acc, item) => acc + (item.tax_amount || 0), 0)

  const totalAmount = parseNullableAmount(raw?.total_amount) ?? (summedAmount > 0 ? summedAmount : undefined)
  const taxAmount = parseNullableAmount(raw?.tax_amount) ?? (summedTax > 0 ? summedTax : undefined)
  const grandTotal = parseNullableAmount(raw?.grand_total) ?? (
    totalAmount !== undefined ? totalAmount + (taxAmount || 0) : undefined
  )

  return {
    statement_date: normalizeDate(raw?.statement_date),
    vendor_name: sanitizeText(raw?.vendor_name) || undefined,
    vendor_name_english: sanitizeText(raw?.vendor_name_english) || undefined,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    items,
    raw_text: sanitizeText(raw?.raw_text)?.slice(0, 12000) || undefined,
  }
}

function fillEmptyItemNames(items: ExtractedItem[]): ExtractedItem[] {
  if (items.length <= 1) return items
  let lastKnownName = ""
  const filled = items.map((item) => {
    if (item.item_name && !isHeaderLikeItemName(item.item_name) && !looksLikeOrderToken(item.item_name)) {
      lastKnownName = item.item_name
      return item
    }
    if (!item.item_name && lastKnownName) {
      return { ...item, item_name: lastKnownName }
    }
    return item
  })
  return mergeDuplicateItemNamesWithSpec(filled)
}

function mergeDuplicateItemNamesWithSpec(items: ExtractedItem[]): ExtractedItem[] {
  if (items.length <= 1) return items

  const nameCounts = new Map<string, number>()
  for (const item of items) {
    if (!item.item_name) continue
    nameCounts.set(item.item_name, (nameCounts.get(item.item_name) || 0) + 1)
  }

  return items.map((item) => {
    if (!item.item_name) return item
    const count = nameCounts.get(item.item_name) || 0
    if (count <= 1) return item
    if (!item.specification) return item

    const spec = item.specification.trim()
    if (!spec) return item
    if (item.item_name.includes(spec)) return item

    return {
      ...item,
      item_name: `${item.item_name}-${spec}`,
    }
  })
}

function normalizeItemRecord(raw: any, fallbackLineNumber: number): ExtractedItem | null {
  const rawItemName = sanitizeText(raw?.item_name)
  const itemName = isHeaderLikeItemName(rawItemName) ? "" : rawItemName
  const specification = sanitizeText(raw?.specification)
  let quantity = parseNullableInteger(raw?.quantity)
  const unitPrice = parseNullableAmount(raw?.unit_price)
  let amount = parseNullableAmount(raw?.amount)
  const taxAmount = parseNullableAmount(raw?.tax_amount)
  const remark = sanitizeText(raw?.remark)

  const poFromFields = extractOrderNumber(
    `${sanitizeText(raw?.po_number)} ${remark} ${itemName} ${specification}`
  )
  const parsedPo = poFromFields ? parseOrderToken(poFromFields) : null

  if (amount === null) {
    if (quantity !== null && unitPrice !== null) {
      amount = quantity * unitPrice
    } else {
      amount = 0
    }
  }

  const hasMeaningfulField =
    Boolean(itemName) ||
    Boolean(specification) ||
    quantity !== null ||
    unitPrice !== null ||
    amount !== 0 ||
    Boolean(remark) ||
    Boolean(parsedPo?.normalized)

  if (!hasMeaningfulField) {
    return null
  }

  if (isLikelyNonItemRow({
    itemName,
    specification,
    remark,
    quantity,
    unitPrice,
    amount,
    poNumber: parsedPo?.normalized,
  })) {
    return null
  }

  const lineNumber = parseLineNumber(raw?.line_number) || fallbackLineNumber

  // 수량이 비어 있는 품목은 null 그대로 둔다.
  // (월말결제 등에서 수량 컬럼 자체가 없는 경우 1로 강제 채우면 잘못된 데이터가 생성됨.)
  // 다운스트림에서 quantity가 null인 행은 입고/매칭 보너스 점수에서 자연스럽게 제외된다.

  return {
    line_number: lineNumber,
    item_name: itemName || "",
    specification: specification || undefined,
    quantity,
    unit_price: unitPrice,
    amount: amount || 0,
    tax_amount: taxAmount,
    po_number: parsedPo?.normalized,
    po_line_number: parsedPo?.lineNumber,
    remark: remark || undefined,
    confidence: normalizeItemConfidence(raw?.confidence),
  }
}

function normalizeDate(value: unknown): string | undefined {
  const text = sanitizeText(value)
  if (!text) return undefined

  const fullDate = text.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/)
  if (fullDate) {
    const [, y, m, d] = fullDate
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return undefined
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

function parseLineNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.round(value)
    return parsed > 0 ? parsed : null
  }

  if (typeof value === "string") {
    const match = value.match(/\d+/)
    if (!match) return null
    const parsed = Number.parseInt(match[0], 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

function parseNullableInteger(value: unknown): number | null {
  const parsed = parseNullableAmount(value)
  if (parsed === null) return null
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed)
}

function parseNullableAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[,₩원$￦\s]/g, "")
      .replace(/[^\d.\-]/g, "")
      .trim()
    if (!cleaned || cleaned === "-" || cleaned === ".") return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function looksLikeBankAccount(value: string): boolean {
  if (!value) return false
  const compact = value.replace(/\s+/g, "")
  if (!compact.includes("-")) return false
  return /^(?:\d{2,4}-){2,5}\d{2,8}$/.test(compact) ||
    /\d{2,4}-\d{3,6}-\d{2,6}-\d{2,8}/.test(compact)
}

function hasFooterKeyword(value: string): boolean {
  if (!value) return false
  const compact = value.replace(/\s+/g, "")
  return /(공급가액|부가세|합계금액|총합계|청구금액|합계|입금|계좌|예금주|인수자|기업은행|신한은행|국민은행|농협|우리은행|은행)/.test(compact)
}

function isLikelyNonItemRow(params: {
  itemName: string
  specification: string
  remark: string
  quantity: number | null
  unitPrice: number | null
  amount: number
  poNumber?: string
}): boolean {
  const { itemName, specification, remark, quantity, unitPrice, amount, poNumber } = params
  const hasName = Boolean(itemName)
  const hasOrderToken = Boolean(poNumber)
  const hasQuantity = quantity !== null && quantity !== undefined
  const hasUnitPrice = unitPrice !== null && unitPrice !== undefined
  const combinedText = `${itemName} ${specification} ${remark}`.trim()
  const hasFooterText = hasFooterKeyword(combinedText)
  const hasBankAccountLikeText =
    looksLikeBankAccount(itemName) || looksLikeBankAccount(specification) || looksLikeBankAccount(remark)
  const hasTextSignal = /[A-Z가-힣]/i.test(`${specification}${remark}`)

  if (!hasName && !hasOrderToken && !specification && !remark) return true
  if (!hasName && !hasOrderToken && hasFooterText) return true
  if (!hasName && !hasOrderToken && hasBankAccountLikeText) return true
  // 금액만 있는 행도 유효한 항목(부자재/공정/할인 등)이므로 제거하지 않음

  return false
}

function normalizePoNumbers(
  items: ExtractedItem[],
  rawText: string | undefined,
  poScope: "single" | "multi" | null
): ExtractedItem[] {
  if (items.length === 0) return []

  const textNumbers = extractOrderNumbersFromText(rawText || "")
  const dominantNumber = pickDominantOrderNumber(textNumbers)

  return items.map((item) => {
    let parsed = item.po_number ? parseOrderToken(item.po_number) : null

    if (!parsed) {
      const fromFields = extractOrderNumber(
        `${item.remark || ""} ${item.specification || ""} ${item.item_name || ""}`
      )
      if (fromFields) {
        parsed = parseOrderToken(fromFields)
      }
    }

    if (!parsed && poScope === "single" && dominantNumber) {
      parsed = parseOrderToken(dominantNumber)
    }

    return {
      ...item,
      po_number: parsed?.normalized || undefined,
      po_line_number: parsed?.lineNumber ?? item.po_line_number,
      confidence: normalizeItemConfidence(item.confidence),
    }
  })
}

function extractOrderNumbersFromText(text: string): string[] {
  if (!text) return []
  const normalized = text.toUpperCase().replace(/\s+/g, "")
  const matches = normalized.match(
    /F\d{8}[_-]\d{1,3}(?:[-_]\d{1,3})?|HS\d{6}[-_]\d{1,2}(?:[-_]\d{1,3})?/g
  )
  if (!matches) return []
  return matches
    .map((token) => parseOrderToken(token)?.normalized || "")
    .filter(Boolean)
}

function extractOrderNumber(text: string): string | null {
  if (!text) return null
  const normalized = text.toUpperCase()
  const match = normalized.match(
    /(F\d{8}[_-]\d{1,3}(?:[-_]\d{1,3})?|HS\d{6}[-_]\d{1,2}(?:[-_]\d{1,3})?)/
  )
  return match ? match[1] : null
}

function parseOrderToken(value: string): ParsedOrderToken | null {
  const cleaned = normalizeOrderCandidate(value)
    if (!cleaned) return null

  const poMatch = cleaned.match(/^(F\d{8})[_-](\d{1,3})(?:[-_](\d{1,3}))?$/)
  if (poMatch) {
    const lineNumber = poMatch[3] ? Number.parseInt(poMatch[3], 10) : undefined
    return {
      normalized: `${poMatch[1]}_${poMatch[2].padStart(3, "0")}`,
      kind: "po",
      lineNumber: Number.isFinite(lineNumber as number) ? lineNumber : undefined,
    }
  }

  const soMatch = cleaned.match(/^(HS\d{6})[-_](\d{1,2})(?:[-_](\d{1,3}))?$/)
  if (soMatch) {
    const lineNumber = soMatch[3] ? Number.parseInt(soMatch[3], 10) : undefined
    return {
      normalized: `${soMatch[1]}-${soMatch[2].padStart(2, "0")}`,
      kind: "so",
      lineNumber: Number.isFinite(lineNumber as number) ? lineNumber : undefined,
    }
  }

      return null
}

function normalizeOrderCandidate(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^\w-]/g, "")
}

function normalizeOrderToken(value: string): string {
  const parsed = parseOrderToken(value)
  return parsed?.normalized || ""
}

function pickDominantOrderNumber(numbers: string[]): string | null {
  if (!numbers.length) return null
  const counter = new Map<string, number>()
  numbers.forEach((value) => {
    counter.set(value, (counter.get(value) || 0) + 1)
  })
  const sorted = Array.from(counter.entries()).sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] || null
}

function collectVendorHints(result: ExtractionResult): string[] {
  const set = new Set<string>()
  if (result.vendor_name) set.add(result.vendor_name)
  if (result.vendor_name_english) set.add(result.vendor_name_english)
  if (result.raw_text) {
    const lines = result.raw_text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    lines.slice(0, 30).forEach((line) => set.add(line))
  }
  return Array.from(set)
}

async function resolveVendor(
  supabase: any,
  extraction: ExtractionResult,
  inferredVendorName?: string,
  inferredVendorId?: number
): Promise<VendorResolution> {
  if (inferredVendorName) {
    return {
      vendorName: inferredVendorName,
      vendorId: inferredVendorId,
      source: "po_infer",
    }
  }

  if (extraction.vendor_name) {
    const matched = await validateAndMatchVendor(supabase, extraction.vendor_name)
    if (matched.matched) {
      return {
        vendorName: matched.vendor_name,
        vendorId: matched.vendor_id,
        source: "gpt_extract",
      }
    }
  }

  if (extraction.vendor_name_english) {
    const matched = await validateAndMatchVendor(supabase, extraction.vendor_name_english)
    if (matched.matched) {
      return {
        vendorName: matched.vendor_name,
        vendorId: matched.vendor_id,
        source: "gpt_extract",
      }
    }
  }

  if (extraction.raw_text) {
    const matchedFromText = await findVendorInText(supabase, extraction.raw_text)
    if (matchedFromText.matched) {
      return {
        vendorName: matchedFromText.vendor_name,
        vendorId: matchedFromText.vendor_id,
        source: "text_scan",
      }
    }
  }

  return { source: "not_found" }
}

function buildInferredPoMap(items: ExtractedItem[]): Map<number, InferredPoInfo> {
  const map = new Map<number, InferredPoInfo>()
  const dominant = pickDominantOrderNumber(
    items.map((item) => item.po_number || "").filter(Boolean)
  )

  items.forEach((item, index) => {
    const lineNumber = item.line_number || index + 1
    if (item.po_number) {
      map.set(lineNumber, {
        inferred_po_number: item.po_number,
        inferred_po_source: "per_item",
        inferred_po_confidence: confidenceToNumeric(item.confidence),
        inferred_po_group_id: `per-item-${item.po_number}`,
      })
      return
    }

    if (dominant) {
      map.set(lineNumber, {
        inferred_po_number: dominant,
        inferred_po_source: "global",
        inferred_po_confidence: 0.45,
        inferred_po_group_id: `global-${dominant}`,
      })
    }
  })

  return map
}

function confidenceToNumeric(value: unknown): number {
  const normalized = normalizeItemConfidence(value)
  if (normalized === "high") return 0.9
  if (normalized === "med") return 0.65
  return 0.4
}

async function correctOrderNumbersByDb(
  supabase: any,
  items: ExtractedItem[],
  hints: OrderCorrectionHints = {}
): Promise<OrderCorrectionResult> {
  if (!items.length) return { items }

  const vendorNameHints = Array.from(
    new Set(
      (hints.vendorNameHints || [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  )

  const numberCounts = new Map<string, number>()
  items.forEach((item) => {
    if (!item.po_number) return
    numberCounts.set(item.po_number, (numberCounts.get(item.po_number) || 0) + 1)
  })

  const mostCommon = Array.from(numberCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!mostCommon) return { items }

  const isPO = /^F\d{8}_\d{3}$/.test(mostCommon)
  const isSO = /^HS\d{6}-\d{2}$/.test(mostCommon)
  if (!isPO && !isSO) return { items }

  const { data: exactCandidates } = await supabase
    .from("purchase_requests")
    .select(`
      id,
      vendor_id,
      purchase_order_number,
      sales_order_number,
      vendor:vendors(vendor_name),
      items:purchase_request_items(
        line_number,
        item_name,
        specification,
        quantity
      )
    `)
    .or(`purchase_order_number.eq.${mostCommon},sales_order_number.eq.${mostCommon}`)
    .limit(1)

  if (exactCandidates && exactCandidates.length > 0) {
    const exact = exactCandidates[0]
    const vendorName = (exact.vendor as { vendor_name?: string } | null)?.vendor_name
    // 발주번호가 정확히 일치하면 항상 신뢰 (OCR 거래처명이 틀릴 수 있음)
    const shouldTrustExact = true

    if (shouldTrustExact) {
      const canonical = normalizeOrderToken(
        isPO ? (exact.purchase_order_number || "") : (exact.sales_order_number || "")
      ) || mostCommon

      const corrected = items.map((item) => {
        const shouldApply =
          !item.po_number ||
          item.po_number === mostCommon ||
          (isPO && item.po_number && !hasValidPoDate(item.po_number))
      return {
          ...item,
          po_number: shouldApply ? canonical : item.po_number,
        }
      })

      return {
        items: corrected,
        inferredVendorName: vendorName,
        inferredVendorId:
          exact.vendor_id !== undefined && exact.vendor_id !== null
            ? Number(exact.vendor_id)
            : undefined,
        matchedPurchaseId: exact.id,
      }
    }
  }

  const useFallbackSuffix = isPO && !hasValidPoDate(mostCommon)
  const candidateLimit = useFallbackSuffix ? 120 : 40

  let query = supabase
    .from("purchase_requests")
    .select(`
      id,
      vendor_id,
      purchase_order_number,
      sales_order_number,
      vendor:vendors(vendor_name),
      items:purchase_request_items(
        line_number,
        item_name,
        specification,
        quantity
      )
    `)
    .limit(candidateLimit)

  if (isPO) {
    if (useFallbackSuffix) {
      const parsed = parsePoNumber(mostCommon)
    if (parsed) {
        query = query.ilike("purchase_order_number", `%_${parsed.seqPart}`)
    } else {
        query = query.ilike("purchase_order_number", `${mostCommon.slice(0, 9)}%`)
    }
  } else {
      query = query.ilike("purchase_order_number", `${mostCommon.slice(0, 9)}%`)
    }
  } else {
    query = query.ilike("sales_order_number", `${mostCommon.slice(0, 8)}%`)
  }

  const { data: candidates } = await query
  if (!candidates || candidates.length === 0) {
    return { items }
  }

  let bestCandidate: any = null
  let bestTotalScore = 0

  for (const candidate of candidates) {
    const candidateNumber = normalizeOrderToken(
      isPO ? (candidate.purchase_order_number || "") : (candidate.sales_order_number || "")
    )
    if (!candidateNumber) continue

    const orderScore = calculateOrderNumberSimilarity(mostCommon, candidateNumber)
    const itemScore = calculateCandidateItemSimilarity(items, candidate.items || [])
    const candidateVendorName = (candidate.vendor as { vendor_name?: string } | null)?.vendor_name
    const vendorHintScore = calculateVendorHintSimilarity(candidateVendorName, vendorNameHints)
    const vendorBonus = vendorHintScore === null ? 0 : Math.max(0, Math.round((vendorHintScore - 60) * 0.2))
    const preferredBonus =
      hints.preferredVendorId !== undefined && Number(candidate.vendor_id) === hints.preferredVendorId ? 8 : 0

    const totalScore = Math.round(orderScore * 0.45 + itemScore * 0.45 + vendorBonus + preferredBonus)
    if (totalScore > bestTotalScore) {
      bestTotalScore = totalScore
      bestCandidate = candidate
    }
  }

  if (!bestCandidate || bestTotalScore < 65) {
    return { items }
  }

  const correctedNumber = normalizeOrderToken(
    isPO ? (bestCandidate.purchase_order_number || "") : (bestCandidate.sales_order_number || "")
  )
  if (!correctedNumber) return { items }

  const correctedItems = items.map((item) => {
    const shouldApply =
      !item.po_number ||
      item.po_number === mostCommon ||
      (isPO && item.po_number && !hasValidPoDate(item.po_number))
    return {
      ...item,
      po_number: shouldApply ? correctedNumber : item.po_number,
    }
  })

  return {
    items: correctedItems,
    inferredVendorName: (bestCandidate.vendor as { vendor_name?: string } | null)?.vendor_name,
    inferredVendorId:
      bestCandidate.vendor_id !== undefined && bestCandidate.vendor_id !== null
        ? Number(bestCandidate.vendor_id)
        : undefined,
    matchedPurchaseId: bestCandidate.id,
  }
}

async function enrichItemsWithPurchaseLines(
  supabase: any,
  items: ExtractedItem[]
): Promise<ExtractedItem[]> {
  if (!items.length) return items

  const poNumbers = Array.from(new Set(
    items
      .map((item) => normalizeOrderToken(item.po_number || ""))
      .filter(Boolean)
  ))
  if (!poNumbers.length) return items

  const poOnly = poNumbers.filter((value) => value.startsWith("F"))
  const soOnly = poNumbers.filter((value) => value.startsWith("HS"))
  const requestRows: any[] = []

  if (poOnly.length) {
        const { data } = await supabase
      .from("purchase_requests")
      .select(`
        id,
        purchase_order_number,
        sales_order_number,
        items:purchase_request_items(
          line_number,
          item_name,
          specification,
          quantity,
          unit_price_value,
          amount_value
        )
      `)
      .in("purchase_order_number", poOnly)
      .limit(500)
    if (Array.isArray(data)) requestRows.push(...data)
  }

  if (soOnly.length) {
    const { data } = await supabase
      .from("purchase_requests")
      .select(`
        id,
        purchase_order_number,
        sales_order_number,
        items:purchase_request_items(
          line_number,
          item_name,
          specification,
          quantity,
          unit_price_value,
          amount_value
        )
      `)
      .in("sales_order_number", soOnly)
      .limit(500)
    if (Array.isArray(data)) requestRows.push(...data)
  }

  if (!requestRows.length) return items

  const lineMap = new Map<string, any>()
  for (const request of requestRows) {
    const poNumber = normalizeOrderToken(request?.purchase_order_number || request?.sales_order_number || "")
    if (!poNumber) continue
    const requestItems = Array.isArray(request?.items) ? request.items : []
    for (const requestItem of requestItems) {
      const line = toInteger(requestItem?.line_number)
      if (line === null) continue
      lineMap.set(`${poNumber}:${line}`, requestItem)
    }
  }

  const unresolvedLineCandidates = new Set<number>()
  items.forEach((item) => {
    if (item.po_number && item.po_line_number !== undefined && item.po_line_number !== null) return
    const parsedLine = parseTrailingLineCandidate(item.specification || item.item_name || item.po_number || "")
    if (parsedLine !== null) unresolvedLineCandidates.add(parsedLine)
  })

  let fallbackRows: any[] = []
  if (unresolvedLineCandidates.size > 0) {
    const { data } = await supabase
      .from("purchase_request_items")
      .select(`
        line_number,
        item_name,
        specification,
        quantity,
        unit_price_value,
        amount_value,
        purchase_order_number
      `)
      .in("line_number", Array.from(unresolvedLineCandidates))
      .limit(4000)
    if (Array.isArray(data)) fallbackRows = data
  }

  return items.map((item) => {
    if (!item.po_number || item.po_line_number === undefined || item.po_line_number === null) {
      const parsedLine = parseTrailingLineCandidate(item.specification || item.item_name || item.po_number || "")
      if (parsedLine === null || fallbackRows.length === 0) return item

      let bestRow: any | null = null
      let bestScore = 0
      for (const row of fallbackRows) {
        if (toInteger(row?.line_number) !== parsedLine) continue
        const qtyScore = numericClosenessScore(item.quantity, toInteger(row?.quantity), 40)
        const priceScore = numericClosenessScore(item.unit_price, toNumber(row?.unit_price_value), 30)
        const amountScore = numericClosenessScore(item.amount, toNumber(row?.amount_value), 30)
        const nameScore = item.item_name
          ? Math.round(calculateNameSimilarity(item.item_name, sanitizeText(row?.item_name || "")) * 0.2)
          : 0
        const score = qtyScore + priceScore + amountScore + nameScore
          if (score > bestScore) {
            bestScore = score
          bestRow = row
        }
      }

      if (!bestRow || bestScore < 40) return item
      const inferredPo = normalizeOrderToken(bestRow?.purchase_order_number || "")
      if (!inferredPo) return item

    return {
      ...item,
        po_number: inferredPo,
        po_line_number: parsedLine,
        quantity: item.quantity ?? toInteger(bestRow?.quantity),
        unit_price: item.unit_price ?? toNumber(bestRow?.unit_price_value),
        amount: item.amount > 0 ? item.amount : (toNumber(bestRow?.amount_value) || 0),
      }
    }

    const key = `${normalizeOrderToken(item.po_number)}:${item.po_line_number}`
    const source = lineMap.get(key)
    if (!source) return item

    const sourceQty = toInteger(source?.quantity)
    const sourceUnitPrice = toNumber(source?.unit_price_value)
    const sourceAmount = toNumber(source?.amount_value)

    let nextQty = item.quantity ?? null
    let nextUnitPrice = item.unit_price ?? null
    let nextAmount = item.amount ?? 0

    if (nextQty === null || nextQty <= 0 || isArithmeticMismatch(nextQty, nextUnitPrice, nextAmount)) {
      if (sourceQty !== null) nextQty = sourceQty
    }

    if ((nextUnitPrice === null || nextUnitPrice <= 0) && sourceUnitPrice !== null) {
      nextUnitPrice = sourceUnitPrice
    }

    if (nextAmount <= 0) {
      if (sourceAmount !== null && sourceAmount > 0) nextAmount = sourceAmount
      else if (nextQty !== null && nextUnitPrice !== null) nextAmount = nextQty * nextUnitPrice
    } else if (nextQty !== null && nextUnitPrice !== null) {
      const recomputedAmount = nextQty * nextUnitPrice
      const recomputedDiff = Math.abs(recomputedAmount - nextAmount) / Math.max(1, recomputedAmount)
      if (recomputedDiff > 0.01) {
        if (sourceAmount !== null && sourceAmount > 0) {
          nextAmount = sourceAmount
        } else {
          nextAmount = recomputedAmount
        }
      }
    }

    return {
      ...item,
      quantity: nextQty,
      unit_price: nextUnitPrice,
      amount: nextAmount,
    }
  })
}

function calculateOrderNumberSimilarity(observed: string, candidate: string): number {
  if (!observed || !candidate) return 0
  if (observed === candidate) return 100

  const observedNorm = normalizeOrderToken(observed)
  const candidateNorm = normalizeOrderToken(candidate)
  if (!observedNorm || !candidateNorm) return 0
  if (observedNorm === candidateNorm) return 95

  if (observedNorm.startsWith("F") && candidateNorm.startsWith("F")) {
    if (observedNorm.slice(0, 9) === candidateNorm.slice(0, 9)) return 84
    const observedParsed = parsePoNumber(observedNorm)
    const candidateParsed = parsePoNumber(candidateNorm)
    if (observedParsed && candidateParsed && observedParsed.seqPart === candidateParsed.seqPart) {
      return 72
    }
  }

  if (observedNorm.startsWith("HS") && candidateNorm.startsWith("HS")) {
    if (observedNorm.slice(0, 8) === candidateNorm.slice(0, 8)) return 82
  }

  return Math.round(calculateNameSimilarity(observedNorm, candidateNorm))
}

function calculateCandidateItemSimilarity(
  ocrItems: ExtractedItem[],
  systemItems: Array<{ item_name?: string; specification?: string; quantity?: number }>
): number {
  if (!ocrItems.length || !systemItems.length) return 0

  const used = new Set<number>()
  let total = 0
  let matched = 0

  const normalizedOcr = ocrItems.map((item) => ({
    name: normalizeItemText(item.item_name || ""),
    spec: normalizeItemText(item.specification || ""),
    qty: item.quantity ?? null,
  }))

  for (const ocr of normalizedOcr) {
    let bestScore = 0
    let bestIdx = -1

    for (let idx = 0; idx < systemItems.length; idx += 1) {
      if (used.has(idx)) continue
      const sys = systemItems[idx]
      const sysName = normalizeItemText(sys.item_name || "")
      const sysSpec = normalizeItemText(sys.specification || "")

      const nameScore = ocr.name ? calculateNameSimilarity(ocr.name, sysName) : 0
      const specScore = ocr.name ? calculateNameSimilarity(ocr.name, sysSpec) : 0
      const reverseSpecScore = ocr.spec ? calculateNameSimilarity(ocr.spec, sysSpec) : 0

      let score = Math.max(nameScore, specScore, reverseSpecScore)
      if (ocr.qty !== null && sys.quantity !== undefined && sys.quantity !== null) {
        if (ocr.qty === sys.quantity) score = Math.min(100, score + 18)
        else if (ocr.qty <= sys.quantity) score = Math.min(100, score + 8)
      }

      if (score > bestScore) {
        bestScore = score
        bestIdx = idx
      }
    }

    if (bestScore >= 40 && bestIdx >= 0) {
      used.add(bestIdx)
      total += bestScore
      matched += 1
    }
  }

  if (matched === 0) return 0
  const matchRatio = matched / ocrItems.length
  const avgScore = total / matched
  return Math.round(matchRatio * 55 + avgScore * 0.45)
}

async function validateAndMatchVendor(
  supabase: any,
  extractedVendorName: string
): Promise<{ matched: boolean; vendor_name?: string; vendor_id?: number; similarity: number }> {
  if (!extractedVendorName) {
    return { matched: false, similarity: 0 }
  }

  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, vendor_name, vendor_alias")
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    return { matched: false, similarity: 0 }
  }

  let bestMatch: { vendor_id: number; vendor_name: string; similarity: number } | null = null

  for (const vendor of vendors) {
    let similarity = calculateVendorSimilarity(extractedVendorName, vendor.vendor_name)
    if (vendor.vendor_alias) {
      const aliasSimilarity = calculateVendorSimilarity(extractedVendorName, vendor.vendor_alias)
      similarity = Math.max(similarity, aliasSimilarity)
    }
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        vendor_id: vendor.id,
        vendor_name: vendor.vendor_name,
        similarity,
      }
    }
  }

  if (bestMatch && bestMatch.similarity >= 60) {
    return {
      matched: true,
      vendor_name: bestMatch.vendor_name,
      vendor_id: bestMatch.vendor_id,
      similarity: bestMatch.similarity,
    }
  }

  return { matched: false, similarity: bestMatch?.similarity || 0 }
}

async function findVendorInText(
  supabase: any,
  fullText: string
): Promise<{ matched: boolean; vendor_name?: string; vendor_id?: number; matched_text?: string; similarity: number }> {
  if (!fullText) {
    return { matched: false, similarity: 0 }
  }

  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, vendor_name, vendor_alias")
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    return { matched: false, similarity: 0 }
  }

  const textLines = fullText.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean)
  let bestMatch:
    | {
        vendor_id: number
        vendor_name: string
        matched_text: string
        similarity: number
      }
    | null = null

  for (const vendor of vendors) {
    // vendor_name과 vendor_alias 모두 매칭 시도
    const namesToCheck = [vendor.vendor_name]
    if (vendor.vendor_alias) namesToCheck.push(vendor.vendor_alias)

    for (const nameToCheck of namesToCheck) {
      const normalizedVendor = normalizeVendorText(nameToCheck || "")
      if (!normalizedVendor || normalizedVendor.length < 2) continue

      for (const line of textLines) {
        const normalizedLine = normalizeVendorText(line)
        if (!normalizedLine) continue

        if (normalizedLine.includes(normalizedVendor)) {
          if (!bestMatch || 100 > bestMatch.similarity) {
            bestMatch = {
              vendor_id: vendor.id,
              vendor_name: vendor.vendor_name,
              matched_text: line,
              similarity: 100,
            }
          }
          break
        }

        const similarity = calculateVendorSimilarity(line, nameToCheck)
        if (similarity >= 70 && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = {
            vendor_id: vendor.id,
            vendor_name: vendor.vendor_name,
            matched_text: line,
            similarity,
          }
        }
      }
    }
  }

  if (bestMatch && bestMatch.similarity >= 70) {
    return {
      matched: true,
      vendor_name: bestMatch.vendor_name,
      vendor_id: bestMatch.vendor_id,
      matched_text: bestMatch.matched_text,
      similarity: bestMatch.similarity,
    }
  }

  return { matched: false, similarity: bestMatch?.similarity || 0 }
}

function normalizeItemText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9가-힣]/g, "")
    .trim()
}

function normalizeVendorText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜|co\.?|ltd\.?|inc\.?|corp\.?|company|컴퍼니/gi, "")
    // OCR이 대표자명을 거래처명에 붙여 읽는 경우 제거 (예: "㈜엠에프코리아 김경경")
    .replace(/\s+[가-힣]{2,4}$/g, (match) => {
      // 2~4글자 한글 이름 패턴만 제거 (공백 뒤)
      const name = match.trim()
      if (/^[가-힣]{2,4}$/.test(name)) return ""
      return match
    })
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9가-힣]/g, "")
    .trim()
}

function calculateVendorHintSimilarity(vendorName: string | undefined, hints: string[]): number | null {
  if (!vendorName || hints.length === 0) return null
  const normalizedVendor = normalizeVendorText(vendorName)
  if (!normalizedVendor) return null

  let best = 0
  for (const hint of hints) {
    const normalizedHint = normalizeVendorText(hint)
    if (!normalizedHint) continue
    const score = calculateNameSimilarity(normalizedVendor, normalizedHint)
    if (score > best) best = score
  }
  return best
}

function calculateVendorSimilarity(vendor1: string, vendor2: string): number {
  if (!vendor1 || !vendor2) return 0

  const n1 = normalizeVendorText(vendor1)
  const n2 = normalizeVendorText(vendor2)
  if (!n1 || !n2) return 0
  if (n1 === n2) return 100
  if (n1.includes(n2) || n2.includes(n1)) return 90

  // 짧은 쪽 기준 Levenshtein 유사도도 계산하여 더 높은 값 채택
  // (OCR 오독으로 1~2글자만 다른 경우: 웹에프코리아 vs 엠에프코리아)
  const levenshteinScore = calculateNameSimilarity(n1, n2)
  const shorter = n1.length <= n2.length ? n1 : n2
  const longer = n1.length > n2.length ? n1 : n2
  const shortDist = levenshteinDistance(shorter, longer)
  const shortScore = ((shorter.length - Math.max(0, shortDist - (longer.length - shorter.length))) / shorter.length) * 100

  return Math.round(Math.max(levenshteinScore, shortScore))
}

function calculateNameSimilarity(name1: string, name2: string): number {
  const s1 = normalizeItemText(name1)
  const s2 = normalizeItemText(name2)
  if (!s1 || !s2) return 0
  if (s1 === s2) return 100
  if (s1.includes(s2) || s2.includes(s1)) return 84

  const maxLen = Math.max(s1.length, s2.length)
  const distance = levenshteinDistance(s1, s2)
  return ((maxLen - distance) / maxLen) * 100
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i += 1) dp[i][0] = i
  for (let j = 0; j <= n; j += 1) dp[0][j] = j

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
    } else {
        dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1
      }
    }
  }

  return dp[m][n]
}

function parsePoNumber(value: string): { datePart: string; seqPart: string } | null {
  const match = value.match(/^F(\d{8})_(\d{3})$/)
  if (!match) return null
  return { datePart: match[1], seqPart: match[2] }
}

function hasValidPoDate(poNumber: string): boolean {
  const parsed = parsePoNumber(poNumber)
  if (!parsed) return true
  return isValidYyyyMmDd(parsed.datePart)
}

function isValidYyyyMmDd(datePart: string): boolean {
  if (!/^\d{8}$/.test(datePart)) return false
  const y = Number.parseInt(datePart.slice(0, 4), 10)
  const m = Number.parseInt(datePart.slice(4, 6), 10)
  const d = Number.parseInt(datePart.slice(6, 8), 10)
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const lastDay = new Date(y, m, 0).getDate()
  return d <= lastDay
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value)
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "")
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? Math.round(parsed) : null
  }
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const cleaned = value.replace(/[,₩원$￦\s]/g, "").replace(/[^\d.-]/g, "")
    if (!cleaned || cleaned === "-" || cleaned === ".") return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseTrailingLineCandidate(value: string): number | null {
  if (!value) return null
  const normalized = value.toUpperCase().replace(/\s+/g, "")
  const match = normalized.match(/(?:[_-])(\d{1,3})$/)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function numericClosenessScore(
  observed: number | null | undefined,
  candidate: number | null | undefined,
  maxScore: number
): number {
  if (candidate === null || candidate === undefined) return 0
  if (observed === null || observed === undefined) return Math.round(maxScore * 0.4)
  if (!Number.isFinite(observed) || !Number.isFinite(candidate)) return 0

  const diff = Math.abs(observed - candidate)
  const base = Math.max(1, Math.abs(candidate))
  const ratio = diff / base
  if (ratio <= 0.01) return maxScore
  if (ratio <= 0.05) return Math.round(maxScore * 0.8)
  if (ratio <= 0.15) return Math.round(maxScore * 0.5)
  if (ratio <= 0.3) return Math.round(maxScore * 0.25)
  return 0
}

function isHeaderLikeItemName(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toUpperCase()
  if (!normalized) return false
  if (/^품명\d*$/.test(normalized)) return true
  return new Set([
    "품명",
    "품목",
    "ITEM",
    "ITEMNAME",
    "NO",
    "NO.",
    "규격",
    "수량",
    "단가",
    "금액",
    "비고",
  ]).has(normalized)
}

function looksLikeOrderToken(value: string): boolean {
  const normalized = value.toUpperCase().replace(/\s+/g, "")
  return /^F\d{8}[_-]\d{1,3}(?:[-_]\d{1,3})?$/.test(normalized) ||
    /^HS\d{6}[-_]\d{1,2}(?:[-_]\d{1,3})?$/.test(normalized)
}

function isArithmeticMismatch(
  quantity: number | null | undefined,
  unitPrice: number | null | undefined,
  amount: number | null | undefined
): boolean {
  if (quantity === null || quantity === undefined) return false
  if (unitPrice === null || unitPrice === undefined) return false
  if (amount === null || amount === undefined || amount <= 0) return false
  const expected = quantity * unitPrice
  const deltaRatio = Math.abs(expected - amount) / Math.max(1, amount)
  return deltaRatio > 0.2
}

function normalizeItemConfidence(confidence: unknown): "low" | "med" | "high" {
  const fromNumeric = (raw: number): "low" | "med" | "high" => {
    if (!Number.isFinite(raw)) return "med"
    let value = raw
    if (value > 1 && value <= 100) value = value / 100
    if (value >= 0.8) return "high"
    if (value >= 0.45) return "med"
    return "low"
  }

  if (typeof confidence === "number") return fromNumeric(confidence)

  if (typeof confidence === "string") {
    const normalized = confidence.trim().toLowerCase()
    if (normalized === "high" || normalized === "h") return "high"
    if (normalized === "med" || normalized === "medium" || normalized === "m") return "med"
    if (normalized === "low" || normalized === "l") return "low"
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) return fromNumeric(parsed)
  }

  if (typeof confidence === "boolean") {
    return confidence ? "high" : "low"
  }

  return "med"
}

async function applyCharPatternCorrections(
  supabase: any,
  items: ExtractedItem[],
  vendorName: string
): Promise<ExtractedItem[]> {
  if (!items.length || !vendorName) return items

  const { data: patterns } = await supabase
    .from("ocr_char_patterns")
    .select("wrong_char, correct_char, occurrence_count")
    .eq("vendor_name", vendorName)
    .gte("occurrence_count", 1)
    .order("occurrence_count", { ascending: false })
    .limit(50)

  if (!Array.isArray(patterns) || patterns.length === 0) return items

  return items.map((item) => {
    if (!item.item_name) return item
    let corrected = item.item_name
    for (const pattern of patterns) {
      if (!pattern.wrong_char || !pattern.correct_char) continue
      corrected = corrected.split(pattern.wrong_char).join(pattern.correct_char)
    }
    if (corrected === item.item_name) return item
    return { ...item, item_name: corrected }
  })
}

function triggerNextQueuedProcessing(supabaseUrl: string, supabaseServiceKey: string): void {
  const functionUrl = `${supabaseUrl}/functions/v1/ocr-transaction-statement`
  fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
      apikey: supabaseServiceKey,
    },
    body: JSON.stringify({ mode: "process_next" }),
  }).catch(() => {})
}
