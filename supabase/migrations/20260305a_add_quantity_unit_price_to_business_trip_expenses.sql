BEGIN;

ALTER TABLE business_trip_expenses
  ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL DEFAULT 1;

ALTER TABLE business_trip_expenses
  ADD COLUMN IF NOT EXISTS unit_price numeric;

COMMENT ON COLUMN business_trip_expenses.quantity IS '수량';
COMMENT ON COLUMN business_trip_expenses.unit_price IS '단가 (NULL 가능)';

COMMIT;
