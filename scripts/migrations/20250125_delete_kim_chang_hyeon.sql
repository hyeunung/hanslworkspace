-- 김창현 직원 퇴사 처리 - 관련 데이터 삭제
-- Employee ID: 3dca77ed-fe44-46f0-9789-86580e9f8c1d
-- Employee Number: HEI00062

-- 1. attendance_records에서 김창현 관련 기록 삭제
DELETE FROM attendance_records 
WHERE employee_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 2. leave 테이블에서 김창현 관련 휴가 기록 삭제 (있다면)
DELETE FROM leave 
WHERE employee_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 3. purchase_requests에서 김창현이 요청자인 발주 요청 삭제 (있다면)
-- 먼저 관련 purchase_request_items 삭제
DELETE FROM purchase_request_items 
WHERE purchase_request_id IN (
    SELECT id FROM purchase_requests 
    WHERE requester_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d'
);

-- 그 다음 purchase_requests 삭제
DELETE FROM purchase_requests 
WHERE requester_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 4. 마지막으로 employees 테이블에서 김창현 삭제
DELETE FROM employees 
WHERE id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 5. 삭제 결과 확인용 코멘트
COMMENT ON TABLE employees IS 'Employee 김창현 (HEI00062) deleted on 2025-01-25 due to resignation';