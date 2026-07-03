-- 납품기한: 날짜+메모 하이브리드로 전환 (ASS'Y 칼럼과 동일). 기존 date 값은 'YYYY-MM-DD' 텍스트로 보존됨
ALTER TABLE production_pcbs   ALTER COLUMN delivery_deadline TYPE text USING delivery_deadline::text;
ALTER TABLE production_cables ALTER COLUMN delivery_deadline TYPE text USING delivery_deadline::text;

-- 수량 단위: 기본 'ea', 드롭다운으로 'set' 선택 가능
ALTER TABLE production_pcbs   ADD COLUMN IF NOT EXISTS quantity_unit text DEFAULT 'ea';
ALTER TABLE production_cables ADD COLUMN IF NOT EXISTS quantity_unit text DEFAULT 'ea';
