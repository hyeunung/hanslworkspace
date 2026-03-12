-- 업무용 AI 서비스 사용 지원 신청서
CREATE TABLE IF NOT EXISTS ai_service_applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id uuid REFERENCES employees(id),
  requester_name text NOT NULL,
  requester_department text NOT NULL,
  application_date date NOT NULL DEFAULT CURRENT_DATE,
  service_name text NOT NULL,
  plan_name text,
  monthly_cost text,
  usage_purpose text NOT NULL,
  usage_example text,
  current_usage_status text NOT NULL
    CHECK (current_usage_status IN ('free_version', 'paid_personal', 'not_used')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE ai_service_applications IS '업무용 AI 서비스 사용 지원 신청서';
COMMENT ON COLUMN ai_service_applications.service_name IS '서비스명 (예: ChatGPT Plus, Claude Pro)';
COMMENT ON COLUMN ai_service_applications.plan_name IS '요금제 (예: Team Plan, Pro Plan)';
COMMENT ON COLUMN ai_service_applications.monthly_cost IS '월 예상 비용 (예: $20, 30,000원)';
COMMENT ON COLUMN ai_service_applications.usage_purpose IS '업무 활용 용도';
COMMENT ON COLUMN ai_service_applications.usage_example IS '활용 예정/실제 사례';
COMMENT ON COLUMN ai_service_applications.current_usage_status IS 'free_version|paid_personal|not_used';

ALTER TABLE ai_service_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_service_applications_select" ON ai_service_applications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ai_service_applications_insert" ON ai_service_applications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "ai_service_applications_update" ON ai_service_applications
  FOR UPDATE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION update_ai_service_applications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_service_applications_updated_at
  BEFORE UPDATE ON ai_service_applications
  FOR EACH ROW EXECUTE FUNCTION update_ai_service_applications_updated_at();
