-- 차량 복귀완료(approved → returned) 시 sync 트리거가 연결 카드 상태를 'pending'으로 되돌려
-- 이미 반납된 카드가 재승인 후 '승인완료'로 보이던 문제 수정 (HCU260818001/260916001/260930001)
--  1) 차량 'returned' 전환/복귀취소는 카드 승인 상태와 무관 → 동기화하지 않음
--  2) 이미 정산(settled)·반납(returned)된 카드는 상위 요청 상태 변경으로 덮어쓰지 않음 (출장 트리거 포함)

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
    WHEN NEW.approval_status IN ('approved', 'returned') THEN 'approved'
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

  -- 승인 상태 동기화 (복귀완료/복귀취소는 승인 상태 변경이 아니므로 제외)
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND NEW.approval_status <> 'returned'
     AND OLD.approval_status <> 'returned' THEN
    UPDATE card_usages
       SET approval_status = v_status,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '차량 승인 반려') ELSE NULL END
     WHERE vehicle_request_id = NEW.id
       AND auto_created_by_vehicle = true
       AND card_returned IS NOT TRUE
       AND approval_status NOT IN ('settled', 'returned');
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

CREATE OR REPLACE FUNCTION public.sync_business_trip_card_usage()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_card text;
  v_status text;
BEGIN
  v_status := CASE
    WHEN NEW.approval_status = 'approved' THEN 'approved'
    WHEN NEW.approval_status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END;

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
            business_trip_id,
            auto_created_by_trip
          ) VALUES (
            NEW.requester_id,
            v_card,
            '출장',
            NEW.trip_start_date,
            NEW.trip_end_date,
            '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
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
     SET usage_date_start = NEW.trip_start_date,
         usage_date_end = NEW.trip_end_date,
         description = '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, '')
   WHERE business_trip_id = NEW.id
     AND auto_created_by_trip = true;

  -- 승인 상태 동기화 (이미 정산/반납된 카드는 보존)
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE card_usages
       SET approval_status = v_status,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '출장 승인 반려') ELSE NULL END
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true
       AND card_returned IS NOT TRUE
       AND approval_status NOT IN ('settled', 'returned');
  END IF;

  -- 새로 추가된 카드는 card_usages 레코드를 추가 생성
  -- (카드 제거 시에는 정산/반납 이력 보존을 위해 자동 삭제하지 않음)
  IF NEW.requested_card_number IS NOT NULL THEN
    FOREACH v_card IN ARRAY NEW.requested_card_number LOOP
      IF NULLIF(BTRIM(COALESCE(v_card, '')), '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM card_usages cu
           WHERE cu.business_trip_id = NEW.id
             AND cu.auto_created_by_trip = true
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
          business_trip_id,
          auto_created_by_trip
        ) VALUES (
          NEW.requester_id,
          v_card,
          '출장',
          NEW.trip_start_date,
          NEW.trip_end_date,
          '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
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

-- 데이터 복구: 반납됐는데 트리거로 상태가 덮인 건을 반납완료로 되돌림
UPDATE public.card_usages
   SET approval_status = 'returned'
 WHERE card_returned = true
   AND approval_status <> 'returned';
