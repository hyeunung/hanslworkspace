-- 기존 영수증 OCR 백필을 저속으로 안정 처리하기 위한 스케줄러
-- OpenAI rate limit 회피를 위해 분당 소량(limit)만 트리거한다.

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
    SELECT j.id
    FROM public.receipt_ocr_jobs j
    LEFT JOIN public.receipt_ocr_results r ON r.job_id = j.id
    WHERE r.id IS NULL
      AND j.status IN ('queued', 'pending', 'failed')
    ORDER BY j.updated_at ASC, j.created_at ASC
    LIMIT batch_limit
  LOOP
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'receipt_ocr_backfill_minutely'
  ) THEN
    PERFORM cron.unschedule('receipt_ocr_backfill_minutely');
  END IF;
END $$;

SELECT cron.schedule(
  'receipt_ocr_backfill_minutely',
  '* * * * *',
  $$SELECT public.kick_receipt_ocr_backfill(2);$$
);
