-- purchase_requests 테이블에 UPDATE 정책 추가
-- 승인 권한이 있는 사용자들이 발주요청을 업데이트할 수 있도록 함

-- 기존 UPDATE 정책이 있다면 삭제
DROP POLICY IF EXISTS "Authorized users can update requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Users can update requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Approvers can update requests" ON public.purchase_requests;

-- 승인 권한이 있는 사용자들이 발주요청을 업데이트할 수 있도록 하는 정책
CREATE POLICY "Approvers can update requests" ON public.purchase_requests
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (
      -- app_admin은 모든 업데이트 가능
      purchase_role LIKE '%app_admin%'
      -- middle_manager는 중간 승인 가능
      OR purchase_role LIKE '%middle_manager%'
      -- final_approver와 ceo는 최종 승인 가능
      OR purchase_role LIKE '%final_approver%'
      OR purchase_role LIKE '%ceo%'
      -- lead_buyer는 구매 상태 업데이트 가능
      OR purchase_role LIKE '%lead_buyer%'
    )
  )
);

-- 모든 인증된 사용자가 자신이 요청한 발주요청의 일부 필드를 업데이트할 수 있도록 하는 정책
-- (예: 입고 확인, 메모 추가 등)
CREATE POLICY "Users can update own requests" ON public.purchase_requests
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND requester_email = auth.jwt() ->> 'email'
)
WITH CHECK (
  -- 승인 상태 필드는 변경할 수 없음
  (OLD.middle_manager_status IS NOT DISTINCT FROM NEW.middle_manager_status)
  AND (OLD.final_manager_status IS NOT DISTINCT FROM NEW.final_manager_status)
  AND (OLD.purchase_status IS NOT DISTINCT FROM NEW.purchase_status)
);

-- 정책이 제대로 적용되었는지 확인
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'purchase_requests'
ORDER BY policyname;
