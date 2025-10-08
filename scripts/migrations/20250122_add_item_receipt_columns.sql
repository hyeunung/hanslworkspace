-- 품목별 입고 관리를 위한 최소 컬럼 추가
-- purchase_request_items 테이블에 입고 관련 컬럼 추가

-- 1. is_received: 개별 품목 입고 완료 여부
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;

-- 2. received_at: 입고 일시
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

-- 인덱스 추가 (성능 향상)
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received 
ON purchase_request_items(is_received);

-- 코멘트 추가
COMMENT ON COLUMN purchase_request_items.is_received IS '품목 입고 완료 여부';
COMMENT ON COLUMN purchase_request_items.received_at IS '입고 처리 일시';