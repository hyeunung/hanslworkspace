-- vendor_contacts 테이블에 position 필드 복구
-- 발주 시스템에서 여전히 사용되고 있어 복구 필요

ALTER TABLE vendor_contacts 
ADD COLUMN IF NOT EXISTS position TEXT;