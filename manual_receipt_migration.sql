-- 품목별 입고 관리를 위한 최소 컬럼 추가
-- Execute this SQL in Supabase Dashboard > SQL Editor

-- 1. Add is_received column (boolean flag for received status)
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;

-- 2. Add received_at column (timestamp for when item was received)
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

-- 3. Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received 
ON purchase_request_items(is_received);

-- 4. Add comments for documentation
COMMENT ON COLUMN purchase_request_items.is_received IS '품목 입고 완료 여부';
COMMENT ON COLUMN purchase_request_items.received_at IS '입고 처리 일시';

-- 5. Verify the columns were added successfully
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'purchase_request_items' 
AND column_name IN ('is_received', 'received_at')
ORDER BY column_name;