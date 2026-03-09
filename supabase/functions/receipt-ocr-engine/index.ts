// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno runtime imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

interface OCRRequest {
  jobId?: string;
}

interface ReceiptExtractionResult {
  merchant_name?: string;
  item_name?: string;
  payment_date?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_amount?: number | null;
  confidence?: "low" | "med" | "high";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let jobId: string | null = null;
  let supabaseUrl = "";
  let supabaseServiceKey = "";

  try {
    supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase env is missing");
    }
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: OCRRequest = await req.json().catch(() => ({}));
    const workerId = crypto.randomUUID();

    if (!body.jobId) {
      throw new Error("jobId is required");
    }
    const { data, error } = await supabase.rpc("claim_receipt_ocr_job", {
      p_job_id: body.jobId,
      p_worker_id: workerId,
      p_processing_timeout: "15 minutes",
    });
    if (error) throw error;
    const claimedJob = Array.isArray(data) ? data[0] : data;
    if (!claimedJob?.id) {
      return jsonResponse({
        success: true,
        queued: true,
        reason: "claim_failed_or_already_processing",
        jobId: body.jobId,
      });
    }

    jobId = String(claimedJob.id);
    const imageUrl = String(claimedJob.image_url || "");
    if (!imageUrl) throw new Error("image_url is missing");

    const imageBuffer = await downloadImage(imageUrl);
    const base64Image = arrayBufferToBase64(imageBuffer);
    const extracted = await extractReceiptWithGPT4o(base64Image, openaiApiKey);
    const normalizedPaymentDate = normalizePaymentDate(extracted.payment_date);
    const normalizedQuantity = normalizeAmount(extracted.quantity);
    const normalizedUnitPrice = normalizeAmount(extracted.unit_price);
    const normalizedAmount = normalizeAmount(extracted.total_amount);
    const normalizedConfidence = normalizeConfidence(extracted.confidence);

    const { error: resultError } = await supabase
      .from("receipt_ocr_results")
      .upsert(
        {
          job_id: jobId,
          merchant_name: extracted.merchant_name || null,
          item_name: extracted.item_name || null,
          payment_date: normalizedPaymentDate,
          quantity: normalizedQuantity,
          unit_price: normalizedUnitPrice,
          total_amount: normalizedAmount,
          confidence: normalizedConfidence,
          raw_json: extracted,
        },
        { onConflict: "job_id" },
      );
    if (resultError) throw resultError;

    const { error: doneError } = await supabase
      .from("receipt_ocr_jobs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        error_message: null,
        locked_by: null,
      })
      .eq("id", jobId);
    if (doneError) throw doneError;

    return jsonResponse({
      success: true,
      jobId,
      result: {
        merchant_name: extracted.merchant_name || null,
        item_name: extracted.item_name || null,
        payment_date: normalizedPaymentDate,
        quantity: normalizedQuantity,
        unit_price: normalizedUnitPrice,
        total_amount: normalizedAmount,
        confidence: normalizedConfidence,
      },
    });
  } catch (error: unknown) {
    if (jobId && supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase
        .from("receipt_ocr_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Unknown error",
          retry_count: (await getRetryCount(supabase, jobId)) + 1,
          locked_by: null,
        })
        .eq("id", jobId);
    }
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getRetryCount(supabase: any, jobId: string): Promise<number> {
  const { data } = await supabase
    .from("receipt_ocr_jobs")
    .select("retry_count")
    .eq("id", jobId)
    .maybeSingle();
  return Number(data?.retry_count || 0);
}

async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`);
  return await response.arrayBuffer();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function extractReceiptWithGPT4o(base64Image: string, apiKey: string): Promise<ReceiptExtractionResult> {
  const prompt = `영수증 이미지를 보고 아래 필드를 JSON으로 추출하세요.

필드:
1) merchant_name: 거래처/사용처 이름
2) item_name: 품명(대표 1개, 없으면 null)
3) payment_date: 결제일(YYYY-MM-DD, 못 찾으면 null)
4) quantity: 수량(숫자만, 없으면 null)
5) unit_price: 단가(숫자만, 없으면 null)
6) total_amount: 총 합계 금액(숫자만)
7) confidence: low | med | high

규칙:
- JSON 외 텍스트 금지
- payment_date는 반드시 YYYY-MM-DD 형식 (예: 2026-03-09)
- quantity, unit_price, total_amount는 숫자만 (통화기호/쉼표 제거)
- 값을 못 찾으면 null 허용`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You extract structured fields from receipt images. Return JSON only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(`GPT error: ${result.error.message}`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in GPT response");
  return JSON.parse(content);
}

function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizePaymentDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace(/[./년월]/g, "-").replace(/[일]/g, "").replace(/\s+/g, "");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function normalizeConfidence(value: unknown): "low" | "med" | "high" {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "low" || raw === "l") return "low";
  if (raw === "high" || raw === "h") return "high";
  return "med";
}

