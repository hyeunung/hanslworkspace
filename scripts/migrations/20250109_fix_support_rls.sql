-- support_inquiries RLS 정책 수정
-- employees 테이블 조회 시 email 기반으로 변경

-- 기존 정책 삭제
DROP POLICY IF EXISTS "App admins can view all inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can update all inquiries" ON public.support_inquiries;

-- 수정된 정책 생성
-- app_admin은 모든 문의 조회
CREATE POLICY "App admins can view all inquiries" ON public.support_inquiries
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- app_admin은 모든 문의 수정 가능 (상태 변경 등)
CREATE POLICY "App admins can update all inquiries" ON public.support_inquiries
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- purchase_request_items 테이블 RLS 정책 추가
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "App admins can update items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can delete items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can view items" ON public.purchase_request_items;

-- app_admin은 품목 조회 가능
CREATE POLICY "App admins can view items" ON public.purchase_request_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- app_admin은 품목 수정 가능
CREATE POLICY "App admins can update items" ON public.purchase_request_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- app_admin은 품목 삭제 가능
CREATE POLICY "App admins can delete items" ON public.purchase_request_items
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- purchase_requests 테이블 RLS 정책 추가
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "App admins can delete requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "App admins can view requests" ON public.purchase_requests;

-- app_admin은 발주요청 조회 가능
CREATE POLICY "App admins can view requests" ON public.purchase_requests
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- app_admin은 발주요청 삭제 가능
CREATE POLICY "App admins can delete requests" ON public.purchase_requests
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);