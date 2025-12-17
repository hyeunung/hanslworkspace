-- 입고일 수정 요청 완료 여부 필드 추가
-- 담당자가 업체에 입고일 변경 요청을 했는지 추적

ALTER TABLE purchase_requests
ADD COLUMN IF NOT EXISTS delivery_revision_requested BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS delivery_revision_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivery_revision_requested_by TEXT;

-- 인덱스 추가 (수정 요청이 필요한 항목 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_purchase_requests_delivery_revision 
ON purchase_requests (delivery_revision_requested, delivery_request_date, revised_delivery_request_date)
WHERE is_received = FALSE;

COMMENT ON COLUMN purchase_requests.delivery_revision_requested IS '입고일 수정 요청 완료 여부 (담당자가 업체에 요청했는지)';
COMMENT ON COLUMN purchase_requests.delivery_revision_requested_at IS '입고일 수정 요청 완료 시간';
COMMENT ON COLUMN purchase_requests.delivery_revision_requested_by IS '입고일 수정 요청 완료한 사람';


