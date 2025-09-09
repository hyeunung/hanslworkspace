-- support_inquiries 테이블 업데이트
-- 수정/삭제 요청 시 발주요청 연결을 위한 컬럼 추가

-- 1. purchase_request_id 컬럼 추가 (수정/삭제 요청용)
ALTER TABLE public.support_inquiries 
ADD COLUMN IF NOT EXISTS purchase_request_id UUID REFERENCES purchase_requests(id);

-- 2. purchase_order_number 컬럼 추가 (발주번호 표시용)
ALTER TABLE public.support_inquiries 
ADD COLUMN IF NOT EXISTS purchase_order_number TEXT;

-- 3. processed_at 컬럼 추가 (처리 완료 시간)
ALTER TABLE public.support_inquiries 
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;

-- 4. requester_id 추가 (employees 테이블과 연결)
ALTER TABLE public.support_inquiries 
ADD COLUMN IF NOT EXISTS requester_id UUID REFERENCES employees(id);

-- 5. 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_support_inquiries_user_id ON public.support_inquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_support_inquiries_status ON public.support_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_support_inquiries_created_at ON public.support_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_inquiries_purchase_request_id ON public.support_inquiries(purchase_request_id);

-- 6. RLS 정책 설정
ALTER TABLE public.support_inquiries ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 (있을 경우)
DROP POLICY IF EXISTS "Users can view their own inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can view all inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "Users can create inquiries" ON public.support_inquiries;
DROP POLICY IF EXISTS "App admins can update all inquiries" ON public.support_inquiries;

-- 7. 본인 문의 조회 정책
CREATE POLICY "Users can view their own inquiries" ON public.support_inquiries
FOR SELECT USING (auth.uid() = user_id);

-- 8. app_admin은 모든 문의 조회
CREATE POLICY "App admins can view all inquiries" ON public.support_inquiries
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE id = auth.uid() 
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- 9. 모든 로그인 사용자는 문의 생성 가능
CREATE POLICY "Users can create inquiries" ON public.support_inquiries
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 10. app_admin은 모든 문의 수정 가능 (상태 변경 등)
CREATE POLICY "App admins can update all inquiries" ON public.support_inquiries
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees 
    WHERE id = auth.uid() 
    AND ('app_admin' = ANY(string_to_array(purchase_role, ','))
         OR purchase_role::text[] @> ARRAY['app_admin'])
  )
);

-- 11. 실시간 구독을 위한 publication 설정
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_inquiries;