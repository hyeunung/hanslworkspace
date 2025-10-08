-- employees 테이블의 purchase_role 컬럼 타입 확인
SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'employees' 
AND column_name = 'purchase_role';

-- 실제 데이터 확인
SELECT id, name, email, purchase_role, pg_typeof(purchase_role) as role_type
FROM employees
LIMIT 5;

-- JSON 배열로 변환이 필요한 경우
-- UPDATE employees 
-- SET purchase_role = CASE 
--   WHEN purchase_role IS NULL THEN NULL
--   WHEN purchase_role = 'middle_manager' THEN '["middle_manager"]'::jsonb
--   WHEN purchase_role = 'final_approver' THEN '["final_approver"]'::jsonb
--   WHEN purchase_role = 'ceo' THEN '["ceo"]'::jsonb
--   WHEN purchase_role = 'lead buyer' THEN '["lead buyer"]'::jsonb
--   WHEN purchase_role = 'app_admin' THEN '["app_admin"]'::jsonb
--   ELSE purchase_role
-- END;