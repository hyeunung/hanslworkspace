-- 1. cad_drawings 테이블
CREATE TABLE IF NOT EXISTS cad_drawings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cad_drawings_board_name ON cad_drawings(board_name);

-- 2. bom_raw_files 테이블
CREATE TABLE IF NOT EXISTS bom_raw_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  bom_file_url TEXT NOT NULL,
  coordinate_file_url TEXT NOT NULL,
  bom_file_name TEXT NOT NULL,
  coordinate_file_name TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_raw_files_cad_drawing ON bom_raw_files(cad_drawing_id);

-- 3. bom_items 테이블
CREATE TABLE IF NOT EXISTS bom_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  item_type TEXT,
  item_name TEXT NOT NULL,
  specification TEXT,
  set_count INTEGER NOT NULL,
  total_quantity INTEGER,
  stock_quantity INTEGER,
  check_status TEXT,
  ref_list TEXT[],
  alternative_item TEXT,
  remark TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_items_cad_drawing ON bom_items(cad_drawing_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_item_name ON bom_items(item_name);

-- 4. part_placements 테이블
CREATE TABLE IF NOT EXISTS part_placements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  part_name TEXT NOT NULL,
  part_type TEXT,
  side TEXT NOT NULL CHECK (side IN ('TOP', 'BOTTOM')),
  x_coordinate NUMERIC NOT NULL,
  y_coordinate NUMERIC NOT NULL,
  angle NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_placements_cad_drawing ON part_placements(cad_drawing_id);
CREATE INDEX IF NOT EXISTS idx_part_placements_ref ON part_placements(ref);

-- 5. bom_processing_logs 테이블
CREATE TABLE IF NOT EXISTS bom_processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE SET NULL,
  bom_raw_file_id UUID REFERENCES bom_raw_files(id) ON DELETE SET NULL,
  artwork_manager TEXT NOT NULL,
  production_manager TEXT,
  production_quantity INTEGER,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('processing', 'completed', 'failed')),
  ai_model_used TEXT,
  tokens_used INTEGER,
  processing_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_bom_processing_logs_status ON bom_processing_logs(processing_status);
CREATE INDEX IF NOT EXISTS idx_bom_processing_logs_created ON bom_processing_logs(created_at);

-- 6. ai_learning_records 테이블
CREATE TABLE IF NOT EXISTS ai_learning_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE SET NULL,
  raw_bom_data JSONB NOT NULL,
  raw_coordinate_data JSONB NOT NULL,
  processed_bom_data JSONB NOT NULL,
  processed_coordinate_data JSONB NOT NULL,
  cad_program_type TEXT,
  user_corrections JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_records_cad_type ON ai_learning_records(cad_program_type);

-- 7. bom_pattern_library 테이블
CREATE TABLE IF NOT EXISTS bom_pattern_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_program_type TEXT NOT NULL,
  pattern_name TEXT NOT NULL,
  header_row_index INTEGER,
  data_start_row_index INTEGER,
  column_mapping JSONB NOT NULL,
  sample_file_url TEXT,
  accuracy_score NUMERIC,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_pattern_library_type ON bom_pattern_library(cad_program_type);

-- RLS (Row Level Security) 정책
ALTER TABLE cad_drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_raw_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_pattern_library ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기 가능 (기존 정책이 없을 경우에만 생성)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cad_drawings' AND policyname = 'Anyone can read cad_drawings'
    ) THEN
        CREATE POLICY "Anyone can read cad_drawings" ON cad_drawings FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'Anyone can read bom_items'
    ) THEN
        CREATE POLICY "Anyone can read bom_items" ON bom_items FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'part_placements' AND policyname = 'Anyone can read part_placements'
    ) THEN
        CREATE POLICY "Anyone can read part_placements" ON part_placements FOR SELECT USING (true);
    END IF;

    -- 인증된 사용자만 쓰기 가능
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cad_drawings' AND policyname = 'Authenticated users can insert cad_drawings'
    ) THEN
        CREATE POLICY "Authenticated users can insert cad_drawings" ON cad_drawings FOR INSERT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'Authenticated users can insert bom_items'
    ) THEN
        CREATE POLICY "Authenticated users can insert bom_items" ON bom_items FOR INSERT TO authenticated USING (true);
    END IF;
END
$$;

-- Storage 버킷 생성 (SQL로 가능한 경우)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('bom-files', 'bom-files', false)
ON CONFLICT (id) DO NOTHING;

-- 버킷 정책 설정
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can upload BOM files'
    ) THEN
        CREATE POLICY "Users can upload BOM files" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'bom-files');
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Anyone can read BOM files'
    ) THEN
        CREATE POLICY "Anyone can read BOM files" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'bom-files');
    END IF;
END
$$;


