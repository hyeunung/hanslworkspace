-- Add our manager's name and position columns to vendors table
ALTER TABLE public.vendors 
ADD COLUMN IF NOT EXISTS our_manager_name text,
ADD COLUMN IF NOT EXISTS our_manager_position text;

-- Add comments for documentation
COMMENT ON COLUMN public.vendors.our_manager_name IS '우리 담당자 이름 (우리 회사 내 해당 업체 담당자)';
COMMENT ON COLUMN public.vendors.our_manager_position IS '우리 담당자 직함 (우리 회사 내 해당 업체 담당자의 직함)';
