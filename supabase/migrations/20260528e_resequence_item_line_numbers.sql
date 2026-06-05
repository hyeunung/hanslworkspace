-- 품목 보관(soft delete) 시 남은 활성 품목의 line_number를 빈 번호 없이 1..N으로 재정렬.
-- 예) 1~10번 중 3번 삭제 → 남은 항목이 1,2,3,...,9로 다시 매겨짐 (3번이 비지 않음).
--
-- SECURITY DEFINER 이유:
--  - 부모 발주 보관 여부를 RLS 우회로 정확히 확인(보관된 발주의 품목은 재정렬 불필요 → cascade 시 낭비/부작용 방지)
--  - 재정렬로 발생하는 형제 품목 UPDATE가 set_request_info_on_items 트리거를 발동시키는데,
--    그 트리거가 부모를 못 읽어 필드를 NULL로 덮는 일을 방지

CREATE OR REPLACE FUNCTION public.resequence_purchase_item_line_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_request_id integer;
  v_parent_deleted boolean;
BEGIN
  v_request_id := COALESCE(NEW.purchase_request_id, OLD.purchase_request_id);
  IF v_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 부모 발주가 이미 보관된 상태면 재정렬 불필요 (전체 삭제 cascade 등)
  SELECT (deleted_at IS NOT NULL) INTO v_parent_deleted
  FROM purchase_requests WHERE id = v_request_id;
  IF COALESCE(v_parent_deleted, false) THEN
    RETURN NULL;
  END IF;

  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY line_number NULLS LAST, id) AS rn
    FROM purchase_request_items
    WHERE purchase_request_id = v_request_id
      AND deleted_at IS NULL
  )
  UPDATE purchase_request_items p
  SET line_number = o.rn
  FROM ordered o
  WHERE p.id = o.id
    AND p.line_number IS DISTINCT FROM o.rn;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_resequence_items_on_soft_delete ON public.purchase_request_items;
CREATE TRIGGER trg_resequence_items_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.purchase_request_items
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION resequence_purchase_item_line_numbers();

REVOKE EXECUTE ON FUNCTION public.resequence_purchase_item_line_numbers() FROM PUBLIC, anon, authenticated;
