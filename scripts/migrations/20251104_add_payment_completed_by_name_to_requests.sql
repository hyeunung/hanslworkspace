-- purchase_requests 테이블에 구매완료 처리자 이름 칼럼 추가
ALTER TABLE purchase_requests
ADD COLUMN IF NOT EXISTS payment_completed_by_name TEXT;

-- 칼럼 설명
COMMENT ON COLUMN purchase_requests.payment_completed_by_name IS '전체 구매완료 처리한 직원 이름';

