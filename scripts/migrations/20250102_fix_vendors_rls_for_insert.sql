-- 업체 테이블 RLS 정책 수정: 모든 직원이 업체 등록 가능하도록 설정
-- 2025-01-02 생성

-- 기존 정책 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;

-- 새로운 정책 생성: 모든 인증된 사용자가 조회 및 등록 가능
CREATE POLICY vendors_select_policy ON vendors
    FOR SELECT
    USING (true);  -- 모든 인증된 사용자가 조회 가능

CREATE POLICY vendors_insert_policy ON vendors
    FOR INSERT
    WITH CHECK (true);  -- 모든 인증된 사용자가 등록 가능

CREATE POLICY vendors_update_policy ON vendors
    FOR UPDATE
    USING (true)
    WITH CHECK (true);  -- 모든 인증된 사용자가 수정 가능

CREATE POLICY vendors_delete_policy ON vendors
    FOR DELETE
    USING (true);  -- 모든 인증된 사용자가 삭제 가능 (soft delete 로직은 앱에서 처리)

-- vendor_contacts 테이블도 동일하게 처리
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts;

CREATE POLICY vendor_contacts_select_policy ON vendor_contacts
    FOR SELECT
    USING (true);

CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY vendor_contacts_update_policy ON vendor_contacts
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts
    FOR DELETE
    USING (true);

-- 정책 적용 확인
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename IN ('vendors', 'vendor_contacts')
ORDER BY tablename, policyname;