-- Deep cleanup of unused columns found after thorough inspection

-- 1. attendance_records 테이블
ALTER TABLE attendance_records
DROP COLUMN IF EXISTS employee_name;  -- employee_id로 충분, 중복 데이터

-- 2. employees 테이블  
ALTER TABLE employees
DROP COLUMN IF EXISTS bank,  -- 사용되지 않음
DROP COLUMN IF EXISTS fcm_token;  -- 사용되지 않음

-- 3. leave 테이블
ALTER TABLE leave
DROP COLUMN IF EXISTS start_day_of_week,  -- 사용되지 않음
DROP COLUMN IF EXISTS end_day_of_week,  -- 사용되지 않음
DROP COLUMN IF EXISTS name,  -- user_email로 충분, 중복 데이터
DROP COLUMN IF EXISTS position;  -- 사용되지 않음

-- 4. purchase_request_items 테이블
ALTER TABLE purchase_request_items
DROP COLUMN IF EXISTS vendor_name,  -- purchase_requests의 vendor_id로 충분, 중복 데이터
DROP COLUMN IF EXISTS purchase_order_number,  -- purchase_requests에 있음, 중복 데이터
DROP COLUMN IF EXISTS requester_name;  -- purchase_requests에 있음, 중복 데이터

-- 5. purchase_requests 테이블
ALTER TABLE purchase_requests
DROP COLUMN IF EXISTS issue_date,  -- 사용되지 않음
DROP COLUMN IF EXISTS vendor_name;  -- vendor_id로 충분, 중복 데이터

-- 6. support_inquires 테이블
ALTER TABLE support_inquires
DROP COLUMN IF EXISTS user_id;  -- requester_id와 중복, 둘 중 하나만 필요

-- 7. vendor_contacts 테이블
ALTER TABLE vendor_contacts
DROP COLUMN IF EXISTS is_primary;  -- 사용되지 않음

-- 8. 코멘트 추가
COMMENT ON TABLE attendance_records IS 'Attendance records table. Removed duplicate employee_name column on 2025-01-25';
COMMENT ON TABLE employees IS 'Employees table. Removed unused bank and fcm_token columns on 2025-01-25';
COMMENT ON TABLE leave IS 'Leave table. Removed unused columns (start/end_day_of_week, name, position) on 2025-01-25';
COMMENT ON TABLE purchase_request_items IS 'Purchase request items table. Removed duplicate columns (vendor_name, purchase_order_number, requester_name) on 2025-01-25';
COMMENT ON TABLE purchase_requests IS 'Purchase requests table. Removed unused issue_date and duplicate vendor_name columns on 2025-01-25';
COMMENT ON TABLE support_inquires IS 'Support inquiries table. Removed duplicate user_id column on 2025-01-25';
COMMENT ON TABLE vendor_contacts IS 'Vendor contacts table. Removed unused is_primary column on 2025-01-25';
