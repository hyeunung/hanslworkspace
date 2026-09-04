-- 발주요청 수주번호(sales_order_number) 앞뒤 공백/탭 제거 (390건)
-- 배경: 7월 이전(엑셀 시절) 입력분에 "HS251117-04\t\t"처럼 탭이 붙어 있어
--       제작현황 제작번호 '상세' 버튼의 정확일치 조회에서 발주요청이 매칭되지 않던 문제.
-- production_pcbs / production_cables 쪽은 공백 오염 0건이라 발주요청만 정리한다.
-- (purchase_requests의 무조건 UPDATE 트리거 2종은 상태 변경시에만 동작하도록
--  함수 내부에서 가드되어 있고, 대상 390건 모두 상태값이 채워져 있어 no-op 확인됨)
UPDATE purchase_requests
SET sales_order_number = regexp_replace(sales_order_number, '^\s+|\s+$', '', 'g')
WHERE sales_order_number ~ '^\s|\s$';
