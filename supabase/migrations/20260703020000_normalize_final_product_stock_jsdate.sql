-- 완제품 입고(final_product_stock) 칼럼의 레거시 데이터 정리
--
-- 배경: final_product_stock 에 과거 데이터가 JS Date.toString() 형식
--   (예: 'Thu Jan 02 2025 09:00:00 GMT+0900 (Korean Standard Time)') 으로 저장되어
--   화면에 원본 문자열이 그대로 노출되었다.
--
-- 조치: JS Date 형식 값만 'MM월 DD일 입고' (기존 정상 데이터와 동일한 표기)로 정규화한다.
--   이 칼럼은 '입고대기' 버튼 / 날짜+메모 텍스트를 담는 TEXT 이므로 타입은 유지하며,
--   날짜가 아닌 메모 값은 건드리지 않는다.

UPDATE production_pcbs
  SET final_product_stock =
        to_char(
          to_date(substring(final_product_stock from '^\w{3} (\w{3} +\d{1,2} \d{4})'), 'Mon DD YYYY'),
          'MM월 DD일'
        ) || ' 입고'
  WHERE final_product_stock LIKE '%GMT%';
