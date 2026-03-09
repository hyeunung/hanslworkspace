import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type {
  CreateReceiptOcrJobParams,
  ReceiptOcrJob,
  ReceiptOcrResult,
} from "@/types/receiptOcr";

class ReceiptOcrService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  async createJob(params: CreateReceiptOcrJobParams): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from("receipt_ocr_jobs")
        .insert({
          image_url: params.imageUrl,
          source_receipt_id: params.sourceReceiptId ?? null,
          requested_by: params.requestedBy ?? null,
          requested_by_name: params.requestedByName ?? null,
          status: "queued",
          queued_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;
      return { success: true, jobId: data.id };
    } catch (error) {
      logger.error("영수증 OCR 작업 생성 실패", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "작업 생성 실패",
      };
    }
  }

  async trigger(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.functions.invoke("receipt-ocr-engine", {
        body: { jobId },
      });
      if (error) throw error;
      return { success: true };
    } catch (error) {
      logger.error("영수증 OCR 트리거 실패", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "OCR 트리거 실패",
      };
    }
  }

  async getJob(jobId: string): Promise<ReceiptOcrJob | null> {
    const { data, error } = await this.supabase
      .from("receipt_ocr_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (error) {
      logger.error("영수증 OCR 작업 조회 실패", error, { jobId });
      return null;
    }
    return data as ReceiptOcrJob | null;
  }

  async getResult(jobId: string): Promise<ReceiptOcrResult | null> {
    const { data, error } = await this.supabase
      .from("receipt_ocr_results")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) {
      logger.error("영수증 OCR 결과 조회 실패", error, { jobId });
      return null;
    }
    return data as ReceiptOcrResult | null;
  }
}

export const receiptOcrService = new ReceiptOcrService();
