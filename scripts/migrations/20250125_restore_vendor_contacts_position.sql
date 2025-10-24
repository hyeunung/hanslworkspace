-- vendor_contacts 테이블에 position 필드 복구
-- 발주 요청 시스템에서 업체 담당자의 직책 정보가 필요함

ALTER TABLE vendor_contacts
ADD COLUMN IF NOT EXISTS position TEXT;

-- 기존 데이터가 있다면 기본값 설정
UPDATE vendor_contacts
SET position = ''
WHERE position IS NULL;

COMMENT ON COLUMN vendor_contacts.position IS '담당자 직책';

-- vendor_contacts_with_vendor_name 뷰 재생성 (position 필드 포함)
DROP VIEW IF EXISTS vendor_contacts_with_vendor_name;

CREATE VIEW vendor_contacts_with_vendor_name AS
SELECT 
    vc.id,
    vc.vendor_id,
    vc.contact_name,
    vc.contact_email,
    vc.contact_phone,
    vc.position,
    vc.created_at,
    vc.updated_at,
    v.vendor_name
FROM vendor_contacts vc
LEFT JOIN vendors v ON vc.vendor_id = v.id;