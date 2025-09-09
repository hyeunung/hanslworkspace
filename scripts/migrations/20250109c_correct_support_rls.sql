-- support_inquiries 테이블 RLS 정책 (올바른 버전)
-- app_admin 권한을 가진 사용자만 수정/삭제 가능

-- 1. support_inquiries 테이블 정책
-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Anyone can view inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Anyone can create inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Anyone can update inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Users can view their own inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can view all inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Users can create inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can update all inquiries" ON public.support_inquiries;

-- 본인 문의는 누구나 조회 가능
CREATE POLICY "Users can view own inquiries" ON public.support_inquiries
FOR SELECT USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (purchase_role LIKE '%app_admin%')
  )
);

-- 모든 인증된 사용자가 문의 생성 가능
CREATE POLICY "Users can create inquiries" ON public.support_inquiries
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- app_admin만 문의 수정 가능
CREATE POLICY "Admins can update inquiries" ON public.support_inquiries
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (purchase_role LIKE '%app_admin%')
  )
);

-- 2. purchase_request_items 테이블 정책
-- 기존 정책 삭제
DROP POLICY IF EXISTS "Anyone can view items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "Anyone can update items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "Anyone can delete items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can view items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can update items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can delete items" ON public.purchase_request_items;

-- 모든 인증된 사용자가 품목 조회 가능
CREATE POLICY "Users can view items" ON public.purchase_request_items
FOR SELECT USING (auth.role() = 'authenticated');

-- app_admin만 품목 수정 가능
CREATE POLICY "Admins can update items" ON public.purchase_request_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (purchase_role LIKE '%app_admin%')
  )
);

-- app_admin만 품목 삭제 가능
CREATE POLICY "Admins can delete items" ON public.purchase_request_items
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (purchase_role LIKE '%app_admin%')
  )
);

-- 3. purchase_requests 테이블 정책
-- 기존 정책 삭제
DROP POLICY IF EXISTS "Anyone can view requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Anyone can delete requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "App admins can view requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "App admins can delete requests" ON public.purchase_requests;

-- 모든 인증된 사용자가 발주요청 조회 가능
CREATE POLICY "Users can view requests" ON public.purchase_requests
FOR SELECT USING (auth.role() = 'authenticated');

-- app_admin만 발주요청 삭제 가능
CREATE POLICY "Admins can delete requests" ON public.purchase_requests
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE email = auth.jwt() ->> 'email'
    AND (purchase_role LIKE '%app_admin%')
  )
);