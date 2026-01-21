// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

interface OCRRequest {
  statementId: string;
  imageUrl: string;
}

interface ExtractedItem {
  line_number: number;
  item_name: string;
  specification?: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_amount?: number;
  po_number?: string;
  remark?: string;
  confidence: 'low' | 'med' | 'high';
}

interface ExtractionResult {
  statement_date?: string;
  vendor_name?: string;
  vendor_name_english?: string; // 한글 회사명의 영문 표기 추정
  total_amount?: number;
  tax_amount?: number;
  grand_total?: number;
  items: ExtractedItem[];
  raw_text?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    const googleCredentials = Deno.env.get('GOOGLE_VISION_CREDENTIALS')

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: OCRRequest = await req.json()

    console.log(`Processing transaction statement: ${requestData.statementId}`)

    // 1. 상태를 processing으로 업데이트
    await supabase
      .from('transaction_statements')
      .update({ status: 'processing' })
      .eq('id', requestData.statementId)

    // 2. 이미지 다운로드
    const imageBuffer = await downloadImage(requestData.imageUrl)
    const base64Image = arrayBufferToBase64(imageBuffer)

    // 3. Google Vision OCR 호출 (선택적 - credentials가 없으면 GPT-4o만 사용)
    let visionText = ''
    if (googleCredentials) {
      try {
        visionText = await callGoogleVision(base64Image, googleCredentials)
        console.log('Vision OCR result length:', visionText.length)
      } catch (e) {
        console.warn('Google Vision failed, using GPT-4o only:', e)
      }
    }

    // 4. GPT-4o 비전으로 구조화 추출
    const extractionResult = await extractWithGPT4o(
      base64Image, 
      visionText, 
      openaiApiKey
    )

    // 5. 발주/수주번호 패턴 정규화 (OCR 텍스트도 함께 전달하여 빈 칸에 적힌 번호도 찾음)
    const normalizedItems = normalizePoNumbers(extractionResult.items, visionText)

    // 6. 거래처명 검증 - vendors 테이블에 반드시 존재해야 함
    let validatedVendorName: string | undefined = undefined
    let vendorMatchSource: 'gpt_extract' | 'text_scan' | 'not_found' = 'not_found'
    
    // 6-1. GPT가 추출한 거래처명으로 먼저 시도 (한글명)
    if (extractionResult.vendor_name) {
      const vendorResult = await validateAndMatchVendor(
        supabase, 
        extractionResult.vendor_name
      )
      
      if (vendorResult.matched) {
        console.log(`✅ 거래처 매칭 성공 (GPT 추출 한글): "${extractionResult.vendor_name}" → "${vendorResult.vendor_name}" (${vendorResult.similarity}%)`)
        validatedVendorName = vendorResult.vendor_name
        vendorMatchSource = 'gpt_extract'
      }
    }
    
    // 6-1-2. 한글명 매칭 실패 시 영문명으로 재시도
    if (!validatedVendorName && extractionResult.vendor_name_english) {
      const vendorResultEng = await validateAndMatchVendor(
        supabase, 
        extractionResult.vendor_name_english
      )
      
      if (vendorResultEng.matched) {
        console.log(`✅ 거래처 매칭 성공 (GPT 추출 영문): "${extractionResult.vendor_name_english}" → "${vendorResultEng.vendor_name}" (${vendorResultEng.similarity}%)`)
        validatedVendorName = vendorResultEng.vendor_name
        vendorMatchSource = 'gpt_extract'
      }
    }
    
    // 6-2. GPT 추출 실패 또는 거래처 못찾음 → 전체 텍스트에서 vendors 테이블 대조
    if (!validatedVendorName && visionText) {
      console.log('📝 거래처 못찾음 - 전체 OCR 텍스트에서 vendors 테이블 대조 시작...')
      const vendorFromText = await findVendorInText(supabase, visionText)
      
      if (vendorFromText.matched) {
        console.log(`✅ 거래처 매칭 성공 (텍스트 스캔): "${vendorFromText.matched_text}" → "${vendorFromText.vendor_name}" (${vendorFromText.similarity}%)`)
        validatedVendorName = vendorFromText.vendor_name
        vendorMatchSource = 'text_scan'
      }
    }
    
    // 6-3. 그래도 못찾으면 경고
    if (!validatedVendorName) {
      console.warn(`⚠️ 거래처를 찾을 수 없음 - 수동 확인 필요`)
    }

    // 8. DB에 결과 저장 (에러 체크 추가)
    const { data: updateData, error: updateError } = await supabase
      .from('transaction_statements')
      .update({
        status: 'extracted',
        statement_date: extractionResult.statement_date || null,
        vendor_name: validatedVendorName || null, // 검증된 거래처명 사용
        total_amount: extractionResult.total_amount || null,
        tax_amount: extractionResult.tax_amount || null,
        grand_total: extractionResult.grand_total || null,
        extracted_data: {
          ...extractionResult,
          items: normalizedItems,
          raw_vision_text: visionText,
          // 학습용: 원본 OCR 추출 거래처명과 검증 결과
          ocr_vendor_name: extractionResult.vendor_name, // GPT가 추출한 원본
          vendor_validated: !!validatedVendorName, // 검증 성공 여부
          vendor_match_source: vendorMatchSource, // 매칭 방법: gpt_extract, text_scan, not_found
          vendor_mismatch: !validatedVendorName // 거래처 못찾음 여부
        }
      })
      .eq('id', requestData.statementId)
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

    console.log('✅ 거래명세서 업데이트 완료:', { id: requestData.statementId, vendor_name: validatedVendorName })

    // 9. 추출된 품목들을 transaction_statement_items에 저장
    if (normalizedItems.length > 0) {
      const itemsToInsert = normalizedItems.map((item, idx) => ({
        statement_id: requestData.statementId,
        line_number: item.line_number || idx + 1,
        extracted_item_name: item.item_name,
        extracted_specification: item.specification,
        extracted_quantity: item.quantity,
        extracted_unit_price: item.unit_price,
        extracted_amount: item.amount,
        extracted_tax_amount: item.tax_amount,
        extracted_po_number: item.po_number,
        extracted_remark: item.remark,
        match_confidence: item.confidence
      }))

      const { error: itemsError } = await supabase
        .from('transaction_statement_items')
        .insert(itemsToInsert)

      if (itemsError) {
        console.error('Failed to insert items:', itemsError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        statementId: requestData.statementId,
        vendor_name: validatedVendorName || null, // 검증된 거래처명 포함
        vendor_match_source: vendorMatchSource, // 매칭 방법
        result: {
          ...extractionResult,
          vendor_name: validatedVendorName || extractionResult.vendor_name, // 검증된 거래처명 우선
          items: normalizedItems
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error processing transaction statement:', error)

    // 에러 시 상태 업데이트
    try {
      const requestData = await req.json().catch(() => ({}))
      if (requestData.statementId) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        await supabase
          .from('transaction_statements')
          .update({ 
            status: 'pending',
            extraction_error: error.message 
          })
          .eq('id', requestData.statementId)
      }
    } catch (e) {
      console.error('Failed to update error status:', e)
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`)
  return await response.arrayBuffer()
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
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function callGoogleVision(base64Image: string, credentials: string): Promise<string> {
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
  
  if (visionResult.responses?.[0]?.fullTextAnnotation?.text) {
    return visionResult.responses[0].fullTextAnnotation.text
  }
  
  return ''
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
  apiKey: string
): Promise<ExtractionResult> {
  const prompt = `거래명세서 이미지입니다. 다음 정보를 JSON으로 추출해주세요.

⚠️ **거래처(공급자) 식별 방법 - 매우 중요:**
한국 거래명세서에는 두 회사 정보가 있습니다:
- "귀중" 또는 "귀사" 옆에 있는 회사 = **받는 사람 (구매자)** → 이건 추출하지 마세요!
- "공급자", "공급하는 자", "(인)", 또는 도장/직인이 있는 쪽 = **공급자 (판매자)** → 이것이 vendor_name입니다!
거래명세서를 **보내온 회사**가 공급자입니다. "귀중" 옆에 있는 회사는 받는 회사이므로 vendor_name으로 사용하면 안됩니다.

추출 대상:
1. statement_date: 거래명세서 날짜 (YYYY-MM-DD 형식, "년/월/일" 또는 "2025년 12월 9일" 등을 변환)
2. vendor_name: **공급자(판매자)** 상호/회사명 - 도장/직인/대표자명이 있는 쪽! 정확히 읽어주세요.
3. vendor_name_english: 한글 회사명의 영문 표기 추정 (예: "엔에스테크" → "NS TECH", "삼성전자" → "Samsung Electronics")
4. total_amount: 공급가액 합계 (숫자만)
5. tax_amount: 세액 합계 (숫자만)
6. grand_total: 총액/합계 (숫자만)
7. items: 품목 배열

⚠️ **한글 회사명 정확히 읽기 - 매우 중요:**
- 비슷하게 생긴 글자 주의: 엔/플, 에/애, 스/즈, 테크/텍 등
- 글자 하나하나 정확히 확인하고 읽어주세요
- 확실하지 않으면 이미지를 다시 자세히 봐주세요

각 품목(item)에서 추출:
- line_number: 순번
- item_name: 품목명/품명
- specification: 규격 (없으면 빈 문자열)
- quantity: 수량 (숫자)
- unit_price: 단가 (숫자)
- amount: 금액/공급가액 (숫자)
- tax_amount: 세액 (숫자, 없으면 null)
- po_number: 발주번호 또는 수주번호
- remark: 비고 전체 내용
- confidence: 추출 확신도 ("low", "med", "high")

⚠️ 발주번호/수주번호 찾는 방법 (중요):
- 발주번호 패턴: F + 날짜(YYYYMMDD) + _ + 숫자 (예: F20251010_001, F20251010_1) - 시스템은 항상 3자리(_001)
- 수주번호 패턴: HS + 날짜(YYMMDD, 6자리) + - + 숫자 (예: HS251201-01, HS251201-1) - 시스템은 항상 2자리(-01)
- 비고란뿐 아니라 빈 칸, 여백, 품목명 옆, 금액 옆 등 **문서 어디에든** 손글씨/필기체로 적혀있을 수 있음
- 각 품목 행의 같은 줄에 있는 손글씨 번호를 해당 품목의 po_number로 매칭
- 여러 품목에 같은 번호가 적혀있으면 모두 해당 번호를 기록
- 번호가 흐리거나 불분명해도 패턴에 맞으면 최대한 읽어서 기록 (confidence: "low")

손글씨/필기체로 적힌 번호도 최대한 읽어주세요.
금액이 비어있거나 "-" 또는 "W" 만 있으면 0으로 처리하세요.
확신도(confidence)는 글씨가 불명확하거나 추측이 필요한 경우 "low", 보통이면 "med", 명확하면 "high"로 표시하세요.

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

function normalizePoNumbers(items: ExtractedItem[], rawVisionText?: string): ExtractedItem[] {
  // 발주번호 패턴: F + YYYYMMDD + _ + 1~3자리 숫자 (OCR에서 읽힌 형태)
  const poPatternLoose = /F\d{8}_\d{1,3}/gi
  // 수주번호 패턴: HS + YYMMDD + - + 1~2자리 숫자 (OCR에서 읽힌 형태)
  const soPatternLoose = /HS\d{6}-\d{1,2}/gi

  // 발주번호를 시스템 형식으로 정규화 (F20251008_1 → F20251008_001)
  function normalizePO(num: string): string {
    const match = num.toUpperCase().match(/^(F\d{8})_(\d{1,3})$/)
    if (match) {
      return `${match[1]}_${match[2].padStart(3, '0')}`
    }
    return num.toUpperCase()
  }

  // 수주번호를 시스템 형식으로 정규화 (HS251201-1 → HS251201-01)
  function normalizeSO(num: string): string {
    const match = num.toUpperCase().match(/^(HS\d{6})-(\d{1,2})$/)
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}`
    }
    return num.toUpperCase()
  }

  // 전체 텍스트에서 모든 PO/SO 번호 추출 (빈 칸, 여백 등에서 발견된 번호들)
  const allFoundNumbers: string[] = []
  if (rawVisionText) {
    const poMatches = rawVisionText.match(poPatternLoose) || []
    const soMatches = rawVisionText.match(soPatternLoose) || []
    allFoundNumbers.push(...poMatches.map(n => normalizePO(n)))
    allFoundNumbers.push(...soMatches.map(n => normalizeSO(n)))
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
      if (allFoundNumbers.length === 1) {
        poNumber = allFoundNumbers[0]
      } else if (allFoundNumbers.length === items.length) {
        // 번호 개수와 품목 개수가 같으면 순서대로 매칭
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

