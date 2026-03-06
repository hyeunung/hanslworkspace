-- uploaded_by_email 칼럼 추가 (거래명세서 업로더 식별용)
ALTER TABLE transaction_statements
  ADD COLUMN IF NOT EXISTS uploaded_by_email TEXT;

-- 기존 데이터 backfill
-- 1) uploaded_by(uuid)가 auth.users.id와 일치하는 경우
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM auth.users au
JOIN employees e ON e.email = au.email
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by IS NOT NULL
  AND ts.uploaded_by = au.id;

-- 2) uploaded_by(uuid)가 employees.id와 일치하는 경우 (등록자 변경된 건)
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM employees e
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by IS NOT NULL
  AND ts.uploaded_by::text = e.id;

-- 3) uploaded_by_name으로 fallback
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM employees e
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by_name IS NOT NULL
  AND ts.uploaded_by_name = e.name;
