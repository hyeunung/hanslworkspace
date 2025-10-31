-- Add payment completion columns to purchase_request_items table
ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS is_payment_completed BOOLEAN DEFAULT FALSE;

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS payment_completed_at TIMESTAMP WITH TIME ZONE;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_payment_completed
ON purchase_request_items(is_payment_completed);

-- Comment for documentation
COMMENT ON COLUMN purchase_request_items.is_payment_completed IS '품목별 구매완료 상태';
COMMENT ON COLUMN purchase_request_items.payment_completed_at IS '품목별 구매완료 처리 시간';