-- statement_mode에 'monthly' 추가
ALTER TABLE transaction_statements
  DROP CONSTRAINT IF EXISTS transaction_statements_statement_mode_check;

ALTER TABLE transaction_statements
  ADD CONSTRAINT transaction_statements_statement_mode_check
  CHECK (statement_mode IN ('default', 'receipt', 'monthly'));
