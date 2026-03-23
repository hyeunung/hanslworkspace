-- resolve_inquiry 함수 확장: item_add (품목 추가 요청) 처리 추가
-- 관리자가 완료 처리 시 payload.items 의 품목들을 purchase_request_items에 INSERT

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
  -- 권한 체크
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

    -- 기존 최대 line_number 조회
    SELECT COALESCE(MAX(line_number), 0)
      INTO v_max_line_number
    FROM public.purchase_request_items
    WHERE purchase_request_id = v_request_id;

    -- 발주요청의 requester_name, vendor_name, purchase_order_number 조회
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

    -- 총액 재계산
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
      -- 품목별 삭제: payload.delete_items 에 있는 품목만 삭제
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

      -- 총액 재계산
      UPDATE public.purchase_requests
      SET total_amount = COALESCE((
        SELECT SUM(amount_value)
        FROM public.purchase_request_items
        WHERE purchase_request_id = v_request_id
      ), 0),
          updated_at = now()
      WHERE id = v_request_id;

      -- 남은 품목이 0이면 발주요청도 삭제
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
      -- 전체 삭제 (기존 로직)
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
