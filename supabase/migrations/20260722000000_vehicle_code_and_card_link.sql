-- 차량 요청 코드(HVR) 자동 채번 + 차량 신청 시 법인카드 동시 신청 연동
-- 출장(business_trips)의 trip_code / requested_card_number 구조와 동일한 패턴

-- 1) vehicle_code 칼럼 + 채번 함수 + before insert 트리거
ALTER TABLE vehicle_requests ADD COLUMN IF NOT EXISTS vehicle_code text;

CREATE OR REPLACE FUNCTION public.generate_vehicle_request_code(p_date date DEFAULT NULL::date)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_date date := COALESCE(p_date, timezone('Asia/Seoul', now())::date);
  v_prefix text := 'HVR' || to_char(v_date, 'YYMMDD');
  v_next_seq int;
BEGIN
  LOCK TABLE vehicle_requests IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(SUBSTRING(vehicle_code FROM 10 FOR 3)::int), 0) + 1
    INTO v_next_seq
  FROM vehicle_requests
  WHERE vehicle_code LIKE (v_prefix || '%');

  RETURN v_prefix || lpad(v_next_seq::text, 3, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.vehicle_code IS NULL OR btrim(NEW.vehicle_code) = '' THEN
    NEW.vehicle_code := generate_vehicle_request_code();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS vehicle_requests_before_insert_trigger ON vehicle_requests;
CREATE TRIGGER vehicle_requests_before_insert_trigger
BEFORE INSERT ON vehicle_requests
FOR EACH ROW EXECUTE FUNCTION vehicle_requests_before_insert();

-- 기존 데이터 소급 채번 (생성일 한국시간 기준)
WITH numbered AS (
  SELECT id,
         'HVR' || to_char(timezone('Asia/Seoul', created_at)::date, 'YYMMDD') ||
         lpad(row_number() OVER (
           PARTITION BY timezone('Asia/Seoul', created_at)::date
           ORDER BY created_at, id
         )::text, 3, '0') AS code
  FROM vehicle_requests
  WHERE vehicle_code IS NULL
)
UPDATE vehicle_requests vr
   SET vehicle_code = n.code
  FROM numbered n
 WHERE vr.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_requests_vehicle_code_key ON vehicle_requests (vehicle_code);

-- 2) 차량 신청 시 법인카드 동시 신청
ALTER TABLE vehicle_requests ADD COLUMN IF NOT EXISTS requested_card_number text[];
ALTER TABLE card_usages ADD COLUMN IF NOT EXISTS vehicle_request_id bigint REFERENCES vehicle_requests(id);
ALTER TABLE card_usages ADD COLUMN IF NOT EXISTS auto_created_by_vehicle boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_vehicle_request_card_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_card text;
  v_status text;
  v_start date;
  v_end date;
BEGIN
  v_status := CASE
    WHEN NEW.approval_status = 'approved' THEN 'approved'
    WHEN NEW.approval_status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END;
  v_start := timezone('Asia/Seoul', NEW.start_at)::date;
  v_end := timezone('Asia/Seoul', NEW.end_at)::date;

  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_card_number IS NOT NULL THEN
      FOREACH v_card IN ARRAY NEW.requested_card_number LOOP
        IF NULLIF(BTRIM(COALESCE(v_card, '')), '') IS NOT NULL THEN
          INSERT INTO card_usages (
            requester_id,
            card_number,
            usage_category,
            usage_date_start,
            usage_date_end,
            description,
            approval_status,
            vehicle_request_id,
            auto_created_by_vehicle
          ) VALUES (
            NEW.requester_id,
            v_card,
            '차량',
            v_start,
            v_end,
            '[' || COALESCE(NEW.vehicle_code, '') || '] ' || COALESCE(NEW.purpose, ''),
            v_status,
            NEW.id,
            true
          );
        END IF;
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  -- 일정/설명 변경을 자동 생성된 카드 요청에 반영
  UPDATE card_usages
     SET usage_date_start = v_start,
         usage_date_end = v_end,
         description = '[' || COALESCE(NEW.vehicle_code, '') || '] ' || COALESCE(NEW.purpose, '')
   WHERE vehicle_request_id = NEW.id
     AND auto_created_by_vehicle = true;

  -- 승인 상태 동기화
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE card_usages
       SET approval_status = v_status,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '차량 승인 반려') ELSE NULL END
     WHERE vehicle_request_id = NEW.id
       AND auto_created_by_vehicle = true;
  END IF;

  -- 새로 추가된 카드는 card_usages 레코드를 추가 생성
  -- (카드 제거 시에는 정산/반납 이력 보존을 위해 자동 삭제하지 않음)
  IF NEW.requested_card_number IS NOT NULL THEN
    FOREACH v_card IN ARRAY NEW.requested_card_number LOOP
      IF NULLIF(BTRIM(COALESCE(v_card, '')), '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM card_usages cu
           WHERE cu.vehicle_request_id = NEW.id
             AND cu.auto_created_by_vehicle = true
             AND cu.card_number = v_card
         ) THEN
        INSERT INTO card_usages (
          requester_id,
          card_number,
          usage_category,
          usage_date_start,
          usage_date_end,
          description,
          approval_status,
          vehicle_request_id,
          auto_created_by_vehicle
        ) VALUES (
          NEW.requester_id,
          v_card,
          '차량',
          v_start,
          v_end,
          '[' || COALESCE(NEW.vehicle_code, '') || '] ' || COALESCE(NEW.purpose, ''),
          v_status,
          NEW.id,
          true
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS vehicle_requests_sync_card_usage_trigger ON vehicle_requests;
CREATE TRIGGER vehicle_requests_sync_card_usage_trigger
AFTER INSERT OR UPDATE ON vehicle_requests
FOR EACH ROW EXECUTE FUNCTION sync_vehicle_request_card_usage();
