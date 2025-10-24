-- purchase_requests 테이블에 requester_fax 필드 복구
-- 코드에서 아직 이 필드를 참조하고 있음

ALTER TABLE purchase_requests
ADD COLUMN IF NOT EXISTS requester_fax TEXT;

-- purchase_requests_korean_time 뷰 재생성 (requester_fax 필드 포함)
DROP VIEW IF EXISTS purchase_requests_korean_time;

CREATE VIEW purchase_requests_korean_time AS
SELECT 
    id,
    requester_name,
    requester_phone,
    requester_fax,
    requester_address,
    vendor_id,
    request_date,
    delivery_request_date,
    progress_type,
    payment_category,
    currency,
    total_amount,
    unit_price_currency,
    po_template_type,
    is_po_download,
    is_received,
    received_at,
    created_at,
    updated_at,
    request_type,
    purchase_order_number,
    project_vendor,
    sales_order_number,
    project_item,
    requester_id,
    contact_id,
    middle_manager_status,
    final_manager_status,
    payment_completed_at,
    final_manager_approved_at,
    is_payment_completed,
    vendor_name,
    middle_manager_rejected_at,
    middle_manager_rejection_reason,
    final_manager_rejected_at,
    final_manager_rejection_reason,
    middle_manager_approved_at,
    (created_at AT TIME ZONE 'Asia/Seoul') AS created_at_korean,
    (updated_at AT TIME ZONE 'Asia/Seoul') AS updated_at_korean
FROM purchase_requests;

COMMENT ON COLUMN purchase_requests.requester_fax IS '발주 요청자 팩스번호 (코드에서 아직 사용 중)';
