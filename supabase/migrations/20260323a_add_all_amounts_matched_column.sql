-- all_amounts_matched 칼럼 추가 (금액 일치 여부)
ALTER TABLE transaction_statements
ADD COLUMN IF NOT EXISTS all_amounts_matched boolean DEFAULT false;

-- 기존 확정 완료 건 백필
UPDATE transaction_statements
SET all_amounts_matched = true
WHERE manager_confirmed_at IS NOT NULL;
