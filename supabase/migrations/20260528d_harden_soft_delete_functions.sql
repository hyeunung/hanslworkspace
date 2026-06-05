-- soft delete 관련 함수 보안 강화 (Supabase security advisor 대응)
-- 1) BEFORE 트리거 함수의 search_path 고정
-- 2) SECURITY DEFINER 트리거 함수는 트리거로만 쓰이므로 RPC 직접 호출 권한 회수

ALTER FUNCTION public.mark_purchase_number_on_soft_delete() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.cascade_soft_delete_to_items() FROM PUBLIC, anon, authenticated;
