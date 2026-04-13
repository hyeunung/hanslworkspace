// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4'
// @ts-ignore - Deno runtime imports
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

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
  file_type: 'excel';
}

interface StatementMetadata {
  statement_date?: string;
  vendor_name?: string;
  total_amount?: number;
  tax_amount?: number;
  grand_total?: number;
}

interface ColumnMap {
  lineNumber: number;
  itemName: number;
  specification: number;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxAmount: number;
  poNumber: number;
  remark: number;
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

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: ParseRequest = await req.json().catch(() => ({}))

    statementId = requestData.statementId || null
    const fileUrl = requestData.fileUrl || requestData.imageUrl || ''
    const mode: ParseMode = requestData.mode || 'process_specific'

    if (mode !== 'process_specific') {
      throw new Error('Unsupported mode. parse-transaction-excel only supports process_specific')
    }
    if (!statementId || !fileUrl) {
      throw new Error('Missing statementId or fileUrl')
    }

    currentStage = 'read_existing'
    const { data: existingStatement } = await supabase
      .from('transaction_statements')
      .select('extracted_data')
      .eq('id', statementId)
      .single()

    const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date || null

    currentStage = 'reset_statement'
    await resetStatementForProcessing(
      supabase,
      statementId,
      preservedActualReceivedDate
    )

    currentStage = 'download_file'
    const fileBuffer = await downloadFile(fileUrl)

    currentStage = 'parse_excel'
    const parseResult = parseExcelFile(fileBuffer)

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
      file_type: 'excel',
      parser: 'parse-transaction-excel',
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
    ? { actual_received_date: preservedActualReceivedDate, file_type: 'excel' }
    : { file_type: 'excel' }

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

function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { items: [], file_type: 'excel' }
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
  if (!rows.length) {
    return { items: [], file_type: 'excel' }
  }

  const headerRowIndex = findHeaderRowIndex(rows)
  const columnMap = detectColumns(rows[headerRowIndex] || [])
  const inferredPoColumn = inferPoColumnFromData(rows, headerRowIndex, columnMap)
  if (inferredPoColumn >= 0) {
    columnMap.poNumber = inferredPoColumn
  }
  const metadata = extractStatementMetadata(rows, headerRowIndex)
  const rawItems = extractItems(rows, headerRowIndex, columnMap)
  const items = rawItems.filter((item) => {
    const hasIdentity = Boolean(item.item_name || item.specification)
    const hasQty = item.quantity !== null && item.quantity !== undefined
    const hasUnit = item.unit_price !== null && item.unit_price !== undefined
    return hasIdentity || hasQty || hasUnit
  })

  const summedAmount = items.reduce((acc, item) => acc + (item.amount || 0), 0)
  const summedTax = items.reduce((acc, item) => acc + (item.tax_amount || 0), 0)

  let totalAmount = metadata.total_amount ?? summedAmount
  let taxAmount = metadata.tax_amount ?? (summedTax > 0 ? summedTax : undefined)
  if (taxAmount !== undefined && totalAmount !== undefined && summedTax === 0 && taxAmount === totalAmount) {
    taxAmount = undefined
  }
  let grandTotal = metadata.grand_total ?? (
    totalAmount + (taxAmount || 0)
  )
  if (taxAmount === undefined && totalAmount !== undefined && grandTotal > totalAmount * 1.5) {
    grandTotal = totalAmount
  }

  return {
    statement_date: metadata.statement_date,
    vendor_name: metadata.vendor_name,
    total_amount: totalAmount || undefined,
    tax_amount: taxAmount,
    grand_total: grandTotal || undefined,
    items,
    file_type: 'excel',
  }
}

function findHeaderRowIndex(rows: any[][]): number {
  const searchLimit = Math.min(rows.length, 40)
  let fallback = -1

  for (let i = 0; i < searchLimit; i++) {
    const row = rows[i] || []
    const tokens = row.map((cell) => normalizeHeaderToken(String(cell || '')))

    const hasItem = tokens.some((token) => hasKeyword(token, [
      '품명', '품목', '내역', 'description', 'item', '상품명', '모델명'
    ]))
    const hasQty = tokens.some((token) => hasKeyword(token, [
      '납품수량', '수량', 'qty', 'quantity', "q'ty", '수'
    ]))
    const hasAmount = tokens.some((token) => hasKeyword(token, [
      '금액', 'amount', '공급가액', '합계'
    ]))
    const hasPrice = tokens.some((token) => hasKeyword(token, [
      '단가', 'unitprice', 'price'
    ]))

    if (hasItem && (hasQty || hasAmount || hasPrice)) {
      return i
    }
    if (fallback < 0 && hasItem) {
      fallback = i
    }
  }

  return fallback >= 0 ? fallback : 0
}

function detectColumns(header: any[]): ColumnMap {
  const colMap: ColumnMap = {
    lineNumber: -1,
    itemName: -1,
    specification: -1,
    quantity: -1,
    unitPrice: -1,
    amount: -1,
    taxAmount: -1,
    poNumber: -1,
    remark: -1,
  }

  for (let i = 0; i < header.length; i++) {
    const token = normalizeHeaderToken(String(header[i] || ''))

    if (colMap.lineNumber < 0 && hasKeyword(token, ['번호', '순번', 'no'])) colMap.lineNumber = i
    if (colMap.itemName < 0 && hasKeyword(token, ['품명', '품목', '내역', 'description', 'item', '상품명', '모델명'])) colMap.itemName = i
    if (colMap.specification < 0 && hasKeyword(token, ['규격', 'size', 'spec', '사이즈', '치수'])) colMap.specification = i
    if (colMap.quantity < 0 && hasKeyword(token, ['납품수량', '수량', 'qty', 'quantity', "q'ty", '수'])) colMap.quantity = i
    if (colMap.unitPrice < 0 && hasKeyword(token, ['단가', 'unitprice', 'price'])) colMap.unitPrice = i
    if (colMap.amount < 0 && hasKeyword(token, ['금액', 'amount', '공급가액', '합계'])) colMap.amount = i
    if (colMap.taxAmount < 0 && hasKeyword(token, ['세액', 'vat', 'tax'])) colMap.taxAmount = i
    if (colMap.poNumber < 0 && hasKeyword(token, ['발주', '수주', 'po', 'so'])) colMap.poNumber = i
    if (colMap.remark < 0 && hasKeyword(token, ['비고', 'remark', 'note'])) colMap.remark = i
  }

  if (colMap.lineNumber < 0) colMap.lineNumber = 0
  if (colMap.itemName < 0) colMap.itemName = 1
  if (colMap.specification < 0) colMap.specification = 2
  if (colMap.quantity < 0) colMap.quantity = 3
  if (colMap.unitPrice < 0) colMap.unitPrice = 4
  if (colMap.amount < 0) colMap.amount = 5
  if (colMap.remark < 0) colMap.remark = Math.max(colMap.amount + 1, 6)
  if (colMap.poNumber < 0) colMap.poNumber = colMap.remark

  return colMap
}

function inferPoColumnFromData(rows: any[][], headerRowIndex: number, colMap: ColumnMap): number {
  const scoreByCol = new Map<number, number>()
  const scanEnd = Math.min(rows.length, headerRowIndex + 160)

  for (let rowIndex = headerRowIndex + 1; rowIndex < scanEnd; rowIndex++) {
    const row = rows[rowIndex] || []
    if (!row.length) continue

    const lineCandidate = parseLineNumber(getCellByIndex(row, colMap.lineNumber))
    if (!lineCandidate) continue

    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (colIndex === colMap.lineNumber || colIndex === colMap.itemName) continue
      const token = extractOrderNumber(String(getCellByIndex(row, colIndex) || ''))
      if (!token) continue
      scoreByCol.set(colIndex, (scoreByCol.get(colIndex) || 0) + 1)
    }
  }

  const ranked = Array.from(scoreByCol.entries()).sort((a, b) => b[1] - a[1])
  if (!ranked.length) return colMap.poNumber

  const [bestCol, bestScore] = ranked[0]
  const currentScore = scoreByCol.get(colMap.poNumber) || 0
  if (currentScore >= bestScore && currentScore > 0) return colMap.poNumber
  if (bestScore >= 2) return bestCol
  return colMap.poNumber
}

function extractStatementMetadata(rows: any[][], headerRowIndex: number): StatementMetadata {
  let statementDate: string | undefined
  let vendorName: string | undefined
  let totalAmount: number | undefined
  let taxAmount: number | undefined
  let grandTotal: number | undefined

  const scanLimit = Math.min(rows.length, Math.max(headerRowIndex + 40, 40))
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] || []
    const normalizedCells = row.map((cell) => sanitizeText(cell))
    const rowText = normalizedCells.filter(Boolean).join(' ')
    const rowLower = rowText.toLowerCase()

    if (!statementDate) {
      const date = extractDate(rowText)
      if (date) statementDate = date
    }

    if (!vendorName) {
      const vendor = extractVendorNameFromRow(normalizedCells)
      if (vendor) vendorName = vendor
    }

    const rowNumbers = extractNumbersFromText(rowText)
    if (!rowNumbers.length) continue
    const maxInRow = Math.max(...rowNumbers)

    if (totalAmount === undefined && (rowLower.includes('공급가액') || rowLower.includes('공급가'))) {
      totalAmount = maxInRow
    }
    if (taxAmount === undefined && (rowLower.includes('세액') || rowLower.includes('부가세') || rowLower.includes('vat'))) {
      const hasExplicitTax = !rowLower.includes('별도') || rowNumbers.length >= 2
      if (hasExplicitTax) {
        taxAmount = maxInRow
      }
    }
    if (grandTotal === undefined && (rowLower.includes('합계') || rowLower.includes('총계') || rowLower.includes('총금액'))) {
      grandTotal = maxInRow
    }
  }

  return {
    statement_date: statementDate,
    vendor_name: vendorName,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    grand_total: grandTotal,
  }
}

function extractItems(rows: any[][], headerRowIndex: number, colMap: ColumnMap): ParsedItem[] {
  const items: ParsedItem[] = []
  let fallbackLineNumber = 1

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const joinedText = row.map((cell) => sanitizeText(cell)).filter(Boolean).join(' ').toLowerCase()
    if (!joinedText) continue
    if (isFooterRow(joinedText)) continue

    const rawLine = getCellByIndex(row, colMap.lineNumber)
    const rawItemName = getCellByIndex(row, colMap.itemName)
    const rawSpec = getCellByIndex(row, colMap.specification)
    const rawQty = getCellByIndex(row, colMap.quantity)
    const rawUnit = getCellByIndex(row, colMap.unitPrice)
    const rawAmount = getCellByIndex(row, colMap.amount)
    const rawTax = getCellByIndex(row, colMap.taxAmount)
    const rawPo = getCellByIndex(row, colMap.poNumber)
    const rawRemark = getCellByIndex(row, colMap.remark)

    const itemName = sanitizeText(rawItemName)
    const specification = sanitizeText(rawSpec)
    const quantity = parseNullableNumber(rawQty)
    const unitPrice = parseNullableAmount(rawUnit)
    let amount = parseNullableAmount(rawAmount)
    const taxAmount = parseNullableAmount(rawTax)
    const remark = sanitizeText(rawRemark)
    const poCandidate = [sanitizeText(rawPo), remark, itemName, specification].filter(Boolean).join(' ')
    const poNumber = extractOrderNumber(poCandidate)

    if (!itemName && !specification && quantity === null && unitPrice === null) continue

    const hasAnyData = Boolean(
      itemName ||
      specification ||
      quantity !== null ||
      unitPrice !== null ||
      amount !== null ||
      taxAmount !== null ||
      poNumber ||
      remark
    )
    if (!hasAnyData) continue

    if (amount === null) {
      if (quantity !== null && unitPrice !== null) {
        amount = quantity * unitPrice
      } else {
        amount = 0
      }
    }

    const explicitLine = parseLineNumber(rawLine)
    const lineNumber = explicitLine || fallbackLineNumber
    fallbackLineNumber = Math.max(fallbackLineNumber + 1, lineNumber + 1)

    items.push({
      line_number: lineNumber,
      item_name: itemName || '',
      specification: specification || undefined,
      quantity,
      unit_price: unitPrice,
      amount: amount || 0,
      tax_amount: taxAmount,
      po_number: poNumber || undefined,
      remark: remark || undefined,
      confidence: 'high',
    })
  }

  if (!items.length) return []

  return items.map((item, idx) => ({
    ...item,
    line_number: item.line_number > 0 ? item.line_number : idx + 1,
    po_number: item.po_number ? normalizeOrderNumber(item.po_number) : item.po_number,
  }))
}

function isFooterRow(text: string): boolean {
  const footerKeywords = [
    '합계', '총계', '소계', '공급가액', '부가세', '세액',
    '인수자', '검수', '확인', '계좌', '은행', '사업자등록번호'
  ]
  return footerKeywords.some((keyword) => text.includes(keyword))
}

function getCellByIndex(row: any[], index: number): any {
  if (index < 0 || index >= row.length) return ''
  return row[index]
}

function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizeHeaderToken(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[()[\]{}]/g, '')
}

function hasKeyword(token: string, keywords: string[]): boolean {
  return keywords.some((keyword) => token.includes(keyword.toLowerCase().replace(/\s+/g, '')))
}

function parseLineNumber(value: unknown): number | null {
  const num = parseNullableNumber(value)
  if (num === null) return null
  if (num <= 0) return null
  return Math.floor(num)
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value
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

function extractDate(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ')
  const fullDateMatch = normalized.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/)
  if (fullDateMatch) {
    const [, y, m, d] = fullDateMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const yearMonthMatch = normalized.match(/(\d{4})[.\-/년\s]+(\d{1,2})[월]*/)
  if (yearMonthMatch) {
    const [, y, m] = yearMonthMatch
    return `${y}-${m.padStart(2, '0')}-01`
  }

  return undefined
}

function extractVendorNameFromRow(cells: string[]): string | undefined {
  for (let i = 0; i < cells.length; i++) {
    const token = (cells[i] || '').toLowerCase()
    if (!token) continue
    if (token.includes('공급자') || token.includes('공급하는자') || token.includes('상호')) {
      for (let j = i + 1; j < Math.min(cells.length, i + 4); j++) {
        const candidate = cleanVendorCandidate(cells[j] || '')
        if (candidate) return candidate
      }
    }
  }

  const rowText = cells.join(' ')
  const regex = /(?:공급자|공급하는\s*자|상호)\s*[:：]?\s*([^\s]+)/i
  const match = rowText.match(regex)
  if (match?.[1]) {
    const candidate = cleanVendorCandidate(match[1])
    if (candidate) return candidate
  }

  return undefined
}

function cleanVendorCandidate(value: string): string | undefined {
  const cleaned = sanitizeText(value)
    .replace(/^[:：]/, '')
    .replace(/\(인\)/g, '')
    .trim()

  if (!cleaned) return undefined
  if (cleaned.length < 2) return undefined
  if (/^\d+$/.test(cleaned)) return undefined
  if (cleaned.includes('사업자') || cleaned.includes('등록번호') || cleaned.includes('대표자')) return undefined
  return cleaned
}

function extractNumbersFromText(text: string): number[] {
  const matches = text.match(/\d{1,3}(?:,\d{3})+|\d+/g) || []
  return matches
    .map((token) => Number(token.replace(/,/g, '')))
    .filter((num) => Number.isFinite(num))
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

  return ''
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
  return s
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜|co\.?|ltd\.?|inc\.?|corp\.?|company|컴퍼니/gi, "")
    .replace(/\s+[가-힣]{2,4}$/g, (m) => /^[가-힣]{2,4}$/.test(m.trim()) ? "" : m)
    .replace(/[^a-z0-9가-힣]/g, '')
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
