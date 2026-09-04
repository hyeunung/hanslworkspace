-- 거래명세서에 매칭된 발주/수주번호 집계 칼럼 추가
-- 명세서 자체에는 발주/수주번호가 인쇄되어 있지 않은 경우가 많아,
-- 품목 매칭(matched_purchase_id) 결과의 발주번호/수주번호를 명세서 단위로 모아
-- 목록 검색·표시에 활용한다. 품목 매칭 변경/발주번호 재발번 시 트리거로 자동 동기화.

ALTER TABLE public.transaction_statements
  ADD COLUMN IF NOT EXISTS matched_order_numbers text;

COMMENT ON COLUMN public.transaction_statements.matched_order_numbers IS
  '매칭된 발주번호/수주번호 집계 (", " 구분, 트리거 자동 동기화, 검색용)';

-- 단일 명세서의 집계값 재계산
-- SECURITY DEFINER: 품목 갱신 주체(authenticated)의 RLS에 막히지 않고 명세서를 갱신하기 위함
CREATE OR REPLACE FUNCTION public.refresh_statement_matched_order_numbers(p_statement_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.transaction_statements ts
  SET matched_order_numbers = (
    SELECT string_agg(DISTINCT n.num, ', ' ORDER BY n.num)
    FROM public.transaction_statement_items i
    JOIN public.purchase_requests pr ON pr.id = i.matched_purchase_id
    CROSS JOIN LATERAL (VALUES (pr.purchase_order_number), (pr.sales_order_number)) AS n(num)
    WHERE i.statement_id = p_statement_id
      AND n.num IS NOT NULL
      AND btrim(n.num) <> ''
  )
  WHERE ts.id = p_statement_id;
$$;

-- 품목 매칭 변경 시 동기화
CREATE OR REPLACE FUNCTION public.trg_tsi_sync_matched_order_numbers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_statement_matched_order_numbers(OLD.statement_id);
    RETURN NULL;
  END IF;
  PERFORM public.refresh_statement_matched_order_numbers(NEW.statement_id);
  IF TG_OP = 'UPDATE' AND OLD.statement_id IS DISTINCT FROM NEW.statement_id THEN
    PERFORM public.refresh_statement_matched_order_numbers(OLD.statement_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tsi_sync_matched_order_numbers ON public.transaction_statement_items;
CREATE TRIGGER trg_tsi_sync_matched_order_numbers
AFTER INSERT OR DELETE OR UPDATE OF matched_purchase_id, statement_id
ON public.transaction_statement_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_tsi_sync_matched_order_numbers();

-- 발주번호/수주번호 자체가 바뀔 때(재발번, 보관 _D 접미사 등) 연결된 명세서 동기화
CREATE OR REPLACE FUNCTION public.trg_pr_sync_statement_order_numbers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement_id uuid;
BEGIN
  FOR v_statement_id IN
    SELECT DISTINCT statement_id
    FROM public.transaction_statement_items
    WHERE matched_purchase_id = NEW.id
  LOOP
    PERFORM public.refresh_statement_matched_order_numbers(v_statement_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr_sync_statement_order_numbers ON public.purchase_requests;
CREATE TRIGGER trg_pr_sync_statement_order_numbers
AFTER UPDATE OF purchase_order_number, sales_order_number
ON public.purchase_requests
FOR EACH ROW
WHEN (
  old.purchase_order_number IS DISTINCT FROM new.purchase_order_number
  OR old.sales_order_number IS DISTINCT FROM new.sales_order_number
)
EXECUTE FUNCTION public.trg_pr_sync_statement_order_numbers();

-- 기존 데이터 백필
UPDATE public.transaction_statements ts
SET matched_order_numbers = agg.nums
FROM (
  SELECT i.statement_id, string_agg(DISTINCT n.num, ', ' ORDER BY n.num) AS nums
  FROM public.transaction_statement_items i
  JOIN public.purchase_requests pr ON pr.id = i.matched_purchase_id
  CROSS JOIN LATERAL (VALUES (pr.purchase_order_number), (pr.sales_order_number)) AS n(num)
  WHERE n.num IS NOT NULL AND btrim(n.num) <> ''
  GROUP BY i.statement_id
) agg
WHERE ts.id = agg.statement_id;
