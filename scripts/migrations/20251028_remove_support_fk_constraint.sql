-- 20251028_remove_support_fk_constraint.sql
-- support_inquires 테이블의 purchase_request_id 외래 키 제약 조건 제거

-- 1. 기존 외래 키 제약 조건 제거
ALTER TABLE support_inquires DROP CONSTRAINT IF EXISTS support_inquires_purchase_request_id_fkey;

-- 2. purchase_request_id 컬럼을 nullable로 변경 (이미 nullable일 수도 있지만 확실히 하기 위해)
ALTER TABLE support_inquires ALTER COLUMN purchase_request_id DROP NOT NULL;

-- 3. purchase_info 컬럼 추가 (텍스트 기반 발주 정보 저장용)
ALTER TABLE support_inquires ADD COLUMN IF NOT EXISTS purchase_info TEXT;

-- 4. 기존 데이터에서 purchase_request_id가 있는 경우 NULL로 설정
UPDATE support_inquires SET purchase_request_id = NULL WHERE purchase_request_id IS NOT NULL;

-- 5. 인덱스가 있다면 제거 (성능상 필요 없어짐)
DROP INDEX IF EXISTS idx_support_inquires_purchase_request_id;

-- 완료 메시지
SELECT 'support_inquires 테이블의 외래 키 제약 조건이 성공적으로 제거되었습니다.' as message;