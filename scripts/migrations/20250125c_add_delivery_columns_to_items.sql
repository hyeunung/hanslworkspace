-- 입고 개별 승인을 위한 purchase_request_items 테이블 컬럼 추가
-- 각 품목별 입고 처리를 위한 컬럼들

DO $$
BEGIN
    -- is_received 컬럼 추가 (기본값: false)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'is_received') THEN
        ALTER TABLE purchase_request_items ADD COLUMN is_received BOOLEAN DEFAULT false NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received ON purchase_request_items(is_received);
    END IF;

    -- received_quantity 컬럼 추가 (부분 입고를 위한 수량)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'received_quantity') THEN
        ALTER TABLE purchase_request_items ADD COLUMN received_quantity DECIMAL(10,2) DEFAULT 0;
    END IF;

    -- received_date 컬럼 추가 (입고 처리 날짜)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'received_date') THEN
        ALTER TABLE purchase_request_items ADD COLUMN received_date TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_purchase_request_items_received_date ON purchase_request_items(received_date);
    END IF;

    -- received_by 컬럼 추가 (입고 처리자 ID)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'received_by') THEN
        ALTER TABLE purchase_request_items ADD COLUMN received_by UUID REFERENCES employees(id);
        CREATE INDEX IF NOT EXISTS idx_purchase_request_items_received_by ON purchase_request_items(received_by);
    END IF;

    -- received_by_name 컬럼 추가 (입고 처리자 이름)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'received_by_name') THEN
        ALTER TABLE purchase_request_items ADD COLUMN received_by_name VARCHAR(100);
    END IF;

    -- delivery_notes 컬럼 추가 (입고 메모)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'delivery_notes') THEN
        ALTER TABLE purchase_request_items ADD COLUMN delivery_notes TEXT;
    END IF;

    -- delivery_status 컬럼 추가 ('pending', 'partial', 'received')
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'purchase_request_items' AND column_name = 'delivery_status') THEN
        ALTER TABLE purchase_request_items ADD COLUMN delivery_status VARCHAR(20) DEFAULT 'pending' 
        CHECK (delivery_status IN ('pending', 'partial', 'received'));
        CREATE INDEX IF NOT EXISTS idx_purchase_request_items_delivery_status ON purchase_request_items(delivery_status);
    END IF;
END $$;

-- 입고 처리를 위한 복합 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_delivery_composite 
ON purchase_request_items(purchase_request_id, delivery_status, is_received);

-- 코멘트 추가
COMMENT ON COLUMN purchase_request_items.is_received IS '입고 완료 여부';
COMMENT ON COLUMN purchase_request_items.received_quantity IS '입고된 수량 (부분 입고 지원)';
COMMENT ON COLUMN purchase_request_items.received_date IS '입고 처리 일자';
COMMENT ON COLUMN purchase_request_items.received_by IS '입고 처리자 ID (FK)';
COMMENT ON COLUMN purchase_request_items.received_by_name IS '입고 처리자 이름';
COMMENT ON COLUMN purchase_request_items.delivery_notes IS '입고 관련 메모';
COMMENT ON COLUMN purchase_request_items.delivery_status IS '입고 상태 (pending/partial/received)';

-- 입고 상태 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_delivery_status()
RETURNS TRIGGER AS $$
BEGIN
    -- received_quantity가 변경되었을 때 상태 업데이트
    IF NEW.received_quantity >= NEW.quantity THEN
        NEW.delivery_status := 'received';
        NEW.is_received := true;
        IF NEW.received_date IS NULL THEN
            NEW.received_date := NOW();
        END IF;
    ELSIF NEW.received_quantity > 0 THEN
        NEW.delivery_status := 'partial';
        NEW.is_received := false;
    ELSE
        NEW.delivery_status := 'pending';
        NEW.is_received := false;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_delivery_status ON purchase_request_items;
CREATE TRIGGER trigger_update_delivery_status
    BEFORE UPDATE ON purchase_request_items
    FOR EACH ROW
    WHEN (OLD.received_quantity IS DISTINCT FROM NEW.received_quantity)
    EXECUTE FUNCTION update_delivery_status();

-- 전체 발주의 입고 상태 체크 함수
CREATE OR REPLACE FUNCTION check_purchase_request_delivery_completion()
RETURNS TRIGGER AS $$
DECLARE
    total_items INTEGER;
    received_items INTEGER;
    partially_received_items INTEGER;
BEGIN
    -- 해당 발주의 총 품목 수와 완료된 품목 수 계산
    SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN delivery_status = 'received' THEN 1 END) as received,
        COUNT(CASE WHEN delivery_status = 'partial' THEN 1 END) as partial
    INTO total_items, received_items, partially_received_items
    FROM purchase_request_items 
    WHERE purchase_request_id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id);
    
    -- 모든 품목이 입고 완료되었을 때 purchase_requests 테이블 업데이트
    IF received_items = total_items THEN
        UPDATE purchase_requests 
        SET 
            is_received = true,
            received_at = NOW()
        WHERE id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id)
        AND is_received = false;
    -- 일부 품목이라도 입고되지 않았을 때 is_received를 false로 설정
    ELSE
        UPDATE purchase_requests 
        SET 
            is_received = false,
            received_at = NULL
        WHERE id = COALESCE(NEW.purchase_request_id, OLD.purchase_request_id)
        AND is_received = true;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 발주 완료 체크 트리거
DROP TRIGGER IF EXISTS trigger_check_delivery_completion ON purchase_request_items;
CREATE TRIGGER trigger_check_delivery_completion
    AFTER INSERT OR UPDATE OR DELETE ON purchase_request_items
    FOR EACH ROW
    EXECUTE FUNCTION check_purchase_request_delivery_completion();

-- 기존 데이터 마이그레이션 (is_received가 true인 purchase_requests의 모든 items를 received로 설정)
UPDATE purchase_request_items 
SET 
    is_received = true,
    delivery_status = 'received',
    received_quantity = quantity,
    received_date = pr.received_at
FROM purchase_requests pr
WHERE purchase_request_items.purchase_request_id = pr.id 
AND pr.is_received = true
AND purchase_request_items.is_received = false;