-- Final cleanup of unused columns and tables with view update

-- 1. Drop the view that depends on columns we want to remove
DROP VIEW IF EXISTS purchase_requests_korean_time;

-- 2. Drop unused tables
DROP TABLE IF EXISTS lead_buyer_downloads CASCADE;
DROP TABLE IF EXISTS lead_buyer_notifications CASCADE;
DROP TABLE IF EXISTS shipping_address CASCADE;

-- 3. Drop unused columns from purchase_requests table
ALTER TABLE purchase_requests 
DROP COLUMN IF EXISTS is_slack_request_sent,
DROP COLUMN IF EXISTS slack_ts,
DROP COLUMN IF EXISTS purchase_manager_email;

-- 4. Drop unused columns from vendor_contacts table
ALTER TABLE vendor_contacts
DROP COLUMN IF EXISTS role,
DROP COLUMN IF EXISTS position,
DROP COLUMN IF EXISTS default_cc;

-- 5. Drop unused columns from attendance_records table
ALTER TABLE attendance_records
DROP COLUMN IF EXISTS user_email;

-- 6. Drop unused columns from employees table
ALTER TABLE employees
DROP COLUMN IF EXISTS role,
DROP COLUMN IF EXISTS is_admin;

-- 7. Recreate the view without the dropped columns
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

-- 8. Add comments to document the cleanup
COMMENT ON TABLE purchase_requests IS 'Main table for purchase requests. Final cleanup completed on 2025-01-25';
COMMENT ON TABLE vendor_contacts IS 'Vendor contacts table. Removed unused role/position/default_cc columns on 2025-01-25';
COMMENT ON TABLE attendance_records IS 'Attendance records table. Removed unused user_email column on 2025-01-25';
COMMENT ON TABLE employees IS 'Employees table. Removed legacy role/is_admin columns on 2025-01-25';
COMMENT ON VIEW purchase_requests_korean_time IS 'View of purchase_requests with Korean timezone conversion. Updated on 2025-01-25';
