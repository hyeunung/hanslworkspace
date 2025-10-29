-- purchase_request_items 테이블의 UPDATE 권한에 lead buyer 추가
-- 인쇄 완료 기능을 위해 필요

-- 1. 기존 UPDATE 정책 삭제
DROP POLICY IF EXISTS "Admins can update items" ON public.purchase_request_items;

-- 2. app_admin과 lead buyer가 모두 수정 가능한 새 정책 생성
CREATE POLICY "Admins and lead buyers can update items" ON public.purchase_request_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (
      -- app_admin
      purchase_role LIKE '%app_admin%'
      -- lead buyer 관련 권한들
      OR purchase_role LIKE '%lead buyer%'
      OR purchase_role LIKE '%raw_material_manager%'
      OR purchase_role LIKE '%consumable_manager%'
      OR purchase_role LIKE '%purchase_manager%'
    )
  )
);

-- 3. 본인이 업로드한 영수증은 본인도 수정 가능 (선택사항)
-- uploaded_by 필드가 있다면 활성화
-- CREATE POLICY "Users can update own uploaded items" ON public.purchase_request_items
-- FOR UPDATE USING (
--   auth.role() = 'authenticated'
--   AND uploaded_by = auth.uid()
-- );

-- 4. 정책 확인
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'purchase_request_items'
AND cmd = 'UPDATE';
