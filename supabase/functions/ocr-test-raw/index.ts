import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

declare const Deno: { env: { get(key: string): string | undefined } }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") || ""
    const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514"
    if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set")

    const { imageUrl } = await req.json()
    if (!imageUrl) throw new Error("imageUrl required")

    const imgResp = await fetch(imageUrl)
    if (!imgResp.ok) throw new Error(`Image download failed: ${imgResp.status}`)
    const imgBuffer = await imgResp.arrayBuffer()
    const imgBytes = new Uint8Array(imgBuffer)
    let binary = ""
    for (let i = 0; i < imgBytes.byteLength; i++) {
      binary += String.fromCharCode(imgBytes[i])
    }
    const base64 = btoa(binary)

    const prompt = `이 거래명세서 이미지에서 품목 테이블의 각 행을 추출하세요.

[핵심 규칙]
- "품명" 칼럼의 텍스트를 item_name에 그대로 기록 (재작성/추정 금지)
- "규격" 칼럼의 텍스트를 specification에 기록
- 규격에 F20260209_003-14 같은 발주번호 패턴이 있으면 po_number/po_line_number로 별도 분리
- 수량/단가/금액은 각 칼럼의 숫자 그대로
- 합계/공급가액/부가세/계좌번호/서명 행은 제외
- 실제 보이는 행만 추출

JSON 스키마:
{
  "items": [
    {
      "line_number": 1,
      "item_name": "",
      "specification": "",
      "quantity": null,
      "unit_price": null,
      "amount": 0,
      "po_number": "",
      "confidence": "low|med|high"
    }
  ]
}

JSON만 반환하세요.`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 4096,
        temperature: 0,
        system: "You are an expert at extracting structured data from Korean transaction statements. Return strict JSON only.",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64,
              },
            },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Claude API failed: ${response.status} ${body}`)
    }

    const result = await response.json()
    const textContent = (result?.content || [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b?.text || "")
      .join("\n")
      .trim()

    return new Response(
      JSON.stringify({
        success: true,
        model: anthropicModel,
        image_size: imgBytes.byteLength,
        base64_length: base64.length,
        raw_claude_response: textContent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
