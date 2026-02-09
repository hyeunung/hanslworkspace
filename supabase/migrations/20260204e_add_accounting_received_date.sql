-- 회계상 입고일 컬럼 추가
ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS accounting_received_date TIMESTAMP WITH TIME ZONE;

-- 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_accounting_received_date
ON purchase_request_items(accounting_received_date);
