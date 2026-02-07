-- 거래명세서 OCR 큐/실패 상태 관리 강화
-- - queued/failed 상태 추가
-- - 큐 메타데이터 컬럼 추가
-- - 큐 클레임 함수 추가

ALTER TABLE transaction_statements
  DROP CONSTRAINT IF EXISTS transaction_statements_status_check;

ALTER TABLE transaction_statements
  ADD CONSTRAINT transaction_statements_status_check
  CHECK (status IN ('pending', 'queued', 'processing', 'extracted', 'confirmed', 'rejected', 'failed'));

ALTER TABLE transaction_statements
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_before_extract BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_transaction_statements_status_queued_at
  ON transaction_statements(status, queued_at);

-- 특정 거래명세서 클레임 (processing 활성 상태가 없을 때만)
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

-- 대기열에서 다음 건 클레임 (processing 활성 상태가 없을 때만)
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

-- 오래된 processing 건 실패 처리
CREATE OR REPLACE FUNCTION mark_stale_transaction_statements_failed(
  processing_timeout INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE transaction_statements
  SET status = 'failed',
      processing_finished_at = NOW(),
      last_error_at = NOW(),
      extraction_error = COALESCE(extraction_error, 'Processing timeout'),
      locked_by = NULL
  WHERE status = 'processing'
    AND processing_started_at IS NOT NULL
    AND processing_started_at <= NOW() - processing_timeout;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
