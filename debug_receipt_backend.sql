-- 영수증 인쇄완료 기능 백엔드 디버깅 SQL 스크립트
-- Supabase 관리자 대시보드에서 실행

-- ========================================
-- 1. 사용자별 기본 정보 확인
-- ========================================

-- 정현웅과 이채령의 기본 정보 조회
SELECT 
    email,
    name,
    purchase_role,
    created_at,
    updated_at,
    CASE 
        WHEN purchase_role LIKE '%app_admin%' THEN 'app_admin'
        WHEN purchase_role LIKE '%hr%' THEN 'hr'
        WHEN purchase_role LIKE '%lead buyer%' THEN 'lead_buyer'
        ELSE 'other'
    END as role_category
FROM employees 
WHERE email IN ('jeong.hyeonwoong@hansl.kr', 'lee.chaeryeong@hansl.kr')
ORDER BY email;

-- ========================================
-- 2. 영수증 인쇄 기록 분석
-- ========================================

-- 최근 인쇄완료 처리 기록 조회 (두 사용자 중심으로)
SELECT 
    pr.id,
    pr.file_name,
    pr.is_printed,
    pr.printed_at,
    pr.printed_by,
    pr.printed_by_name,
    pr.uploaded_at,
    pr.uploaded_by_name,
    e.email as printed_by_email,
    e.purchase_role as printed_by_role
FROM purchase_receipts pr
LEFT JOIN employees e ON pr.printed_by_name = e.name
WHERE pr.printed_by_name IN ('정현웅', '이채령')
   OR pr.uploaded_by_name IN ('정현웅', '이채령')
ORDER BY pr.printed_at DESC NULLS LAST, pr.uploaded_at DESC
LIMIT 20;

-- ========================================
-- 3. RLS 정책 현황 확인
-- ========================================

-- purchase_receipts 테이블의 RLS 정책 확인
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'purchase_receipts'
ORDER BY policyname;

-- RLS 활성화 상태 확인
SELECT 
    schemaname,
    tablename,
    rowsecurity,
    relforcerowsecurity
FROM pg_tables pt
JOIN pg_class pc ON pc.relname = pt.tablename
WHERE tablename = 'purchase_receipts';

-- ========================================
-- 4. 사용자 인증 정보 확인 (auth.users)
-- ========================================

-- 정현웅과 이채령의 auth.users 정보
SELECT 
    au.id as auth_user_id,
    au.email,
    au.created_at as auth_created_at,
    au.last_sign_in_at,
    au.email_confirmed_at,
    e.name as employee_name,
    e.purchase_role
FROM auth.users au
LEFT JOIN employees e ON au.email = e.email
WHERE au.email IN ('jeong.hyeonwoong@hansl.kr', 'lee.chaeryeong@hansl.kr')
ORDER BY au.email;

-- ========================================
-- 5. 최근 업데이트 시도 분석
-- ========================================

-- 최근 인쇄완료 상태 변경 기록 (실제 데이터 기준)
SELECT 
    pr.id,
    pr.file_name,
    pr.is_printed,
    pr.printed_at,
    pr.printed_by,
    pr.printed_by_name,
    pr.uploaded_at,
    pr.uploaded_by_name,
    -- 마지막 수정 시간 추정 (printed_at이 가장 최근 수정을 나타냄)
    EXTRACT(EPOCH FROM (NOW() - pr.printed_at))/60 as minutes_since_printed
FROM purchase_receipts pr
WHERE pr.is_printed = true
  AND pr.printed_at > NOW() - INTERVAL '24 hours'
ORDER BY pr.printed_at DESC;

-- ========================================
-- 6. 권한별 영수증 접근 테스트
-- ========================================

-- 각 사용자가 볼 수 있는 영수증 개수 확인
WITH user_receipts AS (
  SELECT 
    e.email,
    e.name,
    e.purchase_role,
    COUNT(pr.id) as accessible_receipts
  FROM employees e
  CROSS JOIN purchase_receipts pr
  WHERE e.email IN ('jeong.hyeonwoong@hansl.kr', 'lee.chaeryeong@hansl.kr')
    AND (
      e.purchase_role LIKE '%app_admin%' OR
      e.purchase_role LIKE '%hr%' OR  
      e.purchase_role LIKE '%lead buyer%'
    )
  GROUP BY e.email, e.name, e.purchase_role
)
SELECT * FROM user_receipts;

-- ========================================
-- 7. 특정 영수증에 대한 업데이트 권한 시뮬레이션
-- ========================================

-- 샘플 영수증 ID를 사용하여 권한 테스트
-- (실제 영수증 ID로 교체 필요)
WITH test_receipt AS (
  SELECT id FROM purchase_receipts LIMIT 1
),
user_permissions AS (
  SELECT 
    e.email,
    e.name,
    e.purchase_role,
    tr.id as receipt_id,
    CASE 
      WHEN e.purchase_role LIKE '%app_admin%' THEN true
      WHEN e.purchase_role LIKE '%hr%' THEN true
      WHEN e.purchase_role LIKE '%lead buyer%' THEN true
      ELSE false
    END as can_update_receipt
  FROM employees e
  CROSS JOIN test_receipt tr
  WHERE e.email IN ('jeong.hyeonwoong@hansl.kr', 'lee.chaeryeong@hansl.kr')
)
SELECT * FROM user_permissions;

-- ========================================
-- 8. 시스템 로그 및 오류 추적
-- ========================================

-- PostgreSQL 로그에서 purchase_receipts 관련 오류 확인
-- (이것은 실제 로그 테이블이 있는 경우에만 작동)
-- SELECT * FROM pg_stat_user_tables WHERE relname = 'purchase_receipts';

-- 테이블 통계 정보
SELECT 
    schemaname,
    relname,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_tup_hot_upd as hot_updates,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables 
WHERE relname = 'purchase_receipts';

-- ========================================
-- 9. 특정 영수증 ID에 대한 상세 분석
-- ========================================

-- 특정 영수증 ID로 테스트 (실제 ID로 교체 필요)
-- 사용법: 아래 쿼리에서 'RECEIPT_ID_HERE'를 실제 영수증 ID로 교체

/*
SELECT 
    pr.*,
    uploader.email as uploader_email,
    uploader.purchase_role as uploader_role,
    printer.email as printer_email,
    printer.purchase_role as printer_role
FROM purchase_receipts pr
LEFT JOIN employees uploader ON pr.uploaded_by_name = uploader.name
LEFT JOIN employees printer ON pr.printed_by_name = printer.name
WHERE pr.id = 'RECEIPT_ID_HERE';
*/

-- ========================================
-- 10. 디버깅 결과 요약
-- ========================================

-- 최종 요약 정보
SELECT 
    'Summary Report' as report_type,
    NOW() as generated_at,
    (SELECT COUNT(*) FROM purchase_receipts) as total_receipts,
    (SELECT COUNT(*) FROM purchase_receipts WHERE is_printed = true) as printed_receipts,
    (SELECT COUNT(*) FROM employees WHERE purchase_role LIKE '%lead buyer%') as lead_buyers,
    (SELECT COUNT(*) FROM employees WHERE email IN ('jeong.hyeonwoong@hansl.kr', 'lee.chaeryeong@hansl.kr')) as target_users;

-- ========================================
-- 사용법 안내
-- ========================================

/*
이 SQL 스크립트는 Supabase 관리자 대시보드의 SQL Editor에서 실행하세요.

1. 각 섹션을 순서대로 실행하여 결과를 비교
2. 특히 정현웅과 이채령의 차이점을 중점적으로 확인
3. RLS 정책이 제대로 설정되어 있는지 확인
4. 최근 업데이트 기록을 통해 패턴 분석

주의사항:
- 실제 영수증 ID를 사용할 때는 해당 ID로 교체
- 개인정보가 포함된 결과는 적절히 마스킹
- 프로덕션 환경에서는 SELECT 쿼리만 실행
*/