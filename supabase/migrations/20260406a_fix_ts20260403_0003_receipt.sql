-- TS-20260403-0003 데이터 복구
-- 원인: actual_received_date 유실로 수량일치 확인 시 입고 처리가 스킵됨
-- 조치: 18개 품목의 received_quantity 반영 + extracted_data에 actual_received_date 복구 + all_quantities_matched 복구

-- 1) extracted_data에 actual_received_date 복구 (statement_date 기���)
UPDATE transaction_statements
SET
  extracted_data = jsonb_set(
    COALESCE(extracted_data, '{}'::jsonb),
    '{actual_received_date}',
    '"2026-04-02T00:00:00.000Z"'::jsonb
  ),
  all_quantities_matched = true
WHERE id = '43b9f4be-21da-4f16-986d-72740ee37b42';

-- 2) 18개 미입고 품목의 received_quantity 반영 (confirmed_quantity 기준)
-- gold plated terminals (id=11732)는 이미 입고 처리되어 있으므로 제외
WITH stmt_items AS (
  SELECT matched_item_id, confirmed_quantity::numeric AS qty
  FROM transaction_statement_items
  WHERE statement_id = '43b9f4be-21da-4f16-986d-72740ee37b42'
    AND matched_item_id IS NOT NULL
    AND confirmed_quantity IS NOT NULL
)
UPDATE purchase_request_items pri
SET
  received_quantity = COALESCE(pri.received_quantity, 0) + si.qty,
  is_received = (COALESCE(pri.received_quantity, 0) + si.qty) >= pri.quantity,
  delivery_status = CASE
    WHEN (COALESCE(pri.received_quantity, 0) + si.qty) >= pri.quantity THEN 'received'
    WHEN (COALESCE(pri.received_quantity, 0) + si.qty) > 0 THEN 'partial'
    ELSE 'pending'
  END,
  actual_received_date = '2026-04-02T00:00:00.000Z',
  received_at = NOW(),
  receipt_history = COALESCE(pri.receipt_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'seq', COALESCE(jsonb_array_length(COALESCE(pri.receipt_history, '[]'::jsonb)), 0) + 1,
      'qty', si.qty,
      'date', '2026-04-02T00:00:00.000Z',
      'by', '정유진'
    )
  )
FROM stmt_items si
WHERE pri.id = si.matched_item_id
  AND pri.received_quantity IS NULL;

-- 3) 발주서 헤더 is_received 동기화
UPDATE purchase_requests pr
SET
  is_received = true,
  received_at = NOW()
WHERE pr.id IN (
  SELECT DISTINCT tsi.matched_purchase_id
  FROM transaction_statement_items tsi
  WHERE tsi.statement_id = '43b9f4be-21da-4f16-986d-72740ee37b42'
    AND tsi.matched_purchase_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM purchase_request_items pri
  WHERE pri.purchase_request_id = pr.id
    AND (pri.is_received IS NULL OR pri.is_received = false)
);
