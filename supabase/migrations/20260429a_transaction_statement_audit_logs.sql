-- 거래명세서 상태 변경 감사 로그 테이블
-- 누가/언제/왜 거부·확정·재추출 등을 했는지 영구 기록한다.

CREATE TABLE IF NOT EXISTS transaction_statement_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES transaction_statements(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'rejected', 'unrejected', 'confirmed', 'unconfirmed',
    'extracted', 'failed', 'queued', 'reset',
    'manager_confirmed', 'quantity_match_confirmed'
  )),
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  actor_id UUID,
  actor_name TEXT,
  actor_email TEXT,
  source TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ts_audit_logs_statement_id_created
  ON transaction_statement_audit_logs(statement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ts_audit_logs_action_created
  ON transaction_statement_audit_logs(action, created_at DESC);

COMMENT ON TABLE transaction_statement_audit_logs IS
  '거래명세서 상태 변경 감사 로그. rejectStatement/confirmStatement 등에서 누가/언제/왜를 영구 기록.';

-- DB 안전망 트리거: 어플리케이션이 audit 기록을 빼먹어도 status 변경을 자동 캡처.
-- 단 actor 정보는 어플리케이션이 명시 INSERT한 행이 더 정확하므로,
-- 본 트리거는 같은 statement_id + 1초 이내 + 같은 new_status가 이미 있으면 스킵한다.
CREATE OR REPLACE FUNCTION log_transaction_statement_status_change()
RETURNS TRIGGER AS $$
DECLARE
  recent_log_exists BOOLEAN;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM transaction_statement_audit_logs
    WHERE statement_id = NEW.id
      AND new_status = NEW.status
      AND created_at > NOW() - INTERVAL '2 seconds'
  ) INTO recent_log_exists;

  IF recent_log_exists THEN
    RETURN NEW;
  END IF;

  INSERT INTO transaction_statement_audit_logs(
    statement_id, action, previous_status, new_status, reason, source
  ) VALUES (
    NEW.id,
    CASE NEW.status
      WHEN 'rejected' THEN 'rejected'
      WHEN 'confirmed' THEN 'confirmed'
      WHEN 'extracted' THEN 'extracted'
      WHEN 'failed' THEN 'failed'
      WHEN 'queued' THEN 'queued'
      ELSE 'reset'
    END,
    OLD.status,
    NEW.status,
    CASE WHEN NEW.status = 'rejected' THEN NEW.extraction_error ELSE NULL END,
    'db_trigger_fallback'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_transaction_statement_status_change
  ON transaction_statements;

CREATE TRIGGER trg_log_transaction_statement_status_change
  AFTER UPDATE OF status ON transaction_statements
  FOR EACH ROW
  EXECUTE FUNCTION log_transaction_statement_status_change();
