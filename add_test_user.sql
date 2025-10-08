-- 테스트 사용자 추가 (필요시 사용)
-- 이메일과 비밀번호는 Supabase Auth에서 별도로 생성해야 함

-- employees 테이블에 사용자 추가
INSERT INTO employees (
  name,
  email,
  employee_number,
  purchase_role,
  created_at
) VALUES (
  '테스트사용자',
  'test@hansl.com',  -- Supabase Auth에 등록한 이메일과 동일해야 함
  'TEST001',
  'middle_manager,lead buyer',  -- 필요한 역할 설정
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  purchase_role = EXCLUDED.purchase_role;

-- 확인
SELECT name, email, purchase_role 
FROM employees 
WHERE email = 'test@hansl.com';