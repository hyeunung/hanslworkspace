-- 구식 자동 퇴근 경로 제거 (2026-09-28, 원격 DB에 적용 완료)
-- run_auto_clock_out_manually()는 Edge Function auto_clock_out(18:00 고정 기록)을 호출하던 수동 실행 함수.
-- 자동 퇴근은 auto_clock_out_daily 크론 → auto_clock_out_db()(18:00~18:10 초 단위 랜덤)만 사용한다.
-- Edge Function auto_clock_out도 같은 날 삭제, 앱(hansl)의 18:00 고정 자동퇴근 로직은 hansl_attendance PR #24에서 제거.
DROP FUNCTION IF EXISTS public.run_auto_clock_out_manually();
