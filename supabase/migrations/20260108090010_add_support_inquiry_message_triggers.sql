-- 2) 메시지 INSERT 시: 알림 + (관리자 첫 답변이면) in_progress 전환

CREATE OR REPLACE FUNCTION public.handle_support_inquiry_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_user_email TEXT;
  v_user_name TEXT;
  v_subject TEXT;
  v_status TEXT;
  v_admin RECORD;
  v_title TEXT;
  v_body TEXT;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_settings WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public.app_settings WHERE key = 'supabase_service_role_key';

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    -- 설정이 없으면 조용히 종료
    RETURN NEW;
  END IF;

  SELECT si.user_email, si.user_name, si.subject, si.status
    INTO v_user_email, v_user_name, v_subject, v_status
  FROM public.support_inquires si
  WHERE si.id = NEW.inquiry_id;

  IF NEW.sender_role = 'admin' THEN
    -- 관리자 첫 답변 순간 open -> in_progress 자동 전환
    IF v_status = 'open' THEN
      UPDATE public.support_inquires
      SET status = 'in_progress',
          handled_by = COALESCE(handled_by, NEW.sender_email)
      WHERE id = NEW.inquiry_id;
    END IF;

    -- 사용자에게 새 메시지 알림
    v_title := '문의 답변이 도착했습니다';
    v_body := LEFT(COALESCE(NEW.message,''), 120);

    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send_fcm_notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'type', 'inquiry_message',
        'targetEmail', v_user_email,
        'title', v_title,
        'body', v_body,
        'data', jsonb_build_object(
          'type', 'inquiry_message',
          'inquiryId', NEW.inquiry_id::text,
          'messageId', NEW.id::text,
          'senderRole', NEW.sender_role,
          'senderEmail', NEW.sender_email
        ),
        'skip_db_notification', false
      )
    );

  ELSIF NEW.sender_role = 'user' THEN
    -- 관리자(app_admin)들에게 새 메시지 알림
    v_title := '문의에 새 메시지가 있습니다';

    FOR v_admin IN
      SELECT e.email
      FROM public.employees e
      WHERE 'app_admin' = ANY(e.purchase_role)
        AND e.email IS NOT NULL
        AND e.email <> ''
    LOOP
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/send_fcm_notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'type', 'inquiry_message',
          'targetEmail', v_admin.email,
          'title', v_title,
          'body', format('[%s] %s', COALESCE(v_user_name, ''), LEFT(COALESCE(NEW.message,''), 120)),
          'data', jsonb_build_object(
            'type', 'inquiry_message',
            'inquiryId', NEW.inquiry_id::text,
            'messageId', NEW.id::text,
            'senderRole', NEW.sender_role,
            'senderEmail', NEW.sender_email
          ),
          'skip_db_notification', false
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 알림 실패가 메시지 저장을 막지 않도록
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_inquiry_message_insert ON public.support_inquiry_messages;
CREATE TRIGGER trg_support_inquiry_message_insert
AFTER INSERT ON public.support_inquiry_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_support_inquiry_message_insert();

-- 3) 완료 처리 함수: 입력 없이 resolved + 시스템 메시지 + 사용자 알림

CREATE OR REPLACE FUNCTION public.resolve_inquiry(p_inquiry_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_user_email TEXT;
  v_is_admin BOOLEAN;
  v_msg_id BIGINT;
BEGIN
  -- 권한 체크
  SELECT EXISTS(
    SELECT 1 FROM public.employees e
    WHERE e.email = auth.email()
      AND 'app_admin' = ANY(e.purchase_role)
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT si.user_email INTO v_user_email
  FROM public.support_inquires si
  WHERE si.id = p_inquiry_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'inquiry not found';
  END IF;

  -- 상태 업데이트
  UPDATE public.support_inquires
  SET status = 'resolved',
      processed_at = now()
  WHERE id = p_inquiry_id;

  -- 시스템 메시지 기록
  INSERT INTO public.support_inquiry_messages(
    inquiry_id, sender_role, sender_email, message, attachments
  ) VALUES (
    p_inquiry_id, 'system', 'system', '완료되었습니다', '[]'::jsonb
  ) RETURNING id INTO v_msg_id;

  -- 사용자에게 완료 알림
  SELECT value INTO v_supabase_url FROM public.app_settings WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public.app_settings WHERE key = 'supabase_service_role_key';

  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send_fcm_notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'type', 'inquiry_resolved',
        'targetEmail', v_user_email,
        'title', '문의가 완료 처리되었습니다',
        'body', '완료되었습니다',
        'data', jsonb_build_object(
          'type', 'inquiry_resolved',
          'inquiryId', p_inquiry_id::text,
          'messageId', v_msg_id::text
        ),
        'skip_db_notification', false
      )
    );
  END IF;
END;
$$;

-- 기존 문의 트리거(INSERT/UPDATE) 중복 방지: 메시지 기반으로 전환
DROP TRIGGER IF EXISTS trigger_notify_new_inquiry ON public.support_inquires;
DROP TRIGGER IF EXISTS trigger_notify_inquiry_status_change ON public.support_inquires;


