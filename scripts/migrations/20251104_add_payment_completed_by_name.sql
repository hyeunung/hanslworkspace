-- 구매완료 처리자 이름 칼럼 추가
ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS payment_completed_by_name TEXT;

-- 칼럼 설명
COMMENT ON COLUMN purchase_request_items.payment_completed_by_name IS '구매완료 처리한 직원 이름';

