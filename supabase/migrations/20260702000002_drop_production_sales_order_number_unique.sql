-- Drop unique constraint on sales_order_number for production_pcbs and production_cables
-- Since multiple items (boards/cables) can be manufactured under the same order/quote number.

ALTER TABLE public.production_pcbs DROP CONSTRAINT IF EXISTS production_pcbs_sales_order_number_key;
ALTER TABLE public.production_cables DROP CONSTRAINT IF EXISTS production_cables_sales_order_number_key;
