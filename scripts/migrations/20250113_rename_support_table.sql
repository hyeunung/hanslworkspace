-- support_inquiries를 support_inquires로 테이블명 변경
-- 코드와 데이터베이스 테이블명 불일치 문제 해결

-- 1. 테이블명 변경
ALTER TABLE IF EXISTS public.support_inquiries RENAME TO support_inquires;

-- 2. 시퀀스명도 함께 변경 (id 자동증가 시퀀스)
ALTER SEQUENCE IF EXISTS support_inquiries_id_seq RENAME TO support_inquires_id_seq;

-- 3. 트리거도 이름 변경
DROP TRIGGER IF EXISTS trg_support_inquiries_updated_at ON public.support_inquires;
CREATE TRIGGER trg_support_inquires_updated_at
BEFORE UPDATE ON public.support_inquires
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. 인덱스 이름 변경
ALTER INDEX IF EXISTS idx_support_inquiries_user_id RENAME TO idx_support_inquires_user_id;
ALTER INDEX IF EXISTS idx_support_inquiries_status RENAME TO idx_support_inquires_status;
ALTER INDEX IF EXISTS idx_support_inquiries_created_at RENAME TO idx_support_inquires_created_at;
ALTER INDEX IF EXISTS idx_support_inquiries_purchase_request_id RENAME TO idx_support_inquires_purchase_request_id;

-- 5. RLS 정책 재생성 (이름 변경은 안되므로 삭제 후 재생성)
-- 기존 정책 삭제
DROP POLICY IF EXISTS support_inquiries_insert ON public.support_inquires;
DROP POLICY IF EXISTS support_inquiries_select ON public.support_inquires;
DROP POLICY IF EXISTS support_inquiries_update ON public.support_inquires;
DROP POLICY IF EXISTS "Users can view their own inquiries" ON public.support_inquires;
DROP POLICY IF EXISTS "App admins can view all inquiries" ON public.support_inquires;
DROP POLICY IF EXISTS "Users can create inquiries" ON public.support_inquires;
DROP POLICY IF EXISTS "App admins can update all inquiries" ON public.support_inquires;

-- 새로운 정책 생성
CREATE POLICY "support_inquires_insert" ON public.support_inquires
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "support_inquires_select_own" ON public.support_inquires
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "support_inquires_select_admin" ON public.support_inquires
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = auth.jwt()->>'email'
    AND (
      purchase_role::text LIKE '%app_admin%' 
      OR purchase_role::jsonb @> '"app_admin"'::jsonb
    )
  )
);

CREATE POLICY "support_inquires_update_admin" ON public.support_inquires
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = auth.jwt()->>'email'
    AND (
      purchase_role::text LIKE '%app_admin%' 
      OR purchase_role::jsonb @> '"app_admin"'::jsonb
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = auth.jwt()->>'email'
    AND (
      purchase_role::text LIKE '%app_admin%' 
      OR purchase_role::jsonb @> '"app_admin"'::jsonb
    )
  )
);

-- 6. 실시간 구독도 업데이트
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.support_inquiries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_inquires;

-- 7. 테이블 구조 확인 (문의 유형 constraint 확인)
-- inquiry_type은 ('bug','modify','delete','other') 중 하나여야 함
-- 이미 올바르게 설정되어 있음

-- 확인 쿼리 (참고용, 실행 안됨)
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'support_inquires';