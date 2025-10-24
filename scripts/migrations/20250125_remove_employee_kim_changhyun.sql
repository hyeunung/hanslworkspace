-- 김창현 직원 퇴사 처리 - 관련 데이터 모두 삭제
-- Employee ID: 3dca77ed-fe44-46f0-9789-86580e9f8c1d
-- Email: chang-hyun.kim@hansl.com

-- 1. notifications 테이블에서 관련 알림 삭제
DELETE FROM notifications 
WHERE user_email = 'chang-hyun.kim@hansl.com';

-- 2. leave 테이블에서 휴가 기록 삭제
DELETE FROM leave 
WHERE user_email = 'chang-hyun.kim@hansl.com';

-- 3. purchase_request_items 테이블에서 입고 처리한 항목 업데이트 (received_by를 null로 설정)
UPDATE purchase_request_items 
SET received_by = NULL,
    received_by_name = NULL
WHERE received_by = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 4. support_inquires 테이블에서 지원 문의 업데이트 (requester_id를 null로 설정)
UPDATE support_inquires 
SET requester_id = NULL
WHERE requester_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 5. purchase_requests 테이블에서 발주 요청 업데이트 (requester_id를 null로 설정)
UPDATE purchase_requests 
SET requester_id = NULL
WHERE requester_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 6. attendance_records 테이블에서 출근 기록 삭제
DELETE FROM attendance_records 
WHERE employee_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 7. monthly_attendance 테이블에서 월별 출근 기록 삭제
DELETE FROM monthly_attendance 
WHERE employee_id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 8. 마지막으로 employees 테이블에서 직원 정보 삭제
DELETE FROM employees 
WHERE id = '3dca77ed-fe44-46f0-9789-86580e9f8c1d';

-- 코멘트 추가
COMMENT ON TABLE employees IS 'Employees table. Removed employee 김창현 (chang-hyun.kim@hansl.com) on 2025-01-25 due to resignation';
