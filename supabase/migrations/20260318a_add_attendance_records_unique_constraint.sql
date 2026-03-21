-- attendance_records 테이블에 (employee_id, date) 유니크 제약조건 추가
-- process_business_trip_approval 트리거에서 ON CONFLICT (employee_id, date) 를 사용하는데
-- 해당 제약조건이 없어 출장 승인 시 42P10 에러 발생하는 문제 수정

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_employee_id_date_key
  UNIQUE (employee_id, date);
