-- 거래명세서 단일/다중 선택 저장
ALTER TABLE transaction_statements
ADD COLUMN IF NOT EXISTS po_scope TEXT;

-- 값 제한 (single/multi)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transaction_statements_po_scope_check'
  ) THEN
    ALTER TABLE transaction_statements
      ADD CONSTRAINT transaction_statements_po_scope_check
      CHECK (po_scope IN ('single', 'multi'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transaction_statements_po_scope
ON transaction_statements(po_scope);
