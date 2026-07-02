-- 1. production_pcbs 테이블에 누락된 칼럼 추가
ALTER TABLE public.production_pcbs 
  ADD COLUMN IF NOT EXISTS pcb_lead_time TEXT,             -- 제작 기간(PCB)
  ADD COLUMN IF NOT EXISTS received_quantity INTEGER,       -- 입고(수량)
  ADD COLUMN IF NOT EXISTS received_destination TEXT,       -- 입고처
  ADD COLUMN IF NOT EXISTS production_type TEXT,            -- 제작형태
  ADD COLUMN IF NOT EXISTS parts_organization TEXT,         -- 부품정리
  ADD COLUMN IF NOT EXISTS assy_hanwha TEXT,                -- ASS'Y - 환화
  ADD COLUMN IF NOT EXISTS assy_evertech TEXT,              -- ASS'Y - 에버텍
  ADD COLUMN IF NOT EXISTS assy_requested_date DATE,        -- ASS'Y - 입고요청일
  ADD COLUMN IF NOT EXISTS final_product_stock TEXT,        -- PCB 완제품 입고
  ADD COLUMN IF NOT EXISTS qa_passed TEXT,                  -- IN-House Checking - 양품
  ADD COLUMN IF NOT EXISTS qa_failed TEXT,                  -- IN-House Checking - 불량
  ADD COLUMN IF NOT EXISTS qa_notes TEXT,                   -- IN-House Checking - 비고(특이사항)
  ADD COLUMN IF NOT EXISTS design_review TEXT,              -- 디자인 리뷰 유무
  ADD COLUMN IF NOT EXISTS delivery_quantity INTEGER,       -- 납품 - 수량
  ADD COLUMN IF NOT EXISTS delivery_date DATE,              -- 납품 - 일자
  ADD COLUMN IF NOT EXISTS delivery_destination TEXT;       -- 납품 - 배송처

-- 2. production_cables 테이블에 누락된 칼럼 추가
ALTER TABLE public.production_cables
  ADD COLUMN IF NOT EXISTS cable_vendor TEXT,               -- CASE/CABLE - 업체
  ADD COLUMN IF NOT EXISTS cable_requested_date DATE,       -- CASE/CABLE - 입고 요청일
  ADD COLUMN IF NOT EXISTS cable_actual_date DATE,          -- CASE/CABLE - 실제 입고일
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;             -- 납품/비고
