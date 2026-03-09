-- Receipt OCR 독립 엔진 초기 스키마
-- 기존 OCR/거래명세서 파이프라인과 완전히 분리된 테이블/함수만 추가한다.

CREATE TABLE IF NOT EXISTS public.receipt_ocr_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_receipt_id BIGINT REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'processing', 'succeeded', 'failed')),
  requested_by TEXT,
  requested_by_name TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  locked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.receipt_ocr_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.receipt_ocr_jobs(id) ON DELETE CASCADE,
  merchant_name TEXT,
  item_name TEXT,
  total_amount NUMERIC(15,2),
  confidence TEXT CHECK (confidence IN ('low', 'med', 'high')),
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_receipt_ocr_jobs_status_queued_at
  ON public.receipt_ocr_jobs(status, queued_at);

CREATE INDEX IF NOT EXISTS idx_receipt_ocr_jobs_source_receipt_id
  ON public.receipt_ocr_jobs(source_receipt_id);

CREATE INDEX IF NOT EXISTS idx_receipt_ocr_results_job_id
  ON public.receipt_ocr_results(job_id);

ALTER TABLE public.receipt_ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_ocr_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receipt_ocr_jobs_select_authenticated" ON public.receipt_ocr_jobs;
CREATE POLICY "receipt_ocr_jobs_select_authenticated"
  ON public.receipt_ocr_jobs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "receipt_ocr_jobs_insert_authenticated" ON public.receipt_ocr_jobs;
CREATE POLICY "receipt_ocr_jobs_insert_authenticated"
  ON public.receipt_ocr_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "receipt_ocr_jobs_update_authenticated" ON public.receipt_ocr_jobs;
CREATE POLICY "receipt_ocr_jobs_update_authenticated"
  ON public.receipt_ocr_jobs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "receipt_ocr_results_select_authenticated" ON public.receipt_ocr_results;
CREATE POLICY "receipt_ocr_results_select_authenticated"
  ON public.receipt_ocr_results
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "receipt_ocr_results_insert_authenticated" ON public.receipt_ocr_results;
CREATE POLICY "receipt_ocr_results_insert_authenticated"
  ON public.receipt_ocr_results
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "receipt_ocr_results_update_authenticated" ON public.receipt_ocr_results;
CREATE POLICY "receipt_ocr_results_update_authenticated"
  ON public.receipt_ocr_results
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_receipt_ocr_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_ocr_jobs_updated_at ON public.receipt_ocr_jobs;
CREATE TRIGGER trg_receipt_ocr_jobs_updated_at
  BEFORE UPDATE ON public.receipt_ocr_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_ocr_updated_at();

DROP TRIGGER IF EXISTS trg_receipt_ocr_results_updated_at ON public.receipt_ocr_results;
CREATE TRIGGER trg_receipt_ocr_results_updated_at
  BEFORE UPDATE ON public.receipt_ocr_results
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_ocr_updated_at();

-- 독립 엔진용 claim 함수 (기존 claim_* 함수와 분리)
CREATE OR REPLACE FUNCTION public.claim_receipt_ocr_job(
  p_job_id UUID,
  p_worker_id UUID,
  p_processing_timeout INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS SETOF public.receipt_ocr_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.receipt_ocr_jobs j
     SET status = 'processing',
         processing_started_at = NOW(),
         locked_by = p_worker_id,
         error_message = NULL
   WHERE j.id = p_job_id
     AND (
       j.status IN ('pending', 'queued', 'failed')
       OR (j.status = 'processing' AND j.processing_started_at < NOW() - p_processing_timeout)
     )
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_receipt_ocr_job(
  p_worker_id UUID,
  p_processing_timeout INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS SETOF public.receipt_ocr_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
      FROM public.receipt_ocr_jobs j
     WHERE (
       j.status IN ('pending', 'queued', 'failed')
       OR (j.status = 'processing' AND j.processing_started_at < NOW() - p_processing_timeout)
     )
     ORDER BY j.queued_at ASC, j.created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.receipt_ocr_jobs j
     SET status = 'processing',
         processing_started_at = NOW(),
         locked_by = p_worker_id,
         error_message = NULL
    FROM candidate
   WHERE j.id = candidate.id
  RETURNING j.*;
END;
$$;

COMMENT ON TABLE public.receipt_ocr_jobs IS '독립 영수증 OCR 엔진 작업 큐';
COMMENT ON TABLE public.receipt_ocr_results IS '독립 영수증 OCR 추출 결과';
