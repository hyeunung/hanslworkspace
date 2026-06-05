-- 발주 보관(soft delete) 시 발주번호/수주번호에 _D 접미사 부여 (복구 시 제거)
-- deleted_at 전환을 감지하는 BEFORE UPDATE 트리거. 클라이언트는 deleted_at만 세팅하면 됨.
-- 발주번호는 기존 propagate_request_info_change 트리거가 품목에도 전파한다.

CREATE OR REPLACE FUNCTION public.mark_purchase_number_on_soft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 보관 전환 (NULL -> NOT NULL): 발주번호/수주번호 끝에 _D 부여
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.purchase_order_number IS NOT NULL AND NEW.purchase_order_number <> ''
       AND RIGHT(NEW.purchase_order_number, 2) <> '_D' THEN
      NEW.purchase_order_number := NEW.purchase_order_number || '_D';
    END IF;
    IF NEW.sales_order_number IS NOT NULL AND NEW.sales_order_number <> ''
       AND RIGHT(NEW.sales_order_number, 2) <> '_D' THEN
      NEW.sales_order_number := NEW.sales_order_number || '_D';
    END IF;

  -- 복구 전환 (NOT NULL -> NULL): _D 접미사 제거
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.purchase_order_number IS NOT NULL AND RIGHT(NEW.purchase_order_number, 2) = '_D' THEN
      NEW.purchase_order_number := LEFT(NEW.purchase_order_number, LENGTH(NEW.purchase_order_number) - 2);
    END IF;
    IF NEW.sales_order_number IS NOT NULL AND RIGHT(NEW.sales_order_number, 2) = '_D' THEN
      NEW.sales_order_number := LEFT(NEW.sales_order_number, LENGTH(NEW.sales_order_number) - 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mark_purchase_number_on_soft_delete ON public.purchase_requests;
CREATE TRIGGER trg_mark_purchase_number_on_soft_delete
  BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION mark_purchase_number_on_soft_delete();
