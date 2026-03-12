-- transaction_statement_items에 PO 라인번호 분리 저장 컬럼 추가
ALTER TABLE public.transaction_statement_items
ADD COLUMN IF NOT EXISTS extracted_po_line_number integer;

COMMENT ON COLUMN public.transaction_statement_items.extracted_po_line_number
IS 'OCR에서 읽은 발주/수주번호 suffix 라인번호 (예: F20260209_003-14 -> 14)';

-- 기존 데이터 중 suffix가 남아있는 경우에 한해 라인번호 백필
UPDATE public.transaction_statement_items
SET extracted_po_line_number = substring(extracted_po_number FROM '[-_]([0-9]{1,3})$')::integer
WHERE extracted_po_line_number IS NULL
  AND extracted_po_number IS NOT NULL
  AND extracted_po_number ~* '^(F[0-9]{8}[_-][0-9]{1,3}|HS[0-9]{6}[-_][0-9]{1,2})[-_][0-9]{1,3}$';
