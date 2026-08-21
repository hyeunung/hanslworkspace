-- 출장 승인/반려 → 배차 요청 승인/반려 동기화 복원
--
-- 배경:
--   20260324a 마이그레이션에서 "출장 승인/반려 시 차량도 같이 승인/반려" 블록을 추가했으나,
--   20260622000000(출장 일정 변경 기능)에서 같은 함수를 CREATE OR REPLACE 하면서
--   해당 블록이 누락된 채로 덮어써졌다. 그 결과 출장을 승인해도 연동 생성된 배차 요청은
--   계속 '승인대기'로 남았다. (예: HBT260820001 승인 → HVR260820002 pending)
--
-- 이 마이그레이션은 20260622000000의 본문(ON CONFLICT INSERT, approved 건도 일정 동기화)은
-- 그대로 유지하고, 승인 상태 동기화 블록만 다시 붙인다.
-- 단, 복귀완료(returned)는 운행이 끝난 정상 종료 상태이므로 되돌리지 않는다.

BEGIN;

CREATE OR REPLACE FUNCTION sync_business_trip_vehicle_request()
RETURNS TRIGGER AS $$
DECLARE
  v_transport_type text := COALESCE(NEW.transport_type, 'public_transport');
  v_vehicle_info text := NULLIF(BTRIM(COALESCE(NEW.requested_vehicle_info, '')), '');
  v_companion_count int := COALESCE(jsonb_array_length(COALESCE(NEW.companions, '[]'::jsonb)), 0);
  v_start_at timestamptz := (NEW.trip_start_date::text || ' 09:00:00+09')::timestamptz;
  v_end_at timestamptz := (NEW.trip_end_date::text || ' 18:00:00+09')::timestamptz;
BEGIN
  -- 회사차량 요청이 아닌 출장은 배차 연동하지 않음
  IF v_transport_type <> 'company_vehicle' OR v_vehicle_info IS NULL THEN
    RETURN NEW;
  END IF;

  -- 출장 승인 시 배차 요청을 생성(또는 pending 상태면 최신 내용 반영)
  IF NEW.approval_status = 'approved' THEN
    INSERT INTO vehicle_requests (
      requester_id,
      use_department,
      purpose,
      vehicle_info,
      route,
      driver_id,
      companions,
      passenger_count,
      start_at,
      end_at,
      notes,
      approval_status,
      business_trip_id,
      auto_created_by_trip
    )
    VALUES (
      NEW.requester_id,
      NEW.request_department,
      COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_purpose, '')), ''), '출장'),
      v_vehicle_info,
      COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_destination, '')), ''), '출장지 미입력'),
      NEW.requester_id,
      COALESCE(NEW.companions, '[]'::jsonb),
      GREATEST(1, 1 + v_companion_count),
      v_start_at,
      v_end_at,
      COALESCE(NULLIF(BTRIM(COALESCE(NEW.precheck_note, '')), ''), '[' || NEW.trip_code || '] 출장 승인 연동 생성'),
      'pending',
      NEW.id,
      true
    )
    ON CONFLICT (business_trip_id) WHERE (business_trip_id IS NOT NULL AND auto_created_by_trip = true) DO NOTHING;

    -- 대기 중이거나 승인완료된 배차 요청의 일정을 최신 출장 일정으로 동기화 (연장/조기복귀 반영)
    UPDATE vehicle_requests
       SET requester_id = NEW.requester_id,
           use_department = NEW.request_department,
           purpose = COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_purpose, '')), ''), purpose),
           vehicle_info = v_vehicle_info,
           route = COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_destination, '')), ''), route),
           driver_id = COALESCE(driver_id, NEW.requester_id),
           companions = COALESCE(NEW.companions, '[]'::jsonb),
           passenger_count = GREATEST(1, 1 + v_companion_count),
           start_at = v_start_at,
           end_at = v_end_at,
           notes = COALESCE(NULLIF(BTRIM(COALESCE(NEW.precheck_note, '')), ''), notes)
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true
       AND approval_status IN ('pending', 'approved');
  END IF;

  -- 출장 승인/반려 상태가 바뀌면 연동 생성된 배차 요청도 같은 상태로 동기화
  -- (INSERT 시에는 OLD가 없으므로 UPDATE에서만 수행)
  IF TG_OP = 'UPDATE' AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE vehicle_requests
       SET approval_status = CASE
             WHEN NEW.approval_status = 'approved' THEN 'approved'
             WHEN NEW.approval_status = 'rejected' THEN 'rejected'
             ELSE 'pending'
           END,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '출장 승인 반려') ELSE NULL END
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true
       AND approval_status <> 'returned';  -- 복귀완료 건은 되돌리지 않음
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 누락 기간 동안 어긋난 데이터 정정:
-- 출장은 승인됐는데 연동 배차 요청이 아직 승인대기인 건을 출장 승인정보로 맞춘다.
-- (복귀완료/반려 건은 제외)
UPDATE vehicle_requests vr
   SET approval_status = 'approved',
       approved_by = bt.approved_by,
       approved_at = COALESCE(bt.approved_at, now())
  FROM business_trips bt
 WHERE bt.id = vr.business_trip_id
   AND vr.auto_created_by_trip = true
   AND vr.approval_status = 'pending'
   AND bt.approval_status = 'approved';

COMMIT;
