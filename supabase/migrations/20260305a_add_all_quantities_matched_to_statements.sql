-- transaction_statements 테이블에 all_quantities_matched 컬럼 추가
-- 목록 조회 시 수량일치 여부를 빠르게 표시하기 위해 사용
ALTER TABLE transaction_statements
ADD COLUMN IF NOT EXISTS all_quantities_matched boolean DEFAULT false;

-- 이미 수량일치 확정된 건은 true로 설정
UPDATE transaction_statements
SET all_quantities_matched = true
WHERE quantity_match_confirmed_at IS NOT NULL;
