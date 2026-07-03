-- ASS'Y 환화(assy_hanwha) 하이브리드(날짜+메모) 칼럼의 레거시 데이터 정리
--
-- 배경: assy_hanwha 에 과거 데이터가 JS Date.toString() 형식
--   (예: 'Thu Jan 16 2025 09:00:00 GMT+0900 (Korean Standard Time)') 으로 저장되어
--   화면에 원본 문자열이 그대로 노출되었다.
--
-- 조치: JS Date 형식 값만 YYYY-MM-DD 로 정규화한다.
--   이 칼럼은 '날짜 또는 메모' 하이브리드이므로 TEXT 타입을 유지하며,
--   날짜가 아닌 메모 값(예: '??', '한슬')은 건드리지 않는다.
--   (프론트의 formatDateOrMemo 가 YYYY-MM-DD 는 'MM월 DD일'로, 그 외는 메모 원문으로 표시)
--
-- assy_evertech 는 데이터가 없어 대상 없음.

UPDATE production_pcbs
  SET assy_hanwha = to_char(
        to_date(substring(assy_hanwha from '^\w{3} (\w{3} +\d{1,2} \d{4})'), 'Mon DD YYYY'),
        'YYYY-MM-DD')
  WHERE assy_hanwha LIKE '%GMT%';
