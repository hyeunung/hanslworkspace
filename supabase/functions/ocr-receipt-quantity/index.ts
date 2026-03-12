// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4'
// @ts-ignore - Deno runtime imports
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type OCRMode = 'process_specific' | 'process_next';

interface OCRRequest {
  statementId?: string;
  imageUrl?: string;
  reset_before_extract?: boolean;
  mode?: OCRMode;
}

// 입고수량 업로드용 - 금액 필드 제거
interface ExtractedItem {
  line_number: number;
  item_name: string;
  specification?: string;
  quantity: number;
  unit_price?: number | null;  // 입고수량 모드에서는 null
  amount?: number | null;       // 입고수량 모드에서는 null
  tax_amount?: number | null;   // 입고수량 모드에서는 null
  po_number?: string;
  remark?: string;
  confidence: 'low' | 'med' | 'high';
}

// 입고수량 업로드용 - 금액 필드 제거
interface ExtractionResult {
  statement_date?: string;
  vendor_name?: string;
  vendor_name_english?: string;
  total_amount?: number | null;  // 입고수량 모드에서는 null
  tax_amount?: number | null;    // 입고수량 모드에서는 null
  grand_total?: number | null;   // 입고수량 모드에서는 null
  items: ExtractedItem[];
  raw_text?: string;
}

type VisionWord = {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
};

type RowData = {
  id: number;
  text: string;
  words: VisionWord[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerY: number;
};

type InferredPoInfo = {
  inferred_po_number: string;
  inferred_po_source: 'bracket' | 'handwriting_range' | 'margin_range' | 'per_item' | 'global';
  inferred_po_confidence: number;
  inferred_po_group_id?: string;
};

type PreprocessResult = {
  image: Image;
  base64: string;
};

type ImageTile = {
  base64: string;
  offsetX: number;
  offsetY: number;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let statementId: string | null = null
  let claimedStatement: any | null = null
  let supabaseUrl = ''
  let supabaseServiceKey = ''
  let currentStage = 'init'

  try {
    supabaseUrl = Deno.env.get('SUPABASE_URL')!
    supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    const googleCredentials = Deno.env.get('GOOGLE_VISION_CREDENTIALS')

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: OCRRequest = await req.json().catch(() => ({}))
    const mode: OCRMode = requestData.mode || 'process_specific'
    const workerId = crypto.randomUUID()
    statementId = requestData.statementId || null
    let imageUrl = requestData.imageUrl || null

    // 오래된 processing 정리 (안전장치)
    currentStage = 'cleanup_stale'
    try {
      await supabase.rpc('mark_stale_transaction_statements_failed', {
        processing_timeout: '15 minutes'
      })
    } catch (_) {
      // ignore cleanup errors
    }

    currentStage = 'claim_statement'
    if (mode === 'process_next') {
      const { data, error } = await supabase.rpc('claim_next_transaction_statement', {
        worker_id: workerId,
        processing_timeout: '15 minutes'
      })
      if (error) throw error
      const claimed = Array.isArray(data) ? data[0] : data
      if (!claimed) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'no_queue_or_processing_active' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      claimedStatement = claimed
      statementId = claimed.id
      imageUrl = claimed.image_url
    } else {
      if (!statementId) {
        throw new Error('statementId is required')
      }
      const { data, error } = await supabase.rpc('claim_transaction_statement', {
        statement_id: statementId,
        worker_id: workerId,
        processing_timeout: '15 minutes'
      })
      if (error) throw error
      const claimed = Array.isArray(data) ? data[0] : data
      if (!claimed) {
        const queueUpdate: Record<string, any> = {
          status: 'queued',
          queued_at: new Date().toISOString()
        }
        if (requestData.reset_before_extract) {
          queueUpdate.reset_before_extract = true
        }
        await supabase
          .from('transaction_statements')
          .update(queueUpdate)
          .in('status', ['pending', 'queued', 'failed'])
          .eq('id', statementId)
        return new Response(
          JSON.stringify({ success: true, queued: true, status: 'queued', statementId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      claimedStatement = claimed
      statementId = claimed.id
      imageUrl = claimed.image_url || imageUrl
    }

    if (!statementId || !imageUrl) {
      throw new Error('Missing statementId or imageUrl')
    }

    const shouldReset = Boolean(requestData.reset_before_extract) || Boolean(claimedStatement?.reset_before_extract)

    console.log(`Processing transaction statement: ${statementId}`)

    // 0. 재추출 초기화 (실입고일만 유지)
    if (shouldReset) {
      const { data: existingStatement } = await supabase
        .from('transaction_statements')
        .select('extracted_data')
        .eq('id', statementId)
        .single()

      const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date

      await supabase
        .from('transaction_statement_items')
        .delete()
        .eq('statement_id', statementId)

      await supabase
        .from('transaction_statements')
        .update({
          statement_date: null,
          vendor_name: null,
          total_amount: null,
          tax_amount: null,
          grand_total: null,
          extraction_error: null,
          reset_before_extract: false,
          extracted_data: preservedActualReceivedDate
            ? { actual_received_date: preservedActualReceivedDate }
            : null
        })
        .eq('id', statementId)
    }

    // 1. 이미지 다운로드
    currentStage = 'download_image'
    let imageBuffer = await downloadImage(imageUrl)
    let visionBase64 = ''
    let tileImages: ImageTile[] = []
    let decodedImage: Image | null = null

    // 1-1. 이미지 방향 감지 및 회전
    currentStage = 'detect_orientation'
    const rawBase64ForDetection = arrayBufferToBase64(imageBuffer)
    let rotationDegrees = await detectImageOrientation(rawBase64ForDetection, openaiApiKey!)

    // fallback: 방향 감지가 0을 반환했지만 이미지가 명확히 가로형이면 90도 회전
    if (rotationDegrees === 0) {
      try {
        const tmpImg = await decodeImageFromBuffer(imageBuffer)
        if (tmpImg && tmpImg.width > tmpImg.height * 1.1) {
          rotationDegrees = 90
        }
      } catch (_) {}
    }
    if (rotationDegrees > 0) {
      try {
        const tempImage = await decodeImageFromBuffer(imageBuffer)
        if (tempImage) {
          const rotatedImage = tempImage.rotate(rotationDegrees)
          const rotatedPngBytes = await rotatedImage.encode(1)
          imageBuffer = rotatedPngBytes.buffer as ArrayBuffer

          try {
            const storagePath = imageUrl.split("/receipt-images/")[1]?.split("?")[0]
            if (storagePath) {
              const decodedPath = decodeURIComponent(storagePath)
              await supabase.storage
                .from("receipt-images")
                .update(decodedPath, rotatedPngBytes, {
                  contentType: "image/png",
                  upsert: true,
                })
            }
          } catch (_) {
            // 회전 이미지 저장 실패는 OCR 진행을 차단하지 않음
          }
        }
      } catch (_) {
        // 회전 실패 시 원본으로 진행
      }
    }

    try {
      currentStage = 'decode_preprocess'
      decodedImage = await decodeImageFromBuffer(imageBuffer)
      if (decodedImage) {
        const preprocessed = await preprocessImage(decodedImage)
        if (preprocessed) {
          visionBase64 = preprocessed.base64
          decodedImage = preprocessed.image
        }
        tileImages = await buildImageTiles(decodedImage)
      }
    } catch (_) {
      decodedImage = null
      tileImages = []
    }

    if (!visionBase64) {
      visionBase64 = arrayBufferToBase64(imageBuffer)
    }
    const base64Image = visionBase64

    // 3. Google Vision OCR 호출 (선택적 - credentials가 없으면 GPT-4o만 사용)
    let visionText = ''
    let visionWords: VisionWord[] = []
    if (googleCredentials) {
      try {
        currentStage = 'google_vision'
        const visionResult = await callGoogleVision(visionBase64, googleCredentials)
        visionText = visionResult.text
        visionWords = visionResult.words

        if (tileImages.length > 0) {
          const tileResults = await Promise.allSettled(
            tileImages.map((tile) => callGoogleVision(tile.base64, googleCredentials))
          )
          tileResults.forEach((result, index) => {
            if (result.status !== 'fulfilled') return
            const tile = tileImages[index]
            if (result.value.text) {
              visionText = [visionText, result.value.text].filter(Boolean).join('\n')
            }
            if (result.value.words.length > 0) {
              visionWords = visionWords.concat(
                offsetVisionWords(result.value.words, tile.offsetX, tile.offsetY)
              )
            }
          })
        }
      } catch (e) {
        console.warn('Google Vision failed, using GPT-4o only:', e)
      }
    }

    // 4. GPT-4o 비전으로 구조화 추출
    currentStage = 'gpt_extract'
    let poScope: 'single' | 'multi' | null = null
    if (claimedStatement?.po_scope) {
      poScope = claimedStatement.po_scope
    } else {
      const { data: scopeRow } = await supabase
        .from('transaction_statements')
        .select('po_scope')
        .eq('id', statementId)
        .single()
      poScope = (scopeRow as any)?.po_scope || null
    }
    const extractionResult = await extractWithGPT4o(
      base64Image,
      visionText,
      openaiApiKey,
      poScope
    )

    // 5. 숫자 패턴 전용 2차 추출 (저신뢰/누락에만)
    let extraOrderNumbers: string[] = []
    if (shouldRetryOrderNumberPass(extractionResult.items)) {
      try {
        currentStage = 'order_numbers_retry'
        extraOrderNumbers = await extractOrderNumbersWithGPT4o(
          base64Image,
          tileImages.map((tile) => tile.base64),
          openaiApiKey
        )
      } catch (_) {
        extraOrderNumbers = []
      }
    }

    // 6. 발주/수주번호 패턴 정규화 (OCR 텍스트도 함께 전달하여 빈 칸에 적힌 번호도 찾음)
    let normalizedItems = normalizePoNumbers(
      extractionResult.items,
      visionText,
      extraOrderNumbers
    )

    // 6-1. 손글씨 괄호/연결선 기반 PO 매핑 (품목별 보강)
    let bracketMappings: PoMapping[] = []
    try {
      bracketMappings = await extractPoMappingsWithGPT4o(
        base64Image,
        normalizedItems,
        openaiApiKey
      )
      if (bracketMappings.length > 0) {
        normalizedItems = applyPoMappings(normalizedItems, bracketMappings)
      }
    } catch (e) {
      console.warn('Failed to extract PO mappings from brackets:', e)
    }

    // 6-2. 손글씨 좌측 번호/구간 추론 (품목별 보강)
    let rangeMappings: RangeMapping[] = []
    try {
      rangeMappings = await extractPoRangesWithGPT4o(
        base64Image,
        normalizedItems,
        openaiApiKey
      )
    } catch (e) {
      console.warn('Failed to extract PO ranges from handwriting:', e)
    }

    // 6-3. 좌측 번호/구간 추론 + 괄호 매핑 합의 (품목별 inferred 정보)
    const inferredPoMap = buildInferredPoMap({
      items: normalizedItems,
      visionWords,
      bracketMappings,
      rangeMappings
    })

    // 7. 거래처명 검증 - vendors 테이블에 반드시 존재해야 함
    currentStage = 'vendor_match'
    let validatedVendorName: string | undefined = undefined
    let validatedVendorId: number | undefined = undefined
    let vendorMatchSource: 'gpt_extract' | 'text_scan' | 'po_infer' | 'not_found' = 'not_found'
    
    // 7-1. GPT가 추출한 거래처명으로 먼저 시도 (한글명)
    if (extractionResult.vendor_name) {
      const vendorResult = await validateAndMatchVendor(
        supabase, 
        extractionResult.vendor_name
      )
      
      if (vendorResult.matched) {
        console.log(`✅ 거래처 매칭 성공 (GPT 추출 한글): "${extractionResult.vendor_name}" → "${vendorResult.vendor_name}" (${vendorResult.similarity}%)`)
        validatedVendorName = vendorResult.vendor_name
        validatedVendorId = vendorResult.vendor_id
        vendorMatchSource = 'gpt_extract'
      }
    }
    
    // 7-1-2. 한글명 매칭 실패 시 영문명으로 재시도
    if (!validatedVendorName && extractionResult.vendor_name_english) {
      const vendorResultEng = await validateAndMatchVendor(
        supabase, 
        extractionResult.vendor_name_english
      )
      
      if (vendorResultEng.matched) {
        console.log(`✅ 거래처 매칭 성공 (GPT 추출 영문): "${extractionResult.vendor_name_english}" → "${vendorResultEng.vendor_name}" (${vendorResultEng.similarity}%)`)
        validatedVendorName = vendorResultEng.vendor_name
        validatedVendorId = vendorResultEng.vendor_id
        vendorMatchSource = 'gpt_extract'
      }
    }
    
    // 7-2. GPT 추출 실패 또는 거래처 못찾음 → 전체 텍스트에서 vendors 테이블 대조
    if (!validatedVendorName && visionText) {
      console.log('📝 거래처 못찾음 - 전체 OCR 텍스트에서 vendors 테이블 대조 시작...')
      const vendorFromText = await findVendorInText(supabase, visionText)
      
      if (vendorFromText.matched) {
        console.log(`✅ 거래처 매칭 성공 (텍스트 스캔): "${vendorFromText.matched_text}" → "${vendorFromText.vendor_name}" (${vendorFromText.similarity}%)`)
        validatedVendorName = vendorFromText.vendor_name
        validatedVendorId = vendorFromText.vendor_id
        vendorMatchSource = 'text_scan'
      }
    }
    
    // 7-3. 그래도 못찾으면 경고
    if (!validatedVendorName) {
      console.warn(`⚠️ 거래처를 찾을 수 없음 - 수동 확인 필요`)
    }

    // 8. 발주/수주번호 오인식 보정 (거래처/품목/수량 기준)
    const correctionResult = await correctOrderNumbersByDb(
      supabase,
      normalizedItems,
      validatedVendorId
    )
    normalizedItems = correctionResult.items
    if (correctionResult.inferredVendorName) {
      if (!validatedVendorName || validatedVendorName !== correctionResult.inferredVendorName) {
        validatedVendorName = correctionResult.inferredVendorName
        vendorMatchSource = 'po_infer'
      }
    }

    // 9. DB에 결과 저장 (에러 체크 추가)
    const { data: existingStatement } = await supabase
      .from('transaction_statements')
      .select('extracted_data')
      .eq('id', statementId)
      .single()

    const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date

    currentStage = 'db_update'
    // 입고수량 모드: 금액 필드는 모두 null, statement_mode는 'receipt'
    const { data: updateData, error: updateError } = await supabase
      .from('transaction_statements')
      .update({
        status: 'extracted',
        processing_finished_at: new Date().toISOString(),
        locked_by: null,
        reset_before_extract: false,
        statement_mode: 'receipt', // 입고수량 모드로 설정
        statement_date: extractionResult.statement_date || null,
        vendor_name: validatedVendorName || null,
        total_amount: null,  // 금액 제외
        tax_amount: null,    // 금액 제외
        grand_total: null,   // 금액 제외
        extracted_data: {
          ...extractionResult,
          ...(preservedActualReceivedDate ? { actual_received_date: preservedActualReceivedDate } : {}),
          items: normalizedItems.map(item => ({
            ...item,
            unit_price: null,  // 금액 제외
            amount: null,      // 금액 제외
            tax_amount: null   // 금액 제외
          })),
          raw_vision_text: visionText,
          ocr_vendor_name: extractionResult.vendor_name,
          vendor_validated: !!validatedVendorName,
          vendor_match_source: vendorMatchSource,
          vendor_mismatch: !validatedVendorName
        }
      })
      .eq('id', statementId)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update transaction_statements:', updateError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `DB 업데이트 실패: ${updateError.message}. 거래명세서 레코드가 존재하지 않을 수 있습니다.` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('✅ 거래명세서 업데이트 완료:', { id: statementId, vendor_name: validatedVendorName })

    // 10. 추출된 품목들을 transaction_statement_items에 저장 (금액 필드 null)
    if (normalizedItems.length > 0) {
      currentStage = 'db_insert_items'
      const itemsToInsert = normalizedItems.map((item, idx) => {
        const lineNumber = item.line_number || idx + 1
        const inferredInfo = inferredPoMap.get(lineNumber)

        return {
          statement_id: statementId,
          line_number: lineNumber,
          extracted_item_name: item.item_name,
          extracted_specification: item.specification,
          extracted_quantity: item.quantity,
          extracted_unit_price: null,    // 입고수량 모드: 금액 제외
          extracted_amount: null,        // 입고수량 모드: 금액 제외
          extracted_tax_amount: null,    // 입고수량 모드: 금액 제외
          extracted_po_number: item.po_number,
          extracted_remark: item.remark,
          match_confidence: item.confidence,
          inferred_po_number: inferredInfo?.inferred_po_number || null,
          inferred_po_source: inferredInfo?.inferred_po_source || null,
          inferred_po_confidence: inferredInfo?.inferred_po_confidence ?? null,
          inferred_po_group_id: inferredInfo?.inferred_po_group_id || null
        }
      })

      const { error: itemsError } = await supabase
        .from('transaction_statement_items')
        .insert(itemsToInsert)

      if (itemsError) {
        console.error('Failed to insert items:', itemsError)
      }
    }

    if (statementId) {
      triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)
    }

    return new Response(
      JSON.stringify({
        success: true,
        statementId: statementId,
        status: 'extracted',
        vendor_name: validatedVendorName || null, // 검증된 거래처명 포함
        vendor_match_source: vendorMatchSource, // 매칭 방법
        result: {
          ...extractionResult,
          vendor_name: validatedVendorName || null, // DB에 없으면 vendor_name 비움
          items: normalizedItems
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    const errorMessage = `[stage:${currentStage}] ${error?.message || 'Unknown error'}`
    console.error('Error processing transaction statement:', error)

    // 에러 시 상태 업데이트
    try {
      if (statementId) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const retryCount = (claimedStatement?.retry_count ?? 0) + 1
        const delayMinutes = Math.min(30, Math.pow(2, Math.min(retryCount, 4)))
        const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
        await supabase
          .from('transaction_statements')
          .update({ 
            status: 'failed',
            extraction_error: errorMessage,
            processing_finished_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            retry_count: retryCount,
            next_retry_at: nextRetryAt,
            locked_by: null,
            reset_before_extract: false
          })
          .eq('id', statementId)
      }
    } catch (e) {
      console.error('Failed to update error status:', e)
    }

    if (statementId) {
      triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`)
  return await response.arrayBuffer()
}

async function detectImageOrientation(base64Image: string, apiKey: string): Promise<number> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 50,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: "low",
                },
              },
              {
                type: "text",
                text: '이 이미지는 한국어 거래명세서입니다. 텍스트가 정상적으로 읽히는 방향인지 확인하세요. 글자가 옆으로 눕혀져 있거나 뒤집혀 있으면 시계 방향으로 몇 도 회전해야 정상이 되는지 판단하세요. 이미 정상이면 0. 반드시 JSON만 응답: {"rotation": 0 또는 90 또는 180 또는 270}',
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) return 0

    const result = await response.json()
    const text = result?.choices?.[0]?.message?.content || ""
    const match = text.match(/"rotation"\s*:\s*(\d+)/)
    if (!match) return 0

    const degrees = Number(match[1])
    if ([90, 180, 270].includes(degrees)) return degrees
    return 0
  } catch (_) {
    return 0
  }
}

function triggerNextQueuedProcessing(supabaseUrl: string, supabaseServiceKey: string) {
  // 입고수량 모드 전용 함수 호출
  const functionUrl = `${supabaseUrl}/functions/v1/ocr-receipt-quantity`
  fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey
    },
    body: JSON.stringify({ mode: 'process_next' })
  }).catch(() => {})
}

/**
 * 거래처명 검증 - vendors 테이블에서 유사한 거래처 찾기
 * 거래명세서를 보낸 거래처는 반드시 DB에 존재해야 함
 */
async function validateAndMatchVendor(
  supabase: any,
  extractedVendorName: string
): Promise<{ matched: boolean; vendor_name?: string; vendor_id?: number; similarity: number }> {
  if (!extractedVendorName) {
    return { matched: false, similarity: 0 }
  }

  // 1. vendors 테이블에서 모든 거래처 조회
  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, vendor_name')
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    console.warn('Failed to fetch vendors or no vendors found:', error)
    return { matched: false, similarity: 0 }
  }

  // 2. 각 거래처와 유사도 계산
  let bestMatch: { vendor_id: number; vendor_name: string; similarity: number } | null = null

  for (const vendor of vendors) {
    const similarity = calculateVendorSimilarity(extractedVendorName, vendor.vendor_name)
    
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        vendor_id: vendor.id,
        vendor_name: vendor.vendor_name,
        similarity
      }
    }
  }

  // 3. 유사도 60% 이상이면 매칭 성공
  if (bestMatch && bestMatch.similarity >= 60) {
    return {
      matched: true,
      vendor_name: bestMatch.vendor_name,
      vendor_id: bestMatch.vendor_id,
      similarity: bestMatch.similarity
    }
  }

  return { matched: false, similarity: bestMatch?.similarity || 0 }
}

/**
 * 전체 OCR 텍스트에서 vendors 테이블의 거래처를 찾기
 * 거래처명이 텍스트 어디에든 있으면 찾아냄
 */
async function findVendorInText(
  supabase: any,
  fullText: string
): Promise<{ matched: boolean; vendor_name?: string; vendor_id?: number; matched_text?: string; similarity: number }> {
  if (!fullText) {
    return { matched: false, similarity: 0 }
  }

  // 1. vendors 테이블에서 모든 거래처 조회
  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, vendor_name')
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    console.warn('Failed to fetch vendors for text scan:', error)
    return { matched: false, similarity: 0 }
  }

  // 2. 텍스트를 줄 단위로 분리하고 각 부분에서 거래처 찾기
  const textLines = fullText.split(/[\n\r]+/).filter(line => line.trim().length > 0)
  
  let bestMatch: { 
    vendor_id: number; 
    vendor_name: string; 
    matched_text: string;
    similarity: number 
  } | null = null

  // 각 거래처에 대해 텍스트에서 검색
  for (const vendor of vendors) {
    const vendorName = vendor.vendor_name || ''
    if (!vendorName) continue
    
    // 거래처명 정규화
    const normalizedVendor = vendorName
      .toLowerCase()
      .replace(/\(주\)|주식회사|㈜|주\)|co\.|ltd\.|inc\.|corp\.|company|컴퍼니/gi, '')
      .replace(/[^a-z0-9가-힣]/g, '')
      .trim()
    
    if (!normalizedVendor || normalizedVendor.length < 2) continue

    // 각 텍스트 라인에서 거래처명 검색
    for (const line of textLines) {
      const normalizedLine = line
        .toLowerCase()
        .replace(/[^a-z0-9가-힣\s]/g, '')
        .trim()
      
      // 거래처명이 라인에 포함되어 있는지 확인
      if (normalizedLine.includes(normalizedVendor)) {
        const similarity = 100 // 정확히 포함
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = {
            vendor_id: vendor.id,
            vendor_name: vendor.vendor_name,
            matched_text: line.trim(),
            similarity
          }
        }
        break // 이 거래처는 찾았으니 다음 거래처로
      }
      
      // 거래처명이 라인에 부분적으로 포함되어 있는지 확인 (4글자 이상)
      if (normalizedVendor.length >= 4) {
        const partialVendor = normalizedVendor.substring(0, Math.min(normalizedVendor.length, 6))
        if (normalizedLine.includes(partialVendor)) {
          const similarity = calculateVendorSimilarity(line, vendorName)
          if (similarity >= 70 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = {
              vendor_id: vendor.id,
              vendor_name: vendor.vendor_name,
              matched_text: line.trim(),
              similarity
            }
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
      similarity: bestMatch.similarity
    }
  }

  return { matched: false, similarity: bestMatch?.similarity || 0 }
}

/**
 * 거래처명 유사도 계산 (0-100)
 * - 회사 접두/접미어 제거 후 비교
 * - 영어 ↔ 한글 음역 지원
 */
function calculateVendorSimilarity(vendor1: string, vendor2: string): number {
  if (!vendor1 || !vendor2) return 0
  
  // 정규화: 회사 접두어/접미어 제거
  const normalize = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\(주\)|주식회사|㈜|주\)|주|co\.|co,|ltd\.|ltd|inc\.|inc|corp\.|corp|company|컴퍼니/gi, '')
      .replace(/[^a-z0-9가-힣]/g, '') // 특수문자, 공백 제거
      .trim()
  }

  const n1 = normalize(vendor1)
  const n2 = normalize(vendor2)

  if (!n1 || !n2) return 0
  if (n1 === n2) return 100

  // 포함 관계
  if (n1.includes(n2) || n2.includes(n1)) {
    return 90
  }

  // 영어 ↔ 한글 음역 매핑 (기본적인 것만, AI가 영문명 추정하므로 최소화)
  const translitMap: Record<string, string[]> = {
    'yg': ['와이지', 'yg'],
    '와이지': ['yg', '와이지'],
    'tech': ['테크', '텍', 'tech'],
    '테크': ['tech', '텍', '테크'],
    '텍': ['tech', '테크', '텍'],
    'high': ['하이', 'high'],
    '하이': ['high', '하이'],
    'korea': ['코리아', '한국', 'korea'],
    '코리아': ['korea', '한국', '코리아'],
    'electric': ['전기', '일렉트릭', 'electric'],
    '전기': ['electric', '일렉트릭', '전기'],
    'steel': ['스틸', '철강', 'steel'],
    '스틸': ['steel', '철강', '스틸'],
    'metal': ['메탈', '금속', 'metal'],
    '메탈': ['metal', '금속', '메탈'],
    'system': ['시스템', 'system'],
    '시스템': ['system', '시스템'],
    'soft': ['소프트', 'soft'],
    '소프트': ['soft', '소프트'],
    'net': ['넷', 'net'],
    '넷': ['net', '넷'],
    'global': ['글로벌', 'global'],
    '글로벌': ['global', '글로벌'],
    'trade': ['트레이드', '무역', 'trade'],
    '트레이드': ['trade', '무역', '트레이드'],
    'international': ['인터내셔널', 'international'],
    '인터내셔널': ['international', '인터내셔널'],
  }

  // 음역 치환 후 비교
  let n1Replaced = n1
  let n2Replaced = n2
  
  for (const [key, values] of Object.entries(translitMap)) {
    if (n1.includes(key)) {
      for (const val of values) {
        n1Replaced = n1Replaced.replace(key, val)
        if (n1Replaced === n2 || n2.includes(n1Replaced) || n1Replaced.includes(n2)) {
          return 85
        }
      }
      n1Replaced = n1 // 리셋
    }
    if (n2.includes(key)) {
      for (const val of values) {
        n2Replaced = n2Replaced.replace(key, val)
        if (n1 === n2Replaced || n1.includes(n2Replaced) || n2Replaced.includes(n1)) {
          return 85
        }
      }
      n2Replaced = n2 // 리셋
    }
  }

  // Levenshtein 거리 기반 유사도
  const maxLen = Math.max(n1.length, n2.length)
  const distance = levenshteinDistance(n1, n2)
  const similarity = ((maxLen - distance) / maxLen) * 100

  return Math.round(similarity)
}

/**
 * Levenshtein 거리 계산
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length
  const dp: number[][] = []
  
  for (let i = 0; i <= m; i++) {
    dp[i] = [i]
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j
  }
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1
      }
    }
  }
  
  return dp[m][n]
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buffer))
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function decodeImageFromBuffer(buffer: ArrayBuffer): Promise<Image | null> {
  try {
    return await Image.decode(new Uint8Array(buffer))
  } catch (_) {
    return null
  }
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
        const value = (5 * center) - top - bottom - left - right
        output[idx + c] = clampColor(value)
      }
    }
  }

  data.set(output)
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

async function preprocessImage(image: Image): Promise<PreprocessResult | null> {
  const processed = image
  processed.saturation(0, true)
  applyContrast(processed, 30)

  const pixelCount = processed.width * processed.height
  if (pixelCount <= 6_000_000) {
    applySharpen(processed)
  }

  const maxDim = Math.max(processed.width, processed.height)
  const targetMaxDim = 2200
  if (maxDim > targetMaxDim) {
    const scaleFactor = targetMaxDim / maxDim
    processed.scale(scaleFactor, Image.RESIZE_NEAREST_NEIGHBOR)
  }

  const base64 = await encodeImageToBase64(processed)
  return { image: processed, base64 }
}

async function buildImageTiles(image: Image): Promise<ImageTile[]> {
  const tiles: ImageTile[] = []
  const maxDim = Math.max(image.width, image.height)
  if (image.width < 1200 || image.height < 1200) return tiles
  if (maxDim > 2200) return tiles

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
      const base64 = await encodeImageToBase64(tile)
      tiles.push({ base64, offsetX, offsetY })
    }
  }

  return tiles
}

function offsetVisionWords(words: VisionWord[], offsetX: number, offsetY: number): VisionWord[] {
  return words.map((word) => ({
    ...word,
    bbox: {
      x: word.bbox.x + offsetX,
      y: word.bbox.y + offsetY,
      w: word.bbox.w,
      h: word.bbox.h
    }
  }))
}

async function callGoogleVision(base64Image: string, credentials: string): Promise<{ text: string; words: VisionWord[] }> {
  const credentialsJson = JSON.parse(credentials)
  
  // Google OAuth2 토큰 획득
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await createJWT(credentialsJson)
    })
  })

  const tokenData = await tokenResponse.json()
  if (!tokenData.access_token) {
    throw new Error('Failed to get Google access token')
  }

  // Vision API 호출
  const visionResponse = await fetch(
    'https://vision.googleapis.com/v1/images:annotate',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: {
            languageHints: ['ko', 'en']
          }
        }]
      })
    }
  )

  const visionResult = await visionResponse.json()
  const annotation = visionResult.responses?.[0]?.fullTextAnnotation
  const words = annotation ? extractVisionWords(annotation) : []

  if (annotation?.text) {
    return { text: annotation.text, words }
  }

  return { text: '', words }
}

function extractVisionWords(annotation: any): VisionWord[] {
  const words: VisionWord[] = []
  const pages = annotation?.pages || []

  pages.forEach((page: any) => {
    (page.blocks || []).forEach((block: any) => {
      (block.paragraphs || []).forEach((paragraph: any) => {
        (paragraph.words || []).forEach((word: any) => {
          const symbols = word.symbols || []
          const text = symbols.map((symbol: any) => symbol.text).join('')
          const vertices = word.boundingBox?.vertices || []
          if (!text || vertices.length === 0) return

          const xs = vertices.map((v: any) => v.x ?? 0)
          const ys = vertices.map((v: any) => v.y ?? 0)
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          const minY = Math.min(...ys)
          const maxY = Math.max(...ys)

          words.push({
            text,
            bbox: {
              x: minX,
              y: minY,
              w: Math.max(1, maxX - minX),
              h: Math.max(1, maxY - minY)
            }
          })
        })
      })
    })
  })

  return words
}

async function createJWT(credentials: any): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-vision',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const encoder = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header))
  const payloadB64 = btoa(JSON.stringify(payload))
  const signatureInput = encoder.encode(`${headerB64}.${payloadB64}`)

  // Import private key
  const privateKeyPem = credentials.private_key
  const privateKeyDer = pemToDer(privateKeyPem)
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureInput
  )

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i)
  }
  return buffer
}

async function extractWithGPT4o(
  base64Image: string, 
  visionText: string, 
  apiKey: string,
  poScope: 'single' | 'multi' | null
): Promise<ExtractionResult> {
  const scopeHint = poScope === 'single'
    ? '이 거래명세서는 단일 발주/수주 건입니다. 발주/수주번호가 없을 수 있으며, 모든 품목은 동일한 발주/수주로 취급하세요.'
    : poScope === 'multi'
    ? '이 거래명세서는 다중 발주/수주 건입니다. 서로 다른 발주/수주번호가 존재할 수 있으니 각 품목별로 분리해 추출하세요.'
    : ''
  // 입고수량 업로드용 프롬프트 - 금액 추출 제외
  const prompt = `거래명세서 이미지입니다. **입고수량 확인용**으로 수량 관련 정보만 추출합니다. 금액/단가는 추출하지 마세요.

${scopeHint ? `⚠️ **발주/수주 범위 힌트:** ${scopeHint}` : ''}

⚠️ **거래처(공급자) 식별 방법 - 매우 중요:**
한국 거래명세서에는 두 회사 정보가 있습니다:
- "귀중" 또는 "귀사" 옆에 있는 회사 = **받는 사람 (구매자)** → 이건 추출하지 마세요!
- "공급자", "공급하는 자", "(인)", 또는 도장/직인이 있는 쪽 = **공급자 (판매자)** → 이것이 vendor_name입니다!
거래명세서를 **보내온 회사**가 공급자입니다. "귀중" 옆에 있는 회사는 받는 회사이므로 vendor_name으로 사용하면 안됩니다.

추출 대상 (금액 제외):
1. statement_date: 거래명세서 날짜 (YYYY-MM-DD 형식)
2. vendor_name: **공급자(판매자)** 상호/회사명 - 도장/직인/대표자명이 있는 쪽!
3. vendor_name_english: 한글 회사명의 영문 표기 추정
4. items: 품목 배열 (수량만 추출, 금액 제외)

⚠️ **한글 회사명 정확히 읽기 - 매우 중요:**
- 비슷하게 생긴 글자 주의: 엔/플, 에/애, 스/즈, 테크/텍 등
- 글자 하나하나 정확히 확인하고 읽어주세요
- 확실하지 않으면 이미지를 다시 자세히 봐주세요

⚠️ **칼럼 헤더를 반드시 먼저 읽고 데이터 추출 - 가장 중요:**
1. 테이블의 **헤더 행**을 먼저 읽어서 각 칼럼이 무엇인지 파악하세요
2. 헤더명은 업체마다 다를 수 있습니다:
   - 품목명: "품명", "품목", "내역", "DESCRIPTION", "상품명" 등
   - 규격: "규격", "SIZE", "사이즈", "치수", "SPEC" 등  
   - 수량: "수량", "QTY", "수", "Q'TY", "QUANTITY" 등
3. **헤더명을 보고 각 열이 무엇인지 정확히 파악한 후** 데이터를 추출하세요!

⚠️ **수량(QTY) 칼럼 정확히 찾기 - 절대 틀리면 안됨:**
- 수량은 **헤더에 "수량" 또는 "QTY"**라고 적혀 있는 칼럼입니다
- 수량 값은 항상 **순수한 정수** (1, 5, 10, 15, 100 등)
- 규격 칼럼에 있는 숫자(예: 110, 200mm)를 수량으로 착각하지 마세요!
- **헤더를 무시하고 순서로만 추측하지 마세요!**

각 품목(item)에서 추출 (금액 필드 제외):
- line_number: 순번
- item_name: 품목명/품명
- specification: 규격/SIZE (예: 197X, 100mm, 110x50 등) - 없으면 빈 문자열
- quantity: 수량/QTY (정수, 주문 개수) ⭐ 가장 중요!
- po_number: 발주번호 또는 수주번호
- remark: 비고 전체 내용
- confidence: 추출 확신도 ("low", "med", "high")

⚠️ **금액 관련 필드는 추출하지 마세요:** unit_price, amount, tax_amount, total_amount, grand_total 등

⚠️ 발주번호/수주번호 찾는 방법 (중요):
- 발주번호 패턴: F + 날짜(YYYYMMDD) + _ + 숫자 (예: F20251010_001, F20251010_1) - 시스템은 항상 3자리(_001)
- 수주번호 패턴: HS + 날짜(YYMMDD, 6자리) + - + 숫자 (예: HS251201-01, HS251201-1) - 시스템은 항상 2자리(-01)
- 비고란뿐 아니라 빈 칸, 여백, 품목명 옆 등 **문서 어디에든** 손글씨/필기체로 적혀있을 수 있음
- 각 품목 행의 같은 줄에 있는 손글씨 번호를 해당 품목의 po_number로 매칭
- 여러 품목에 같은 번호가 적혀있으면 모두 해당 번호를 기록
- 번호가 흐리거나 불분명해도 패턴에 맞으면 최대한 읽어서 기록 (confidence: "low")

손글씨/필기체로 적힌 번호도 최대한 읽어주세요.
확신도(confidence)는 글씨가 불명확하거나 추측이 필요한 경우 "low", 보통이면 "med", 명확하면 "high"로 표시하세요.

⚠️ 중요: 이것은 **입고수량 확인용**입니다. 금액(unit_price, amount, tax_amount 등)은 추출하지 마세요!

${visionText ? `
⚠️ **OCR 텍스트 우선 참조 - 거래처명 추출 시 매우 중요:**
아래는 Google Vision OCR이 읽은 텍스트입니다. 이미지와 다르게 보이면 **OCR 텍스트를 신뢰**하세요.
특히 거래처명(vendor_name)은 OCR 텍스트에서 먼저 찾아주세요.
---
${visionText.substring(0, 3000)}
---` : ''}

JSON 형식으로만 응답하세요.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert at extracting structured data from Korean transaction statements (거래명세서). Always respond with valid JSON only.' 
        },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: prompt },
            { 
              type: 'image_url', 
              image_url: { 
                url: `data:image/png;base64,${base64Image}`,
                detail: 'high'
              } 
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })
  })

  const result = await response.json()
  
  if (result.error) {
    throw new Error(`GPT-4o error: ${result.error.message}`)
  }

  const content = result.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No content in GPT-4o response')
  }

  return JSON.parse(content)
}

type PoMapping = {
  line_number?: number
  start_line?: number
  end_line?: number
  item_name?: string
  po_number?: string
  confidence?: number
}

type RangeMapping = {
  po_number?: string
  start_line?: number
  end_line?: number
  confidence?: number
}

async function extractPoMappingsWithGPT4o(
  base64Image: string,
  items: ExtractedItem[],
  apiKey: string
): Promise<PoMapping[]> {
  const itemHints = items.map((item) => ({
    line_number: item.line_number,
    item_name: item.item_name
  }))

  const prompt = `거래명세서 이미지에서 손글씨 괄호/연결선으로 표시된 "발주번호/수주번호 포함 관계"를 읽어,
아래 item 목록에 대해 품목별 po_number를 매핑해주세요.

규칙:
1) 손글씨로 적힌 번호(F########_### 또는 HS######-##)와 괄호/연결선이 가리키는 품목들을 묶어주세요.
2) 번호가 품목 옆이 아니라 두번째 줄에 적혀 있어도, 괄호/연결선이 위쪽 품목까지 이어지면 위쪽 행도 포함하세요.
3) line_number는 문서의 행 순서입니다. 여러 행 묶음은 start_line/end_line 범위로 반환해도 됩니다.
4) 매핑이 확실하지 않으면 제외하세요.
5) 결과는 아래 JSON 형식만 반환:
{"mappings":[{"start_line":1,"end_line":4,"po_number":"F... 또는 HS...","confidence":0~1},{"line_number":번호,"item_name":"품목명","po_number":"F... 또는 HS...","confidence":0~1}]}

item 목록:
${JSON.stringify(itemHints)}
`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You extract handwritten bracket-to-item mappings.' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } }
        ] }
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    })
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(`GPT-4o error (mapping): ${result.error.message}`)
  }
  const content = result.choices?.[0]?.message?.content
  if (!content) return []
  const parsed = JSON.parse(content)
  return Array.isArray(parsed.mappings) ? parsed.mappings : []
}

async function extractPoRangesWithGPT4o(
  base64Image: string,
  items: ExtractedItem[],
  apiKey: string
): Promise<RangeMapping[]> {
  const itemHints = items.map((item) => ({
    line_number: item.line_number,
    item_name: item.item_name
  }))

  const prompt = `거래명세서 이미지에서 왼쪽 여백에 손글씨로 적힌 발주/수주번호가 있고,
그 아래 여러 품목에 같은 번호가 적용되는 경우를 찾아 line_number 범위를 추론해주세요.

규칙:
1) 번호는 F########_### 또는 HS######-## 형식입니다.
2) 번호가 중간에 바뀌면 여러 구간으로 나눠주세요.
3) 확실하지 않으면 제외하세요.
4) 결과는 아래 JSON 형식만 반환:
{"ranges":[{"po_number":"F... 또는 HS...","start_line":1,"end_line":5,"confidence":0~1}]}

item 목록:
${JSON.stringify(itemHints)}
`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You detect handwritten margin order numbers and their line ranges.' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } }
        ] }
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    })
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(`GPT-4o error (range mapping): ${result.error.message}`)
  }
  const content = result.choices?.[0]?.message?.content
  if (!content) return []
  const parsed = JSON.parse(content)
  return Array.isArray(parsed.ranges) ? parsed.ranges : []
}

function shouldRetryOrderNumberPass(items: ExtractedItem[]): boolean {
  if (!items.length) return false
  const lowConfidenceCount = items.filter((item) => item.confidence === 'low').length
  const missingCount = items.filter((item) => !item.po_number).length
  const lowConfidenceRatio = lowConfidenceCount / items.length
  const missingRatio = missingCount / items.length
  return missingRatio >= 0.4 || lowConfidenceRatio >= 0.4 || missingCount === items.length
}

async function extractOrderNumbersWithGPT4o(
  base64Image: string,
  tileImages: string[],
  apiKey: string
): Promise<string[]> {
  const prompt = `거래명세서 이미지에서 손글씨/필기체로 적힌 발주번호 또는 수주번호만 추출하세요.

규칙:
1) 번호 패턴만 반환: F########_### 또는 HS######-## 형태
2) 불확실하면 제외하세요.
3) 결과는 아래 JSON 형식만 반환:
{"numbers":["F...","HS..."]}
`

  const imageContents = [
    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } }
  ]

  tileImages.slice(0, 4).forEach((tile) => {
    imageContents.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${tile}`, detail: 'high' }
    })
  })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You only extract handwritten order numbers.' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          ...imageContents
        ] }
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(`GPT-4o error (numbers): ${result.error.message}`)
  }
  const content = result.choices?.[0]?.message?.content
  if (!content) return []
  const parsed = JSON.parse(content)
  return Array.isArray(parsed.numbers) ? parsed.numbers : []
}

function normalizePO(num: string): string {
  const match = num.toUpperCase().match(/^(F\d{8})_(\d{1,3})$/)
  if (match) {
    return `${match[1]}_${match[2].padStart(3, '0')}`
  }
  return num.toUpperCase()
}

function normalizeSO(num: string): string {
  const match = num.toUpperCase().match(/^(HS\d{6})-(\d{1,2})$/)
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}`
  }
  return num.toUpperCase()
}

function normalizePoNumbers(
  items: ExtractedItem[],
  rawVisionText?: string,
  extraNumbers: string[] = []
): ExtractedItem[] {
  // 발주번호 패턴: F + YYYYMMDD + _ + 1~3자리 숫자 (OCR에서 읽힌 형태)
  const poPatternLoose = /F\d{8}_\d{1,3}/gi
  // 수주번호 패턴: HS + YYMMDD + - + 1~2자리 숫자 (OCR에서 읽힌 형태)
  const soPatternLoose = /HS\d{6}-\d{1,2}/gi

  // 전체 텍스트에서 모든 PO/SO 번호 추출 (빈 칸, 여백 등에서 발견된 번호들)
  const allFoundNumbers: string[] = []
  if (rawVisionText) {
    const poMatches = rawVisionText.match(poPatternLoose) || []
    const soMatches = rawVisionText.match(soPatternLoose) || []
    allFoundNumbers.push(...poMatches.map(n => normalizePO(n)))
    allFoundNumbers.push(...soMatches.map(n => normalizeSO(n)))
  }
  if (extraNumbers.length > 0) {
    extraNumbers.forEach((value) => {
      const normalized = normalizeMappedNumber(value)
      if (normalized) allFoundNumbers.push(normalized)
    })
  }

  return items.map((item, idx) => {
    let poNumber = item.po_number

    if (poNumber) {
      // 패턴 매칭으로 정규화
      let normalized = poNumber.toUpperCase().replace(/\s+/g, '').replace(/[^\w_-]/g, '')
      
      // 발주번호 패턴 체크 및 정규화
      const poMatch = normalized.match(poPatternLoose)
      if (poMatch) {
        poNumber = normalizePO(poMatch[0])
      } else {
        // 수주번호 패턴 체크 및 정규화
        const soMatch = normalized.match(soPatternLoose)
        if (soMatch) {
          poNumber = normalizeSO(soMatch[0])
        } else {
          poNumber = normalized
        }
      }
    } else if (allFoundNumbers.length > 0) {
      // 품목에 번호가 없지만 전체 문서에서 번호가 발견된 경우
      // 단일 번호만 있으면 모든 품목에 적용 (하나의 발주에 대한 거래명세서)
      const uniqueCount = new Set(allFoundNumbers).size
      if (uniqueCount === 1) {
        poNumber = allFoundNumbers[0]
      } else if (allFoundNumbers.length === items.length && uniqueCount === items.length) {
        // 번호 개수와 품목 개수가 같고 중복이 없으면 순서대로 매칭
        poNumber = allFoundNumbers[idx]
      }
      // 그 외의 경우는 수동 매칭 필요
    }

    return {
      ...item,
      po_number: poNumber || item.po_number
    }
  })
}

type OrderCorrectionResult = {
  items: ExtractedItem[];
  inferredVendorName?: string;
};

async function correctOrderNumbersByDb(
  supabase: any,
  items: ExtractedItem[],
  vendorId?: number
): Promise<OrderCorrectionResult> {
  if (!items.length) return { items };

  const numberCounts = new Map<string, number>();
  items.forEach(item => {
    if (item.po_number) {
      numberCounts.set(item.po_number, (numberCounts.get(item.po_number) || 0) + 1);
    }
  });

  const mostCommon = Array.from(numberCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mostCommon) return { items };

  const isPO = /^F\d{8}_\d{3}$/.test(mostCommon);
  const isSO = /^HS\d{6}-\d{2}$/.test(mostCommon);
  if (!isPO && !isSO) return { items };

  const { data: exactMatch } = await supabase
    .from('purchase_requests')
    .select('id, vendor:vendors(vendor_name)')
    .or(`purchase_order_number.eq.${mostCommon},sales_order_number.eq.${mostCommon}`)
    .limit(1);

  if (exactMatch && exactMatch.length > 0) {
    const vendorName = (exactMatch[0].vendor as { vendor_name?: string } | null)?.vendor_name;
    return {
      items,
      inferredVendorName: vendorName
    };
  }

  const prefix = isPO ? mostCommon.slice(0, 9) : mostCommon.slice(0, 8);
  let query = supabase
    .from('purchase_requests')
    .select(`
      id,
      purchase_order_number,
      sales_order_number,
      vendor:vendors(vendor_name),
      items:purchase_request_items(
        id,
        item_name,
        specification,
        quantity
      )
    `)
    .limit(30);

  query = isPO
    ? query.ilike('purchase_order_number', `${prefix}%`)
    : query.ilike('sales_order_number', `${prefix}%`);

  if (vendorId) {
    query = query.eq('vendor_id', vendorId);
  }

  const { data: candidates } = await query;
  if (!candidates || candidates.length === 0) return { items };

  const cleanedItems = items.map(item => ({
    name: normalizeItemText(item.item_name || ''),
    quantity: item.quantity || 0
  }));

  let bestCandidate: any = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const systemItems = (candidate.items || []).map((it: any) => ({
      name: normalizeItemText(it.item_name || ''),
      spec: normalizeItemText(it.specification || ''),
      quantity: it.quantity || 0
    }));

    const { score, matchedCount } = calculateOrderSimilarity(cleanedItems, systemItems);
    if (matchedCount === 0) continue;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestScore < 65) {
    return { items };
  }

  const correctedNumber = isPO
    ? (bestCandidate.purchase_order_number || '')
    : (bestCandidate.sales_order_number || '');

  if (!correctedNumber) {
    return { items };
  }

  const correctedItems = items.map(item => ({
    ...item,
    po_number: correctedNumber
  }));

  const inferredVendorName = (bestCandidate.vendor as { vendor_name?: string } | null)?.vendor_name;

  return { items: correctedItems, inferredVendorName };
}

function normalizeItemText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9가-힣]/g, '')
    .trim();
}

function normalizeMappedNumber(value?: string): string {
  if (!value) return ''
  const cleaned = normalizeOrderCandidate(value)
  if (cleaned.startsWith('F')) return normalizePO(cleaned)
  if (cleaned.startsWith('HS')) return normalizeSO(cleaned)
  return cleaned
}

function normalizeOrderCandidate(value: string): string {
  const cleaned = value.toUpperCase().replace(/\s+/g, '').replace(/[^\w_-]/g, '')
  if (cleaned.startsWith('H5')) {
    return `HS${normalizeDigitConfusions(cleaned.slice(2))}`
  }
  if (cleaned.startsWith('HS')) {
    return `HS${normalizeDigitConfusions(cleaned.slice(2))}`
  }
  if (cleaned.startsWith('F')) {
    return `F${normalizeDigitConfusions(cleaned.slice(1))}`
  }
  return normalizeDigitConfusions(cleaned)
}

function normalizeDigitConfusions(value: string): string {
  const replacements: Record<string, string> = {
    O: '0',
    I: '1',
    L: '1',
    S: '5',
    B: '8',
    Z: '2'
  }
  return value
    .split('')
    .map((char) => replacements[char] ?? char)
    .join('')
}

function applyPoMappings(items: ExtractedItem[], mappings: PoMapping[]): ExtractedItem[] {
  if (!mappings.length) return items

  const byLine = new Map<number, PoMapping>()
  const byName = new Map<string, PoMapping>()
  const ranges: Array<{ start: number; end: number; po_number?: string; confidence?: number }> = []

  mappings.forEach((m) => {
    if (m.confidence !== undefined && m.confidence < 0.6) return
    if (typeof m.start_line === 'number' && typeof m.end_line === 'number') {
      if (m.start_line <= m.end_line) {
        ranges.push({ start: m.start_line, end: m.end_line, po_number: m.po_number, confidence: m.confidence })
      }
      return
    }
    if (typeof m.line_number === 'number') {
      byLine.set(m.line_number, m)
      return
    }
    if (m.item_name) {
      byName.set(normalizeItemText(m.item_name), m)
    }
  })

  return items.map((item, idx) => {
    const lineNumber = item.line_number ?? idx + 1
    const rangeMatches = ranges.filter(range => lineNumber >= range.start && lineNumber <= range.end)
    let rangeMatch: { po_number?: string; confidence?: number } | undefined = undefined
    if (rangeMatches.length > 0) {
      rangeMatch = rangeMatches
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || (a.end - a.start) - (b.end - b.start))[0]
    }
    const byLineMatch = byLine.get(lineNumber)
    const byNameMatch = byName.get(normalizeItemText(item.item_name || ''))
    const selected = rangeMatch || byLineMatch || byNameMatch
    const mapped = normalizeMappedNumber(selected?.po_number)
    if (!mapped) return item
    return { ...item, po_number: mapped }
  })
}

function buildInferredPoMap(params: {
  items: ExtractedItem[];
  visionWords: VisionWord[];
  bracketMappings: PoMapping[];
  rangeMappings: RangeMapping[];
}): Map<number, InferredPoInfo> {
  const { items, visionWords, bracketMappings, rangeMappings } = params
  const inferredMap = new Map<number, InferredPoInfo>()

  if (!items.length) return inferredMap

  const itemsWithLine = items.map((item, idx) => ({
    item,
    lineNumber: item.line_number || idx + 1
  }))

  const rows = visionWords.length > 0 ? groupWordsIntoRows(visionWords) : []
  const itemRowMap = rows.length > 0 ? mapItemsToRows(itemsWithLine, rows) : new Map<number, RowData>()
  const marginMap = rows.length > 0 ? mapMarginNumbersToItems(itemRowMap, rows) : new Map<number, InferredPoInfo>()
  const bracketMap = mapBracketMappingsToItems(itemsWithLine, bracketMappings)
  const rangeMap = mapRangeMappingsToItems(itemsWithLine, rangeMappings)
  const perItemMap = mapPerItemNumbers(itemsWithLine)
  const globalNumber = getGlobalPoNumber(items)

  itemsWithLine.forEach(({ lineNumber }) => {
    if (bracketMap.has(lineNumber)) {
      inferredMap.set(lineNumber, bracketMap.get(lineNumber)!)
      return
    }
    if (rangeMap.has(lineNumber)) {
      inferredMap.set(lineNumber, rangeMap.get(lineNumber)!)
      return
    }
    if (marginMap.has(lineNumber)) {
      inferredMap.set(lineNumber, marginMap.get(lineNumber)!)
      return
    }
    if (perItemMap.has(lineNumber)) {
      inferredMap.set(lineNumber, perItemMap.get(lineNumber)!)
      return
    }
    if (globalNumber) {
      inferredMap.set(lineNumber, {
        inferred_po_number: globalNumber,
        inferred_po_source: 'global',
        inferred_po_confidence: 0.55,
        inferred_po_group_id: `global-${globalNumber}`
      })
    }
  })

  return inferredMap
}

function groupWordsIntoRows(words: VisionWord[]): RowData[] {
  if (!words.length) return []

  const heights = words.map(word => word.bbox.h).filter(h => h > 0).sort((a, b) => a - b)
  const medianHeight = heights.length
    ? heights[Math.floor(heights.length / 2)]
    : 10
  const rowGap = Math.max(6, Math.round(medianHeight * 0.6))

  const sorted = [...words].sort((a, b) => (a.bbox.y + a.bbox.h / 2) - (b.bbox.y + b.bbox.h / 2))
  const rows: RowData[] = []

  sorted.forEach(word => {
    const centerY = word.bbox.y + word.bbox.h / 2
    const row = rows.find(r => Math.abs(r.centerY - centerY) <= rowGap)
    if (row) {
      row.words.push(word)
      row.centerY = (row.centerY * (row.words.length - 1) + centerY) / row.words.length
      row.minX = Math.min(row.minX, word.bbox.x)
      row.maxX = Math.max(row.maxX, word.bbox.x + word.bbox.w)
      row.minY = Math.min(row.minY, word.bbox.y)
      row.maxY = Math.max(row.maxY, word.bbox.y + word.bbox.h)
      return
    }

    rows.push({
      id: rows.length + 1,
      text: '',
      words: [word],
      minX: word.bbox.x,
      maxX: word.bbox.x + word.bbox.w,
      minY: word.bbox.y,
      maxY: word.bbox.y + word.bbox.h,
      centerY
    })
  })

  rows.forEach(row => {
    row.words.sort((a, b) => a.bbox.x - b.bbox.x)
    row.text = row.words.map(word => word.text).join(' ')
  })

  rows.sort((a, b) => a.centerY - b.centerY)
  return rows
}

function mapItemsToRows(
  itemsWithLine: Array<{ item: ExtractedItem; lineNumber: number }>,
  rows: RowData[]
): Map<number, RowData> {
  const rowMap = new Map<number, RowData>()

  itemsWithLine.forEach(({ item, lineNumber }, idx) => {
    const itemName = (item.item_name || '').trim()
    if (!itemName) return

    let bestRow: RowData | null = null
    let bestScore = 0

    rows.forEach(row => {
      const score = calculateRowMatchScore(itemName, row.text)
      if (score > bestScore) {
        bestScore = score
        bestRow = row
      }
    })

    if (bestRow && bestScore >= 35) {
      rowMap.set(lineNumber, bestRow)
      return
    }

    const fallbackRow = rows[idx]
    if (fallbackRow) {
      rowMap.set(lineNumber, fallbackRow)
    }
  })

  return rowMap
}

function mapMarginNumbersToItems(
  itemRowMap: Map<number, RowData>,
  rows: RowData[]
): Map<number, InferredPoInfo> {
  const inferredMap = new Map<number, InferredPoInfo>()
  if (!rows.length) return inferredMap

  const allMinX = rows.map(row => row.minX)
  const allMaxX = rows.map(row => row.maxX)
  const minX = Math.min(...allMinX)
  const maxX = Math.max(...allMaxX)
  const leftLimit = minX + (maxX - minX) * 0.2

  const marginNumbers = rows
    .map(row => {
      const leftWords = row.words.filter(word => word.bbox.x <= leftLimit + 2)
      const combinedText = leftWords.map(word => word.text).join(' ')
      const number = extractOrderNumber(combinedText)
      return number ? { number, centerY: row.centerY, rowId: row.id } : null
    })
    .filter((value): value is { number: string; centerY: number; rowId: number } => !!value)
    .sort((a, b) => a.centerY - b.centerY)

  if (!marginNumbers.length) return inferredMap

  itemRowMap.forEach((row, lineNumber) => {
    const match = marginNumbers
      .filter(candidate => candidate.centerY <= row.centerY)
      .slice(-1)[0]
    if (!match) return

    inferredMap.set(lineNumber, {
      inferred_po_number: match.number,
      inferred_po_source: 'margin_range',
      inferred_po_confidence: 0.7,
      inferred_po_group_id: `margin-${match.rowId}`
    })
  })

  return inferredMap
}

function mapBracketMappingsToItems(
  itemsWithLine: Array<{ item: ExtractedItem; lineNumber: number }>,
  mappings: PoMapping[]
): Map<number, InferredPoInfo> {
  const inferredMap = new Map<number, InferredPoInfo>()
  if (!mappings.length) return inferredMap

  const itemByLine = new Map<number, ExtractedItem>()
  itemsWithLine.forEach(({ item, lineNumber }) => {
    itemByLine.set(lineNumber, item)
  })

  mappings.forEach((mapping, index) => {
    const mappedNumber = normalizeMappedNumber(mapping.po_number)
    if (!mappedNumber) return
    const confidence = Math.max(0.5, Math.min(0.95, mapping.confidence ?? 0.8))

    if (typeof mapping.start_line === 'number' && typeof mapping.end_line === 'number') {
      const startLine = mapping.start_line
      const endLine = mapping.end_line
      if (startLine <= endLine) {
        const groupId = `bracket-range-${index + 1}-${mappedNumber}`
        itemsWithLine.forEach(({ lineNumber }) => {
          if (lineNumber >= startLine && lineNumber <= endLine && !inferredMap.has(lineNumber)) {
            inferredMap.set(lineNumber, {
              inferred_po_number: mappedNumber,
              inferred_po_source: 'bracket',
              inferred_po_confidence: confidence,
              inferred_po_group_id: groupId
            })
          }
        })
      }
      return
    }

    let lineNumber: number | undefined = undefined
    if (typeof mapping.line_number === 'number') {
      lineNumber = mapping.line_number
    } else if (mapping.item_name) {
      const bestMatch = findBestItemByName(itemsWithLine, mapping.item_name)
      lineNumber = bestMatch?.lineNumber
    }

    if (!lineNumber) return

    const groupId = `bracket-${mappedNumber}`
    inferredMap.set(lineNumber, {
      inferred_po_number: mappedNumber,
      inferred_po_source: 'bracket',
      inferred_po_confidence: confidence,
      inferred_po_group_id: groupId
    })

    const previousLine = lineNumber - 1
    const previousItem = itemByLine.get(previousLine)
    if (
      previousItem &&
      !inferredMap.has(previousLine) &&
      confidence >= 0.75 &&
      (previousItem.item_name || '').trim().length >= 2
    ) {
      inferredMap.set(previousLine, {
        inferred_po_number: mappedNumber,
        inferred_po_source: 'bracket',
        inferred_po_confidence: confidence,
        inferred_po_group_id: groupId
      })
    }
  })

  return inferredMap
}

function mapRangeMappingsToItems(
  itemsWithLine: Array<{ item: ExtractedItem; lineNumber: number }>,
  mappings: RangeMapping[]
): Map<number, InferredPoInfo> {
  const inferredMap = new Map<number, InferredPoInfo>()
  if (!mappings.length) return inferredMap

  mappings.forEach((mapping, index) => {
    const mappedNumber = normalizeMappedNumber(mapping.po_number)
    if (!mappedNumber) return
    const startLine = mapping.start_line
    const endLine = mapping.end_line
    if (!startLine || !endLine || startLine > endLine) return

    const confidence = Math.max(0.5, Math.min(0.95, mapping.confidence ?? 0.75))
    const groupId = `range-${index + 1}-${mappedNumber}`

    itemsWithLine.forEach(({ lineNumber }) => {
      if (lineNumber >= startLine && lineNumber <= endLine) {
        inferredMap.set(lineNumber, {
          inferred_po_number: mappedNumber,
          inferred_po_source: 'handwriting_range',
          inferred_po_confidence: confidence,
          inferred_po_group_id: groupId
        })
      }
    })
  })

  return inferredMap
}

function mapPerItemNumbers(
  itemsWithLine: Array<{ item: ExtractedItem; lineNumber: number }>
): Map<number, InferredPoInfo> {
  const inferredMap = new Map<number, InferredPoInfo>()

  itemsWithLine.forEach(({ item, lineNumber }) => {
    const number = normalizeMappedNumber(item.po_number)
    if (!number) return

    const confidence = item.confidence === 'high'
      ? 0.85
      : item.confidence === 'med'
        ? 0.7
        : 0.55

    inferredMap.set(lineNumber, {
      inferred_po_number: number,
      inferred_po_source: 'per_item',
      inferred_po_confidence: confidence
    })
  })

  return inferredMap
}

function getGlobalPoNumber(items: ExtractedItem[]): string | null {
  const uniqueNumbers = Array.from(new Set(
    items
      .map(item => normalizeMappedNumber(item.po_number))
      .filter((value): value is string => !!value)
  ))

  if (uniqueNumbers.length === 1) {
    return uniqueNumbers[0]
  }

  return null
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9가-힣]/g, '')
    .trim()
}

function calculateRowMatchScore(itemName: string, rowText: string): number {
  const normalizedItem = normalizeText(itemName)
  const normalizedRow = normalizeText(rowText)
  if (!normalizedItem || !normalizedRow) return 0

  if (normalizedRow.includes(normalizedItem) || normalizedItem.includes(normalizedRow)) {
    return 90
  }

  const itemTokens = tokenizeText(itemName)
  const rowTokens = tokenizeText(rowText)
  if (!itemTokens.length || !rowTokens.length) return 0

  const commonCount = itemTokens.filter(token => rowTokens.includes(token)).length
  const score = (commonCount / Math.max(itemTokens.length, rowTokens.length)) * 100
  return Math.round(score)
}

function tokenizeText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

function findBestItemByName(
  itemsWithLine: Array<{ item: ExtractedItem; lineNumber: number }>,
  query: string
): { lineNumber: number } | null {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return null

  let bestLineNumber: number | null = null
  let bestScore = -1
  itemsWithLine.forEach(({ item, lineNumber }) => {
    const name = normalizeText(item.item_name || '')
    if (!name) return

    let score = 0
    if (name.includes(normalizedQuery) || normalizedQuery.includes(name)) {
      score = 90
    } else {
      const queryTokens = tokenizeText(query)
      const nameTokens = tokenizeText(item.item_name || '')
      const commonCount = queryTokens.filter(token => nameTokens.includes(token)).length
      score = (commonCount / Math.max(queryTokens.length, nameTokens.length || 1)) * 100
    }

    if (score > bestScore) {
      bestScore = score
      bestLineNumber = lineNumber
    }
  })

  if (!bestLineNumber || bestScore < 35) return null
  return { lineNumber: bestLineNumber }
}

function extractOrderNumber(text: string): string | null {
  if (!text) return null
  const cleaned = text.toUpperCase().replace(/\s+/g, '').replace(/[^\w_-]/g, '')

  const poMatch = cleaned.match(/F[0-9A-Z]{8}[_-][0-9A-Z]{1,3}/)
  if (poMatch) {
    const normalized = normalizeOrderCandidate(poMatch[0]).replace('-', '_')
    return normalizePO(normalized)
  }

  const soMatch = cleaned.match(/H[5S][0-9A-Z]{6}[-_][0-9A-Z]{1,2}/)
  if (soMatch) {
    const normalized = normalizeOrderCandidate(soMatch[0]).replace('_', '-')
    return normalizeSO(normalized)
  }

  return null
}

function calculateOrderSimilarity(
  ocrItems: Array<{ name: string; quantity: number }>,
  systemItems: Array<{ name: string; spec: string; quantity: number }>
): { score: number; matchedCount: number } {
  if (!ocrItems.length || !systemItems.length) {
    return { score: 0, matchedCount: 0 };
  }

  const usedSystem = new Set<number>();
  let totalScore = 0;
  let matchedCount = 0;

  for (const ocrItem of ocrItems) {
    let best = 0;
    let bestIndex = -1;

    for (let i = 0; i < systemItems.length; i += 1) {
      if (usedSystem.has(i)) continue;
      const sys = systemItems[i];
      const nameScore = calculateNameSimilarity(ocrItem.name, sys.name);
      const specScore = sys.spec ? calculateNameSimilarity(ocrItem.name, sys.spec) : 0;
      const baseScore = Math.max(nameScore, specScore);

      let quantityBonus = 0;
      if (ocrItem.quantity && sys.quantity) {
        if (ocrItem.quantity === sys.quantity) {
          quantityBonus = 20;
        } else if (ocrItem.quantity <= sys.quantity) {
          quantityBonus = 10;
        }
      }

      const total = baseScore + quantityBonus;
      if (total > best) {
        best = total;
        bestIndex = i;
      }
    }

    if (best >= 60 && bestIndex >= 0) {
      usedSystem.add(bestIndex);
      totalScore += best;
      matchedCount += 1;
    }
  }

  const matchRatio = matchedCount / ocrItems.length;
  const avgScore = matchedCount > 0 ? totalScore / matchedCount : 0;
  const score = Math.round((matchRatio * 50) + (avgScore * 0.5));

  return { score, matchedCount };
}

function calculateNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return Math.round(80 + ratio * 20);
  }
  return 0;
}

