-- 출장 1건에 회사차량 최대 2대 신청 지원
-- requested_vehicle_info(단일)는 첫 번째 차량으로 유지해 모바일 앱 호환,
-- requested_vehicle_infos(배열)에 전체 차량을 저장하고 차량마다 배차(vehicle_requests)를 1건씩 연동 생성한다.

ALTER TABLE public.business_trips
  ADD COLUMN IF NOT EXISTS requested_vehicle_infos text[];

UPDATE public.business_trips
   SET requested_vehicle_infos = ARRAY[BTRIM(requested_vehicle_info)]
 WHERE transport_type = 'company_vehicle'
   AND NULLIF(BTRIM(COALESCE(requested_vehicle_info, '')), '') IS NOT NULL
   AND requested_vehicle_infos IS NULL;

-- 출장당 연동 배차 1건 → (출장, 차량)당 1건
DROP INDEX IF EXISTS public.idx_vehicle_requests_trip_auto_unique;
CREATE UNIQUE INDEX idx_vehicle_requests_trip_auto_unique
  ON public.vehicle_requests (business_trip_id, vehicle_info)
  WHERE business_trip_id IS NOT NULL AND auto_created_by_trip = true;

CREATE OR REPLACE FUNCTION public.sync_business_trip_vehicle_request()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_transport_type text := COALESCE(NEW.transport_type, 'public_transport');
  v_vehicles text[];
  v_vehicle_info text;
  v_companion_count int := COALESCE(jsonb_array_length(COALESCE(NEW.companions, '[]'::jsonb)), 0);
  v_start_at timestamptz := (NEW.trip_start_date::text || ' 09:00:00+09')::timestamptz;
  v_end_at timestamptz := (NEW.trip_end_date::text || ' 18:00:00+09')::timestamptz;
BEGIN
  -- 배열 우선, 없으면 단일 칼럼(구버전 앱) 폴백
  SELECT array_agg(DISTINCT BTRIM(v))
    INTO v_vehicles
    FROM unnest(
      CASE WHEN COALESCE(array_length(NEW.requested_vehicle_infos, 1), 0) > 0
           THEN NEW.requested_vehicle_infos
           ELSE ARRAY[NEW.requested_vehicle_info]
      END
    ) AS v
   WHERE NULLIF(BTRIM(COALESCE(v, '')), '') IS NOT NULL;

  IF v_transport_type <> 'company_vehicle' OR v_vehicles IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status = 'approved' THEN
    FOREACH v_vehicle_info IN ARRAY v_vehicles LOOP
      INSERT INTO vehicle_requests (
        requester_id, use_department, purpose, vehicle_info, route, driver_id,
        companions, passenger_count, start_at, end_at, notes, approval_status,
        business_trip_id, auto_created_by_trip
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
      ON CONFLICT (business_trip_id, vehicle_info) WHERE (business_trip_id IS NOT NULL AND auto_created_by_trip = true) DO NOTHING;
    END LOOP;

    UPDATE vehicle_requests
       SET requester_id = NEW.requester_id,
           use_department = NEW.request_department,
           purpose = COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_purpose, '')), ''), purpose),
           route = COALESCE(NULLIF(BTRIM(COALESCE(NEW.trip_destination, '')), ''), route),
           driver_id = COALESCE(driver_id, NEW.requester_id),
           companions = COALESCE(NEW.companions, '[]'::jsonb),
           passenger_count = GREATEST(1, 1 + v_companion_count),
           start_at = v_start_at,
           end_at = v_end_at,
           notes = COALESCE(NULLIF(BTRIM(COALESCE(NEW.precheck_note, '')), ''), notes)
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true
       AND vehicle_info = ANY(v_vehicles)
       AND approval_status IN ('pending', 'approved');
  END IF;

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
       AND approval_status <> 'returned';
  END IF;

  RETURN NEW;
END;
$function$;
