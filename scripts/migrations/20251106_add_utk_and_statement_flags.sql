-- Add UTK confirmation flag on purchase request items and requests
ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS is_utk_checked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS is_utk_checked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_statement_received BOOLEAN NOT NULL DEFAULT false;

-- Backfill request level flags based on item data
UPDATE public.purchase_requests pr
SET is_utk_checked = COALESCE(
  (
    SELECT bool_and(COALESCE(pri.is_utk_checked, false))
    FROM public.purchase_request_items pri
    WHERE pri.purchase_request_id = pr.id
  ),
  false
);

UPDATE public.purchase_requests pr
SET is_statement_received = COALESCE(
  (
    SELECT bool_and(COALESCE(pri.is_statement_received, false))
    FROM public.purchase_request_items pri
    WHERE pri.purchase_request_id = pr.id
  ),
  false
);
