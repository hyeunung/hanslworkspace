-- 자동 퇴근 처리 함수 수정 (2026-08-31, 원격 DB에 적용 완료)
-- 배경: 2026-04-16에 크론을 Edge Function 호출 → auto_clock_out_db() 직접 호출로 교체하면서
--       '18:00:00'(text) → clock_out(time) 캐스팅 누락으로 매일 23:59 크론이 137회 연속 실패,
--       4/16~8/30 퇴근 기록 1,936건 미기록 (별도 UPDATE로 백필 완료).
-- 변경:
-- 1) time 캐스팅 버그 수정
-- 2) 퇴근 시각을 18:00:00~18:10:00 사이 초 단위 랜덤으로 기록 (오후반차는 기존대로 12:30 고정)
-- 3) 18시 이후 출근자는 제외 (퇴근시각이 출근시각보다 빨라지는 오류 방지)
-- 4) remarks의 '자동 퇴근 처리 (23:59)' 문구 추가 제거
CREATE OR REPLACE FUNCTION public.auto_clock_out_db()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_today date;
  v_updated int;
BEGIN
  -- 한국시간 기준 오늘
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- 출근했지만 퇴근 안 한 직원: 오후반차는 12:30, 나머지는 18:00~18:10 랜덤(초 단위)
  UPDATE attendance_records ar
  SET
    clock_out = CASE
      WHEN EXISTS (
        SELECT 1 FROM leave l
        JOIN employees e ON e.email = l.user_email
        WHERE e.id = ar.employee_id
          AND l.status = 'approved'
          AND l.type = 'half_pm'
          AND l.start_date <= v_today
          AND l.end_date >= v_today
      ) THEN '12:30:00'::time
      ELSE '18:00:00'::time + make_interval(secs => floor(random() * 601)::int)
    END,
    status = '퇴근',
    updated_at = now()
  WHERE date = v_today
    AND clock_in IS NOT NULL
    AND clock_out IS NULL
    AND clock_in <= '18:00:00'::time;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[자동 퇴근] %명 처리 완료 (날짜: %)', v_updated, v_today;
END;
$function$;
