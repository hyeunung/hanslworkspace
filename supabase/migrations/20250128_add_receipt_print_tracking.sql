-- 영수증 인쇄 추적 기능 추가
-- 인쇄 여부, 인쇄 일시, 인쇄자 정보를 추적

-- purchase_receipts 테이블에 인쇄 관련 컬럼 추가
ALTER TABLE purchase_receipts
ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS printed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS printed_by_name TEXT;

-- 인덱스 추가 (인쇄 상태로 필터링하는 경우를 위해)
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_is_printed 
ON purchase_receipts(is_printed);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_printed_at 
ON purchase_receipts(printed_at);

-- 코멘트 추가
COMMENT ON COLUMN purchase_receipts.is_printed IS '인쇄 완료 여부';
COMMENT ON COLUMN purchase_receipts.printed_at IS '인쇄 완료 일시';
COMMENT ON COLUMN purchase_receipts.printed_by IS '인쇄 완료 처리자 ID';
COMMENT ON COLUMN purchase_receipts.printed_by_name IS '인쇄 완료 처리자 이름';

