-- 문의하기 관련 모든 app_admin 참조를 superadmin(roles)으로 변경
-- 1) 알림 트리거: handle_support_inquiry_message_insert
-- 2) resolve_inquiry 함수: 20260319a 최신 버전 복구 + superadmin 유지
-- 3) RLS 정책: support_inquiry_messages (SELECT, INSERT admin, DELETE)
-- 4) RLS 정책: support_inquires (DELETE)

---------------------------------------------------------------
-- 1) 알림 트리거 함수: app_admin → superadmin
---------------------------------------------------------------
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
    RETURN NEW;
  END IF;

  SELECT si.user_email, si.user_name, si.subject, si.status
    INTO v_user_email, v_user_name, v_subject, v_status
  FROM public.support_inquires si
  WHERE si.id = NEW.inquiry_id;

  IF NEW.sender_role = 'admin' THEN
    IF v_status = 'open' THEN
      UPDATE public.support_inquires
      SET status = 'in_progress',
          handled_by = COALESCE(handled_by, NEW.sender_email)
      WHERE id = NEW.inquiry_id;
    END IF;

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
    -- superadmin에게 새 메시지 알림
    v_title := '문의에 새 메시지가 있습니다';

    FOR v_admin IN
      SELECT e.email
      FROM public.employees e
      WHERE 'superadmin' = ANY(e.roles)
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
    RETURN NEW;
END;
$$;

---------------------------------------------------------------
-- 2) resolve_inquiry: 20260319a 최신 버전 복구 (이미 superadmin 사용)
--    20260330a에서 단순 버전으로 덮어쓴 것을 복구
---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_inquiry(p_inquiry_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_user_email TEXT;
  v_inquiry_type TEXT;
  v_payload JSONB;
  v_request_id BIGINT;
  v_is_admin BOOLEAN;
  v_msg_id BIGINT;
  v_item JSONB;
  v_item_id BIGINT;
  v_new_qty NUMERIC;
  v_new_price NUMERIC;
  v_new_amount NUMERIC;
  v_change_type TEXT;
  v_requested_date TEXT;
  v_delete_type TEXT;
  v_remaining_count INT;
  v_max_line_number INT;
  v_requester_name TEXT;
  v_vendor_name TEXT;
  v_po_number TEXT;
BEGIN
  -- 권한 체크: superadmin만
  SELECT EXISTS(
    SELECT 1 FROM public.employees e
    WHERE e.email = auth.email()
      AND 'superadmin' = ANY(e.roles)
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT si.user_email, si.inquiry_type, si.inquiry_payload, si.purchase_request_id
    INTO v_user_email, v_inquiry_type, v_payload, v_request_id
  FROM public.support_inquires si
  WHERE si.id = p_inquiry_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'inquiry not found';
  END IF;

  v_payload := COALESCE(v_payload, '{}'::jsonb);

  -- 유형별 자동 처리
  IF v_inquiry_type = 'delivery_date_change' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    v_requested_date := v_payload->>'requested_date';
    IF v_requested_date IS NULL OR v_requested_date = '' THEN
      RAISE EXCEPTION 'requested_date missing';
    END IF;

    UPDATE public.purchase_requests
    SET revised_delivery_request_date = v_requested_date::date,
        delivery_revision_requested = TRUE,
        delivery_revision_requested_at = now(),
        delivery_revision_requested_by = auth.email(),
        updated_at = now()
    WHERE id = v_request_id;

  ELSIF v_inquiry_type = 'quantity_change' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    IF jsonb_array_length(COALESCE(v_payload->'items', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'items missing';
    END IF;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'items', '[]'::jsonb))
    LOOP
      v_item_id := (v_item->>'item_id')::bigint;
      v_new_qty := (v_item->>'new_quantity')::numeric;

      IF v_item_id IS NULL OR v_new_qty IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.purchase_request_items
      SET quantity = v_new_qty,
          amount_value = COALESCE(unit_price_value, 0) * v_new_qty,
          updated_at = now()
      WHERE id = v_item_id
        AND purchase_request_id = v_request_id;
    END LOOP;

    UPDATE public.purchase_requests
    SET total_amount = COALESCE((
      SELECT SUM(amount_value)
      FROM public.purchase_request_items
      WHERE purchase_request_id = v_request_id
    ), 0),
        updated_at = now()
    WHERE id = v_request_id;

  ELSIF v_inquiry_type = 'price_change' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    IF jsonb_array_length(COALESCE(v_payload->'items', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'items missing';
    END IF;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'items', '[]'::jsonb))
    LOOP
      v_item_id := (v_item->>'item_id')::bigint;
      v_change_type := COALESCE(v_item->>'change_type', 'unit_price');

      IF v_change_type = 'amount' THEN
        v_new_amount := (v_item->>'new_amount')::numeric;

        IF v_item_id IS NULL OR v_new_amount IS NULL THEN
          CONTINUE;
        END IF;

        UPDATE public.purchase_request_items
        SET amount_value = v_new_amount,
            unit_price_value = CASE
              WHEN COALESCE(quantity, 0) > 0 THEN v_new_amount / quantity
              ELSE unit_price_value
            END,
            updated_at = now()
        WHERE id = v_item_id
          AND purchase_request_id = v_request_id;
      ELSE
        v_new_price := (v_item->>'new_unit_price')::numeric;

        IF v_item_id IS NULL OR v_new_price IS NULL THEN
          CONTINUE;
        END IF;

        UPDATE public.purchase_request_items
        SET unit_price_value = v_new_price,
            amount_value = COALESCE(quantity, 0) * v_new_price,
            updated_at = now()
        WHERE id = v_item_id
          AND purchase_request_id = v_request_id;
      END IF;
    END LOOP;

    UPDATE public.purchase_requests
    SET total_amount = COALESCE((
      SELECT SUM(amount_value)
      FROM public.purchase_request_items
      WHERE purchase_request_id = v_request_id
    ), 0),
        updated_at = now()
    WHERE id = v_request_id;

  ELSIF v_inquiry_type = 'item_add' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    IF jsonb_array_length(COALESCE(v_payload->'items', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'items missing';
    END IF;

    SELECT COALESCE(MAX(line_number), 0)
      INTO v_max_line_number
    FROM public.purchase_request_items
    WHERE purchase_request_id = v_request_id;

    SELECT pr.requester_name, pr.vendor_name, pr.purchase_order_number
      INTO v_requester_name, v_vendor_name, v_po_number
    FROM public.purchase_requests pr
    WHERE pr.id = v_request_id;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'items', '[]'::jsonb))
    LOOP
      v_max_line_number := v_max_line_number + 1;
      v_new_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      v_new_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_new_amount := v_new_qty * v_new_price;

      INSERT INTO public.purchase_request_items (
        purchase_request_id,
        line_number,
        item_name,
        specification,
        quantity,
        unit_price_value,
        unit_price_currency,
        amount_value,
        amount_currency,
        remark,
        requester_name,
        vendor_name,
        purchase_order_number,
        is_received,
        delivery_status,
        created_at,
        updated_at
      ) VALUES (
        v_request_id,
        v_max_line_number,
        COALESCE(v_item->>'item_name', ''),
        v_item->>'specification',
        v_new_qty,
        v_new_price,
        'KRW',
        v_new_amount,
        'KRW',
        v_item->>'remark',
        v_requester_name,
        v_vendor_name,
        v_po_number,
        FALSE,
        'pending',
        now(),
        now()
      );
    END LOOP;

    UPDATE public.purchase_requests
    SET total_amount = COALESCE((
      SELECT SUM(amount_value)
      FROM public.purchase_request_items
      WHERE purchase_request_id = v_request_id
    ), 0),
        updated_at = now()
    WHERE id = v_request_id;

  ELSIF v_inquiry_type = 'delete' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    v_delete_type := COALESCE(v_payload->>'delete_type', 'all');

    IF v_delete_type = 'items' THEN
      IF jsonb_array_length(COALESCE(v_payload->'delete_items', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'delete_items missing';
      END IF;

      FOR v_item IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'delete_items', '[]'::jsonb))
      LOOP
        v_item_id := (v_item->>'item_id')::bigint;

        IF v_item_id IS NULL THEN
          CONTINUE;
        END IF;

        DELETE FROM public.purchase_request_items
        WHERE id = v_item_id
          AND purchase_request_id = v_request_id;
      END LOOP;

      UPDATE public.purchase_requests
      SET total_amount = COALESCE((
        SELECT SUM(amount_value)
        FROM public.purchase_request_items
        WHERE purchase_request_id = v_request_id
      ), 0),
          updated_at = now()
      WHERE id = v_request_id;

      SELECT COUNT(*) INTO v_remaining_count
      FROM public.purchase_request_items
      WHERE purchase_request_id = v_request_id;

      IF v_remaining_count = 0 THEN
        UPDATE public.support_inquires
        SET purchase_request_id = NULL
        WHERE purchase_request_id = v_request_id;

        DELETE FROM public.purchase_requests
        WHERE id = v_request_id;
      END IF;

    ELSE
      UPDATE public.support_inquires
      SET purchase_request_id = NULL
      WHERE purchase_request_id = v_request_id;

      DELETE FROM public.purchase_request_items
      WHERE purchase_request_id = v_request_id;

      DELETE FROM public.purchase_requests
      WHERE id = v_request_id;
    END IF;
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

---------------------------------------------------------------
-- 3) RLS 정책: support_inquiry_messages - app_admin → superadmin
---------------------------------------------------------------

-- SELECT 정책 재생성
DROP POLICY IF EXISTS select_support_inquiry_messages ON public.support_inquiry_messages;
CREATE POLICY select_support_inquiry_messages
  ON public.support_inquiry_messages
  FOR SELECT
  TO public
  USING (
    auth.email() = (SELECT si.user_email FROM public.support_inquires si WHERE si.id = inquiry_id)
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.email = auth.email()
        AND 'superadmin' = ANY(e.roles)
    )
  );

-- INSERT (admin) 정책 재생성
DROP POLICY IF EXISTS insert_support_inquiry_messages_admin ON public.support_inquiry_messages;
CREATE POLICY insert_support_inquiry_messages_admin
  ON public.support_inquiry_messages
  FOR INSERT
  TO public
  WITH CHECK (
    sender_role = 'admin'
    AND sender_email = auth.email()
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.email = auth.email()
        AND 'superadmin' = ANY(e.roles)
    )
    AND (SELECT si.status FROM public.support_inquires si WHERE si.id = inquiry_id) NOT IN ('resolved','closed')
  );

-- DELETE 정책 재생성
DROP POLICY IF EXISTS delete_support_inquiry_messages ON public.support_inquiry_messages;
CREATE POLICY delete_support_inquiry_messages
  ON public.support_inquiry_messages
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.support_inquires si
      WHERE si.id = inquiry_id
        AND si.user_email = auth.email()
    )
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.email = auth.email()
        AND 'superadmin' = ANY(e.roles)
    )
  );

---------------------------------------------------------------
-- 4) RLS 정책: support_inquires DELETE - app_admin → superadmin
---------------------------------------------------------------
DROP POLICY IF EXISTS delete_support_inquires ON public.support_inquires;
CREATE POLICY delete_support_inquires
  ON public.support_inquires
  FOR DELETE
  TO public
  USING (
    (
      auth.uid() = user_id
      AND status = 'open'
      AND (resolution_note IS NULL OR resolution_note = '')
    )
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.email = auth.email()
        AND 'superadmin' = ANY(e.roles)
    )
  );
