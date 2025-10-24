-- Add missing delivery columns to purchase_request_items table
ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS delivery_status VARCHAR DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'partial', 'received'));

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS received_quantity INTEGER;

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS received_by UUID;

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS received_by_name TEXT;

ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- Add foreign key constraint for received_by
ALTER TABLE purchase_request_items
ADD CONSTRAINT purchase_request_items_received_by_fkey 
FOREIGN KEY (received_by) REFERENCES employees(id) ON DELETE SET NULL;

-- Add index for delivery_status
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_delivery_status 
ON purchase_request_items(delivery_status);

-- Comment on new columns
COMMENT ON COLUMN purchase_request_items.delivery_status IS 'Delivery status: pending, partial, or received';
COMMENT ON COLUMN purchase_request_items.received_quantity IS 'Actual quantity received';
COMMENT ON COLUMN purchase_request_items.received_by IS 'Employee who received the items';
COMMENT ON COLUMN purchase_request_items.received_by_name IS 'Name of employee who received the items';
COMMENT ON COLUMN purchase_request_items.delivery_notes IS 'Notes about the delivery';
