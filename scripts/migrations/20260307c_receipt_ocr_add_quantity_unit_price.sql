-- 영수증 OCR 결과에 수량/단가 컬럼 추가

ALTER TABLE public.receipt_ocr_results
ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,3),
ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2);
