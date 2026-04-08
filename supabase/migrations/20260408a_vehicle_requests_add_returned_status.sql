-- vehicle_requests의 approval_status에 'returned'(복귀완료) 추가
ALTER TABLE vehicle_requests
  DROP CONSTRAINT IF EXISTS vehicle_requests_approval_status_check;

ALTER TABLE vehicle_requests
  ADD CONSTRAINT vehicle_requests_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'returned'));
