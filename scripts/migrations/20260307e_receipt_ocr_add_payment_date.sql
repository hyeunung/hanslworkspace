-- 영수증 OCR 결과에 결제일 컬럼 추가

ALTER TABLE public.receipt_ocr_results
ADD COLUMN IF NOT EXISTS payment_date DATE;
