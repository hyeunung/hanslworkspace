-- OCR job 누락된 purchase_receipts를 백필 함수가 자동 생성하도록 보강
-- (특정 업로드 경로에서 job 생성이 빠져도 복구 가능)

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
  -- 1) OCR job이 아예 없는 영수증을 먼저 큐에 등록
  INSERT INTO public.receipt_ocr_jobs (
    image_url,
    source_receipt_id,
    requested_by,
    requested_by_name,
    status,
    queued_at
  )
  SELECT
    pr.receipt_image_url,
    pr.id,
    pr.uploaded_by,
    pr.uploaded_by_name,
    'queued',
    NOW()
  FROM public.purchase_receipts pr
  LEFT JOIN public.receipt_ocr_jobs j ON j.source_receipt_id = pr.id
  WHERE j.id IS NULL
    AND pr.receipt_image_url IS NOT NULL
    AND pr.receipt_image_url <> '';

  -- 2) 결과 미생성 또는 payment_date 미생성 건 재처리
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
