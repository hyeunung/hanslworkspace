-- uploaded_by_email 칼럼 추가 (거래명세서 업로더 식별용)
ALTER TABLE transaction_statements
  ADD COLUMN IF NOT EXISTS uploaded_by_email TEXT;

-- 기존 데이터 backfill: uploaded_by(auth UUID 또는 employees.id)로 employees 테이블에서 email 매칭
-- 1) uploaded_by가 employees.id인 경우
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM employees e
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by IS NOT NULL
  AND ts.uploaded_by = e.id;

-- 2) uploaded_by가 auth.users UUID인 경우 (email로 연결)
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM auth.users au
JOIN employees e ON e.email = au.email
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by IS NOT NULL
  AND ts.uploaded_by = au.id::text;

-- 3) uploaded_by_name으로 fallback (위 두 방법으로 매칭 안 된 경우)
UPDATE transaction_statements ts
SET uploaded_by_email = e.email
FROM employees e
WHERE ts.uploaded_by_email IS NULL
  AND ts.uploaded_by_name IS NOT NULL
  AND ts.uploaded_by_name = e.name;
