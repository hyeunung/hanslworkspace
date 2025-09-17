-- employees 테이블에서 해당 이메일 확인
SELECT * FROM employees 
WHERE LOWER(email) = LOWER('hyun-woong.jeong@hansil.com');

-- 전체 직원 이메일 목록 확인
SELECT id, name, email, purchase_role 
FROM employees 
ORDER BY email;

-- 이메일 패턴으로 검색
SELECT * FROM employees 
WHERE email LIKE '%hyun-woong%' OR email LIKE '%jeong%';
