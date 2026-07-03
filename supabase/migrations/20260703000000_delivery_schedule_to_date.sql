-- production_pcbs.delivery_schedule(입고 일정) 를 다른 날짜 컬럼과 동일하게 date 타입으로 통일
--
-- 배경: delivery_schedule 만 TEXT 로 정의되어 있었고, 과거 데이터가
--   JS Date.toString() 형식(예: 'Fri Dec 27 2024 09:00:00 GMT+0900 (Korean Standard Time)')
--   으로 저장되어 화면(입고(일정) 컬럼)에 원본 문자열이 그대로 노출되었다.
--   프론트의 formatDbDateToDisplay 는 YYYY-MM-DD 만 'MM월 DD일' 로 변환한다.
--
-- 조치: 기존 값을 YYYY-MM-DD 로 정규화한 뒤 컬럼 타입을 date 로 변경한다.

-- 1) 빈 문자열 -> NULL
UPDATE production_pcbs SET delivery_schedule = NULL
  WHERE delivery_schedule IS NOT NULL AND btrim(delivery_schedule) = '';

-- 2) JS Date.toString() 형식 -> 날짜 부분만 추출하여 YYYY-MM-DD
UPDATE production_pcbs
  SET delivery_schedule = to_char(
        to_date(substring(delivery_schedule from '^\w{3} (\w{3} +\d{1,2} \d{4})'), 'Mon DD YYYY'),
        'YYYY-MM-DD')
  WHERE delivery_schedule LIKE '%GMT%';

-- 3) 연도 없는 표시형식 1건 '12월 26일' (발주 HS241218-01 / H24-166, sample-data 엑셀 확인) -> 2024-12-26
UPDATE production_pcbs SET delivery_schedule = '2024-12-26'
  WHERE delivery_schedule = '12월 26일';

-- 4) 타입 전환 (request_date/delivery_deadline/delivery_date/assy_requested_date 와 동일)
ALTER TABLE production_pcbs
  ALTER COLUMN delivery_schedule TYPE date
  USING nullif(btrim(delivery_schedule), '')::date;
