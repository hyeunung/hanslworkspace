-- receipt-ocr-engine 단건 실행만 사용하도록 정리
-- 사용하지 않는 큐 순차 처리 함수 제거

DROP FUNCTION IF EXISTS public.claim_next_receipt_ocr_job(UUID, INTERVAL);
