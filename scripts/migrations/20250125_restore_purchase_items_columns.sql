-- purchase_request_items 테이블에 트리거에서 필요한 컬럼들 복구
-- propagate_request_info_change 트리거 함수가 이 컬럼들을 업데이트함

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS vendor_name TEXT,
ADD COLUMN IF NOT EXISTS purchase_order_number TEXT,
ADD COLUMN IF NOT EXISTS requester_name TEXT;

-- 기존 데이터 동기화 (purchase_requests 테이블에서 가져오기)
UPDATE purchase_request_items i
SET 
    vendor_name = (SELECT v.vendor_name FROM vendors v JOIN purchase_requests pr ON v.id = pr.vendor_id WHERE pr.id = i.purchase_request_id),
    purchase_order_number = (SELECT purchase_order_number FROM purchase_requests WHERE id = i.purchase_request_id),
    requester_name = (SELECT requester_name FROM purchase_requests WHERE id = i.purchase_request_id)
WHERE vendor_name IS NULL OR purchase_order_number IS NULL OR requester_name IS NULL;

COMMENT ON COLUMN purchase_request_items.vendor_name IS '업체명 (purchase_requests와 동기화됨, 트리거에서 필요)';
COMMENT ON COLUMN purchase_request_items.purchase_order_number IS '발주요청번호 (purchase_requests와 동기화됨, 트리거에서 필요)';
COMMENT ON COLUMN purchase_request_items.requester_name IS '요청자명 (purchase_requests와 동기화됨, 트리거에서 필요)';
