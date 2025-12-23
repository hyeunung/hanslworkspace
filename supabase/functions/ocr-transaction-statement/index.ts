import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // 6. DB에 결과 저장
    await supabase
      .from('transaction_statements')
      .update({
        status: 'extracted',
        statement_date: extractionResult.statement_date || null,
        vendor_name: extractionResult.vendor_name || null,
        total_amount: extractionResult.total_amount || null,
        tax_amount: extractionResult.tax_amount || null,
        grand_total: extractionResult.grand_total || null,
        extracted_data: {
          ...extractionResult,
          items: normalizedItems,
          raw_vision_text: visionText
        }
      })
      .eq('id', requestData.statementId)

    // 7. 추출된 품목들을 transaction_statement_items에 저장
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
        result: {
          ...extractionResult,
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

추출 대상:
1. statement_date: 거래명세서 날짜 (YYYY-MM-DD 형식, "년/월/일" 또는 "2025년 12월 9일" 등을 변환)
2. vendor_name: 공급자(판매자) 상호/회사명
3. total_amount: 공급가액 합계 (숫자만)
4. tax_amount: 세액 합계 (숫자만)
5. grand_total: 총액/합계 (숫자만)
6. items: 품목 배열

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
- 수주번호 패턴: HS + 날짜(YYYYMMDD) + - + 숫자 (예: HS20251201-01, HS20251201-1) - 시스템은 항상 2자리(-01)
- 비고란뿐 아니라 빈 칸, 여백, 품목명 옆, 금액 옆 등 **문서 어디에든** 손글씨/필기체로 적혀있을 수 있음
- 각 품목 행의 같은 줄에 있는 손글씨 번호를 해당 품목의 po_number로 매칭
- 여러 품목에 같은 번호가 적혀있으면 모두 해당 번호를 기록
- 번호가 흐리거나 불분명해도 패턴에 맞으면 최대한 읽어서 기록 (confidence: "low")

손글씨/필기체로 적힌 번호도 최대한 읽어주세요.
금액이 비어있거나 "-" 또는 "W" 만 있으면 0으로 처리하세요.
확신도(confidence)는 글씨가 불명확하거나 추측이 필요한 경우 "low", 보통이면 "med", 명확하면 "high"로 표시하세요.

${visionText ? `참고로 OCR로 읽은 텍스트:\n${visionText.substring(0, 3000)}` : ''}

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
  // 수주번호 패턴: HS + YYYYMMDD + - + 1~2자리 숫자 (OCR에서 읽힌 형태)
  const soPatternLoose = /HS\d{8}-\d{1,2}/gi

  // 발주번호를 시스템 형식으로 정규화 (F20251008_1 → F20251008_001)
  function normalizePO(num: string): string {
    const match = num.toUpperCase().match(/^(F\d{8})_(\d{1,3})$/)
    if (match) {
      return `${match[1]}_${match[2].padStart(3, '0')}`
    }
    return num.toUpperCase()
  }

  // 수주번호를 시스템 형식으로 정규화 (HS20251201-1 → HS20251201-01)
  function normalizeSO(num: string): string {
    const match = num.toUpperCase().match(/^(HS\d{8})-(\d{1,2})$/)
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

