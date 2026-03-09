BEGIN;

-- 1) 출장 요청에 이동수단/차량 선택 정보 추가
ALTER TABLE business_trips
  ADD COLUMN IF NOT EXISTS transport_type text NOT NULL DEFAULT 'public_transport';

ALTER TABLE business_trips
  ADD COLUMN IF NOT EXISTS requested_vehicle_info text;

ALTER TABLE business_trips
  DROP CONSTRAINT IF EXISTS business_trips_transport_type_check;

UPDATE business_trips
SET transport_type = 'public_transport'
WHERE transport_type IN ('airplane', 'ktx_srt');

ALTER TABLE business_trips
  ADD CONSTRAINT business_trips_transport_type_check
  CHECK (transport_type IN ('company_vehicle', 'public_transport', 'private_car', 'other'));

COMMENT ON COLUMN business_trips.transport_type IS '이동수단(company_vehicle/public_transport/private_car/other)';
COMMENT ON COLUMN business_trips.requested_vehicle_info IS '이동수단 상세(회사차량: 차량정보, 대중교통: bus/train_ktx_srt/airplane/taxi, 기타: 직접입력)';

-- 2) vehicle_requests <- business_trips 연동 컬럼 추가
ALTER TABLE vehicle_requests
  ADD COLUMN IF NOT EXISTS business_trip_id bigint REFERENCES business_trips(id) ON DELETE SET NULL;

ALTER TABLE vehicle_requests
  ADD COLUMN IF NOT EXISTS auto_created_by_trip boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN vehicle_requests.business_trip_id IS '연결된 출장 요청 ID';
COMMENT ON COLUMN vehicle_requests.auto_created_by_trip IS '출장 승인 시 자동 생성된 배차 요청 여부';

CREATE INDEX IF NOT EXISTS idx_vehicle_requests_business_trip_id
  ON vehicle_requests(business_trip_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_requests_trip_auto_unique
  ON vehicle_requests(business_trip_id)
  WHERE business_trip_id IS NOT NULL AND auto_created_by_trip = true;

-- 3) 출장 승인 -> 차량요청(pending) 자동 생성/동기화
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
      'pending',
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
       AND auto_created_by_trip = true
       AND approval_status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_trips_sync_vehicle_request_trigger ON business_trips;
CREATE TRIGGER business_trips_sync_vehicle_request_trigger
  AFTER INSERT OR UPDATE ON business_trips
  FOR EACH ROW EXECUTE FUNCTION sync_business_trip_vehicle_request();

COMMIT;
