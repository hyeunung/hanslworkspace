-- 1) business_trips 테이블에 출장 일정 변경(연장/조기복귀) 관련 컬럼 추가
ALTER TABLE business_trips
  ADD COLUMN IF NOT EXISTS modification_status text
    CHECK (modification_status IN ('extension_pending', 'early_return_pending', 'extension_approved', 'early_return_approved', 'modification_rejected')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_end_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_end_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modification_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modification_requested_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modification_rejected_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modification_approved_by uuid REFERENCES employees(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modification_approved_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN business_trips.modification_status IS '출장 일정 변경 상태 (extension_pending/early_return_pending/extension_approved/early_return_approved/modification_rejected)';
COMMENT ON COLUMN business_trips.original_end_date IS '변경 요청 전 최초 출장 종료일';
COMMENT ON COLUMN business_trips.requested_end_date IS '변경 요청한 새로운 출장 종료일';
COMMENT ON COLUMN business_trips.modification_reason IS '출장 변경 사유 (연장 사유 또는 조기복귀 사유)';

-- 2) sync_business_trip_vehicle_request 트리거 함수 수정
-- 이미 승인된 배차 요청(approval_status = 'approved')에 대해서도 출장 기간 변경 시 end_at이 동기화되도록 수정
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
