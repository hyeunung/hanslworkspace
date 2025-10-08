-- Add columns for item-level receipt tracking
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;

ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received 
ON purchase_request_items(is_received);

-- Add comments
COMMENT ON COLUMN purchase_request_items.is_received IS '품목 입고 완료 여부';
COMMENT ON COLUMN purchase_request_items.received_at IS '입고 처리 일시';