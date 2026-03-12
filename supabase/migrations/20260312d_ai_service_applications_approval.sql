-- 업무용 AI 신청서 승인: HR, app_admin만 승인 가능
ALTER TABLE ai_service_applications
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN ai_service_applications.approval_status IS 'pending:승인대기, approved:승인완료, rejected:반려';
