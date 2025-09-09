-- 모든 직원의 purchase_role 확인
SELECT id, name, email, purchase_role, role, is_active 
FROM employees 
WHERE email IS NOT NULL;

-- 특정 이메일로 사용자 찾아서 권한 부여 (이메일을 실제 이메일로 변경)
UPDATE employees 
SET purchase_role = 'app_admin' 
WHERE email = 'your-email@example.com';

-- 또는 모든 활성 사용자에게 기본 권한 부여 (테스트용)
UPDATE employees 
SET purchase_role = 'middle_manager' 
WHERE is_active = true AND purchase_role IS NULL;

-- 권한 확인
SELECT name, email, purchase_role 
FROM employees 
WHERE purchase_role IS NOT NULL;