-- 운행지가 '택배'인 차량 요청은 등록 1분 뒤 자동 승인
-- 매 분 pg_cron이 실행 → 승인 처리 + 요청자에게 승인 완료 푸시(기존 vehicle_approved 타입)
-- 연동된 법인카드는 vehicle_requests_sync_card_usage_trigger가 함께 자동 승인

CREATE OR REPLACE FUNCTION public.auto_approve_parcel_vehicle_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  r record;
  v_email text;
  v_name text;
BEGIN
  FOR r IN
    UPDATE vehicle_requests
       SET approval_status = 'approved',
           approved_at = now()
     WHERE approval_status = 'pending'
       AND route = '택배'
       AND created_at <= now() - interval '1 minute'
    RETURNING id, requester_id, vehicle_info, purpose, vehicle_code, requested_card_number
  LOOP
    SELECT email, name INTO v_email, v_name FROM employees WHERE id = r.requester_id;

    IF v_email IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://qvhbigvdfyvhoegkhvef.supabase.co/functions/v1/send_fcm_notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
        ),
        body := jsonb_build_object(
          'type', 'vehicle_approved',
          'data', jsonb_build_object(
            'requester_email', v_email,
            'requester_name', COALESCE(v_name, ''),
            'vehicle_info', COALESCE(r.vehicle_info, ''),
            'purpose', COALESCE(r.purpose, ''),
            'vehicle_code', COALESCE(r.vehicle_code, ''),
            'card_numbers', COALESCE(array_to_string(r.requested_card_number, ', '), '')
          )
        )
      );
    END IF;
  END LOOP;
END;
$function$;

-- 매 분 실행 (이미 등록돼 있으면 교체)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-approve-parcel-vehicle') THEN
    PERFORM cron.unschedule('auto-approve-parcel-vehicle');
  END IF;
  PERFORM cron.schedule(
    'auto-approve-parcel-vehicle',
    '* * * * *',
    'SELECT public.auto_approve_parcel_vehicle_requests();'
  );
END $$;
