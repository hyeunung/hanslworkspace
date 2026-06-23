-- ai_service_applications 테이블의 approval_status CHECK 제약 조건에 'reviewed' (검토완료) 추가
ALTER TABLE ai_service_applications DROP CONSTRAINT IF EXISTS ai_service_applications_approval_status_check;
ALTER TABLE ai_service_applications ADD CONSTRAINT ai_service_applications_approval_status_check CHECK (approval_status IN ('pending', 'reviewed', 'approved', 'rejected'));

COMMENT ON COLUMN ai_service_applications.approval_status IS 'pending:승인대기, reviewed:검토완료, approved:승인완료, rejected:반려';
