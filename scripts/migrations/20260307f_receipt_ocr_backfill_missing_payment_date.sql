-- 결제일(payment_date) 미추출 건도 백필 재처리 대상에 포함
-- 기존: 결과 row가 없는 작업만 처리
-- 변경: 결과는 있으나 payment_date가 NULL인 성공 작업도 queued로 전환 후 재처리

CREATE OR REPLACE FUNCTION public.kick_receipt_ocr_backfill(batch_limit INTEGER DEFAULT 2)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT
      j.id,
      j.status,
      r.id AS result_id,
      r.payment_date
    FROM public.receipt_ocr_jobs j
    LEFT JOIN public.receipt_ocr_results r ON r.job_id = j.id
    WHERE (
      r.id IS NULL
      OR r.payment_date IS NULL
    )
    AND (
      j.status IN ('queued', 'pending', 'failed')
      OR (j.status = 'succeeded' AND r.payment_date IS NULL)
    )
    ORDER BY j.updated_at ASC, j.created_at ASC
    LIMIT batch_limit
  LOOP
    -- 성공 상태(succeeded)는 claim 함수 대상이 아니므로 queued로 내려서 재처리 가능하게 만든다.
    IF v_job.status = 'succeeded' THEN
      UPDATE public.receipt_ocr_jobs
         SET status = 'queued',
             queued_at = NOW(),
             finished_at = NULL,
             error_message = NULL,
             locked_by = NULL
       WHERE id = v_job.id;
    END IF;

    PERFORM net.http_post(
      url := 'https://qvhbigvdfyvhoegkhvef.supabase.co/functions/v1/receipt-ocr-engine',
      body := jsonb_build_object('jobId', v_job.id::text),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MTQzNjAsImV4cCI6MjA2MzM5MDM2MH0.7VZlSwnNuE0MaQpDjuzeZFgjJrDBQOWA_COyqaM8Rbg',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MTQzNjAsImV4cCI6MjA2MzM5MDM2MH0.7VZlSwnNuE0MaQpDjuzeZFgjJrDBQOWA_COyqaM8Rbg'
      ),
      timeout_milliseconds := 5000
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
