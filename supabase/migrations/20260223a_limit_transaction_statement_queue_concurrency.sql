-- OCR 워커 리소스 한도(546/500) 대응:
-- claim 단계에서 active processing 동시성을 1건으로 제한
-- (stale processing 정리는 유지)

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

  -- active processing이 있으면 특정 건도 즉시 처리하지 않고 큐로 남김
  UPDATE transaction_statements
  SET status = 'processing',
      processing_started_at = NOW(),
      processing_finished_at = NULL,
      locked_by = worker_id,
      extraction_error = NULL,
      last_error_at = NULL
  WHERE id = statement_id
    AND status IN ('pending', 'queued', 'failed')
    AND NOT EXISTS (
      SELECT 1
      FROM transaction_statements
      WHERE status = 'processing'
        AND processing_started_at IS NOT NULL
        AND processing_started_at > NOW() - processing_timeout
    )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

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
  AND NOT EXISTS (
    SELECT 1
    FROM transaction_statements
    WHERE status = 'processing'
      AND processing_started_at IS NOT NULL
      AND processing_started_at > NOW() - processing_timeout
  )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

