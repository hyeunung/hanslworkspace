-- 매칭 발주/수주번호 집계를 수량일치 완료 시점으로 게이트
-- 추출 단계 자동매칭(matched_purchase_id)은 잠정값이므로 노출하지 않고,
-- 수량일치(quantity_match_confirmed_at) 완료된 명세서만 번호를 집계한다.
-- 수량일치가 해제되면 집계도 NULL로 되돌린다.

-- 1) 재계산 함수: 수량일치 전이면 항상 NULL
CREATE OR REPLACE FUNCTION public.refresh_statement_matched_order_numbers(p_statement_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.transaction_statements ts
  SET matched_order_numbers = CASE
    WHEN ts.quantity_match_confirmed_at IS NULL THEN NULL
    ELSE (
      SELECT string_agg(DISTINCT n.num, ', ' ORDER BY n.num)
      FROM public.transaction_statement_items i
      JOIN public.purchase_requests pr ON pr.id = i.matched_purchase_id
      CROSS JOIN LATERAL (VALUES (pr.purchase_order_number), (pr.sales_order_number)) AS n(num)
      WHERE i.statement_id = p_statement_id
        AND n.num IS NOT NULL
        AND btrim(n.num) <> ''
    )
  END
  WHERE ts.id = p_statement_id;
$$;

-- 2) 수량일치 확정/해제 시점에 같은 행에서 즉시 재계산 (BEFORE 트리거 → 재귀 UPDATE 없음)
CREATE OR REPLACE FUNCTION public.trg_ts_qm_sync_matched_order_numbers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity_match_confirmed_at IS NULL THEN
    NEW.matched_order_numbers := NULL;
  ELSE
    SELECT string_agg(DISTINCT n.num, ', ' ORDER BY n.num)
    INTO NEW.matched_order_numbers
    FROM public.transaction_statement_items i
    JOIN public.purchase_requests pr ON pr.id = i.matched_purchase_id
    CROSS JOIN LATERAL (VALUES (pr.purchase_order_number), (pr.sales_order_number)) AS n(num)
    WHERE i.statement_id = NEW.id
      AND n.num IS NOT NULL
      AND btrim(n.num) <> '';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ts_qm_sync_matched_order_numbers ON public.transaction_statements;
CREATE TRIGGER trg_ts_qm_sync_matched_order_numbers
BEFORE UPDATE OF quantity_match_confirmed_at
ON public.transaction_statements
FOR EACH ROW
WHEN (old.quantity_match_confirmed_at IS DISTINCT FROM new.quantity_match_confirmed_at)
EXECUTE FUNCTION public.trg_ts_qm_sync_matched_order_numbers();

-- 3) 재백필: 수량일치 안 된 명세서는 NULL, 완료된 명세서는 집계 유지/갱신
UPDATE public.transaction_statements
SET matched_order_numbers = NULL
WHERE quantity_match_confirmed_at IS NULL
  AND matched_order_numbers IS NOT NULL;

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
WHERE ts.id = agg.statement_id
  AND ts.quantity_match_confirmed_at IS NOT NULL;
