-- 새요청: PROJECT명(요청 단위) + 품목별 사용목적 및 사용처
ALTER TABLE public.purchase_requests ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS usage_purpose text;
COMMENT ON COLUMN public.purchase_requests.project_name IS 'PROJECT명 (새요청 필수 입력)';
COMMENT ON COLUMN public.purchase_request_items.usage_purpose IS '사용목적 및 사용처 (무엇에 쓰는지, 어느 설비·현장에 쓰는지)';
