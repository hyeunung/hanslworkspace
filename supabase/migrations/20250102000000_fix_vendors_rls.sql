-- Fix vendors table RLS policies to allow all authenticated users to insert
-- Created: 2025-01-02

BEGIN;

-- Drop existing policies
DROP POLICY IF EXISTS vendors_policy ON vendors;
DROP POLICY IF EXISTS vendors_select_policy ON vendors;
DROP POLICY IF EXISTS vendors_insert_policy ON vendors;
DROP POLICY IF EXISTS vendors_update_policy ON vendors;
DROP POLICY IF EXISTS vendors_delete_policy ON vendors;

-- Create new policies - allow all authenticated users
CREATE POLICY vendors_select_policy ON vendors
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY vendors_insert_policy ON vendors
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendors_update_policy ON vendors
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendors_delete_policy ON vendors
    FOR DELETE
    USING (auth.role() = 'authenticated');

-- Fix vendor_contacts table RLS policies
DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_select_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_insert_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_update_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_delete_policy ON vendor_contacts;

-- Enable RLS on vendor_contacts if not already enabled
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

-- Create new policies for vendor_contacts
CREATE POLICY vendor_contacts_select_policy ON vendor_contacts
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendor_contacts_update_policy ON vendor_contacts
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts
    FOR DELETE
    USING (auth.role() = 'authenticated');

COMMIT;

-- Verify the policies
SELECT 
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename IN ('vendors', 'vendor_contacts')
ORDER BY tablename, policyname;