-- Update view and cleanup unused columns

-- 1. Drop the existing view that depends on columns we want to remove
DROP VIEW IF EXISTS purchase_requests_korean_time;

-- 2. Drop unused tables
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS trigger_execution_log CASCADE;
DROP TABLE IF EXISTS notification_sent_log CASCADE;

-- 3. Drop unused columns from purchase_requests table
ALTER TABLE purchase_requests 
DROP COLUMN IF EXISTS requester_fax,
DROP COLUMN IF EXISTS email_status,
DROP COLUMN IF EXISTS external_email_sent,
DROP COLUMN IF EXISTS external_email_date,
DROP COLUMN IF EXISTS last_reminder_at,
DROP COLUMN IF EXISTS po_file_url,
DROP COLUMN IF EXISTS raw_material_manager_status,
DROP COLUMN IF EXISTS consumable_manager_status,
DROP COLUMN IF EXISTS raw_material_manager_approved_at,
DROP COLUMN IF EXISTS consumable_manager_approved_at,
DROP COLUMN IF EXISTS raw_material_manager_rejected_at,
DROP COLUMN IF EXISTS raw_material_manager_rejection_reason,
DROP COLUMN IF EXISTS consumable_manager_rejected_at,
DROP COLUMN IF EXISTS consumable_manager_rejection_reason;

-- 4. Recreate the view without the dropped columns
CREATE VIEW purchase_requests_korean_time AS
SELECT 
    id,
    requester_name,
    requester_phone,
    requester_address,
    vendor_id,
    request_date,
    issue_date,
    delivery_request_date,
    progress_type,
    payment_category,
    currency,
    total_amount,
    unit_price_currency,
    po_template_type,
    is_po_download,
    is_slack_request_sent,
    slack_ts,
    is_received,
    received_at,
    created_at,
    updated_at,
    request_type,
    purchase_manager_email,
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

-- 5. Add comment to explain the removal
COMMENT ON TABLE purchase_requests IS 'Main table for purchase requests. Cleaned up unused columns on 2025-01-25';
COMMENT ON VIEW purchase_requests_korean_time IS 'View of purchase_requests with Korean timezone conversion. Updated on 2025-01-25 to remove unused columns';
