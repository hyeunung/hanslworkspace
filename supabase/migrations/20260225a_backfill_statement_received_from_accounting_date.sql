-- Backfill statement-received flags from existing accounting received dates.
-- This keeps historical data consistent for PurchaseDetailModal "거래명세서 확인".

UPDATE purchase_request_items
SET
  is_statement_received = true,
  statement_received_date = COALESCE(statement_received_date, accounting_received_date::date)
WHERE accounting_received_date IS NOT NULL
  AND (
    is_statement_received IS DISTINCT FROM true
    OR statement_received_date IS NULL
  );

-- Recalculate purchase-level statement received status from item-level flags.
WITH item_rollup AS (
  SELECT
    purchase_request_id,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE is_statement_received = true) AS done_count
  FROM purchase_request_items
  WHERE purchase_request_id IS NOT NULL
  GROUP BY purchase_request_id
)
UPDATE purchase_requests pr
SET
  is_statement_received = (r.total_count > 0 AND r.total_count = r.done_count)
FROM item_rollup r
WHERE pr.id = r.purchase_request_id
  AND pr.is_statement_received IS DISTINCT FROM (r.total_count > 0 AND r.total_count = r.done_count);
