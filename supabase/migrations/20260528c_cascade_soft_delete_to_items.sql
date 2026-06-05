-- 발주 전체 보관(soft delete) 시 품목에도 deleted_at을 함께 찍어 직접 품목 조회에서도 숨김.
-- (PostgREST 임베디드 조인은 부모 RLS를 따르지만, 품목을 직접 조회하는 코드가 다수 존재하므로 필요)
--
-- SECURITY DEFINER 이유: cascade가 인증 사용자 권한으로 돌면, 보관된 부모가 RLS로 숨겨져
-- 품목 트리거(set_request_info_on_items)가 부모를 못 읽고 품목 필드를 NULL로 덮어쓴다.
-- DEFINER로 RLS를 우회하면 중첩 트리거가 부모를 정상 조회 → 발주번호(_D)/거래처/요청자가 올바르게 복사된다.
--
-- 복구(deleted_at -> NULL) 시에는 "부모와 동일 시각에 함께 보관된 품목"만 되살린다.
-- 개별 삭제(품목별 삭제)된 품목은 시각이 달라 그대로 보관 상태로 유지된다.

CREATE OR REPLACE FUNCTION public.cascade_soft_delete_to_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE purchase_request_items
       SET deleted_at = NEW.deleted_at
     WHERE purchase_request_id = NEW.id
       AND deleted_at IS NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE purchase_request_items
       SET deleted_at = NULL
     WHERE purchase_request_id = NEW.id
       AND deleted_at = OLD.deleted_at;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cascade_soft_delete_to_items ON public.purchase_requests;
CREATE TRIGGER trg_cascade_soft_delete_to_items
  AFTER UPDATE ON public.purchase_requests
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION cascade_soft_delete_to_items();
