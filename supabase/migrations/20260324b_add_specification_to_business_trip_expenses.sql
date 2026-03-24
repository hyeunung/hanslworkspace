BEGIN;

ALTER TABLE business_trip_expenses
  ADD COLUMN IF NOT EXISTS specification text;

COMMENT ON COLUMN business_trip_expenses.specification IS '규격';

COMMIT;
