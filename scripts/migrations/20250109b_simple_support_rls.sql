-- support_inquiries 테이블 RLS 간소화 (테스트용)
-- 모든 인증된 사용자가 조회/수정 가능하도록 임시 설정

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Users can view their own inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can view all inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Users can create inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can update all inquiries" ON public.support_inquiries;

-- 간단한 정책으로 교체 (테스트용)
-- 모든 인증된 사용자가 모든 문의 조회 가능
CREATE POLICY "Anyone can view inquiries" ON public.support_inquiries
FOR SELECT USING (auth.role() = 'authenticated');

-- 모든 인증된 사용자가 문의 생성 가능
CREATE POLICY "Anyone can create inquiries" ON public.support_inquiries
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 모든 인증된 사용자가 문의 수정 가능 (테스트용)
CREATE POLICY "Anyone can update inquiries" ON public.support_inquiries
FOR UPDATE USING (auth.role() = 'authenticated');

-- purchase_request_items 테이블도 같은 방식으로
DROP POLICY IF EXISTS "App admins can view items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can update items" ON public.purchase_request_items;
DROP POLICY IF EXISTS "App admins can delete items" ON public.purchase_request_items;

CREATE POLICY "Anyone can view items" ON public.purchase_request_items
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone can update items" ON public.purchase_request_items
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone can delete items" ON public.purchase_request_items
FOR DELETE USING (auth.role() = 'authenticated');

-- purchase_requests 테이블도 같은 방식으로
DROP POLICY IF EXISTS "App admins can view requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "App admins can delete requests" ON public.purchase_requests;

CREATE POLICY "Anyone can view requests" ON public.purchase_requests
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone can delete requests" ON public.purchase_requests
FOR DELETE USING (auth.role() = 'authenticated');