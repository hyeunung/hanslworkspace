-- soft delete 쓰기용 SECURITY DEFINER RPC.
--
-- 배경: purchase_requests/purchase_request_items의 SELECT RLS 정책에 deleted_at IS NULL 조건이 있으면,
-- 이 환경의 PostgreSQL은 그 조건을 UPDATE의 새 행 검사(WITH CHECK)에도 적용한다. 그 결과
-- authenticated 역할이 직접 UPDATE로 deleted_at을 채우면 "new row violates RLS policy"로 차단된다.
-- (읽기 숨김 RLS와 같은 역할의 직접 soft-delete UPDATE가 양립 불가)
--
-- 해결: soft-delete 쓰기는 SECURITY DEFINER 함수로 수행해 RLS를 우회한다.
-- 기존 하드삭제도 누구나 가능했으므로(allow_delete_* USING true) 권한 수준은 동일(오히려 복구 가능해 개선).
-- 읽기 숨김은 기존 restrictive SELECT 정책이 그대로 담당한다.

CREATE OR REPLACE FUNCTION public.soft_delete_purchase_order(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- cascade 트리거가 품목 보관 + 발주번호/수주번호 _D 처리
  UPDATE public.purchase_requests
  SET deleted_at = now()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_purchase_order(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  UPDATE public.purchase_requests
  SET deleted_at = NULL
  WHERE id = p_id AND deleted_at IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_purchase_items(p_item_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- line_number 재정렬 트리거가 남은 활성 품목을 1..N으로 정리
  UPDATE public.purchase_request_items
  SET deleted_at = now()
  WHERE id = ANY(p_item_ids) AND deleted_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.soft_delete_purchase_order(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_purchase_order(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_purchase_items(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_purchase_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_purchase_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_purchase_items(bigint[]) TO authenticated;
