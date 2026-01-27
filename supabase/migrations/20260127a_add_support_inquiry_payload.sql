-- 문의 자동 처리용 구조화된 payload 컬럼 추가
ALTER TABLE support_inquires
ADD COLUMN IF NOT EXISTS inquiry_payload JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN support_inquires.inquiry_payload IS '문의 유형별 요청 상세 데이터 (입고일/수량/단가 변경 등)';

-- 완료 처리 함수 확장: 유형별 자동 반영
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

  ELSIF v_inquiry_type = 'delete' THEN
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'purchase_request_id missing';
    END IF;

    -- 문의 기록 보존: FK 이슈 방지용
    UPDATE public.support_inquires
    SET purchase_request_id = NULL
    WHERE purchase_request_id = v_request_id;

    DELETE FROM public.purchase_request_items
    WHERE purchase_request_id = v_request_id;

    DELETE FROM public.purchase_requests
    WHERE id = v_request_id;
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
