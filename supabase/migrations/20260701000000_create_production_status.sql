-- 1. PCB 및 소켓보드 제작현황 테이블 생성
CREATE TABLE IF NOT EXISTS public.production_pcbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_number TEXT NOT NULL UNIQUE,
  production_category TEXT NOT NULL, -- 'PCB', 'Socket Board', '기타' 등
  board_name TEXT NOT NULL,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  estimate_no TEXT,
  delivery_deadline DATE,
  client_name TEXT,
  client_manager TEXT,
  hansl_manager TEXT,
  creator TEXT,
  revision_count INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  artwork_status TEXT,
  metal_mask TEXT,
  pcb_vendor TEXT,
  delivery_schedule TEXT,
  stock_count INTEGER NOT NULL DEFAULT 0,
  changes_memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 케이블 및 케이스 제작현황 테이블 생성
CREATE TABLE IF NOT EXISTS public.production_cables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_number TEXT NOT NULL UNIQUE,
  production_category TEXT NOT NULL, -- 'Cable', 'Case', '기타' 등
  board_name TEXT NOT NULL,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  estimate_no TEXT,
  delivery_deadline DATE,
  client_name TEXT,
  client_manager TEXT,
  hansl_manager TEXT,
  creator TEXT,
  revision_count INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  spec_details TEXT, -- 사양/스펙 상세 내용 (줄바꿈 포함)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. cad_drawings 테이블에 수주번호(sales_order_number) 컬럼 보강
ALTER TABLE public.cad_drawings ADD COLUMN IF NOT EXISTS sales_order_number TEXT;
CREATE INDEX IF NOT EXISTS idx_cad_drawings_sales_order_number ON public.cad_drawings(sales_order_number);

-- 4. Row Level Security (RLS) 설정
ALTER TABLE public.production_pcbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_cables ENABLE ROW LEVEL SECURITY;

-- 4-1. 읽기 정책: 인증된 모든 유저 읽기 가능
DROP POLICY IF EXISTS "Anyone can read production_pcbs" ON public.production_pcbs;
CREATE POLICY "Anyone can read production_pcbs" ON public.production_pcbs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read production_cables" ON public.production_cables;
CREATE POLICY "Anyone can read production_cables" ON public.production_cables FOR SELECT USING (true);

-- 4-2. 쓰기 정책: 인증된 모든 유저 삽입/수정/삭제 가능
DROP POLICY IF EXISTS "Authenticated users can insert/update/delete production_pcbs" ON public.production_pcbs;
CREATE POLICY "Authenticated users can insert/update/delete production_pcbs" ON public.production_pcbs
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert/update/delete production_cables" ON public.production_cables;
CREATE POLICY "Authenticated users can insert/update/delete production_cables" ON public.production_cables
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 5. 실시간 복제(Realtime) 설정
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- production_pcbs
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'production_pcbs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.production_pcbs;
    END IF;

    -- production_cables
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'production_cables'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.production_cables;
    END IF;
  END IF;
END $$;

ALTER TABLE public.production_pcbs REPLICA IDENTITY FULL;
ALTER TABLE public.production_cables REPLICA IDENTITY FULL;

-- 6. 시스템 통합 감사 로그(Trigger) 부착
DROP TRIGGER IF EXISTS trg_log_production_pcbs ON public.production_pcbs;
CREATE TRIGGER trg_log_production_pcbs
  AFTER INSERT OR UPDATE OR DELETE ON public.production_pcbs
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_production_cables ON public.production_cables;
CREATE TRIGGER trg_log_production_cables
  AFTER INSERT OR UPDATE OR DELETE ON public.production_cables
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();
