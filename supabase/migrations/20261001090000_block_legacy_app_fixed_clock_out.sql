-- 구버전 앱(hansl)의 18:00:00 고정 자동퇴근 기록 차단 (2026-10-01, 원격 DB에 적용 완료)
-- 배경: 앱 소스에서는 18:00 고정 자동퇴근을 제거했지만(hansl_attendance PR #24),
--       업데이트 안 된 기기는 크론보다 먼저 clock_out='18:00:00'을 직접 써서 랜덤 규칙을 무력화한다.
-- 변경:
-- 1) 빈 퇴근 → 정각 18:00:00 기록을 DB에서 무효화 (본인 계정이 본인 기록에 쓰는 경우 / 18시 이후 출근자)
--    → 퇴근 시각을 채우는 주체는 auto_clock_out_daily 크론 하나뿐.
--    관리자의 타인 기록 수동 수정, 퇴근 버튼(실제 시각) 기록은 통과.
--    9/29의 guard_premature_auto_clock_out(출근 전 기록만 차단)를 포함하는 상위 규칙으로 대체.
-- 2) 크론 랜덤 범위를 18:00:01~18:10:00 으로 조정 (우연히 정각 18:00:00 이 나오지 않도록)
-- 3) 기존 정각 18:00:00 기록 312건(2025-06-12~2026-09-30)은 같은 규칙으로 백필 완료
--    (오후반차 5건은 12:30, 나머지 307건 랜덤, 기존 status 보존)
CREATE OR REPLACE FUNCTION public.guard_legacy_app_auto_clock_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_email text;
BEGIN
  -- 빈 퇴근 → 정각 18:00:00 으로 바뀌는 경우만 검사
  IF OLD.clock_out IS NULL AND NEW.clock_out = '18:00:00'::time THEN
    BEGIN
      v_actor_email := auth.email();
    EXCEPTION WHEN OTHERS THEN
      v_actor_email := NULL;
    END;

    IF
      -- (1) 본인 계정이 본인 기록에 쓰는 경우 = 구버전 앱의 자동퇴근 (관리자의 타인 기록 수정은 통과)
      (v_actor_email IS NOT NULL AND EXISTS (
         SELECT 1 FROM employees e
         WHERE e.id = NEW.employee_id AND lower(e.email) = lower(v_actor_email)))
      -- (2) 18시 이후 출근자에게 18:00 퇴근 = 구버전 앱의 자정 일괄 처리 (퇴근이 출근보다 빨라지는 잘못된 값)
      OR (v_actor_email IS NOT NULL AND COALESCE(NEW.clock_in, OLD.clock_in) > '18:00:00'::time)
    THEN
      NEW.clock_out := NULL;
      NEW.status := OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_a_guard_premature_auto_clock_out ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_a_guard_legacy_app_auto_clock_out ON public.attendance_records;
-- 이름이 trg_auto_calc_attendance_status 보다 앞서야 상태 재계산 전에 되돌려진다
CREATE TRIGGER trg_a_guard_legacy_app_auto_clock_out
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_app_auto_clock_out();
DROP FUNCTION IF EXISTS public.guard_premature_auto_clock_out();

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

  -- 출근했지만 퇴근 안 한 직원: 오후반차는 12:30, 나머지는 18:00:01~18:10:00 랜덤(초 단위)
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
      ELSE '18:00:00'::time + make_interval(secs => 1 + floor(random() * 600)::int)
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
