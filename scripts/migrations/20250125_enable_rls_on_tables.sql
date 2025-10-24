-- Enable RLS on tables that have policies but RLS is disabled

-- 1. Enable RLS on lead_buyer_notifications
ALTER TABLE lead_buyer_notifications ENABLE ROW LEVEL SECURITY;

-- 2. Enable RLS on user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- 3. Enable RLS on vendor_contacts
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

-- 4. Enable RLS on vendors
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- 5. Enable RLS on app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Comments to explain the changes
COMMENT ON TABLE lead_buyer_notifications IS 'Lead Buyer notification history table. RLS enabled on 2025-01-25';
COMMENT ON TABLE user_preferences IS 'User preferences table. RLS enabled on 2025-01-25';
COMMENT ON TABLE vendor_contacts IS 'Vendor contacts table. RLS enabled on 2025-01-25';
COMMENT ON TABLE vendors IS 'Vendors table. RLS enabled on 2025-01-25';
COMMENT ON TABLE app_settings IS 'Application settings table. RLS enabled on 2025-01-25';
