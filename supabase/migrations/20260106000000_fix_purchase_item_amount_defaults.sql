-- Ensure purchase_request_items numeric fields are never NULL
-- This is a defensive migration so that UI bugs/edge cases can't cause save failures.

-- 1) Backfill existing NULLs to 0
UPDATE purchase_request_items
SET unit_price_value = 0
WHERE unit_price_value IS NULL;

UPDATE purchase_request_items
SET amount_value = 0
WHERE amount_value IS NULL;

-- 2) Set defaults to 0 for future inserts
ALTER TABLE purchase_request_items
  ALTER COLUMN unit_price_value SET DEFAULT 0;

ALTER TABLE purchase_request_items
  ALTER COLUMN amount_value SET DEFAULT 0;

-- 3) Enforce NOT NULL (after backfill)
ALTER TABLE purchase_request_items
  ALTER COLUMN unit_price_value SET NOT NULL;

ALTER TABLE purchase_request_items
  ALTER COLUMN amount_value SET NOT NULL;


