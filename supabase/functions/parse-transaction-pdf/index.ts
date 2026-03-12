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
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    if (!openaiApiKey) {
      throw new Error('Missing OPENAI_API_KEY')
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

    currentStage = 'extract_pdf_text'
    const rawExtractedText = extractTextFromPdfBuffer(fileBuffer)
    if (!rawExtractedText || rawExtractedText.length < 30) {
      throw new Error('PDF 텍스트 추출 결과가 비어있습니다')
    }
    const extractedText = removeSupplierCopySections(rawExtractedText)

    currentStage = 'gpt_structuring'
    const parseResult = await extractWithGPT4o(extractedText, openaiApiKey, poScope)

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
      raw_text: extractedText.slice(0, 12000),
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

function extractTextFromPdfBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binaryText = new TextDecoder('latin1').decode(bytes)
  const lines: string[] = []

  const btEtRegex = /BT[\s\S]*?ET/g
  const blocks = binaryText.match(btEtRegex) || []

  for (const block of blocks) {
    const literalTokens = block.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) || []
    for (const token of literalTokens) {
      const literal = token.replace(/\s*Tj$/, '')
      const decoded = decodePdfLiteralString(literal)
      if (decoded) lines.push(decoded)
    }

    const arrayTokens = block.match(/\[(?:[\s\S]*?)\]\s*TJ/g) || []
    for (const token of arrayTokens) {
      const arrayLiteral = token.replace(/\]\s*TJ$/, ']')
      const parts = arrayLiteral.match(/\((?:\\.|[^\\)])*\)/g) || []
      const decodedParts = parts
        .map((part) => decodePdfLiteralString(part))
        .filter(Boolean)
      if (decodedParts.length) {
        lines.push(decodedParts.join(''))
      }
    }

    const hexTokens = block.match(/<([0-9A-Fa-f\s]+)>\s*Tj/g) || []
    for (const token of hexTokens) {
      const hexBody = token.replace(/\s*Tj$/, '').replace(/[<>]/g, '').replace(/\s+/g, '')
      const decoded = decodePdfHexString(hexBody)
      if (decoded) lines.push(decoded)
    }
  }

  if (!lines.length) {
    const fallbackMatches = binaryText.match(/\((?:\\.|[^\\)])*\)/g) || []
    for (const match of fallbackMatches) {
      const decoded = decodePdfLiteralString(match)
      if (decoded) lines.push(decoded)
    }
  }

  const normalized = lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .join('\n')

  return normalized.trim()
}

function removeSupplierCopySections(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let skip = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/거래명세서\s*\(\s*공급자\s*\)/.test(trimmed) || /거래명세서\s*\(\s*공급\s*하는\s*자\s*\)/.test(trimmed)) {
      skip = true
      continue
    }
    if (skip && (/거래명세서\s*\(\s*공급받는\s*자?\s*\)/.test(trimmed) || /^--\s*\d+\s+of\s+\d+\s*--$/.test(trimmed))) {
      skip = false
    }
    if (!skip) {
      result.push(line)
    }
  }

  return result.join('\n')
}

function decodePdfLiteralString(literal: string): string {
  let content = literal
  if (content.startsWith('(') && content.endsWith(')')) {
    content = content.slice(1, -1)
  }

  content = content
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\r/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\b/g, ' ')
    .replace(/\\f/g, ' ')
    .replace(/\\\d{3}/g, '')

  return content.trim()
}

function decodePdfHexString(hexText: string): string {
  if (!hexText) return ''
  let cleaned = hexText
  if (cleaned.length % 2 !== 0) cleaned += '0'
  const bytes: number[] = []
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = Number.parseInt(cleaned.slice(i, i + 2), 16)
    if (Number.isFinite(byte)) bytes.push(byte)
  }
  if (!bytes.length) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).trim()
}

async function extractWithGPT4o(
  pdfText: string,
  apiKey: string,
  poScope: 'single' | 'multi' | null
): Promise<ParseResult> {
  const scopeHint = poScope === 'single'
    ? '이 거래명세서는 단일 발주/수주 건입니다. 번호가 없더라도 동일 건으로 취급하세요.'
    : poScope === 'multi'
      ? '이 거래명세서는 다중 발주/수주 건입니다. 품목별 번호를 분리해 추출하세요.'
      : ''

  const prompt = `다음은 거래명세서 PDF에서 추출한 텍스트입니다.
아래 규칙에 따라 JSON으로만 구조화하세요.

${scopeHint ? `발주/수주 범위 힌트: ${scopeHint}` : ''}

거래처(공급자) 식별 규칙:
- "귀중", "귀사" 옆 회사는 받는 회사이므로 vendor_name이 아닙니다.
- "공급자", "공급하는 자", "(인)", 도장/직인 쪽 회사가 vendor_name 입니다.

추출 대상:
1) statement_date (YYYY-MM-DD)
2) vendor_name (공급자 회사명)
3) vendor_name_english (영문 추정, 없으면 생략)
4) total_amount, tax_amount, grand_total (숫자만)
5) items 배열

items 각 항목:
- line_number: 순번
- item_name: 품목명/품명 (비어있으면 "")
- specification: 규격 (없으면 "")
- quantity: 수량 (비어있으면 null)
- unit_price: 단가 (비어있으면 null)
- amount: 금액 (비어있거나 "-"면 0)
- tax_amount: 세액 (없으면 null)
- po_number: 발주/수주번호 (없으면 "")
- remark: 비고
- confidence: low|med|high

헤더 인식 규칙:
- 품목명: 품명/품목/내역/DESCRIPTION/상품명
- 규격: 규격/SIZE/사이즈/치수/SPEC
- 수량: 수량/QTY/Q'TY/QUANTITY
- 단가: 단가/UNIT PRICE/가격
- 금액: 금액/AMOUNT/공급가액/합계

수량 규칙:
- 수량은 수량 칼럼 값만 사용
- 수량이 비어있으면 null
- 이전 행 수량을 복사하지 말 것

단가 규칙:
- 단가가 비어있으면 null
- 금액 값을 단가로 옮기지 말 것

발주/수주번호 규칙:
- 발주번호: F + YYYYMMDD + _ + 숫자 (예: F20251010_001)
- 수주번호: HS + YYMMDD + - + 숫자 (예: HS251201-01)
- 패턴에 맞는 번호를 최대한 추출

행 생략 금지 규칙:
- 품목명이 비어 있어도 규격/수량/단가/금액 중 하나라도 있으면 별도 item으로 포함
- 여러 행을 임의로 합치거나 생략하지 말 것
- 합계/소계/서명/입금 등의 푸터 행은 제외

중복 제거 규칙:
- 거래명세서에 공급받는자/공급자 사본이 중복으로 포함될 수 있음
- 동일한 품목이 반복되면 한 번만 포함할 것
- "거래명세서(공급자)" 섹션의 데이터는 무시할 것

JSON 응답 형식:
{
  "statement_date": "YYYY-MM-DD 또는 null",
  "vendor_name": "공급자명 또는 null",
  "vendor_name_english": "영문명 또는 null",
  "total_amount": 숫자 또는 null,
  "tax_amount": 숫자 또는 null,
  "grand_total": 숫자 또는 null,
  "items": [
    {
      "line_number": 1,
      "item_name": "",
      "specification": "",
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "tax_amount": null,
      "po_number": "",
      "remark": "",
      "confidence": "med"
    }
  ]
}

PDF 텍스트:
---
${pdfText.slice(0, 28000)}
---
`

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
          content: 'You extract structured transaction statement data from plain text. Always return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 8000,
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

  const parsed = JSON.parse(content)
  return normalizeParseResult(parsed, pdfText)
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
    raw_text: rawText.slice(0, 12000),
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
