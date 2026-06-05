-- 문의하기 삭제요청 처리(resolve_inquiry)를 soft delete로 전환.
-- 변경점은 'delete' 분기뿐 (나머지 delivery_date_change/quantity_change/price_change/item_add 분기는 동일):
--   1) delete_type='items' (품목별 삭제) 분기 복원 → 지정 품목만 soft delete, 남은 품목 없으면 발주도 보관, 총액 재계산
--   2) delete_type='all'/기본 (발주 전체 삭제) → 부모만 soft delete (cascade 트리거가 품목+_D 처리)
--   3) support_inquires.purchase_request_id NULL 처리 제거 → 발주가 보존되므로 문의 링크 유지
--   4) transaction_statements 삭제는 기존대로 (별도 도메인)

CREATE OR REPLACE FUNCTION public.resolve_inquiry(p_inquiry_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_delete_target TEXT;
  v_statement_id TEXT;
  v_max_line_number INTEGER;
  v_requester_name TEXT;
  v_vendor_name TEXT;
  v_po_number TEXT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.employees e
    WHERE e.email = auth.email()
      AND ('superadmin' = ANY(e.roles))
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
        delivery_status
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
        'pending'
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
    v_delete_target := COALESCE(v_payload->>'delete_target', 'purchase');

    IF v_delete_target = 'statement' THEN
      v_statement_id := v_payload->>'statement_id';
      IF v_statement_id IS NULL OR v_statement_id = '' THEN
        RAISE EXCEPTION 'statement_id missing';
      END IF;

      DELETE FROM public.transaction_statements
      WHERE id = v_statement_id::uuid;
    ELSE
      IF v_request_id IS NULL THEN
        RAISE EXCEPTION 'purchase_request_id missing';
      END IF;

      IF COALESCE(v_payload->>'delete_type', 'all') = 'items' THEN
        -- 품목별 삭제(보관): 지정 품목만 soft delete. line_number 재정렬은 트리거가 처리.
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

          UPDATE public.purchase_request_items
          SET deleted_at = now(),
              updated_at = now()
          WHERE id = v_item_id
            AND purchase_request_id = v_request_id
            AND deleted_at IS NULL;
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM public.purchase_request_items
          WHERE purchase_request_id = v_request_id AND deleted_at IS NULL
        ) THEN
          -- 남은 활성 품목이 없으면 발주도 보관
          UPDATE public.purchase_requests
          SET deleted_at = now()
          WHERE id = v_request_id AND deleted_at IS NULL;
        ELSE
          -- 활성 품목 기준 총액 재계산
          UPDATE public.purchase_requests
          SET total_amount = COALESCE((
            SELECT SUM(amount_value)
            FROM public.purchase_request_items
            WHERE purchase_request_id = v_request_id AND deleted_at IS NULL
          ), 0),
              updated_at = now()
          WHERE id = v_request_id;
        END IF;
      ELSE
        -- 발주 전체 삭제(보관): 부모만 soft delete → cascade 트리거가 품목 보관 + 발주번호/수주번호 _D 처리.
        -- support_inquires 링크는 발주가 보존되므로 그대로 유지.
        UPDATE public.purchase_requests
        SET deleted_at = now()
        WHERE id = v_request_id AND deleted_at IS NULL;
      END IF;
    END IF;
  END IF;

  UPDATE public.support_inquires
  SET status = 'resolved',
      processed_at = now()
  WHERE id = p_inquiry_id;

  INSERT INTO public.support_inquiry_messages(
    inquiry_id, sender_role, sender_email, message, attachments
  ) VALUES (
    p_inquiry_id, 'system', 'system', '완료되었습니다', '[]'::jsonb
  ) RETURNING id INTO v_msg_id;

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
$function$;
