-- purchase_receipts 테이블의 RLS 정책 확인
-- Supabase SQL Editor에서 실행

-- 1. 테이블의 RLS 상태 확인
SELECT 
    schemaname, 
    tablename, 
    rowsecurity 
FROM pg_tables 
WHERE tablename = 'purchase_receipts';

-- 2. purchase_receipts 테이블의 모든 RLS 정책 확인
SELECT 
    policyname,
    cmd,
    permissive,
    roles,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'purchase_receipts'
ORDER BY cmd, policyname;

-- 3. 특정 영수증 ID 24의 실제 존재 여부 확인
SELECT 
    id,
    file_name,
    uploaded_by,
    uploaded_by_name,
    is_printed,
    created_at
FROM purchase_receipts 
WHERE id = 24;

-- 4. 현재 사용자(test@hansl.com)로 볼 수 있는 영수증 목록
SELECT 
    id,
    file_name,
    uploaded_by,
    uploaded_by_name,
    is_printed
FROM purchase_receipts 
ORDER BY id DESC 
LIMIT 10;

-- 5. test@hansl.com 사용자 정보 확인
SELECT 
    id,
    email,
    name,
    purchase_role
FROM employees 
WHERE email = 'test@hansl.com';

-- 6. Auth 사용자 정보 확인 (service role로만 실행 가능)
-- SELECT 
--     id,
--     email,
--     created_at,
--     last_sign_in_at
-- FROM auth.users 
-- WHERE email = 'test@hansl.com';