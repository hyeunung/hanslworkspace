-- 출근시각 초 단위 랜덤화 (2026-08-31, 원격 DB에 적용 완료)
-- 배경: 관리자 수동 입력/앱 시간지정 입력은 분 단위(HH:MM:00)로 들어와 초가 항상 00으로 남음.
--       기존 :00초 출근기록 303건(2025-01-15~2026-08-28)은 1~59초 랜덤 더해 백필 완료
--       (트리거 우회 replica 모드로 실행해 지각/정상출근 상태 재계산 없이 시각만 변경).
-- 주의: 트리거 이름은 trg_auto_calc_attendance_status보다 뒤(알파벳순)에 오도록 유지할 것.
--       BEFORE 트리거는 이름순으로 실행되므로, 상태(정상출근/지각) 판정은 입력된 분 단위 시각으로
--       먼저 끝난 뒤에 초가 붙는다 (08:30:00 정각 입력자가 초 추가로 지각 처리되는 것 방지).
CREATE OR REPLACE FUNCTION public.randomize_clock_in_seconds()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.clock_in IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.clock_in IS DISTINCT FROM OLD.clock_in)
     AND extract(second FROM NEW.clock_in) = 0 THEN
    NEW.clock_in := NEW.clock_in + make_interval(secs => 1 + floor(random() * 59)::int);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_randomize_clock_in_seconds ON public.attendance_records;
CREATE TRIGGER trg_randomize_clock_in_seconds
BEFORE INSERT OR UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.randomize_clock_in_seconds();
