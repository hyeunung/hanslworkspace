BEGIN;

-- 1) 차량 트리거: 출장 승인/반려 시 차량도 같이 승인/반려 동기화
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
    SELECT
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
      'approved',
      NEW.id,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM vehicle_requests vr
      WHERE vr.business_trip_id = NEW.id
        AND vr.auto_created_by_trip = true
    );

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
       AND auto_created_by_trip = true;
  END IF;

  -- 출장 승인/반려 상태 변경 시 차량도 동기화 (카드와 동일한 로직)
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
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
       AND auto_created_by_trip = true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) 출장 삭제 시 카드/차량 CASCADE 삭제되도록 FK 변경

-- vehicle_requests.business_trip_id: SET NULL → CASCADE
ALTER TABLE vehicle_requests
  DROP CONSTRAINT IF EXISTS vehicle_requests_business_trip_id_fkey;

ALTER TABLE vehicle_requests
  ADD CONSTRAINT vehicle_requests_business_trip_id_fkey
  FOREIGN KEY (business_trip_id) REFERENCES business_trips(id) ON DELETE CASCADE;

-- card_usages.business_trip_id: SET NULL → CASCADE
ALTER TABLE card_usages
  DROP CONSTRAINT IF EXISTS card_usages_business_trip_id_fkey;

ALTER TABLE card_usages
  ADD CONSTRAINT card_usages_business_trip_id_fkey
  FOREIGN KEY (business_trip_id) REFERENCES business_trips(id) ON DELETE CASCADE;

COMMIT;
