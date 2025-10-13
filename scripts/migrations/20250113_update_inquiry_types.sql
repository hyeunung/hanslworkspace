-- support_inquires 테이블의 inquiry_type 확장
-- Flutter 앱과 웹앱 모두 지원하도록 수정

-- 1. 기존 체크 제약 조건 삭제
ALTER TABLE public.support_inquires 
DROP CONSTRAINT IF EXISTS support_inquires_inquiry_type_check;

ALTER TABLE public.support_inquiries 
DROP CONSTRAINT IF EXISTS support_inquiries_inquiry_type_check;

-- 2. 새로운 체크 제약 조건 추가 (Flutter + 웹앱 모든 유형 포함)
-- Flutter: leave(연차), attendance(근태), bug(오류), other(기타)
-- 웹앱: bug(오류신고), modify(수정요청), delete(삭제요청), other(기타문의)
ALTER TABLE public.support_inquires 
ADD CONSTRAINT support_inquires_inquiry_type_check 
CHECK (inquiry_type IN (
  'leave',      -- Flutter: 연차
  'attendance', -- Flutter: 근태  
  'bug',        -- 공통: 오류/오류신고
  'other',      -- 공통: 기타/기타문의
  'modify',     -- 웹앱: 수정요청
  'delete'      -- 웹앱: 삭제요청
));

-- 3. 앱 구분을 위한 source 컬럼 추가 (선택사항)
-- 어느 앱에서 등록된 문의인지 구분 가능
ALTER TABLE public.support_inquires 
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'web' 
CHECK (source IN ('web', 'flutter', 'mobile'));

-- 4. 인덱스 추가 (source별 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_support_inquires_source 
ON public.support_inquires(source);

-- 5. 기존 데이터 source 업데이트 (기존 데이터는 모두 웹앱에서 생성)
UPDATE public.support_inquires 
SET source = 'web' 
WHERE source IS NULL;

-- 6. 코멘트 추가 (문서화)
COMMENT ON COLUMN public.support_inquires.inquiry_type IS 
'문의 유형: leave(연차-Flutter), attendance(근태-Flutter), bug(오류-공통), other(기타-공통), modify(수정요청-웹), delete(삭제요청-웹)';

COMMENT ON COLUMN public.support_inquires.source IS 
'문의 등록 출처: web(웹앱), flutter(Flutter앱), mobile(모바일)';

-- 7. 통계 뷰 생성 (선택사항 - 관리 편의용)
CREATE OR REPLACE VIEW v_support_inquires_stats AS
SELECT 
  source,
  inquiry_type,
  CASE 
    WHEN inquiry_type = 'leave' THEN '연차'
    WHEN inquiry_type = 'attendance' THEN '근태'
    WHEN inquiry_type = 'bug' AND source = 'flutter' THEN '오류'
    WHEN inquiry_type = 'bug' AND source = 'web' THEN '오류 신고'
    WHEN inquiry_type = 'other' AND source = 'flutter' THEN '기타'
    WHEN inquiry_type = 'other' AND source = 'web' THEN '기타 문의'
    WHEN inquiry_type = 'modify' THEN '수정 요청'
    WHEN inquiry_type = 'delete' THEN '삭제 요청'
  END as inquiry_type_label,
  status,
  COUNT(*) as count,
  MAX(created_at) as last_inquiry_at
FROM public.support_inquires
GROUP BY source, inquiry_type, status
ORDER BY source, inquiry_type;