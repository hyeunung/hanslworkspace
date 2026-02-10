-- 매칭 후보 캐시 컬럼 추가 (모달 로딩 최적화)
ALTER TABLE transaction_statement_items
ADD COLUMN IF NOT EXISTS match_candidates_data JSONB;
