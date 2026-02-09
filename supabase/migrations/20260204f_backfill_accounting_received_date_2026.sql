-- 2026년 회계상 입고일 백필: 기존 실제입고일 값을 회계상 입고일로 복사
UPDATE purchase_request_items
SET accounting_received_date = actual_received_date
WHERE accounting_received_date IS NULL
  AND actual_received_date IS NOT NULL
  AND actual_received_date >= '2026-01-01'
  AND actual_received_date < '2027-01-01';
