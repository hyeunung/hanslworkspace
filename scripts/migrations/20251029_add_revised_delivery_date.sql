-- purchase_requests 테이블에 revised_delivery_request_date 칼럼 추가
-- 수정된 납품 요청일을 저장하기 위한 칼럼

-- 1. 칼럼 추가 (delivery_request_date와 동일한 date 타입)
ALTER TABLE public.purchase_requests
ADD COLUMN IF NOT EXISTS revised_delivery_request_date DATE;

-- 2. 칼럼에 대한 코멘트 추가
COMMENT ON COLUMN public.purchase_requests.revised_delivery_request_date 
IS '수정된 납품 요청일 - 원래 납품 요청일이 변경된 경우 저장';

-- 3. 칼럼 정보 확인
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'purchase_requests'
AND column_name IN ('delivery_request_date', 'revised_delivery_request_date')
ORDER BY column_name;
