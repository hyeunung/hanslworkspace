-- resolve_inquiry: 업체등록(new_vendor)·기존업체 수정(vendor_edit)·택배 주소록 수정(shipping_edit)
-- 유형도 완료 처리 시 실제 데이터에 자동 반영되도록 분기 추가.
-- 배경: 웹 대시보드/문의관리/모바일 앱의 일반 "완료 처리" 버튼이 모두 이 RPC를 호출하는데,
-- 기존에는 발주 관련 5개 유형만 처리하고 업체등록 요청은 상태만 resolved로 바꿔
-- 업체가 등록되지 않은 채 완료되는 문제가 있었음 (2026-09-10 하이툴 건).
-- 관리 패널(VendorRequestAdminPanel)의 "등록 확정"과 동일한 규칙으로 반영한다.

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
  v_delete_mode TEXT;
  v_deleted_line INTEGER;
  v_deleted_lines INTEGER[];
  -- 업체등록/수정/택배주소록 처리용
  v_vendor JSONB;
  v_new_vendor_id BIGINT;
  v_edit_vendor_id BIGINT;
  v_shipping JSONB;
  v_company_id UUID;
  v_addr_id UUID;
  v_contact_uuid UUID;
  v_company_name TEXT;
  v_contact_name TEXT;
  v_addr TEXT;
  v_resolution_note TEXT;
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
        purchase_request_id, line_number, item_name, specification, quantity,
        unit_price_value, unit_price_currency, amount_value, amount_currency, remark,
        requester_name, vendor_name, purchase_order_number, is_received, delivery_status
      ) VALUES (
        v_request_id, v_max_line_number, COALESCE(v_item->>'item_name', ''), v_item->>'specification', v_new_qty,
        v_new_price, 'KRW', v_new_amount, 'KRW', v_item->>'remark',
        v_requester_name, v_vendor_name, v_po_number, FALSE, 'pending'
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
        IF jsonb_array_length(COALESCE(v_payload->'delete_items', '[]'::jsonb)) = 0 THEN
          RAISE EXCEPTION 'delete_items missing';
        END IF;

        -- 요청자가 선택한 삭제 방식: 'hard' = 번호 당김, 그 외(soft/미지정) = 번호 유지
        v_delete_mode := COALESCE(v_payload->>'delete_mode', 'soft');
        v_deleted_lines := ARRAY[]::INTEGER[];

        FOR v_item IN
          SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'delete_items', '[]'::jsonb))
        LOOP
          v_item_id := (v_item->>'item_id')::bigint;
          IF v_item_id IS NULL THEN
            CONTINUE;
          END IF;

          v_deleted_line := NULL;

          UPDATE public.purchase_request_items
          SET deleted_at = now(),
              updated_at = now()
          WHERE id = v_item_id
            AND purchase_request_id = v_request_id
            AND deleted_at IS NULL
          RETURNING line_number INTO v_deleted_line;

          IF v_deleted_line IS NOT NULL THEN
            v_deleted_lines := array_append(v_deleted_lines, v_deleted_line);
          END IF;
        END LOOP;

        -- hard 모드: 삭제된 라인보다 뒤의 활성 품목만 삭제된 라인 수만큼 당김
        -- (앞쪽 품목 번호는 그대로 유지, 전체 재부여 금지 - PR #232와 동일 규칙)
        IF v_delete_mode = 'hard' AND COALESCE(array_length(v_deleted_lines, 1), 0) > 0 THEN
          UPDATE public.purchase_request_items pri
          SET line_number = pri.line_number - (
                SELECT COUNT(*)::integer
                FROM unnest(v_deleted_lines) dl
                WHERE dl < pri.line_number
              ),
              updated_at = now()
          WHERE pri.purchase_request_id = v_request_id
            AND pri.deleted_at IS NULL
            AND pri.line_number IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM unnest(v_deleted_lines) dl WHERE dl < pri.line_number
            );
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.purchase_request_items
          WHERE purchase_request_id = v_request_id AND deleted_at IS NULL
        ) THEN
          UPDATE public.purchase_requests
          SET deleted_at = now()
          WHERE id = v_request_id AND deleted_at IS NULL;
        ELSE
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
        UPDATE public.purchase_requests
        SET deleted_at = now()
        WHERE id = v_request_id AND deleted_at IS NULL;
      END IF;
    END IF;

  ELSIF v_inquiry_type = 'new_vendor' THEN
    -- 업체등록 요청: payload의 업체/담당자를 vendors/vendor_contacts에 등록
    v_vendor := COALESCE(v_payload->'vendor', '{}'::jsonb);
    v_vendor_name := NULLIF(TRIM(COALESCE(v_vendor->>'vendor_name', '')), '');
    IF v_vendor_name IS NULL THEN
      RAISE EXCEPTION 'vendor_name missing';
    END IF;

    SELECT id INTO v_new_vendor_id
    FROM public.vendors
    WHERE vendor_name = v_vendor_name
    LIMIT 1;

    IF v_new_vendor_id IS NULL THEN
      INSERT INTO public.vendors (
        vendor_name, vendor_alias, vendor_phone, vendor_fax,
        vendor_payment_schedule, vendor_address, note
      ) VALUES (
        v_vendor_name,
        TRIM(COALESCE(v_vendor->>'vendor_alias', '')),
        TRIM(COALESCE(v_vendor->>'vendor_phone', '')),
        TRIM(COALESCE(v_vendor->>'vendor_fax', '')),
        TRIM(COALESCE(v_vendor->>'vendor_payment_schedule', '')),
        TRIM(COALESCE(v_vendor->>'vendor_address', '')),
        TRIM(COALESCE(v_vendor->>'note', ''))
      ) RETURNING id INTO v_new_vendor_id;

      FOR v_item IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'contacts', '[]'::jsonb))
      LOOP
        v_contact_name := NULLIF(TRIM(COALESCE(v_item->>'contact_name', '')), '');
        IF v_contact_name IS NOT NULL THEN
          INSERT INTO public.vendor_contacts (
            vendor_id, contact_name, "position", contact_phone, contact_email
          ) VALUES (
            v_new_vendor_id,
            v_contact_name,
            TRIM(COALESCE(v_item->>'position', '')),
            TRIM(COALESCE(v_item->>'contact_phone', '')),
            TRIM(COALESCE(v_item->>'contact_email', ''))
          );
        END IF;
      END LOOP;

      v_resolution_note := '업체 등록 완료: ' || v_vendor_name;
    ELSE
      -- 동일 업체명이 이미 있으면 중복 등록하지 않고 완료만 처리
      v_resolution_note := '업체 등록 생략(동일 업체명 존재): ' || v_vendor_name;
    END IF;

  ELSIF v_inquiry_type = 'vendor_edit' THEN
    -- 기존업체 수정 요청: 업체 정보 갱신 + 담당자 전체 교체(관리 패널과 동일 규칙)
    v_edit_vendor_id := (v_payload->>'vendor_id')::bigint;
    IF v_edit_vendor_id IS NULL THEN
      RAISE EXCEPTION 'vendor_id missing';
    END IF;

    v_vendor := COALESCE(v_payload->'vendor', '{}'::jsonb);
    v_vendor_name := NULLIF(TRIM(COALESCE(v_vendor->>'vendor_name', '')), '');
    IF v_vendor_name IS NULL THEN
      RAISE EXCEPTION 'vendor_name missing';
    END IF;

    UPDATE public.vendors SET
      vendor_name = v_vendor_name,
      vendor_alias = TRIM(COALESCE(v_vendor->>'vendor_alias', '')),
      vendor_phone = TRIM(COALESCE(v_vendor->>'vendor_phone', '')),
      vendor_fax = TRIM(COALESCE(v_vendor->>'vendor_fax', '')),
      vendor_payment_schedule = TRIM(COALESCE(v_vendor->>'vendor_payment_schedule', '')),
      vendor_address = TRIM(COALESCE(v_vendor->>'vendor_address', '')),
      note = TRIM(COALESCE(v_vendor->>'note', '')),
      updated_at = now()
    WHERE id = v_edit_vendor_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'vendor not found';
    END IF;

    DELETE FROM public.vendor_contacts WHERE vendor_id = v_edit_vendor_id;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'contacts', '[]'::jsonb))
    LOOP
      v_contact_name := NULLIF(TRIM(COALESCE(v_item->>'contact_name', '')), '');
      IF v_contact_name IS NOT NULL THEN
        INSERT INTO public.vendor_contacts (
          vendor_id, contact_name, "position", contact_phone, contact_email
        ) VALUES (
          v_edit_vendor_id,
          v_contact_name,
          TRIM(COALESCE(v_item->>'position', '')),
          TRIM(COALESCE(v_item->>'contact_phone', '')),
          TRIM(COALESCE(v_item->>'contact_email', ''))
        );
      END IF;
    END LOOP;

    v_resolution_note := '업체 정보 수정 완료: ' || v_vendor_name;

  ELSIF v_inquiry_type = 'shipping_edit' THEN
    -- 택배 주소록 수정 요청: shipping_contacts 갱신(회사/주소는 없으면 생성)
    IF NULLIF(v_payload->>'address_id', '') IS NULL THEN
      RAISE EXCEPTION 'address_id missing';
    END IF;
    v_contact_uuid := (v_payload->>'address_id')::uuid;

    v_shipping := COALESCE(v_payload->'shipping', '{}'::jsonb);
    v_company_name := NULLIF(TRIM(COALESCE(v_shipping->>'company_name', '')), '');
    v_contact_name := NULLIF(TRIM(COALESCE(v_shipping->>'contact_name_only', '')), '');
    IF v_company_name IS NULL OR v_contact_name IS NULL THEN
      RAISE EXCEPTION 'company_name or contact_name missing';
    END IF;

    SELECT id INTO v_company_id
    FROM public.shipping_companies
    WHERE name = v_company_name
    LIMIT 1;
    IF v_company_id IS NULL THEN
      INSERT INTO public.shipping_companies (name)
      VALUES (v_company_name)
      RETURNING id INTO v_company_id;
    END IF;

    IF v_shipping ? 'address' THEN
      v_addr := NULLIF(TRIM(COALESCE(v_shipping->>'address', '')), '');
      v_addr_id := NULL;
      IF v_addr IS NOT NULL THEN
        SELECT id INTO v_addr_id
        FROM public.shipping_company_addresses
        WHERE company_id = v_company_id AND address = v_addr
        LIMIT 1;
        IF v_addr_id IS NULL THEN
          INSERT INTO public.shipping_company_addresses (company_id, address)
          VALUES (v_company_id, v_addr)
          RETURNING id INTO v_addr_id;
        END IF;
      END IF;

      UPDATE public.shipping_contacts SET
        company_id = v_company_id,
        address_id = v_addr_id,
        name = v_contact_name,
        title = NULLIF(TRIM(COALESCE(v_shipping->>'contact_title', '')), ''),
        memo = NULLIF(TRIM(COALESCE(v_shipping->>'contact_memo', '')), ''),
        phone = NULLIF(TRIM(COALESCE(v_shipping->>'phone', '')), ''),
        mobile = NULLIF(TRIM(COALESCE(v_shipping->>'mobile', '')), ''),
        email = NULLIF(TRIM(COALESCE(v_shipping->>'email', '')), ''),
        updated_at = now()
      WHERE id = v_contact_uuid;
    ELSE
      -- address 키가 없으면 기존 주소 연결 유지
      UPDATE public.shipping_contacts SET
        company_id = v_company_id,
        name = v_contact_name,
        title = NULLIF(TRIM(COALESCE(v_shipping->>'contact_title', '')), ''),
        memo = NULLIF(TRIM(COALESCE(v_shipping->>'contact_memo', '')), ''),
        phone = NULLIF(TRIM(COALESCE(v_shipping->>'phone', '')), ''),
        mobile = NULLIF(TRIM(COALESCE(v_shipping->>'mobile', '')), ''),
        email = NULLIF(TRIM(COALESCE(v_shipping->>'email', '')), ''),
        updated_at = now()
      WHERE id = v_contact_uuid;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'shipping contact not found';
    END IF;

    v_resolution_note := '택배 주소록 수정 완료: ' || v_company_name;
  END IF;

  UPDATE public.support_inquires
  SET status = 'resolved',
      processed_at = now(),
      resolution_note = COALESCE(v_resolution_note, resolution_note)
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
