-- Final cleanup of unused columns and tables

-- 1. Drop unused tables
DROP TABLE IF EXISTS lead_buyer_downloads CASCADE;
DROP TABLE IF EXISTS lead_buyer_notifications CASCADE;
DROP TABLE IF EXISTS shipping_address CASCADE;

-- 2. Drop unused columns from purchase_requests table
ALTER TABLE purchase_requests 
DROP COLUMN IF EXISTS is_slack_request_sent,
DROP COLUMN IF EXISTS slack_ts,
DROP COLUMN IF EXISTS purchase_manager_email;

-- 3. Drop unused columns from vendor_contacts table
ALTER TABLE vendor_contacts
DROP COLUMN IF EXISTS role,
DROP COLUMN IF EXISTS position,
DROP COLUMN IF EXISTS default_cc;

-- 4. Drop unused columns from attendance_records table
ALTER TABLE attendance_records
DROP COLUMN IF EXISTS user_email;

-- 5. Drop unused columns from employees table
ALTER TABLE employees
DROP COLUMN IF EXISTS role,
DROP COLUMN IF EXISTS is_admin;

-- 6. Add comments to document the cleanup
COMMENT ON TABLE purchase_requests IS 'Main table for purchase requests. Final cleanup completed on 2025-01-25';
COMMENT ON TABLE vendor_contacts IS 'Vendor contacts table. Removed unused role/position/default_cc columns on 2025-01-25';
COMMENT ON TABLE attendance_records IS 'Attendance records table. Removed unused user_email column on 2025-01-25';
COMMENT ON TABLE employees IS 'Employees table. Removed legacy role/is_admin columns on 2025-01-25';
