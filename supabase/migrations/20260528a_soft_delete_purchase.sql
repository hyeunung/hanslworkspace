-- 발주/품목 soft delete
-- 문의하기의 "발주 전체 삭제" / "품목별 삭제"를 실제 DELETE 대신 deleted_at 마킹으로 변경.
-- UI(인증 사용자)에서는 RESTRICTIVE RLS 정책으로 숨기고, DB에는 데이터를 보존한다.
-- service_role(엣지펑션/슬랙봇 등)은 RLS를 우회하므로 보존된 행을 계속 볼 수 있다.
-- deleted_at은 UTC(now())로 저장한다 (조회/표시 시 한국시간으로 변환).

-- 1) deleted_at 칼럼 추가 (nullable, 기본 NULL = 미삭제)
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2) RESTRICTIVE SELECT 정책: deleted_at IS NULL 행만 노출.
--    기존 permissive SELECT 정책들과 AND로 결합되어, 모든 조회에서 삭제된 행이 자동으로 숨겨진다.
DROP POLICY IF EXISTS hide_soft_deleted_purchase_requests ON public.purchase_requests;
CREATE POLICY hide_soft_deleted_purchase_requests
  ON public.purchase_requests
  AS RESTRICTIVE
  FOR SELECT
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS hide_soft_deleted_purchase_request_items ON public.purchase_request_items;
CREATE POLICY hide_soft_deleted_purchase_request_items
  ON public.purchase_request_items
  AS RESTRICTIVE
  FOR SELECT
  USING (deleted_at IS NULL);

-- 3) 트리거 가드: deleted_at만 바꾸는 soft-delete UPDATE가 부수효과를 일으키지 않도록.
--    결제완료 발주의 PO 자동생성은 삭제(보관)된 행에 대해서는 건너뛴다.
CREATE OR REPLACE FUNCTION public.on_purchase_request_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 결제완료 시 자동 발주서 생성 (is_po_generated 조건 제거)
  IF NEW.is_payment_completed = TRUE
     AND NEW.progress_type = '일반'
     AND NEW.deleted_at IS NULL THEN
    PERFORM call_edge_generate_po(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) 입고 완료 집계: 보관(soft-delete)된 품목은 집계에서 제외하고,
--    품목 soft-delete 전환 시에도 부모 발주 상태를 재집계한다.
CREATE OR REPLACE FUNCTION public.check_purchase_request_delivery_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_items INTEGER;
    received_items INTEGER;
    target_purchase_id INTEGER;
BEGIN
    target_purchase_id := COALESCE(NEW.purchase_request_id, OLD.purchase_request_id);

    -- is_received 변화가 없고, soft-delete 전환(NULL -> NOT NULL)도 아니면 집계 생략
    IF TG_OP = 'UPDATE' THEN
      IF COALESCE(NEW.is_received, false) = COALESCE(OLD.is_received, false)
         AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
        RETURN NEW;
      END IF;
    END IF;

    SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN is_received = true THEN 1 END) as received
    INTO total_items, received_items
    FROM purchase_request_items
    WHERE purchase_request_id = target_purchase_id
      AND deleted_at IS NULL;

    IF received_items = total_items AND total_items > 0 THEN
        UPDATE purchase_requests
        SET
            is_received = true,
            received_at = NOW()
        WHERE id = target_purchase_id
        AND is_received = false;
    ELSE
        UPDATE purchase_requests
        SET
            is_received = false,
            received_at = NULL
        WHERE id = target_purchase_id
        AND is_received = true;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 5) 결제 완료 집계: 보관(soft-delete)된 품목은 집계에서 제외하고,
--    품목 soft-delete 전환 시에도 부모 발주 상태를 재집계한다.
CREATE OR REPLACE FUNCTION public.check_purchase_request_payment_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_items INTEGER;
    completed_items INTEGER;
    target_purchase_id INTEGER;
BEGIN
    target_purchase_id := COALESCE(NEW.purchase_request_id, OLD.purchase_request_id);

    -- is_payment_completed 변화가 없고, soft-delete 전환(NULL -> NOT NULL)도 아니면 집계 생략
    IF TG_OP = 'UPDATE' THEN
      IF COALESCE(NEW.is_payment_completed, false) = COALESCE(OLD.is_payment_completed, false)
         AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
        RETURN NEW;
      END IF;
    END IF;

    SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN is_payment_completed = true THEN 1 END) as completed
    INTO total_items, completed_items
    FROM purchase_request_items
    WHERE purchase_request_id = target_purchase_id
      AND deleted_at IS NULL;

    IF completed_items = total_items AND total_items > 0 THEN
        UPDATE purchase_requests
        SET
            is_payment_completed = true,
            payment_completed_at = NOW()
        WHERE id = target_purchase_id
        AND is_payment_completed = false;
    ELSE
        UPDATE purchase_requests
        SET
            is_payment_completed = false,
            payment_completed_at = NULL
        WHERE id = target_purchase_id
        AND is_payment_completed = true;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;
