-- cad_drawings 테이블에 status 컬럼 추가
-- 상태: 'pending' (검토대기), 'completed' (완료)

-- status 컬럼 추가
ALTER TABLE cad_drawings 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed';

-- 기존 데이터는 모두 'completed'로 설정 (이미 저장된 것들이므로)
UPDATE cad_drawings 
SET status = 'completed' 
WHERE status IS NULL;

-- status 컬럼에 체크 제약조건 추가
ALTER TABLE cad_drawings 
ADD CONSTRAINT cad_drawings_status_check 
CHECK (status IN ('pending', 'completed'));

-- 인덱스 추가 (상태별 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_cad_drawings_status ON cad_drawings(status);

-- 코멘트 추가
COMMENT ON COLUMN cad_drawings.status IS '상태: pending(검토대기), completed(완료)';


