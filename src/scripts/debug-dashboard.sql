-- 현재 사용자 권한 확인
SELECT 
    name, 
    email, 
    purchase_role,
    pg_typeof(purchase_role) as role_type
FROM employees 
WHERE email IS NOT NULL
AND is_active = true
LIMIT 10;

-- 승인 대기 항목 확인 (중간승인)
SELECT 
    COUNT(*) as middle_pending_count,
    'Middle Manager Pending' as status
FROM purchase_requests
WHERE middle_manager_status IN ('pending', '대기', '', NULL)
   OR middle_manager_status IS NULL;

-- 승인 대기 항목 확인 (최종승인)
SELECT 
    COUNT(*) as final_pending_count,
    'Final Manager Pending' as status
FROM purchase_requests
WHERE middle_manager_status = 'approved'
  AND (final_manager_status IN ('pending', '대기', '', NULL) OR final_manager_status IS NULL);

-- 전체 발주요청 상태 요약
SELECT 
    middle_manager_status,
    final_manager_status,
    COUNT(*) as count
FROM purchase_requests
GROUP BY middle_manager_status, final_manager_status
ORDER BY count DESC;