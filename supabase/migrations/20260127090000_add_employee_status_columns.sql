-- 직원 활성/비활성 및 퇴사일 컬럼 추가
-- 퇴사자는 비활성 처리하며 종료 일자 기록

ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;

-- 기존 직원은 모두 활성 상태로 초기화
UPDATE public.employees
SET is_active = TRUE,
    terminated_at = NULL;
