-- 영수증 OCR 결과에 통화 코드 추가 (해외 결제 영수증 $ 표기용)
ALTER TABLE public.receipt_ocr_results
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KRW';

ALTER TABLE public.receipt_ocr_results
  DROP CONSTRAINT IF EXISTS receipt_ocr_results_currency_check;
ALTER TABLE public.receipt_ocr_results
  ADD CONSTRAINT receipt_ocr_results_currency_check CHECK (currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.receipt_ocr_results.currency IS 'ISO 4217 통화 코드 (기본 KRW)';

-- 기존 달러 영수증 보정: 2026-11-03 Gmail 일괄 업로드분(1346~1406) + 미국 출장/해외 결제 4건
UPDATE public.receipt_ocr_results r
SET currency = 'USD'
FROM public.receipt_ocr_jobs j
WHERE j.id = r.job_id
  AND (j.source_receipt_id BETWEEN 1346 AND 1406 OR j.source_receipt_id IN (830, 866, 883, 898));
