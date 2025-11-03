-- 실제 입고 처리 관련 컬럼 추가
-- 기존 is_received, received_at은 발주 요청시 예상 입고일이므로 건드리지 않음
-- actual_received_date가 null이면 아직 실제 입고 안됨, 날짜가 있으면 실제 입고 완료

ALTER TABLE purchase_request_items  
ADD COLUMN IF NOT EXISTS actual_received_date TIMESTAMP WITH TIME ZONE;

-- 실제 입고 날짜 조회를 위한 인덱스 추가  
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_actual_received_date
ON purchase_request_items(actual_received_date);