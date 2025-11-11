-- 지출정보 필드 추가 마이그레이션
-- 실행 전: Supabase 대시보드 > SQL Editor에서 실행하거나 마이그레이션 도구 사용

-- 1. purchase_request_items 테이블에 지출 관련 컬럼 추가
ALTER TABLE purchase_request_items
ADD COLUMN IF NOT EXISTS expenditure_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS expenditure_amount NUMERIC(15, 2);

-- 2. purchase_requests 테이블에 총 지출 금액 컬럼 추가
ALTER TABLE purchase_requests
ADD COLUMN IF NOT EXISTS total_expenditure_amount NUMERIC(15, 2) DEFAULT 0;

-- 3. 기존 데이터가 있다면 초기값 설정 (선택사항)
-- UPDATE purchase_requests
-- SET total_expenditure_amount = COALESCE((
--   SELECT SUM(COALESCE(expenditure_amount, 0))
--   FROM purchase_request_items
--   WHERE purchase_request_items.purchase_request_id = purchase_requests.id
-- ), 0)
-- WHERE total_expenditure_amount IS NULL;

-- 4. 인덱스 추가 (성능 최적화, 선택사항)
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_expenditure_date 
ON purchase_request_items(expenditure_date);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_total_expenditure_amount 
ON purchase_requests(total_expenditure_amount);

-- 5. 코멘트 추가 (문서화)
COMMENT ON COLUMN purchase_request_items.expenditure_date IS '품목별 지출 날짜';
COMMENT ON COLUMN purchase_request_items.expenditure_amount IS '품목별 지출 금액';
COMMENT ON COLUMN purchase_requests.total_expenditure_amount IS '전체 품목의 지출 금액 합계';

