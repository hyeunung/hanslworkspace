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
- 동일한 품목이 반복되면 한 번만 포함할 것

추출 대상:
1) statement_date (YYYY-MM-DD)
2) vendor_name (공급자 회사명)
3) vendor_name_english (영문 추정, 없으면 null)
4) total_amount, tax_amount, grand_total (숫자만)
5) items 배열 — 모든 페이지에서 연속 순번으로 통합

items 각 항목:
- line_number: 거래명세서에 표기된 원본 순번 그대로 사용 (중간에 빠진 번호가 있을 수 있음, 임의로 재부여하지 말 것)
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

  const parsed = parseStrictJson(textContent)
  return normalizeParseResult(parsed, textContent)
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

  throw new Error('Failed to parse JSON from Claude response')
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
  const poNumber = poRaw ? normalizeOrderNumber(poRaw) : undefined

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

function normalizeOrderNumber(input: string): string {
  const normalized = input.toUpperCase().replace(/\s+/g, '')

  const poMatch = normalized.match(/^(F\d{8})[_-](\d{1,3})$/)
  if (poMatch) {
    return `${poMatch[1]}_${poMatch[2].padStart(3, '0')}`
  }

  const soMatch = normalized.match(/^(HS\d{6})[-_](\d{1,2})$/)
  if (soMatch) {
    return `${soMatch[1]}-${soMatch[2].padStart(2, '0')}`
  }

  return normalized
}

async function matchItemsToSystem(
  supabase: any,
  items: ParsedItem[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = []

  for (const item of items) {
    const nameForSearch = sanitizeText(item.item_name || item.specification || '')
      .replace(/\s*\(TOP\/BOT\)\s*/gi, '')
      .replace(/\s*\(TOP\)\s*/gi, '')
      .replace(/\s*\(BOT\)\s*/gi, '')
      .replace(/\s*\[.*?\]\s*/g, '')
      .trim()

    if (!nameForSearch) continue

    const { data: specMatches } = await supabase
      .from('purchase_request_items')
      .select('id, item_name, specification, purchase_request_id, vendor_name')
      .ilike('specification', `%${nameForSearch}%`)
      .limit(10)

    const { data: nameMatches } = await supabase
      .from('purchase_request_items')
      .select('id, item_name, specification, purchase_request_id, vendor_name')
      .ilike('item_name', `%${nameForSearch}%`)
      .limit(10)

    const allMatches = [...(specMatches || []), ...(nameMatches || [])]
    const uniqueMatches = [...new Map(allMatches.map((m: any) => [m.id, m])).values()]
    if (!uniqueMatches.length) continue

    const bestMatch = uniqueMatches[0]
    results.push({
      lineNumber: item.line_number,
      matchedPurchaseId: bestMatch.purchase_request_id || null,
      matchedItemId: bestMatch.id || null,
      matchedVendorName: bestMatch.vendor_name || null,
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
    .select('id, vendor_name')
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    return { matched: false, similarity: 0 }
  }

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

function calculateVendorSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) return 100
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) return 85

  const longer = na.length >= nb.length ? na : nb
  const shorter = na.length >= nb.length ? nb : na
  let matches = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches += 1
  }
  return Math.round((matches / longer.length) * 100)
}
