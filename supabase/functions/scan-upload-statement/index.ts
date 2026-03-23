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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * scan-upload-statement
 *
 * 스캐너 → Make.com → 이 Edge Function 호출
 * PDF/이미지 파일을 받아 Supabase Storage에 업로드하고
 * transaction_statements 테이블에 레코드를 생성한 뒤
 * 기존 파싱 Edge Function(parse-transaction-pdf / ocr-transaction-statement)을 트리거한다.
 *
 * 기존 웹 업로드 로직(transactionStatementService.uploadStatement)과
 * 동일한 Storage 경로·DB 스키마·파싱 파이프라인을 사용하므로
 * 기존 코드를 전혀 건드리지 않는다.
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const scanApiKey = Deno.env.get('SCAN_UPLOAD_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    // API Key 인증
    const providedKey =
      req.headers.get('x-api-key') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''

    if (!scanApiKey) {
      throw new Error('SCAN_UPLOAD_API_KEY is not configured on the server')
    }
    if (providedKey !== scanApiKey) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const contentType = req.headers.get('content-type') || ''

    let fileBytes: Uint8Array
    let originalFileName: string
    let fileMimeType: string
    let uploaderEmail: string | null = null
    let uploaderName: string | null = null
    let poScope: 'single' | 'multi' | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file')
      if (!file || !(file instanceof File)) {
        return new Response(
          JSON.stringify({ error: 'Missing "file" in form data' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      fileBytes = new Uint8Array(await file.arrayBuffer())
      originalFileName = file.name || 'scan.pdf'
      fileMimeType = file.type || detectMimeType(originalFileName)
      uploaderEmail = (formData.get('uploader_email') as string) || null
      uploaderName = (formData.get('uploader_name') as string) || null
      const psScopeRaw = (formData.get('po_scope') as string) || null
      if (psScopeRaw === 'single' || psScopeRaw === 'multi') {
        poScope = psScopeRaw
      }
    } else if (contentType.includes('application/json')) {
      const body = await req.json()
      const base64Data: string = body.file_base64 || body.file || ''
      if (!base64Data) {
        return new Response(
          JSON.stringify({ error: 'Missing "file_base64" in JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      fileBytes = base64ToUint8Array(base64Data)
      originalFileName = body.file_name || 'scan.pdf'
      fileMimeType = body.mime_type || detectMimeType(originalFileName)
      uploaderEmail = body.uploader_email || null
      uploaderName = body.uploader_name || null
      if (body.po_scope === 'single' || body.po_scope === 'multi') {
        poScope = body.po_scope
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Unsupported Content-Type. Use multipart/form-data or application/json' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (fileBytes.length === 0) {
      return new Response(
        JSON.stringify({ error: 'File is empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 등록자 이메일 → employees 테이블에서 이름 조회
    let resolvedUploaderName = uploaderName || '스캐너'
    let resolvedUploaderId: string | null = null

    if (uploaderEmail) {
      const { data: emp } = await supabase
        .from('employees')
        .select('id, name')
        .eq('email', uploaderEmail)
        .eq('is_active', true)
        .single()

      if (emp) {
        resolvedUploaderName = emp.name || resolvedUploaderName
        resolvedUploaderId = emp.id
      }
    }

    // 파일 확장자·파일 타입 판별
    const ext = originalFileName.split('.').pop()?.toLowerCase() || 'pdf'
    const fileType = resolveFileType(ext, fileMimeType)

    // Storage 경로 생성 (기존 uploadStatement와 동일한 경로 패턴)
    const uuid = crypto.randomUUID()
    const fileName = `${uuid}.${ext}`
    const storagePath = `Transaction Statement/${fileName}`

    // Storage에 업로드
    const { error: uploadError } = await supabase
      .storage
      .from('receipt-images')
      .upload(storagePath, fileBytes, {
        contentType: fileMimeType || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    // Public URL 생성
    const { data: urlData } = supabase
      .storage
      .from('receipt-images')
      .getPublicUrl(storagePath)

    const imageUrl = urlData.publicUrl

    // DB에 레코드 생성 (기존 uploadStatement와 동일한 스키마)
    const extractedData: Record<string, unknown> = { file_type: fileType, source: 'scanner' }

    const { data: statement, error: dbError } = await supabase
      .from('transaction_statements')
      .insert({
        image_url: imageUrl,
        file_name: originalFileName,
        uploaded_by: resolvedUploaderId,
        uploaded_by_name: resolvedUploaderName,
        uploaded_by_email: uploaderEmail,
        status: 'queued',
        queued_at: new Date().toISOString(),
        po_scope: poScope,
        extracted_data: extractedData,
      })
      .select('id')
      .single()

    if (dbError) {
      throw new Error(`DB insert failed: ${dbError.message}`)
    }

    // 기존 파싱 Edge Function 트리거 (비동기, 실패해도 업로드 자체는 성공)
    const parserFunction = fileType === 'pdf' ? 'parse-transaction-pdf' : 'ocr-transaction-statement'
    triggerParsing(supabaseUrl, supabaseServiceKey, parserFunction, statement.id, imageUrl, fileType)

    return new Response(
      JSON.stringify({
        success: true,
        statementId: statement.id,
        imageUrl,
        fileType,
        uploaderEmail: uploaderEmail || null,
        uploaderName: resolvedUploaderName,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function resolveFileType(ext: string, mimeType: string): 'pdf' | 'image' | 'excel' {
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (/^(xlsx?|xlsm|xlsb)$/.test(ext)) return 'excel'
  return 'image'
}

function detectMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    bmp: 'image/bmp',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
  }
  return map[ext] || 'application/octet-stream'
}

function base64ToUint8Array(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function triggerParsing(
  supabaseUrl: string,
  serviceKey: string,
  functionName: string,
  statementId: string,
  fileUrl: string,
  fileType: string
): void {
  const url = `${supabaseUrl}/functions/v1/${functionName}`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
    },
    body: JSON.stringify({
      statementId,
      fileUrl,
      imageUrl: fileUrl,
      fileType,
    }),
  }).catch(() => {
    // 파싱 트리거 실패해도 업로드 자체는 성공 처리
  })
}
