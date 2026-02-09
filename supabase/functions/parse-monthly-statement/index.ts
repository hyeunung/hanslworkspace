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

interface ParsedItem {
  line_number: number;
  item_name: string;        // 모델명 (엑셀의 모델명 컬럼)
  specification?: string;   // 규격 (프레임두께 등)
  quantity: number;
  unit_price: number;
  amount: number;
  tax_amount?: number;
  po_number?: string;       // 비고에 있는 수주번호
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
  file_type: 'excel' | 'pdf' | 'image';
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
    supabaseUrl = Deno.env.get('SUPABASE_URL')!
    supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData = await req.json().catch(() => ({}))
    statementId = requestData.statementId || null
    const fileUrl: string = requestData.fileUrl || requestData.imageUrl || ''
    const fileType: string = requestData.fileType || 'excel' // 'excel' | 'pdf' | 'image'

    if (!statementId || !fileUrl) {
      throw new Error('Missing statementId or fileUrl')
    }

    console.log(`[parse-monthly-statement] Processing: ${statementId}, type: ${fileType}`)

    // 1. 파일 다운로드
    currentStage = 'download_file'
    const fileBuffer = await downloadFile(fileUrl)

    // 2. 파일 형식별 파싱
    currentStage = 'parse_file'
    let parseResult: ParseResult

    if (fileType === 'excel') {
      parseResult = parseExcelFile(fileBuffer)
    } else if (fileType === 'pdf') {
      parseResult = await parsePdfFile(fileBuffer)
    } else {
      // 이미지인 경우 - 기본 정보만 반환 (OCR은 별도)
      parseResult = {
        items: [],
        file_type: 'image'
      }
    }

    console.log(`[parse-monthly-statement] Parsed ${parseResult.items.length} items`)

    // 3. 모델명으로 시스템 매칭 (specification ILIKE 검색)
    currentStage = 'match_items'
    const matchedItems = await matchItemsToSystem(supabase, parseResult.items)

    // 4. 거래처 매칭
    currentStage = 'match_vendor'
    let validatedVendorName: string | null = null
    let validatedVendorId: number | null = null

    if (parseResult.vendor_name) {
      const vendorResult = await validateAndMatchVendor(supabase, parseResult.vendor_name)
      if (vendorResult.matched) {
        validatedVendorName = vendorResult.vendor_name!
        validatedVendorId = vendorResult.vendor_id!
      }
    }

    // 발주번호에서 거래처 추론
    if (!validatedVendorName && matchedItems.length > 0) {
      const firstMatch = matchedItems.find(m => m.matchedVendorName)
      if (firstMatch?.matchedVendorName) {
        validatedVendorName = firstMatch.matchedVendorName
      }
    }

    // 5. 기존 실입고일 보존
    const { data: existingStatement } = await supabase
      .from('transaction_statements')
      .select('extracted_data')
      .eq('id', statementId)
      .single()

    const preservedActualReceivedDate = (existingStatement?.extracted_data as any)?.actual_received_date

    // 6. DB 업데이트
    currentStage = 'db_update'
    const { error: updateError } = await supabase
      .from('transaction_statements')
      .update({
        status: 'extracted',
        processing_finished_at: new Date().toISOString(),
        locked_by: null,
        statement_date: parseResult.statement_date || null,
        vendor_name: validatedVendorName || parseResult.vendor_name || null,
        total_amount: parseResult.total_amount || null,
        tax_amount: parseResult.tax_amount || null,
        grand_total: parseResult.grand_total || null,
        extracted_data: {
          ...parseResult,
          ...(preservedActualReceivedDate ? { actual_received_date: preservedActualReceivedDate } : {}),
          items: parseResult.items,
          file_type: parseResult.file_type
        }
      })
      .eq('id', statementId)

    if (updateError) {
      console.error('Failed to update transaction_statements:', updateError)
      throw new Error(`DB 업데이트 실패: ${updateError.message}`)
    }

    // 7. 품목 저장
    currentStage = 'db_insert_items'
    if (parseResult.items.length > 0) {
      const itemsToInsert = parseResult.items.map((item, idx) => {
        const matched = matchedItems.find(m => m.lineNumber === item.line_number)

        return {
          statement_id: statementId,
          line_number: item.line_number || idx + 1,
          extracted_item_name: item.item_name,
          extracted_specification: item.specification || null,
          extracted_quantity: item.quantity,
          extracted_unit_price: item.unit_price,
          extracted_amount: item.amount,
          extracted_tax_amount: item.tax_amount || null,
          extracted_po_number: item.po_number || null,
          extracted_remark: item.remark || null,
          match_confidence: item.confidence,
          matched_purchase_id: matched?.matchedPurchaseId || null,
          matched_item_id: matched?.matchedItemId || null,
          match_method: matched ? 'item_similarity' : null
        }
      })

      const { error: itemsError } = await supabase
        .from('transaction_statement_items')
        .insert(itemsToInsert)

      if (itemsError) {
        console.error('Failed to insert items:', itemsError)
      }
    }

    // 8. 다음 큐 처리
    triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)

    return new Response(
      JSON.stringify({
        success: true,
        statementId,
        status: 'extracted',
        vendor_name: validatedVendorName || parseResult.vendor_name || null,
        itemCount: parseResult.items.length,
        matchedCount: matchedItems.length,
        result: parseResult
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    const errorMessage = `[stage:${currentStage}] ${error?.message || 'Unknown error'}`
    console.error('Error processing monthly statement:', error)

    try {
      if (statementId) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        await supabase
          .from('transaction_statements')
          .update({
            status: 'failed',
            extraction_error: errorMessage,
            processing_finished_at: new Date().toISOString(),
            locked_by: null
          })
          .eq('id', statementId)
      }
    } catch (e) {
      console.error('Failed to update error status:', e)
    }

    triggerNextQueuedProcessing(supabaseUrl, supabaseServiceKey)

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========== 파일 다운로드 ==========

async function downloadFile(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`)
  return await response.arrayBuffer()
}

// ========== 엑셀 파싱 ==========

function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  // 헤더 행 찾기 (번호, 모델명, 발주일 등이 있는 행)
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    const rowText = row.map((c: any) => String(c).toLowerCase()).join(' ')
    if (
      (rowText.includes('번호') && (rowText.includes('모델') || rowText.includes('품목') || rowText.includes('품명'))) ||
      (rowText.includes('no') && (rowText.includes('model') || rowText.includes('item') || rowText.includes('description')))
    ) {
      headerRowIdx = i
      break
    }
  }

  if (headerRowIdx === -1) {
    // 헤더를 못 찾으면 5번째 행(인덱스 4)을 헤더로 추정
    headerRowIdx = 4
  }

  // 헤더에서 컬럼 매핑
  const header = rows[headerRowIdx] || []
  const colMap = detectColumns(header)

  console.log(`[parseExcel] Header at row ${headerRowIdx}:`, header.slice(0, 10))
  console.log(`[parseExcel] Column mapping:`, colMap)

  // 제목에서 날짜/거래처 추출 시도
  let statementDate: string | undefined
  let vendorName: string | undefined
  let grandTotal: number | undefined

  // 첫 몇 행에서 제목 정보 추출
  for (let i = 0; i < headerRowIdx; i++) {
    const rowText = rows[i].map((c: any) => String(c)).join(' ')

    // 날짜 추출 (2026년 01월 등)
    const dateMatch = rowText.match(/(\d{4})년?\s*(\d{1,2})월/)
    if (dateMatch) {
      statementDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-01`
    }
  }

  // 데이터 행 파싱
  const items: ParsedItem[] = []
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    // 번호 컬럼 확인
    const lineNum = colMap.lineNumber >= 0 ? row[colMap.lineNumber] : ''
    const modelName = colMap.modelName >= 0 ? String(row[colMap.modelName] || '').trim() : ''
    const amount = colMap.amount >= 0 ? row[colMap.amount] : 0
    const poNumber = colMap.poNumber >= 0 ? String(row[colMap.poNumber] || '').trim() : ''
    const spec = colMap.specification >= 0 ? String(row[colMap.specification] || '').trim() : ''
    const remark = colMap.remark >= 0 ? String(row[colMap.remark] || '').trim() : ''

    // 빈 행이거나 소계/총계 행이면 스킵
    if (!modelName) continue
    const modelLower = modelName.toLowerCase()
    if (modelLower.includes('소계') || modelLower.includes('총계') || modelLower.includes('합계')) {
      // 총계 금액 추출
      const totalAmount = parseAmount(amount)
      if (totalAmount > 0) grandTotal = totalAmount
      continue
    }
    if (modelLower.includes('기  타') || modelLower.includes('기타(jig)')) continue

    // 번호가 숫자인지 확인 (데이터 행인지)
    const num = Number(lineNum)
    if (Number.isNaN(num) || num <= 0) continue

    const parsedAmount = parseAmount(amount)

    items.push({
      line_number: num,
      item_name: modelName,
      specification: spec || undefined,
      quantity: 1, // 월말결제 엑셀은 보통 수량 1
      unit_price: parsedAmount,
      amount: parsedAmount,
      po_number: poNumber || undefined,
      remark: remark || undefined,
      confidence: 'high' // 파싱은 정확도가 높음
    })
  }

  // 총계가 없으면 합산
  if (!grandTotal && items.length > 0) {
    grandTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0)
  }

  return {
    statement_date: statementDate,
    vendor_name: vendorName,
    total_amount: grandTotal,
    grand_total: grandTotal,
    items,
    file_type: 'excel'
  }
}

function detectColumns(header: any[]): {
  lineNumber: number;
  modelName: number;
  amount: number;
  poNumber: number;
  specification: number;
  remark: number;
} {
  const result = {
    lineNumber: -1,
    modelName: -1,
    amount: -1,
    poNumber: -1,
    specification: -1,
    remark: -1
  }

  for (let i = 0; i < header.length; i++) {
    const col = String(header[i]).toLowerCase().replace(/\s+/g, '')
    
    if (col.includes('번호') || col === 'no' || col === 'no.') {
      if (result.lineNumber === -1) result.lineNumber = i
    }
    if (col.includes('모델') || col.includes('품목') || col.includes('품명') || col.includes('내역') || col.includes('description')) {
      result.modelName = i
    }
    if (col.includes('금액') || col.includes('amount') || col.includes('금 액')) {
      result.amount = i
    }
    if (col.includes('비고') || col.includes('remark') || col.includes('note')) {
      result.poNumber = i // 비고에 수주번호가 들어가 있음
    }
    if (col.includes('규격') || col.includes('프레임') || col.includes('size') || col.includes('spec') || col.includes('두께')) {
      result.specification = i
    }
  }

  // 기본값 (샘플 기준: 번호=0, 모델명=1, 금액=6, 비고=7)
  if (result.lineNumber === -1) result.lineNumber = 0
  if (result.modelName === -1) result.modelName = 1
  if (result.amount === -1) result.amount = 6
  if (result.poNumber === -1) result.poNumber = 7

  return result
}

function parseAmount(value: any): number {
  if (typeof value === 'number') return value
  const str = String(value).replace(/[,\s]/g, '').replace(/원/g, '')
  if (str === '무상' || str === '-' || str === '') return 0
  const num = Number(str)
  return Number.isNaN(num) ? 0 : num
}

// ========== PDF 파싱 ==========

async function parsePdfFile(buffer: ArrayBuffer): Promise<ParseResult> {
  // PDF는 텍스트 추출 후 구조화
  // Deno에서 사용 가능한 간단한 방법: 텍스트 레이어 추출
  // 복잡한 PDF는 이미지로 변환 후 OCR이 필요할 수 있음
  
  console.log('[parsePdf] PDF parsing - extracting text...')
  
  // PDF 바이너리에서 텍스트 추출 시도 (간단한 방식)
  const text = extractTextFromPdfBuffer(buffer)
  
  if (!text || text.length < 50) {
    console.log('[parsePdf] PDF text extraction failed or too short, returning empty')
    return {
      items: [],
      file_type: 'pdf'
    }
  }

  // 텍스트에서 구조 추출
  const lines = text.split('\n').filter(l => l.trim())
  const items: ParsedItem[] = []
  let lineNumber = 0

  for (const line of lines) {
    // 번호로 시작하는 행 찾기
    const match = line.match(/^\s*(\d+)\s+(.+)/)
    if (match) {
      lineNumber++
      const content = match[2].trim()
      
      // 금액 패턴 찾기
      const amountMatch = content.match(/([\d,]+)\s*$/)
      const amount = amountMatch ? parseAmount(amountMatch[1]) : 0
      const itemName = amountMatch 
        ? content.substring(0, content.length - amountMatch[0].length).trim()
        : content

      if (itemName) {
        items.push({
          line_number: lineNumber,
          item_name: itemName,
          quantity: 1,
          unit_price: amount,
          amount: amount,
          confidence: 'med'
        })
      }
    }
  }

  return {
    items,
    file_type: 'pdf'
  }
}

function extractTextFromPdfBuffer(buffer: ArrayBuffer): string {
  // 간단한 PDF 텍스트 추출 (텍스트 스트림에서 추출)
  const bytes = new Uint8Array(buffer)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  
  // PDF 텍스트 오브젝트에서 문자열 추출
  const textParts: string[] = []
  const regex = /\(([^)]*)\)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match[1].length > 1 && !match[1].includes('\\')) {
      textParts.push(match[1])
    }
  }
  
  // BT...ET 블록에서 Tj/TJ 오퍼레이터의 텍스트 추출
  const tjRegex = /\[([^\]]*)\]\s*TJ/g
  while ((match = tjRegex.exec(text)) !== null) {
    const parts = match[1].match(/\(([^)]*)\)/g)
    if (parts) {
      textParts.push(parts.map(p => p.slice(1, -1)).join(''))
    }
  }

  return textParts.join('\n')
}

// ========== 시스템 매칭 ==========

interface MatchResult {
  lineNumber: number;
  matchedPurchaseId: number | null;
  matchedItemId: number | null;
  matchedVendorName: string | null;
}

async function matchItemsToSystem(
  supabase: any,
  items: ParsedItem[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = []

  for (const item of items) {
    // 모델명에서 (TOP), (BOT), [SUS301-고밀도] 등 제거
    const cleanName = item.item_name
      .replace(/\s*\(TOP\/BOT\)\s*/gi, '')
      .replace(/\s*\(TOP\)\s*/gi, '')
      .replace(/\s*\(BOT\)\s*/gi, '')
      .replace(/\s*\[.*?\]\s*/g, '')
      .trim()

    if (!cleanName) continue

    // specification에서 ILIKE 검색
    const { data: specMatches } = await supabase
      .from('purchase_request_items')
      .select('id, item_name, specification, unit_price_value, amount_value, purchase_request_id, vendor_name')
      .ilike('specification', `%${cleanName}%`)
      .limit(10)

    // item_name에서도 검색
    const { data: nameMatches } = await supabase
      .from('purchase_request_items')
      .select('id, item_name, specification, unit_price_value, amount_value, purchase_request_id, vendor_name')
      .ilike('item_name', `%${cleanName}%`)
      .limit(10)

    const allMatches = [...(specMatches || []), ...(nameMatches || [])]
    const unique = [...new Map(allMatches.map(r => [r.id, r])).values()]

    if (unique.length > 0) {
      // item_name이 METAL MASK인 것 우선 (월말결제 업체 특성)
      const metalMaskMatch = unique.find(m => 
        m.item_name?.toUpperCase().includes('METAL MASK') || 
        m.item_name?.toUpperCase().includes('METALMASK')
      )
      const bestMatch = metalMaskMatch || unique[0]

      results.push({
        lineNumber: item.line_number,
        matchedPurchaseId: bestMatch.purchase_request_id,
        matchedItemId: bestMatch.id,
        matchedVendorName: bestMatch.vendor_name || null
      })
    }
  }

  return results
}

// ========== 거래처 매칭 ==========

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
  if (na.includes(nb) || nb.includes(na)) return 85

  // 간단한 문자 일치율
  const longer = na.length > nb.length ? na : nb
  const shorter = na.length > nb.length ? nb : na
  if (longer.length === 0) return 0

  let matches = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++
  }

  return Math.round((matches / longer.length) * 100)
}

// ========== 큐 처리 ==========

function triggerNextQueuedProcessing(supabaseUrl: string, supabaseServiceKey: string) {
  const functionUrl = `${supabaseUrl}/functions/v1/parse-monthly-statement`
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
