-- Cleanup unused tables and columns

-- 1. Drop unused tables
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS trigger_execution_log CASCADE;
DROP TABLE IF EXISTS notification_sent_log CASCADE;

-- 2. Drop unused columns from purchase_requests table
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

-- 3. Add comment to explain the removal
COMMENT ON TABLE purchase_requests IS 'Main table for purchase requests. Cleaned up unused columns on 2025-01-25';
