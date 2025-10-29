-- purchase_receipts 테이블의 UPDATE 권한에 lead buyer 추가
-- 인쇄 완료 기능을 위해 필요

-- 1. 기존 UPDATE 정책 삭제
DROP POLICY IF EXISTS "Users can update their own receipts" ON public.purchase_receipts;

-- 2. app_admin과 lead buyer가 모두 수정 가능한 새 정책 생성
CREATE POLICY "Users can update their own receipts" ON public.purchase_receipts
FOR UPDATE USING (
  (auth.email() = uploaded_by) 
  OR 
  (EXISTS (
    SELECT 1 
    FROM employees 
    WHERE employees.email = auth.email() 
    AND (
      'app_admin' = ANY (employees.purchase_role) 
      OR 'lead buyer' = ANY (employees.purchase_role)
      OR 'raw_material_manager' = ANY (employees.purchase_role)
      OR 'consumable_manager' = ANY (employees.purchase_role)
      OR 'purchase_manager' = ANY (employees.purchase_role)
    )
  ))
);

-- 3. 정책 확인
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'purchase_receipts'
AND cmd = 'UPDATE';
