-- 제작현황 PJ명(PROJECT명) — 새요청에서 수주번호 선택 시 발주 PJ명으로 연동
ALTER TABLE public.production_pcbs ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE public.production_cables ADD COLUMN IF NOT EXISTS project_name text;

COMMENT ON COLUMN public.production_pcbs.project_name IS 'PJ명(PROJECT명) — 새요청 수주번호 선택 시 purchase_requests.project_name으로 자동 입력';
COMMENT ON COLUMN public.production_cables.project_name IS 'PJ명(PROJECT명) — 새요청 수주번호 선택 시 purchase_requests.project_name으로 자동 입력';
