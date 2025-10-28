ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received
ON purchase_request_items(is_received);















