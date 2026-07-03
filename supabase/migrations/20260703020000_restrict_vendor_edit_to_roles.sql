-- 업체관리(vendors / vendor_contacts) 수정 권한을 특정 역할로 제한한다.
-- 허용 역할: superadmin, hr, lead buyer
-- 조회(SELECT)는 기존과 동일하게 로그인 사용자 전체 허용, 쓰기(INSERT/UPDATE/DELETE)만 제한한다.
--
-- 참고: DB의 employees.roles 컬럼은 text[] 배열이며, 현재 로그인 사용자는 auth.email()로 매칭한다.
-- (기존 support/system_activity_logs RLS 선례와 동일한 패턴)

-- 1) 수정 권한 판별 헬퍼 함수
--    SECURITY DEFINER로 employees 테이블 RLS를 우회하여 안전하게 역할을 확인한다.
CREATE OR REPLACE FUNCTION public.can_edit_vendors()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.email = auth.email()
      AND (COALESCE(e.roles, ARRAY[]::text[]) && ARRAY['superadmin', 'hr', 'lead buyer']::text[])
  );
$$;

-- 2) vendors 쓰기 정책 교체 -------------------------------------------------
-- 기존 무제한 쓰기 정책 제거 (라이브 명칭 + 과거 마이그레이션 명칭 모두 대응)
DROP POLICY IF EXISTS webapp_can_insert_vendors ON public.vendors;
DROP POLICY IF EXISTS webapp_can_update_vendors ON public.vendors;
DROP POLICY IF EXISTS webapp_can_delete_vendors ON public.vendors;
DROP POLICY IF EXISTS vendors_insert_policy ON public.vendors;
DROP POLICY IF EXISTS vendors_update_policy ON public.vendors;
DROP POLICY IF EXISTS vendors_delete_policy ON public.vendors;

CREATE POLICY webapp_can_insert_vendors ON public.vendors
  FOR INSERT
  WITH CHECK (public.can_edit_vendors());

CREATE POLICY webapp_can_update_vendors ON public.vendors
  FOR UPDATE
  USING (public.can_edit_vendors())
  WITH CHECK (public.can_edit_vendors());

CREATE POLICY webapp_can_delete_vendors ON public.vendors
  FOR DELETE
  USING (public.can_edit_vendors());

-- 3) vendor_contacts 쓰기 정책 교체 ----------------------------------------
DROP POLICY IF EXISTS webapp_can_insert_vendor_contacts ON public.vendor_contacts;
DROP POLICY IF EXISTS webapp_can_update_vendor_contacts ON public.vendor_contacts;
DROP POLICY IF EXISTS webapp_can_delete_vendor_contacts ON public.vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_insert_policy ON public.vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_update_policy ON public.vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_delete_policy ON public.vendor_contacts;

CREATE POLICY webapp_can_insert_vendor_contacts ON public.vendor_contacts
  FOR INSERT
  WITH CHECK (public.can_edit_vendors());

CREATE POLICY webapp_can_update_vendor_contacts ON public.vendor_contacts
  FOR UPDATE
  USING (public.can_edit_vendors())
  WITH CHECK (public.can_edit_vendors());

CREATE POLICY webapp_can_delete_vendor_contacts ON public.vendor_contacts
  FOR DELETE
  USING (public.can_edit_vendors());
