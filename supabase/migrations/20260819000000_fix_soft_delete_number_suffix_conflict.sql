-- 발주 보관(soft delete) 시 _D 접미사 중복 충돌 해결
-- 문제: 같은 발주번호가 재발번되면(이전 건 보관 후 동일 번호로 재생성) 보관 시
--       기존 '<번호>_D' 와 충돌해 unique_purchase_order_number 위반 → 삭제요청 완료 처리 실패
-- 해결: 이미 사용 중인 접미사면 _D2, _D3 ... 로 자동 증가시켜 유일한 번호 부여
--       복구 시에는 _D / _D<n> 접미사를 제거하되, 기본 번호가 이미 사용 중이면 접미사를 유지(에러 대신)

CREATE OR REPLACE FUNCTION public.mark_purchase_number_on_soft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base TEXT;
  v_candidate TEXT;
  v_n INT;
BEGIN
  -- 보관 전환 (NULL -> NOT NULL): 발주번호/수주번호 끝에 _D(중복 시 _D2, _D3 ...) 부여
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.purchase_order_number IS NOT NULL AND NEW.purchase_order_number <> ''
       AND NEW.purchase_order_number !~ '_D[0-9]*$' THEN
      v_base := NEW.purchase_order_number || '_D';
      v_candidate := v_base;
      v_n := 1;
      WHILE EXISTS (
        SELECT 1 FROM public.purchase_requests pr
        WHERE pr.purchase_order_number = v_candidate
          AND pr.id <> NEW.id
      ) LOOP
        v_n := v_n + 1;
        v_candidate := v_base || v_n::text;
      END LOOP;
      NEW.purchase_order_number := v_candidate;
    END IF;

    IF NEW.sales_order_number IS NOT NULL AND NEW.sales_order_number <> ''
       AND NEW.sales_order_number !~ '_D[0-9]*$' THEN
      NEW.sales_order_number := NEW.sales_order_number || '_D';
    END IF;

  -- 복구 전환 (NOT NULL -> NULL): _D / _D<n> 접미사 제거 (기본 번호가 비어 있을 때만)
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.purchase_order_number IS NOT NULL AND NEW.purchase_order_number ~ '_D[0-9]*$' THEN
      v_base := regexp_replace(NEW.purchase_order_number, '_D[0-9]*$', '');
      IF v_base <> '' AND NOT EXISTS (
        SELECT 1 FROM public.purchase_requests pr
        WHERE pr.purchase_order_number = v_base
          AND pr.id <> NEW.id
      ) THEN
        NEW.purchase_order_number := v_base;
      END IF;
    END IF;

    IF NEW.sales_order_number IS NOT NULL AND NEW.sales_order_number ~ '_D[0-9]*$' THEN
      NEW.sales_order_number := regexp_replace(NEW.sales_order_number, '_D[0-9]*$', '');
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
