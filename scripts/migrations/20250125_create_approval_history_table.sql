-- 승인 히스토리 테이블 생성
-- 승인/반려 처리 이력을 추적하기 위한 테이블

CREATE TABLE IF NOT EXISTS approval_history (
    id SERIAL PRIMARY KEY,
    purchase_request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('approve', 'reject')),
    level VARCHAR(20) NOT NULL CHECK (level IN ('middle', 'final', 'buyer')),
    comment TEXT,
    processed_by UUID NOT NULL REFERENCES employees(id),
    processed_by_name VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_approval_history_purchase_request_id ON approval_history(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_approval_history_processed_by ON approval_history(processed_by);
CREATE INDEX IF NOT EXISTS idx_approval_history_processed_at ON approval_history(processed_at);
CREATE INDEX IF NOT EXISTS idx_approval_history_level_action ON approval_history(level, action_type);

-- RLS 정책 적용
ALTER TABLE approval_history ENABLE ROW LEVEL SECURITY;

-- 승인 권한이 있는 사용자만 조회 가능
CREATE POLICY "approval_history_select_policy" ON approval_history
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees e 
            WHERE e.id = auth.uid() 
            AND (
                e.purchase_role @> ARRAY['app_admin'] OR
                e.purchase_role @> ARRAY['ceo'] OR
                e.purchase_role @> ARRAY['final_approver'] OR
                e.purchase_role @> ARRAY['middle_manager'] OR
                e.purchase_role @> ARRAY['lead_buyer']
            )
        )
    );

-- 승인 처리자만 추가 가능 (API에서만 사용)
CREATE POLICY "approval_history_insert_policy" ON approval_history
    FOR INSERT
    WITH CHECK (
        processed_by = auth.uid() AND
        EXISTS (
            SELECT 1 FROM employees e 
            WHERE e.id = auth.uid() 
            AND (
                e.purchase_role @> ARRAY['app_admin'] OR
                e.purchase_role @> ARRAY['ceo'] OR
                e.purchase_role @> ARRAY['final_approver'] OR
                e.purchase_role @> ARRAY['middle_manager'] OR
                e.purchase_role @> ARRAY['lead_buyer']
            )
        )
    );

-- 수정/삭제 금지
CREATE POLICY "approval_history_update_policy" ON approval_history
    FOR UPDATE
    USING (FALSE);

CREATE POLICY "approval_history_delete_policy" ON approval_history
    FOR DELETE
    USING (FALSE);

-- 코멘트 추가
COMMENT ON TABLE approval_history IS '발주 승인/반려 처리 이력 테이블';
COMMENT ON COLUMN approval_history.purchase_request_id IS '발주 요청 ID (FK)';
COMMENT ON COLUMN approval_history.action_type IS '처리 유형 (approve/reject)';
COMMENT ON COLUMN approval_history.level IS '승인 단계 (middle/final/buyer)';
COMMENT ON COLUMN approval_history.comment IS '승인/반려 코멘트';
COMMENT ON COLUMN approval_history.processed_by IS '처리자 ID (FK)';
COMMENT ON COLUMN approval_history.processed_by_name IS '처리자 이름';
COMMENT ON COLUMN approval_history.processed_at IS '처리 시각';

-- 통계 및 모니터링용 뷰 생성
CREATE OR REPLACE VIEW approval_statistics AS
SELECT 
    DATE_TRUNC('day', processed_at) as date,
    level,
    action_type,
    COUNT(*) as count,
    COUNT(DISTINCT processed_by) as unique_processors,
    COUNT(DISTINCT purchase_request_id) as unique_purchases
FROM approval_history
GROUP BY DATE_TRUNC('day', processed_at), level, action_type
ORDER BY date DESC, level, action_type;

-- 뷰에 대한 RLS 정책
ALTER VIEW approval_statistics SET (security_invoker = true);

-- 승인 처리 시간 통계 뷰
CREATE OR REPLACE VIEW approval_processing_times AS
SELECT 
    pr.id as purchase_request_id,
    pr.purchase_order_number,
    pr.created_at as request_created_at,
    MIN(CASE WHEN ah.level = 'middle' AND ah.action_type = 'approve' THEN ah.processed_at END) as middle_approved_at,
    MIN(CASE WHEN ah.level = 'final' AND ah.action_type = 'approve' THEN ah.processed_at END) as final_approved_at,
    MIN(CASE WHEN ah.level = 'buyer' AND ah.action_type = 'approve' THEN ah.processed_at END) as buyer_processed_at,
    EXTRACT(EPOCH FROM (
        MIN(CASE WHEN ah.level = 'middle' AND ah.action_type = 'approve' THEN ah.processed_at END) - pr.created_at
    ))/3600 as hours_to_middle_approval,
    EXTRACT(EPOCH FROM (
        MIN(CASE WHEN ah.level = 'final' AND ah.action_type = 'approve' THEN ah.processed_at END) - pr.created_at
    ))/3600 as hours_to_final_approval,
    EXTRACT(EPOCH FROM (
        MIN(CASE WHEN ah.level = 'buyer' AND ah.action_type = 'approve' THEN ah.processed_at END) - pr.created_at
    ))/3600 as hours_to_completion
FROM purchase_requests pr
LEFT JOIN approval_history ah ON pr.id = ah.purchase_request_id
GROUP BY pr.id, pr.purchase_order_number, pr.created_at;

-- 뷰에 대한 RLS 정책
ALTER VIEW approval_processing_times SET (security_invoker = true);