-- 구매완료 자동 체크 트리거 추가
-- 모든 items가 구매완료되면 purchase_requests도 자동으로 구매완료 처리

-- 구매완료 체크 함수
CREATE OR REPLACE FUNCTION check_purchase_request_payment_completion()
RETURNS TRIGGER AS $$
DECLARE
    total_items INTEGER;
    completed_items INTEGER;
BEGIN
    -- 해당 발주의 총 품목 수와 구매완료된 품목 수 계산
    SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_payment_completed = true THEN 1 END) as completed
    INTO total_items, completed_items
    FROM purchase_request_items 
    WHERE purchase_request_id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id);
    
    -- 모든 품목이 구매 완료되었을 때 purchase_requests 테이블 업데이트
    IF completed_items = total_items AND total_items > 0 THEN
        UPDATE purchase_requests 
        SET 
            is_payment_completed = true,
            payment_completed_at = NOW()
        WHERE id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id)
        AND is_payment_completed = false;
    -- 일부 품목이라도 구매 미완료일 때 is_payment_completed를 false로 설정
    ELSE
        UPDATE purchase_requests 
        SET 
            is_payment_completed = false,
            payment_completed_at = NULL
        WHERE id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id)
        AND is_payment_completed = true;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 구매완료 체크 트리거
DROP TRIGGER IF EXISTS trigger_check_payment_completion ON purchase_request_items;
CREATE TRIGGER trigger_check_payment_completion
    AFTER INSERT OR UPDATE OR DELETE ON purchase_request_items
    FOR EACH ROW
    EXECUTE FUNCTION check_purchase_request_payment_completion();

-- 기존 데이터에 대해 트리거 로직 적용 (모든 items가 구매완료된 경우)
UPDATE purchase_requests pr
SET 
    is_payment_completed = true,
    payment_completed_at = NOW()
WHERE id IN (
    SELECT purchase_request_id
    FROM purchase_request_items
    GROUP BY purchase_request_id
    HAVING COUNT(*) = COUNT(CASE WHEN is_payment_completed = true THEN 1 END)
    AND COUNT(*) > 0
)
AND pr.is_payment_completed = false;

