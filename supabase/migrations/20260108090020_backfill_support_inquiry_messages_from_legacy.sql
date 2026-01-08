-- (선택) 기존 support_inquires.message/resolution_note를 메시지 로그로 백필
-- 이미 백필된 경우 중복 삽입 방지 위해 inquiry_id별 메시지 존재 여부 체크

DO $$
DECLARE
  r RECORD;
  has_msgs BOOLEAN;
BEGIN
  FOR r IN
    SELECT id, user_email, handled_by, message, resolution_note, status
    FROM public.support_inquires
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.support_inquiry_messages m
      WHERE m.inquiry_id = r.id
    ) INTO has_msgs;

    IF has_msgs THEN
      CONTINUE;
    END IF;

    -- 최초 사용자 메시지
    INSERT INTO public.support_inquiry_messages(inquiry_id, sender_role, sender_email, message, attachments)
    VALUES (r.id, 'user', COALESCE(r.user_email, ''), COALESCE(r.message, ''), '[]'::jsonb);

    -- 기존 resolution_note가 있으면 관리자 메시지로 기록
    IF r.resolution_note IS NOT NULL AND r.resolution_note <> '' THEN
      INSERT INTO public.support_inquiry_messages(inquiry_id, sender_role, sender_email, message, attachments)
      VALUES (r.id, 'admin', COALESCE(r.handled_by, 'admin'), r.resolution_note, '[]'::jsonb);
    END IF;

    -- resolved/closed면 시스템 완료 메시지
    IF r.status IN ('resolved','closed') THEN
      INSERT INTO public.support_inquiry_messages(inquiry_id, sender_role, sender_email, message, attachments)
      VALUES (r.id, 'system', 'system', '완료되었습니다', '[]'::jsonb);
    END IF;

  END LOOP;
END $$;


