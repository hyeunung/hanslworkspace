-- 제작현황 소프트 삭제(감사/로그용): 삭제 시 행을 지우지 않고 deleted_at 스탬프만 남긴다.
-- UI(앱 조회)는 deleted_at IS NULL 인 행만 보여주고, DB에는 삭제 이력이 보존된다.
-- RLS는 변경하지 않는다(앱단에서 deleted_at 필터링 → SELECT 정책의 deleted_at 조건이 UPDATE를 막는 함정 회피).

ALTER TABLE production_pcbs   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE production_pcbs   ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE production_cables ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE production_cables ADD COLUMN IF NOT EXISTS deleted_by text;

-- 활성(미삭제) 행 조회 성능용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_production_pcbs_active
  ON production_pcbs (sales_order_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_production_cables_active
  ON production_cables (sales_order_number) WHERE deleted_at IS NULL;
