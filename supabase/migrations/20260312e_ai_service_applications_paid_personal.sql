-- 유료(개인) 사용 중 선택 시: 사용 중인 모델, 현재 월 비용
ALTER TABLE ai_service_applications
  ADD COLUMN IF NOT EXISTS current_model text,
  ADD COLUMN IF NOT EXISTS current_cost text;

COMMENT ON COLUMN ai_service_applications.current_model IS '유료(개인) 사용 중일 때 사용 중인 모델 (예: GPT-4o, Claude 3.5 Sonnet)';
COMMENT ON COLUMN ai_service_applications.current_cost IS '유료(개인) 사용 중일 때 현재 월 비용 (예: $20, 30,000원)';
