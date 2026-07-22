-- 택배 자동 승인 함수 수정:
-- 1) cron 세션에 app.settings.supabase_service_role_key 설정이 없어 매 실행 실패하던 문제
--    → Supabase Vault의 'service_role_key' 시크릿에서 키를 읽도록 변경
--    (시크릿 자체는 vault.create_secret으로 별도 등록 — 레포에 키를 커밋하지 않음)
-- 2) FCM 호출이 실패해도 승인 처리는 롤백되지 않도록 예외 처리 추가

CREATE OR REPLACE FUNCTION public.auto_approve_parcel_vehicle_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  r record;
  v_email text;
  v_name text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  FOR r IN
    UPDATE vehicle_requests
       SET approval_status = 'approved',
           approved_at = now()
     WHERE approval_status = 'pending'
       AND purpose = '택배'
       AND created_at <= now() - interval '1 minute'
    RETURNING id, requester_id, vehicle_info, purpose, vehicle_code, requested_card_number
  LOOP
    -- 알림 실패가 승인 처리를 막지 않도록 개별 예외 처리
    BEGIN
      SELECT email, name INTO v_email, v_name FROM employees WHERE id = r.requester_id;

      IF v_email IS NOT NULL AND v_key IS NOT NULL THEN
        PERFORM net.http_post(
          url := 'https://qvhbigvdfyvhoegkhvef.supabase.co/functions/v1/send_fcm_notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
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
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '택배 자동승인 알림 실패 (vehicle_request %): %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;
