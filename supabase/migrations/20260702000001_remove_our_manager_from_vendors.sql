-- Drop our manager's name and position columns from vendors table
ALTER TABLE public.vendors 
DROP COLUMN IF EXISTS our_manager_name,
DROP COLUMN IF EXISTS our_manager_position;
