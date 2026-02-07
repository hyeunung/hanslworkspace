-- 거래명세서 이중 확인(확정/수량일치) 컬럼 추가
ALTER TABLE transaction_statements
  ADD COLUMN IF NOT EXISTS manager_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_confirmed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manager_confirmed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS quantity_match_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quantity_match_confirmed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS quantity_match_confirmed_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_transaction_statements_manager_confirmed_at
  ON transaction_statements(manager_confirmed_at);

CREATE INDEX IF NOT EXISTS idx_transaction_statements_quantity_match_confirmed_at
  ON transaction_statements(quantity_match_confirmed_at);
