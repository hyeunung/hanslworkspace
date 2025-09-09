-- employees 테이블 RLS 정책 확인 및 수정

-- 1. 먼저 현재 사용자가 employees 테이블에 있는지 확인
-- (Supabase SQL Editor에서 실행)

-- 2. RLS 비활성화 (테스트용 - 주의!)
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- 또는 더 안전하게: 모든 인증된 사용자가 자신의 정보를 볼 수 있도록
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "Users can view own employee record" ON employees;
DROP POLICY IF EXISTS "Users can view all employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can view employees" ON employees;

-- 새로운 정책 생성: 모든 인증된 사용자가 employees 조회 가능
CREATE POLICY "Authenticated users can view employees" ON employees
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- 자신의 정보는 수정 가능
CREATE POLICY "Users can update own record" ON employees
    FOR UPDATE
    USING (auth.uid() = id);

-- HR/Admin은 모든 직원 정보 수정 가능
CREATE POLICY "HR and Admin can update all employees" ON employees
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM employees 
            WHERE id = auth.uid() 
            AND (role = 'hr' OR role = 'admin')
        )
    );

-- INSERT 정책 (필요한 경우)
CREATE POLICY "HR and Admin can insert employees" ON employees
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM employees 
            WHERE id = auth.uid() 
            AND (role = 'hr' OR role = 'admin')
        )
    );

-- DELETE 정책 (필요한 경우)
CREATE POLICY "HR and Admin can delete employees" ON employees
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM employees 
            WHERE id = auth.uid() 
            AND (role = 'hr' OR role = 'admin')
        )
    );