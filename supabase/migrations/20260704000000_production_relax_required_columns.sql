-- 제작현황: 제작구분(production_category)과 보드명(board_name)만 필수로 유지하고,
-- 요청일/수량/횟수/재고는 필수 해제 (엑셀에서 비어있으면 DB에서도 빈값으로 둘 수 있도록)
ALTER TABLE production_pcbs   ALTER COLUMN request_date   DROP NOT NULL;
ALTER TABLE production_pcbs   ALTER COLUMN quantity       DROP NOT NULL;
ALTER TABLE production_pcbs   ALTER COLUMN revision_count DROP NOT NULL;
ALTER TABLE production_pcbs   ALTER COLUMN stock_count    DROP NOT NULL;
ALTER TABLE production_cables ALTER COLUMN request_date   DROP NOT NULL;
ALTER TABLE production_cables ALTER COLUMN quantity       DROP NOT NULL;
ALTER TABLE production_cables ALTER COLUMN revision_count DROP NOT NULL;
