-- 거래명세서 큐 멈춤 방지 보강
-- 1) stale processing 자동 정리(클레임 시점)
-- 2) process_specific 클레임에서 전역 processing 락 제거
--    -> 특정 statement 재처리를 다른 processing 건과 분리
-- 3) processing timeout 지난 건은 재클레임 허용

-- 특정 거래명세서 클레임 (전역 processing 상태와 무관하게 대상 건만 클레임)
CREATE OR REPLACE FUNCTION claim_transaction_statement(
  statement_id UUID,
  worker_id TEXT,
  processing_timeout INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS transaction_statements
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed transaction_statements;
BEGIN
  -- stale processing 정리
  UPDATE transaction_statements
  SET status = 'failed',
      processing_finished_at = NOW(),
      last_error_at = NOW(),
      extraction_error = COALESCE(extraction_error, 'Processing timeout (auto cleanup)'),
      locked_by = NULL
  WHERE status = 'processing'
    AND processing_started_at IS NOT NULL
    AND processing_started_at <= NOW() - processing_timeout;

  -- 대상 statement 클레임
  UPDATE transaction_statements
  SET status = 'processing',
      processing_started_at = NOW(),
      processing_finished_at = NULL,
      locked_by = worker_id,
      extraction_error = NULL,
      last_error_at = NULL
  WHERE id = statement_id
    AND (
      status IN ('pending', 'queued', 'failed')
      OR (
        status = 'processing'
        AND processing_started_at IS NOT NULL
        AND processing_started_at <= NOW() - processing_timeout
      )
    )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

-- 대기열에서 다음 건 클레임 (stale 정리 후 queued 우선 처리)
CREATE OR REPLACE FUNCTION claim_next_transaction_statement(
  worker_id TEXT,
  processing_timeout INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS transaction_statements
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed transaction_statements;
BEGIN
  -- stale processing 정리
  UPDATE transaction_statements
  SET status = 'failed',
      processing_finished_at = NOW(),
      last_error_at = NOW(),
      extraction_error = COALESCE(extraction_error, 'Processing timeout (auto cleanup)'),
      locked_by = NULL
  WHERE status = 'processing'
    AND processing_started_at IS NOT NULL
    AND processing_started_at <= NOW() - processing_timeout;

  UPDATE transaction_statements
  SET status = 'processing',
      processing_started_at = NOW(),
      processing_finished_at = NULL,
      locked_by = worker_id,
      extraction_error = NULL,
      last_error_at = NULL
  WHERE id = (
    SELECT id
    FROM transaction_statements
    WHERE status = 'queued'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY queued_at NULLS LAST, uploaded_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

