// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4'

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

type ParseMode = 'process_specific'

interface ParseRequest {
  statementId?: string;
  fileUrl?: string;
  imageUrl?: string;
  mode?: ParseMode;
  reset_before_extract?: boolean;
}

interface ParsedItem {
  line_number: number;
  item_name: string;
  specification?: string;
  quantity?: number | null;
  unit_price?: number | null;
  amount: number;
  tax_amount?: number | null;
  po_number?: string;
  po_line_number?: number;
  remark?: string;
  confidence: 'low' | 'med' | 'high';
}

interface ParseResult {
  statement_date?: string;
  vendor_name?: string;
  vendor_name_english?: string;
  total_amount?: number;
  tax_amount?: number;
  grand_total?: number;
  items: ParsedItem[];
  raw_text?: string;
  file_type: 'pdf';
  expected_item_count?: number;
  expected_max_line_number?: number;
  extraction_passes?: number;
}

interface MatchResult {
  lineNumber: number;
  matchedPurchaseId: number | null;
  matchedItemId: number | null;
  matchedVendorName: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let statementId: string | null = null
  let supabaseUrl = ''
  let supabaseServiceKey = ''
  let currentStage = 'init'

  try {
    supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    if (!anthropicApiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: ParseRequest = await req.json().catch(() => ({}))

    statementId = requestData.statementId || null
    const fileUrl = requestData.fileUrl || requestData.imageUrl || ''
    const mode: ParseMode = requestData.mode || 'process_specific'

    if (mode !== 'process_specific') {
      throw new Error('Unsupported mode. parse-transaction-pdf only supports process_specific')
    }
    if (!statementId || !fileUrl) {
      throw new Error('Missing statementId or fileUrl')
    }

    currentStage = 'read_existing'
    const { data: existingStatement } = await supabase
      .from('transaction_statements')
      .select('extracted_data, po_scope')
      .eq('id', statementId)
      .single()

    const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date || null
    const poScope = existingStatement?.po_scope as ('single' | 'multi' | null)

    currentStage = 'reset_statement'
    await resetStatementForProcessing(
      supabase,
      statementId,
      preservedActualReceivedDate
    )

    currentStage = 'download_file'
    const fileBuffer = await downloadFile(fileUrl)

    currentStage = 'encode_pdf'
    const pdfBase64 = arrayBufferToBase64(fileBuffer)

    currentStage = 'claude_extract'
    const parseResult = await extractWithClaude(pdfBase64, anthropicApiKey, poScope)

    currentStage = 'match_items'
    const matchedItems = await matchItemsToSystem(supabase, parseResult.items)

    currentStage = 'match_vendor'
    let validatedVendorName: string | null = null
    if (parseResult.vendor_name) {
      const vendorResult = await validateAndMatchVendor(supabase, parseResult.vendor_name)
      if (vendorResult.matched) {
        validatedVendorName = vendorResult.vendor_name || null
      }
    }
    if (!validatedVendorName) {
      const inferredVendor = matchedItems.find((item) => item.matchedVendorName)?.matchedVendorName || null
      validatedVendorName = inferredVendor
    }

    currentStage = 'db_update'
    const extractedDataPayload: Record<string, unknown> = {
      ...parseResult,
      parser: 'parse-transaction-pdf',
      file_type: 'pdf',
      raw_text: sanitizeForJsonb(JSON.stringify(parseResult.items).slice(0, 12000)),
      items: parseResult.items,
    }
    if (preservedActualReceivedDate) {
      extractedDataPayload.actual_received_date = preservedActualReceivedDate
    }

    const { error: updateError } = await supabase
      .from('transaction_statements')
      .update({
        status: 'extracted',
        extraction_error: null,
        processing_finished_at: new Date().toISOString(),
        locked_by: null,
        statement_date: parseResult.statement_date || null,
        vendor_name: validatedVendorName || parseResult.vendor_name || null,
        total_amount: parseResult.total_amount || null,
        tax_amount: parseResult.tax_amount || null,
        grand_total: parseResult.grand_total || null,
        extracted_data: extractedDataPayload,
      })
      .eq('id', statementId)

    if (updateError) {
      throw new Error(`Failed to update transaction_statements: ${updateError.message}`)
    }

    currentStage = 'db_insert_items'
    if (parseResult.items.length > 0) {
      const itemsToInsert = parseResult.items.map((item, idx) => {
        const matched = matchedItems.find((m) => m.lineNumber === item.line_number)
        return {
          statement_id: statementId,
          line_number: item.line_number || idx + 1,
          extracted_item_name: item.item_name || '',
          extracted_specification: item.specification || null,
          extracted_quantity: item.quantity ?? null,
          extracted_unit_price: item.unit_price ?? null,
          extracted_amount: item.amount ?? 0,
          extracted_tax_amount: item.tax_amount ?? null,
          extracted_po_number: item.po_number || null,
          extracted_po_line_number: item.po_line_number ?? null,
          extracted_remark: item.remark || null,
          match_confidence: item.confidence,
          matched_purchase_id: matched?.matchedPurchaseId || null,
          matched_item_id: matched?.matchedItemId || null,
          match_method: matched ? 'item_similarity' : null,
        }
      })

      const { error: itemsError } = await supabase
        .from('transaction_statement_items')
        .insert(itemsToInsert)

      if (itemsError) {
        throw new Error(`Failed to insert transaction_statement_items: ${itemsError.message}`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        statementId,
        status: 'extracted',
        itemCount: parseResult.items.length,
        vendor_name: validatedVendorName || parseResult.vendor_name || null,
        result: parseResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    const errorMessage = `[stage:${currentStage}] ${error?.message || 'Unknown error'}`
    if (statementId && supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        await supabase
          .from('transaction_statements')
          .update({
            status: 'failed',
            extraction_error: errorMessage,
            processing_finished_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            retry_count: 0,
            locked_by: null,
          })
          .eq('id', statementId)
      } catch (_) {
        // no-op
      }
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function resetStatementForProcessing(
  supabase: any,
  statementId: string,
  preservedActualReceivedDate: string | null
): Promise<void> {
  await supabase
    .from('transaction_statement_items')
    .delete()
    .eq('statement_id', statementId)

  const extractedData = preservedActualReceivedDate
    ? { actual_received_date: preservedActualReceivedDate, file_type: 'pdf' }
    : { file_type: 'pdf' }

  await supabase
    .from('transaction_statements')
    .update({
      status: 'processing',
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
      processing_started_at: new Date().toISOString(),
      processing_finished_at: null,
      locked_by: null,
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
    .eq('id', statementId)
}

async function downloadFile(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }
  return await response.arrayBuffer()
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function sanitizeForJsonb(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
}

async function extractWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null
): Promise<ParseResult> {
  const scopeHint = poScope === 'single'
    ? '이 거래명세서는 단일 발주/수주 건입니다. 번호가 없더라도 동일 건으로 취급하세요.'
    : poScope === 'multi'
      ? '이 거래명세서는 다중 발주/수주 건입니다. 품목별 번호를 분리해 추출하세요.'
      : ''

  const prompt = `이 PDF는 한국어 거래명세서입니다. 아래 규칙에 따라 JSON으로만 구조화하세요.

${scopeHint ? `발주/수주 범위 힌트: ${scopeHint}` : ''}

거래처(공급자) 식별 규칙:
- "공급받는자" 쪽 회사는 우리 회사이므로 vendor_name이 아닙니다.
- "공급자" 쪽 회사가 vendor_name 입니다.

중복 제거 규칙 (중요):
- PDF에 "거래명세서(공급받는자)"와 "거래명세서(공급자)" 사본이 동일 내용으로 중복될 수 있음
- "거래명세서(공급자)" 섹션의 품목은 무시하고, "거래명세서(공급받는자)" 섹션만 사용
- 같은 품목명/금액이 여러 번 나오더라도 "거래명세서(공급받는자)" 본문의 서로 다른 행이면 모두 포함할 것

추출 대상:
1) statement_date (YYYY-MM-DD)
2) vendor_name (공급자 회사명)
3) vendor_name_english (영문 추정, 없으면 null)
4) total_amount, tax_amount, grand_total (숫자만)
5) items 배열 — 모든 페이지에서 연속 순번으로 통합

items 각 항목:
- line_number: 위에서 아래로 읽은 행 순서 (첫 번째 품목 행=1, 두 번째=2, ...). 거래명세서에 인쇄된 품목 번호(예: 1,2,3...8)는 무시하고, 실제 테이블 행 순서대로 1부터 연번 부여
- item_name: 품목명/품명
- specification: 규격
- quantity: 수량 (비어있으면 null)
- unit_price: 단가 (비어있으면 null)
- amount: 금액 (비어있으면 0)
- tax_amount: 세액 (없으면 null)
- po_number: 발주/수주번호 (F20260121_001-01 형식 또는 HS260201-01 형식)
- remark: 비고
- confidence: low|med|high

발주/수주번호에 라인 서픽스(예: F20260121_001-01)가 있으면 po_number에 전체를 포함하세요.

행 생략 금지:
- 모든 품목 행을 빠짐없이 추출
- 합계/소계/서명 등 푸터 행은 제외
- ENIG(화학금도금), 필름, V-CUT, 네고, 잉크비, 운반비처럼 품목명 칸에 찍힌 행은 모두 item으로 반드시 포함
- 품명 칸이 비어 있어도 금액(amount) 또는 세액(tax_amount)이 있으면 별도 item으로 포함 (직전 행 remark로 병합 금지)

items 배열 순서 (매우 중요):
- items 배열은 반드시 거래명세서 원본의 위에서 아래로 인쇄된 행 순서 그대로 반환할 것
- 번호가 있는 행과 번호가 없는 행(ENIG, 필름, V-CUT 등)을 분리하거나 그룹핑하지 말 것
- 예: 원본이 "1.PCB → ENIG → 2.PCB → ENIG" 순이면 items도 반드시 [PCB, ENIG, PCB, ENIG] 순서로 반환

반드시 JSON만 응답하세요.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Claude API error: ${response.status} ${body}`)
  }

  const result = await response.json()
  const textContent = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()

  if (!textContent) {
    throw new Error('No content in Claude response')
  }

  let parsed: any
  try {
    parsed = parseStrictJson(textContent)
  } catch (parseError) {
    // Claude가 거의-JSON을 반환한 경우, 한번 더 "JSON 정규화"를 요청해 복구한다.
    let repairedText = ''
    let repairErrorMessage = ''
    try {
      repairedText = await repairJsonWithClaude(textContent, apiKey)
    } catch (repairError: any) {
      repairErrorMessage = repairError?.message || 'unknown_repair_error'
    }

    try {
      parsed = parseStrictJson(repairedText)
    } catch (_) {
      const primaryTail = sanitizeForJsonb((textContent || '').slice(-300))
      const repairedTail = sanitizeForJsonb((repairedText || '').slice(-300))
      throw new Error(
        `Failed to parse JSON from Claude response | ` +
        `primary_len=${textContent?.length || 0} | ` +
        `primary_tail=${primaryTail} | ` +
        `repair_error=${repairErrorMessage || 'none'} | ` +
        `repair_len=${repairedText?.length || 0} | ` +
        `repair_tail=${repairedTail}`
      )
    }
  }
  let normalized = normalizeParseResult(parsed, textContent)
  normalized.items = deduplicateExactRows(normalized.items)

  const expectedLineNumbers = await detectExpectedLineNumbersWithClaude(pdfBase64, apiKey, poScope).catch(() => [])
  const expected = await estimateExpectedItemsWithClaude(pdfBase64, apiKey, poScope).catch(() => ({
    expectedItemCount: null as number | null,
    maxLineNumber: null as number | null,
  }))

  const numberedExpectedCount = expectedLineNumbers.length > 0 ? expectedLineNumbers.length : null
  const estimatedExpectedCount = expected.expectedItemCount
  let expectedItemCount: number | null = null
  if (numberedExpectedCount !== null && estimatedExpectedCount !== null) {
    expectedItemCount = Math.max(numberedExpectedCount, estimatedExpectedCount)
  } else {
    expectedItemCount = numberedExpectedCount ?? estimatedExpectedCount
  }

  const expectedMaxLineNumber = expectedLineNumbers.length > 0
    ? Math.max(...expectedLineNumbers)
    : expected.maxLineNumber

  if (expectedItemCount === null) {
    throw new Error('Failed to estimate expected item count for PDF extraction')
  }

  let extractionPasses = 1
  const tailRecovery = await extractTailItemsWithClaude(
    pdfBase64,
    apiKey,
    poScope,
    getMaxLineNumber(normalized.items),
    expectedMaxLineNumber
  )
  if (tailRecovery.passes > 0) {
    extractionPasses += tailRecovery.passes
    normalized.items = mergeParsedItems(normalized.items, tailRecovery.items)
    normalized.items = deduplicateExactRows(normalized.items)
  }

  if (
    expectedMaxLineNumber !== null &&
    normalized.items.length < expectedItemCount
  ) {
    let rangeItems: ParsedItem[] = []
    if (expectedLineNumbers.length > 0) {
      const missingLineNumbers = findMissingExpectedLineNumbers(normalized.items, expectedLineNumbers)
      if (missingLineNumbers.length > 0) {
        const ranges = buildLineRanges(missingLineNumbers, 40)
        rangeItems = await extractItemsForRangesWithClaude(pdfBase64, apiKey, poScope, ranges)
        extractionPasses += ranges.length
      }
    } else {
      rangeItems = await extractItemsByLineRangesWithClaude(
        pdfBase64,
        apiKey,
        poScope,
        expectedMaxLineNumber
      )
      extractionPasses += Math.ceil(expectedMaxLineNumber / 40)
    }
    normalized.items = mergeParsedItems(normalized.items, rangeItems)
  }

  if (
    normalized.items.length < expectedItemCount
  ) {
    const supplementalItems = await extractMissingItemsWithClaude(
      pdfBase64,
      apiKey,
      poScope,
      normalized.items,
      expectedItemCount
    )
    extractionPasses += 1
    normalized.items = mergeParsedItems(normalized.items, supplementalItems)
  }

  // 모든 추출 패스가 끝난 후: 완전 중복(동일 line_number + 동일 내용)만 제거
  // 공급자 사본 중복은 프롬프트에서 "공급받는자만 사용"으로 처리
  normalized.items = deduplicateExactRows(normalized.items)

  const adjustedExpectedCount = expectedItemCount

  const missingExpectedLines = expectedLineNumbers.length > 0
    ? findMissingExpectedLineNumbers(normalized.items, expectedLineNumbers)
    : []

  // 중복 제거로 제거된 line_number는 missing에서 제외
  const trulyMissingLines = missingExpectedLines.filter((lineNum) =>
    !normalized.items.some((item) => item.line_number < lineNum) ||
    lineNum <= getMaxLineNumber(normalized.items)
  )

  if (trulyMissingLines.length > 0) {
    const missingPreview = trulyMissingLines.slice(0, 25).join(',')
    throw new Error(
      `Incomplete PDF extraction: expected_item_count=${expectedItemCount}, extracted_item_count=${normalized.items.length}, missing_lines=[${missingPreview}${trulyMissingLines.length > 25 ? ',...' : ''}]`
    )
  }

  if (normalized.items.length < adjustedExpectedCount) {
    throw new Error(
      `Incomplete PDF extraction: expected_item_count=${expectedItemCount}, extracted_item_count=${normalized.items.length}`
    )
  }

  const orderedItems = renumberItemsInDisplayOrder(normalized.items)
  const finalExpectedItemCount = Math.max(expectedItemCount, orderedItems.length)

  return {
    ...normalized,
    items: orderedItems,
    expected_item_count: finalExpectedItemCount,
    expected_max_line_number: expectedMaxLineNumber ?? undefined,
    extraction_passes: extractionPasses,
  }
}

function parseStrictJson(content: string): any {
  try {
    return JSON.parse(content)
  } catch (_) {}

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()) } catch (_) {}
  }

  const first = content.indexOf('{')
  const last = content.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try { return JSON.parse(content.slice(first, last + 1)) } catch (_) {}
  }

  const recovered = recoverTruncatedItemsJson(content)
  if (recovered) {
    try {
      return JSON.parse(recovered)
    } catch (_) {}
  }

  throw new Error('Failed to parse JSON from Claude response')
}

function recoverTruncatedItemsJson(content: string): string | null {
  const start = content.indexOf('{')
  if (start < 0) return null
  const itemsKeyIndex = content.indexOf('"items"', start)
  if (itemsKeyIndex < 0) return null
  const arrayStart = content.indexOf('[', itemsKeyIndex)
  if (arrayStart < 0) return null

  const tail = content.slice(arrayStart + 1)
  const lastCompleteItemEndInTail = tail.lastIndexOf('}')
  if (lastCompleteItemEndInTail < 0) return null

  const prefix = content.slice(start, arrayStart + 1)
  let itemsBody = tail.slice(0, lastCompleteItemEndInTail + 1).trim()
  itemsBody = itemsBody.replace(/,\s*$/, '')

  // 잘린 항목 이후를 버리고, 완성된 items 배열까지만 닫아서 JSON 복구
  return `${prefix}${itemsBody}]}`
}

async function repairJsonWithClaude(rawContent: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `아래 텍스트를 거래명세서 JSON 스키마에 맞는 "유효한 JSON 객체 하나"로 복구하세요.

규칙:
- 출력은 JSON 객체만 허용 (코드블록/설명/주석 금지)
- 키는 statement_date, vendor_name, vendor_name_english, total_amount, tax_amount, grand_total, items 만 사용
- items는 배열, 각 원소 키는 line_number, item_name, specification, quantity, unit_price, amount, tax_amount, po_number, po_line_number, remark, confidence
- 알 수 없는 값은 null 사용

원본 텍스트:
${rawContent.slice(0, 12000)}`
            }
          ]
        }
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Claude JSON repair error: ${response.status} ${body}`)
  }

  const result = await response.json()
  const repairedText = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()

  if (!repairedText) {
    throw new Error('No content in Claude JSON repair response')
  }

  return repairedText
}

async function estimateExpectedItemsWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null
): Promise<{ expectedItemCount: number | null; maxLineNumber: number | null }> {
  const scopeHint = poScope === 'single'
    ? '단일 발주/수주 건으로 간주'
    : poScope === 'multi'
      ? '다중 발주/수주 건으로 간주'
      : '발주 범위 힌트 없음'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `이 PDF의 "거래명세서(공급받는자)" 기준 품목 행 개수를 추정하세요.
공급자 사본/중복/합계/소계/푸터/서명/계좌 행은 제외하세요.
ENIG(화학금도금), 필름, V-CUT, 네고, 잉크비, 운반비처럼 품목명 칸에 찍힌 행도 amount 또는 tax_amount가 있으면 품목 개수에 포함하세요.
힌트: ${scopeHint}

반드시 아래 JSON만 출력:
{
  "expected_item_count": 0,
  "max_line_number": 0
}

주의:
- expected_item_count: 실제 품목 개수
- max_line_number: 문서에 표기된 가장 큰 line_number (없으면 expected_item_count와 동일값)
- 값은 정수만`
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    return { expectedItemCount: null, maxLineNumber: null }
  }

  const result = await response.json().catch(() => null)
  const textContent = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()
  if (!textContent) return { expectedItemCount: null, maxLineNumber: null }

  try {
    const parsed = parseStrictJson(textContent)
    const expectedItemCount = parsePositiveInt(parsed?.expected_item_count)
    const maxLineNumber = parsePositiveInt(parsed?.max_line_number) ?? expectedItemCount
    return { expectedItemCount, maxLineNumber }
  } catch (_) {
    return { expectedItemCount: null, maxLineNumber: null }
  }
}

async function detectExpectedLineNumbersWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null
): Promise<number[]> {
  const scopeHint = poScope === 'single'
    ? '단일 발주/수주 건으로 간주'
    : poScope === 'multi'
      ? '다중 발주/수주 건으로 간주'
      : '발주 범위 힌트 없음'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `이 PDF의 "거래명세서(공급받는자)" 본문 품목 행에서 보이는 line_number를 전부 추출하세요.
규칙:
- 공급자 사본은 제외
- 합계/소계/푸터/서명/계좌행 제외
- 중복 숫자는 제거
- 오름차순 정렬
- 숫자만 반환
- 판단 불가한 값은 제외
- 힌트: ${scopeHint}

반드시 JSON만 출력:
{
  "line_numbers": [1,2,3]
}`
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    return []
  }

  const result = await response.json().catch(() => null)
  const textContent = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()
  if (!textContent) return []

  try {
    const parsed = parseStrictJson(textContent)
    const rawLineNumbers: any[] = Array.isArray(parsed?.line_numbers) ? parsed.line_numbers : []
    const unique: number[] = Array.from(new Set<number>(
      rawLineNumbers
        .map((v) => parsePositiveInt(v))
        .filter((v): v is number => v !== null)
    )).sort((a, b) => a - b)
    return unique
  } catch (_) {
    return []
  }
}

function findMissingExpectedLineNumbers(items: ParsedItem[], expectedLineNumbers: number[]): number[] {
  const found = new Set(
    items
      .map((item) => item.line_number)
      .filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0)
  )
  return expectedLineNumbers.filter((lineNumber) => !found.has(lineNumber))
}

function buildLineRanges(lineNumbers: number[], maxSpan: number = 40): Array<{ startLine: number; endLine: number }> {
  if (!lineNumbers.length) return []
  const sorted = Array.from(new Set(lineNumbers)).sort((a, b) => a - b)
  const ranges: Array<{ startLine: number; endLine: number }> = []

  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const contiguous = current === prev + 1
    const withinSpan = current - start < maxSpan
    if (contiguous && withinSpan) {
      prev = current
      continue
    }
    ranges.push({ startLine: start, endLine: prev })
    start = current
    prev = current
  }
  ranges.push({ startLine: start, endLine: prev })
  return ranges
}

async function extractItemsForRangesWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null,
  ranges: Array<{ startLine: number; endLine: number }>
): Promise<ParsedItem[]> {
  let merged: ParsedItem[] = []
  for (const range of ranges) {
    const chunkItems = await extractItemsLineRangeWithClaude(
      pdfBase64,
      apiKey,
      poScope,
      range.startLine,
      range.endLine
    )
    merged = mergeParsedItems(merged, chunkItems)
  }
  return merged
}

async function extractItemsByLineRangesWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null,
  maxLineNumber: number
): Promise<ParsedItem[]> {
  const chunkSize = 40
  let merged: ParsedItem[] = []
  const safeMaxLine = Math.min(Math.max(maxLineNumber, 1), 2000)
  for (let startLine = 1; startLine <= safeMaxLine; startLine += chunkSize) {
    const endLine = Math.min(startLine + chunkSize - 1, safeMaxLine)
    const chunkItems = await extractItemsLineRangeWithClaude(
      pdfBase64,
      apiKey,
      poScope,
      startLine,
      endLine
    )
    merged = mergeParsedItems(merged, chunkItems)
  }
  return merged
}

async function extractTailItemsWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null,
  currentMaxLineNumber: number,
  expectedMaxLineNumber: number | null
): Promise<{ items: ParsedItem[]; passes: number }> {
  if (!Number.isFinite(currentMaxLineNumber) || currentMaxLineNumber <= 0) {
    return { items: [], passes: 0 }
  }

  const chunkSize = 40
  const safeExpectedMax = expectedMaxLineNumber && expectedMaxLineNumber > 0 ? expectedMaxLineNumber : null
  const absoluteStopLine = Math.min(
    Math.max(
      safeExpectedMax ?? 0,
      currentMaxLineNumber + 120,
      currentMaxLineNumber + chunkSize
    ),
    currentMaxLineNumber + 200
  )

  let startLine = currentMaxLineNumber + 1
  let merged: ParsedItem[] = []
  let passes = 0
  let emptyStreak = 0

  while (startLine <= absoluteStopLine) {
    const endLine = Math.min(startLine + chunkSize - 1, absoluteStopLine)
    const chunkItems = await extractItemsLineRangeWithClaude(
      pdfBase64,
      apiKey,
      poScope,
      startLine,
      endLine
    )
    passes += 1

    const usefulItems = chunkItems.filter((item) => item.line_number > currentMaxLineNumber)
    if (usefulItems.length > 0) {
      merged = mergeParsedItems(merged, usefulItems)
      emptyStreak = 0
      if (safeExpectedMax !== null && getMaxLineNumber(merged) >= safeExpectedMax) {
        break
      }
    } else {
      emptyStreak += 1
      if (emptyStreak >= 1) {
        break
      }
    }

    startLine += chunkSize
  }

  return { items: merged, passes }
}

async function extractItemsLineRangeWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null,
  startLine: number,
  endLine: number
): Promise<ParsedItem[]> {
  const scopeHint = poScope === 'single'
    ? '단일 발주/수주 건'
    : poScope === 'multi'
      ? '다중 발주/수주 건'
      : '발주 범위 힌트 없음'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3072,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `이 PDF에서 line_number ${startLine}~${endLine} 구간에 해당하는 품목만 추출하세요.
기준:
- "거래명세서(공급받는자)"만 사용
- 공급자 사본/중복 제거
- 합계/소계/푸터/서명/계좌 행 제외
- 구간 외 행은 절대 포함 금지
- ENIG(화학금도금), 필름, V-CUT, 네고, 잉크비처럼 품목명 칸에 찍힌 행도 amount 또는 tax_amount가 있으면 포함
- 품목 행에 인쇄된 line_number가 없으면 line_number는 null로 반환
- 품명 빈칸 금액행은 직전 행 remark로 합치지 말고 별도 item으로 유지
- 힌트: ${scopeHint}

반드시 JSON만 출력:
{
  "items": [
    {
      "line_number": null,
      "item_name": "",
      "specification": null,
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "tax_amount": null,
      "po_number": null,
      "po_line_number": null,
      "remark": null,
      "confidence": "med"
    }
  ]
}`
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    return []
  }

  const result = await response.json().catch(() => null)
  const textContent = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()
  if (!textContent) return []

  try {
    const parsed = parseStrictJson(textContent)
    const rawItems: any[] = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed)
        ? parsed
        : []
    return rawItems
      .map((item, idx) => normalizeParsedItem(item, idx + startLine))
      .filter((item) => item.line_number >= startLine && item.line_number <= endLine)
  } catch (_) {
    return []
  }
}

async function extractMissingItemsWithClaude(
  pdfBase64: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null,
  knownItems: ParsedItem[],
  expectedItemCount: number
): Promise<ParsedItem[]> {
  const scopeHint = poScope === 'single'
    ? '단일 발주/수주 건'
    : poScope === 'multi'
      ? '다중 발주/수주 건'
      : '발주 범위 힌트 없음'

  const knownLines = Array.from(new Set(
    knownItems
      .map((item) => item.line_number)
      .filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0)
  )).sort((a, b) => a - b)

  const knownLineText = knownLines.join(',').slice(0, 7000)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `이 PDF의 품목 중에서 아직 누락된 행만 추출하세요.
기준:
- "거래명세서(공급받는자)"만 사용
- 공급자 사본/중복 제거
- 합계/소계/푸터/서명/계좌 행 제외
- ENIG(화학금도금), 필름, V-CUT, 네고, 잉크비처럼 품목명 칸에 찍힌 행도 amount 또는 tax_amount가 있으면 포함
- 품목 행에 인쇄된 line_number가 없으면 line_number는 null로 반환
- 품명 빈칸 금액행은 직전 행 remark로 합치지 말고 별도 item으로 유지
- 힌트: ${scopeHint}

이미 확보된 line_number:
${knownLineText}

총 품목 목표 개수(expected_item_count): ${expectedItemCount}

반드시 JSON만 출력:
{
  "items": [
    {
      "line_number": null,
      "item_name": "",
      "specification": null,
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "tax_amount": null,
      "po_number": null,
      "po_line_number": null,
      "remark": null,
      "confidence": "med"
    }
  ]
}`
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    return []
  }

  const result = await response.json().catch(() => null)
  const textContent = (result?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text || '')
    .join('\n')
    .trim()
  if (!textContent) return []

  try {
    const parsed = parseStrictJson(textContent)
    const rawItems: any[] = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed)
        ? parsed
        : []
    const normalized = rawItems.map((item, idx) => normalizeParsedItem(item, idx + 1))
    return normalized
  } catch (_) {
    return []
  }
}

/**
 * 공급자/공급받는자 사본 중복 제거.
 * line_number와 핵심 콘텐츠가 모두 같은 완전 중복만 제거한다.
 * (같은 품목명/금액이라도 line_number가 다르면 실제 별도 행으로 유지)
 */
function deduplicateExactRows(items: ParsedItem[]): ParsedItem[] {
  const normalize = (value: unknown): string => String(value ?? '').trim().toUpperCase()
  const grouped = new Map<string, ParsedItem[]>()

  for (const item of items) {
    const key = [
      Number.isFinite(item.line_number) ? item.line_number : 0,
      normalize(item.item_name),
      normalize(item.specification),
      normalize(item.po_number),
      item.quantity ?? '',
      item.unit_price ?? '',
      item.amount ?? 0,
      item.tax_amount ?? '',
      normalize(item.remark),
    ].join('|')

    const list = grouped.get(key)
    if (list) {
      list.push(item)
    } else {
      grouped.set(key, [item])
    }
  }

  const kept: ParsedItem[] = []
  for (const group of grouped.values()) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    const best = group.reduce((acc, cur) => chooseBetterParsedItem(acc, cur))
    kept.push(best)
  }

  return kept.sort((a, b) => {
    if (a.line_number !== b.line_number) return a.line_number - b.line_number
    return (a.item_name || '').localeCompare(b.item_name || '')
  })
}

/**
 * 공급자/공급받는자 사본이 함께 추출되면 동일 콘텐츠가 일정 라인 간격으로 반복된다.
 * 가장 지지도가 높은 라인 간격(diff)을 찾아, 같은 콘텐츠의 후행 블록만 제거한다.
 */
function deduplicateShiftedCopy(items: ParsedItem[]): ParsedItem[] {
  if (items.length < 10) return items

  const byContent = new Map<string, number[]>()
  for (const item of items) {
    const line = Number.isFinite(item.line_number) ? item.line_number : 0
    if (line <= 0) continue
    const key = buildContentOnlyKey(item)
    const lines = byContent.get(key)
    if (lines) lines.push(line)
    else byContent.set(key, [line])
  }

  const diffVotes = new Map<number, number>()
  for (const lines of byContent.values()) {
    const sorted = Array.from(new Set(lines)).sort((a, b) => a - b)
    if (sorted.length < 2) continue
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const diff = sorted[j] - sorted[i]
        if (diff < 8 || diff > 200) continue
        diffVotes.set(diff, (diffVotes.get(diff) || 0) + 1)
      }
    }
  }

  let bestDiff = 0
  let bestVotes = 0
  for (const [diff, votes] of diffVotes.entries()) {
    if (votes > bestVotes) {
      bestDiff = diff
      bestVotes = votes
    }
  }
  const voteThreshold = Math.max(5, Math.floor(items.length * 0.18))
  if (bestDiff <= 0 || bestVotes < voteThreshold) {
    return items
  }

  const lineSetByContent = new Map<string, Set<number>>()
  for (const item of items) {
    const line = Number.isFinite(item.line_number) ? item.line_number : 0
    if (line <= 0) continue
    const key = buildContentOnlyKey(item)
    const set = lineSetByContent.get(key) || new Set<number>()
    set.add(line)
    lineSetByContent.set(key, set)
  }

  const indexed = items.map((item, idx) => ({ item, idx }))
  indexed.sort((a, b) => a.item.line_number - b.item.line_number)

  const removeIndices = new Set<number>()
  for (const entry of indexed) {
    const line = Number.isFinite(entry.item.line_number) ? entry.item.line_number : 0
    if (line <= bestDiff) continue
    const key = buildContentOnlyKey(entry.item)
    const lines = lineSetByContent.get(key)
    if (!lines) continue
    if (lines.has(line - bestDiff)) {
      removeIndices.add(entry.idx)
    }
  }

  if (removeIndices.size < 3) return items
  return items.filter((_, idx) => !removeIndices.has(idx))
}

function renumberItemsInDisplayOrder(items: ParsedItem[]): ParsedItem[] {
  return items.map((item, idx) => ({
    ...item,
    line_number: idx + 1,
  }))
}

function mergeParsedItems(base: ParsedItem[], incoming: ParsedItem[]): ParsedItem[] {
  const byKey = new Map<string, ParsedItem>()

  const put = (item: ParsedItem) => {
    if (!item) return
    const key = buildItemMergeKey(item)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, item)
      return
    }
    byKey.set(key, chooseBetterParsedItem(existing, item))
  }

  for (const item of base) put(item)
  for (const item of incoming) put(item)

  return [...Array.from(byKey.values())].sort((a, b) => {
    if (a.line_number !== b.line_number) return a.line_number - b.line_number
    return (a.item_name || '').localeCompare(b.item_name || '')
  })
}

function buildItemMergeKey(item: ParsedItem): string {
  const safe = (v: unknown) => String(v ?? '').trim().toUpperCase()
  return [
    item.line_number || 0,
    safe(item.item_name),
    safe(item.specification),
    item.quantity ?? '',
    item.unit_price ?? '',
    item.amount ?? 0,
    item.tax_amount ?? '',
    safe(item.po_number),
  ].join('|')
}

function buildContentOnlyKey(item: ParsedItem): string {
  const safe = (v: unknown) => String(v ?? '').trim().toUpperCase()
  return [
    safe(item.item_name),
    safe(item.specification),
    item.quantity ?? '',
    item.unit_price ?? '',
    item.amount ?? 0,
    item.tax_amount ?? '',
    safe(item.po_number),
    safe(item.remark),
  ].join('|')
}

function parsePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(String(value).replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function chooseBetterParsedItem(a: ParsedItem, b: ParsedItem): ParsedItem {
  return scoreParsedItem(b) >= scoreParsedItem(a) ? b : a
}

function scoreParsedItem(item: ParsedItem): number {
  const confidenceScore = item.confidence === 'high' ? 3 : item.confidence === 'med' ? 2 : 1
  let score = confidenceScore
  if (item.item_name) score += 3
  if (item.specification) score += 1
  if (item.quantity !== null && item.quantity !== undefined) score += 1
  if (item.unit_price !== null && item.unit_price !== undefined) score += 1
  if ((item.amount || 0) !== 0) score += 1
  if (item.tax_amount !== null && item.tax_amount !== undefined) score += 1
  if (item.po_number) score += 2
  if (item.remark) score += 0.5
  return score
}

function getMaxLineNumber(items: ParsedItem[]): number {
  let maxLine = 0
  for (const item of items) {
    if (!Number.isFinite(item.line_number)) continue
    if (item.line_number > maxLine) {
      maxLine = item.line_number
    }
  }
  return maxLine
}

function normalizeParseResult(raw: any, rawText: string): ParseResult {
  const rawItems: any[] = Array.isArray(raw?.items) ? raw.items : []
  const items = rawItems
    .map((item, idx) => normalizeParsedItem(item, idx + 1))
    .filter((item) => {
      const hasMain = item.item_name || item.specification || item.quantity !== null || item.amount !== 0 || item.po_number || item.remark
      return Boolean(hasMain)
    })

  const sumAmount = items.reduce((acc, item) => acc + (item.amount || 0), 0)
  const sumTax = items.reduce((acc, item) => acc + (item.tax_amount || 0), 0)

  const totalAmount = parseNullableAmount(raw?.total_amount) ?? (sumAmount > 0 ? sumAmount : undefined)
  const taxAmount = parseNullableAmount(raw?.tax_amount) ?? (sumTax > 0 ? sumTax : undefined)
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
    raw_text: sanitizeForJsonb(rawText.slice(0, 12000)),
    file_type: 'pdf',
  }
}

function normalizeParsedItem(raw: any, fallbackLineNumber: number): ParsedItem {
  const lineNumber = parseLineNumber(raw?.line_number) || fallbackLineNumber
  const quantity = parseNullableNumber(raw?.quantity)
  const unitPrice = parseNullableAmount(raw?.unit_price)
  let amount = parseNullableAmount(raw?.amount)
  if (amount === null) {
    if (quantity !== null && unitPrice !== null) {
      amount = quantity * unitPrice
    } else {
      amount = 0
    }
  }

  const taxAmount = parseNullableAmount(raw?.tax_amount)
  const itemName = sanitizeText(raw?.item_name)
  const specification = sanitizeText(raw?.specification)
  const remark = sanitizeText(raw?.remark)

  const poRaw = sanitizeText(raw?.po_number) || extractOrderNumber(`${remark} ${itemName} ${specification}`) || ''
  const parsed = poRaw ? parseOrderNumberWithLine(poRaw) : null
  const poNumber = parsed?.base || undefined
  const poLineNumber = parsed?.lineNumber ?? undefined

  const confidenceRaw = sanitizeText(raw?.confidence).toLowerCase()
  const confidence: 'low' | 'med' | 'high' =
    confidenceRaw === 'low' || confidenceRaw === 'high' || confidenceRaw === 'med'
      ? confidenceRaw
      : 'med'

  return {
    line_number: lineNumber,
    item_name: itemName || '',
    specification: specification || undefined,
    quantity,
    unit_price: unitPrice,
    amount: amount || 0,
    tax_amount: taxAmount,
    po_number: poNumber,
    po_line_number: poLineNumber,
    remark: remark || undefined,
    confidence,
  }
}

function normalizeDate(value: unknown): string | undefined {
  const text = sanitizeText(value)
  if (!text) return undefined

  const fullDate = text.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/)
  if (fullDate) {
    const [, y, m, d] = fullDate
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}$/)
  if (isoDate) return isoDate[0]

  return undefined
}

function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function parseLineNumber(value: unknown): number | null {
  const num = parseNullableNumber(value)
  if (num === null || num <= 0) return null
  return Math.floor(num)
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const normalized = String(value)
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/원/g, '')
    .trim()

  if (!normalized || normalized === '-' || normalized.toLowerCase() === 'null') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNullableAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const normalized = String(value)
    .replace(/[,\s]/g, '')
    .replace(/원/g, '')
    .trim()

  if (!normalized || normalized === '-' || normalized === '무상' || normalized === 'W') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function extractOrderNumber(text: string): string | null {
  if (!text) return null
  const normalized = text.toUpperCase().replace(/\s+/g, '')

  const exactPo = normalized.match(/F\d{8}[_-]\d{1,3}/g)
  if (exactPo?.length) return normalizeOrderNumber(exactPo[0])

  const exactSo = normalized.match(/HS\d{6}[-_]\d{1,2}/g)
  if (exactSo?.length) return normalizeOrderNumber(exactSo[0])

  return null
}

function parseOrderNumberWithLine(input: string): { base: string; lineNumber: number | null } | null {
  const normalized = input.toUpperCase().replace(/\s+/g, '')

  // F20260121_001-07 → base=F20260121_001, lineNumber=7
  const poWithLine = normalized.match(/^(F\d{8})[_-](\d{1,3})[-_](\d{1,3})$/)
  if (poWithLine) {
    return {
      base: `${poWithLine[1]}_${poWithLine[2].padStart(3, '0')}`,
      lineNumber: parseInt(poWithLine[3], 10),
    }
  }

  // F20260121_001 → base=F20260121_001, lineNumber=null
  const poOnly = normalized.match(/^(F\d{8})[_-](\d{1,3})$/)
  if (poOnly) {
    return {
      base: `${poOnly[1]}_${poOnly[2].padStart(3, '0')}`,
      lineNumber: null,
    }
  }

  // HS260109-03-01 → base=HS260109-03, lineNumber=1
  const soWithLine = normalized.match(/^(HS\d{6})[-_](\d{1,2})[-_](\d{1,3})$/)
  if (soWithLine) {
    return {
      base: `${soWithLine[1]}-${soWithLine[2].padStart(2, '0')}`,
      lineNumber: parseInt(soWithLine[3], 10),
    }
  }

  // HS260109-03 → base=HS260109-03, lineNumber=null
  const soOnly = normalized.match(/^(HS\d{6})[-_](\d{1,2})$/)
  if (soOnly) {
    return {
      base: `${soOnly[1]}-${soOnly[2].padStart(2, '0')}`,
      lineNumber: null,
    }
  }

  return null
}

function normalizeOrderNumber(input: string): string {
  return parseOrderNumberWithLine(input)?.base || ''
}

async function matchItemsToSystem(
  supabase: any,
  items: ParsedItem[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = []

  const poGroups = new Map<string, ParsedItem[]>()
  for (const item of items) {
    if (item.po_number) {
      const list = poGroups.get(item.po_number) || []
      list.push(item)
      poGroups.set(item.po_number, list)
    }
  }

  const purchaseCache = new Map<string, { purchaseId: number; vendorName: string; items: any[] } | null>()

  for (const [poNumber] of poGroups) {
    if (purchaseCache.has(poNumber)) continue
    const { data } = await supabase
      .from('purchase_requests')
      .select(`
        id,
        purchase_order_number,
        sales_order_number,
        vendor:vendors(vendor_name),
        items:purchase_request_items(id, line_number, item_name, specification, quantity)
      `)
      .or(`purchase_order_number.eq.${poNumber},sales_order_number.eq.${poNumber}`)
      .limit(1)

    const purchase = data?.[0]
    if (purchase) {
      purchaseCache.set(poNumber, {
        purchaseId: purchase.id,
        vendorName: (purchase.vendor as any)?.vendor_name || '',
        items: purchase.items || [],
      })
    } else {
      purchaseCache.set(poNumber, null)
    }
  }

  for (const item of items) {
    if (!item.po_number) continue

    const purchase = purchaseCache.get(item.po_number)
    if (!purchase) continue

    if (item.po_line_number != null) {
      const matched = purchase.items.find((i: any) => i.line_number === item.po_line_number)
      if (matched) {
        results.push({
          lineNumber: item.line_number,
          matchedPurchaseId: purchase.purchaseId,
          matchedItemId: matched.id,
          matchedVendorName: purchase.vendorName,
        })
        continue
      }
    }

    results.push({
      lineNumber: item.line_number,
      matchedPurchaseId: purchase.purchaseId,
      matchedItemId: null,
      matchedVendorName: purchase.vendorName,
    })
  }

  return results
}

async function validateAndMatchVendor(
  supabase: any,
  extractedVendorName: string
): Promise<{ matched: boolean; vendor_name?: string; vendor_id?: number; similarity: number }> {
  if (!extractedVendorName) {
    return { matched: false, similarity: 0 }
  }

  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, vendor_name, vendor_alias')
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
        similarity
      }
    }
  }

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

function normalizeVendorName(s: string): string {
  const result = s
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜|co\.?|ltd\.?|inc\.?|corp\.?/gi, "")
    .replace(/[^a-z0-9가-힣]/g, '')
  // 정규화 결과가 비어있으면 원본에서 특수문자만 제거한 값 사용
  if (!result) {
    return s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  }
  return result
}

function vendorLevenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]) + 1
  return dp[m][n]
}

function calculateVendorSimilarity(a: string, b: string): number {
  const na = normalizeVendorName(a)
  const nb = normalizeVendorName(b)

  if (na === nb) return 100
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) return 85

  const maxLen = Math.max(na.length, nb.length)
  const dist = vendorLevenshtein(na, nb)
  return Math.round(((maxLen - dist) / maxLen) * 100)
}
