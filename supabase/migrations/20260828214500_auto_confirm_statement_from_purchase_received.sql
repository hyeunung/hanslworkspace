-- 구매 화면에서 매칭된 발주 품목 전체가 거래명세서 확인(is_statement_received) 완료되면
-- 거래명세서(transaction_statements)도 자동으로 확정(confirmed) 처리한다.
-- 배경: 수량/금액 체크는 실데이터 파생값이라 구매 쪽 수동 처리가 자동 반영되지만,
--       확정 상태는 상세모달 확인 버튼으로만 기록되어 비대칭이 있었음.

CREATE OR REPLACE FUNCTION public.try_auto_confirm_statement(p_statement_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stmt record;
  v_total int;
  v_unmatched int;
  v_not_received int;
  v_all_received boolean;
  v_actor text;
BEGIN
  SELECT * INTO v_stmt FROM transaction_statements WHERE id = p_statement_id FOR UPDATE;
  IF NOT FOUND OR v_stmt.status <> 'extracted' THEN
    RETURN false;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE tsi.matched_item_id IS NULL),
         count(*) FILTER (WHERE tsi.matched_item_id IS NOT NULL AND pri.is_statement_received IS NOT TRUE),
         bool_and(pri.is_received IS TRUE)
    INTO v_total, v_unmatched, v_not_received, v_all_received
  FROM transaction_statement_items tsi
  LEFT JOIN purchase_request_items pri ON pri.id = tsi.matched_item_id
  WHERE tsi.statement_id = p_statement_id;

  -- 품목이 없거나, 매칭 안 된 품목이 있거나, 구매 쪽 거래명세서 확인이 안 된 품목이 있으면 자동 확정하지 않음
  IF v_total IS NULL OR v_total = 0 OR v_unmatched > 0 OR v_not_received > 0 THEN
    RETURN false;
  END IF;

  -- 구매 화면에서 거래명세서 확인을 누른 사람을 확정자로 기록
  SELECT pri.statement_received_by_name INTO v_actor
  FROM transaction_statement_items tsi
  JOIN purchase_request_items pri ON pri.id = tsi.matched_item_id
  WHERE tsi.statement_id = p_statement_id
    AND pri.statement_received_by_name IS NOT NULL
  ORDER BY pri.statement_received_date DESC NULLS LAST
  LIMIT 1;

  UPDATE transaction_statements SET
    status = 'confirmed',
    confirmed_at = now(),
    confirmed_by_name = COALESCE(v_actor, '자동확정(구매연동)'),
    all_amounts_matched = true,
    manager_confirmed_at = COALESCE(manager_confirmed_at, now()),
    manager_confirmed_by_name = COALESCE(manager_confirmed_by_name, v_actor, '자동확정(구매연동)'),
    all_quantities_matched = CASE WHEN v_all_received THEN true ELSE all_quantities_matched END,
    quantity_match_confirmed_at = CASE
      WHEN quantity_match_confirmed_at IS NULL AND v_all_received THEN now()
      ELSE quantity_match_confirmed_at END,
    quantity_match_confirmed_by_name = CASE
      WHEN quantity_match_confirmed_by_name IS NULL AND v_all_received THEN COALESCE(v_actor, '자동확정(구매연동)')
      ELSE quantity_match_confirmed_by_name END,
    updated_at = now()
  WHERE id = p_statement_id;

  UPDATE transaction_statement_items SET
    is_confirmed = true,
    confirmed_quantity = COALESCE(confirmed_quantity, extracted_quantity),
    confirmed_unit_price = COALESCE(confirmed_unit_price, extracted_unit_price),
    confirmed_amount = COALESCE(confirmed_amount, extracted_amount),
    updated_at = now()
  WHERE statement_id = p_statement_id;

  INSERT INTO transaction_statement_audit_logs
    (statement_id, action, previous_status, new_status, reason, actor_name, source)
  VALUES
    (p_statement_id, 'confirmed', 'extracted', 'confirmed',
     '매칭된 발주 품목 전체가 구매 화면에서 거래명세서 확인 완료되어 자동 확정',
     v_actor, 'auto_sync_purchase_received');

  RETURN true;
END;
$$;

-- 경로 1: 구매 화면에서 거래명세서 확인 체크 시 → 연결된 명세서 자동 확정 시도
CREATE OR REPLACE FUNCTION public.trg_pri_statement_received_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.is_statement_received IS TRUE
     AND OLD.is_statement_received IS DISTINCT FROM NEW.is_statement_received THEN
    FOR r IN
      SELECT DISTINCT tsi.statement_id
      FROM transaction_statement_items tsi
      WHERE tsi.matched_item_id = NEW.id
    LOOP
      PERFORM try_auto_confirm_statement(r.statement_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_pri_statement_received_sync ON purchase_request_items;
CREATE TRIGGER after_pri_statement_received_sync
AFTER UPDATE OF is_statement_received ON purchase_request_items
FOR EACH ROW
EXECUTE FUNCTION trg_pri_statement_received_sync();

-- 경로 2: 명세서가 extracted 상태가 될 때(재추출 포함) 이미 구매 쪽 처리가 끝나 있으면 자동 확정
CREATE OR REPLACE FUNCTION public.trg_ts_extracted_auto_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM try_auto_confirm_statement(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_ts_extracted_auto_confirm ON transaction_statements;
CREATE TRIGGER after_ts_extracted_auto_confirm
AFTER UPDATE OF status ON transaction_statements
FOR EACH ROW
WHEN (NEW.status = 'extracted' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION trg_ts_extracted_auto_confirm();

-- 경로 3: 상세모달에서 품목 매칭을 수정했을 때도 자동 확정 시도
CREATE OR REPLACE FUNCTION public.trg_tsi_matched_auto_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.matched_item_id IS NOT NULL
     AND OLD.matched_item_id IS DISTINCT FROM NEW.matched_item_id THEN
    PERFORM try_auto_confirm_statement(NEW.statement_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_tsi_matched_auto_confirm ON transaction_statement_items;
CREATE TRIGGER after_tsi_matched_auto_confirm
AFTER UPDATE OF matched_item_id ON transaction_statement_items
FOR EACH ROW
EXECUTE FUNCTION trg_tsi_matched_auto_confirm();
