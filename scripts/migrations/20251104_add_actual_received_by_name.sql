-- 실제 입고 처리자명 컬럼 추가
-- actual_received_date와 함께 실제 입고 처리를 추적하기 위한 필드

ALTER TABLE purchase_request_items  
ADD COLUMN IF NOT EXISTS actual_received_by_name TEXT;

-- 실제 입고 처리자 조회를 위한 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_actual_received_by_name
ON purchase_request_items(actual_received_by_name);

-- 기존 actual_received_date가 있는 데이터에 대해 default 값 설정 (선택사항)
-- UPDATE purchase_request_items 
-- SET actual_received_by_name = '시스템'
-- WHERE actual_received_date IS NOT NULL AND actual_received_by_name IS NULL;