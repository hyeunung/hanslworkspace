export type ReceiptOcrJobStatus = "pending" | "queued" | "processing" | "succeeded" | "failed";

export interface ReceiptOcrJob {
  id: string;
  source_receipt_id?: number | null;
  image_url: string;
  status: ReceiptOcrJobStatus;
  requested_by?: string | null;
  requested_by_name?: string | null;
  queued_at: string;
  processing_started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiptOcrResult {
  id: string;
  job_id: string;
  merchant_name?: string | null;
  item_name?: string | null;
  payment_date?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_amount?: number | null;
  confidence?: "low" | "med" | "high" | null;
  raw_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateReceiptOcrJobParams {
  imageUrl: string;
  sourceReceiptId?: number;
  requestedBy?: string;
  requestedByName?: string;
}
