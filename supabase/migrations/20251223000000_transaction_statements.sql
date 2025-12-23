-- 거래명세서 확인 시스템 테이블
-- 거래명세서 이미지 업로드 → OCR 추출 → 발주 매칭 → 확정 흐름 지원

-- 거래명세서 테이블
CREATE TABLE IF NOT EXISTS transaction_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  file_name TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_by_name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'extracted', 'confirmed', 'rejected')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES auth.users(id),
  confirmed_by_name TEXT,
  statement_date DATE, -- 거래명세서 상 날짜 (입고일)
  vendor_name TEXT, -- 추출된 거래처명
  total_amount NUMERIC, -- 공급가액
  tax_amount NUMERIC, -- 세액
  grand_total NUMERIC, -- 합계
  extracted_data JSONB, -- OCR/LLM 원본 결과 전체
  extraction_error TEXT, -- 추출 실패 시 에러 메시지
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 거래명세서-품목 매핑 테이블
CREATE TABLE IF NOT EXISTS transaction_statement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES transaction_statements(id) ON DELETE CASCADE,
  line_number INTEGER, -- 거래명세서 상 순번
  extracted_item_name TEXT, -- 추출된 품목명
  extracted_specification TEXT, -- 추출된 규격
  extracted_quantity NUMERIC, -- 추출된 수량
  extracted_unit_price NUMERIC, -- 추출된 단가
  extracted_amount NUMERIC, -- 추출된 금액
  extracted_tax_amount NUMERIC, -- 추출된 세액
  extracted_po_number TEXT, -- 비고에서 추출한 발주/수주번호
  extracted_remark TEXT, -- 추출된 비고 전체
  
  -- 매칭 정보
  matched_purchase_id INTEGER REFERENCES purchase_requests(id) ON DELETE SET NULL,
  matched_item_id INTEGER REFERENCES purchase_request_items(id) ON DELETE SET NULL,
  match_confidence TEXT CHECK (match_confidence IN ('low', 'med', 'high')),
  match_method TEXT, -- 'po_number', 'item_similarity', 'manual'
  
  -- 추가 공정/부자재 처리
  is_additional_item BOOLEAN DEFAULT FALSE,
  parent_item_id UUID REFERENCES transaction_statement_items(id) ON DELETE SET NULL,
  
  -- 확정 상태
  is_confirmed BOOLEAN DEFAULT FALSE,
  confirmed_unit_price NUMERIC, -- 사용자가 확정한 단가
  confirmed_amount NUMERIC, -- 사용자가 확정한 금액
  confirmed_quantity NUMERIC, -- 사용자가 확정한 수량
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 학습 데이터 테이블 (OCR 교정용)
CREATE TABLE IF NOT EXISTS ocr_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID REFERENCES transaction_statements(id) ON DELETE CASCADE,
  statement_item_id UUID REFERENCES transaction_statement_items(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL, -- OCR이 읽은 값
  corrected_text TEXT NOT NULL, -- 사용자가 수정한 값
  field_type TEXT NOT NULL CHECK (field_type IN ('po_number', 'item_name', 'quantity', 'unit_price', 'amount', 'date', 'vendor_name', 'remark')),
  corrected_by UUID REFERENCES auth.users(id),
  corrected_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_transaction_statements_status ON transaction_statements(status);
CREATE INDEX IF NOT EXISTS idx_transaction_statements_uploaded_at ON transaction_statements(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_statements_statement_date ON transaction_statements(statement_date);
CREATE INDEX IF NOT EXISTS idx_transaction_statement_items_statement_id ON transaction_statement_items(statement_id);
CREATE INDEX IF NOT EXISTS idx_transaction_statement_items_matched_purchase_id ON transaction_statement_items(matched_purchase_id);
CREATE INDEX IF NOT EXISTS idx_transaction_statement_items_matched_item_id ON transaction_statement_items(matched_item_id);
CREATE INDEX IF NOT EXISTS idx_transaction_statement_items_extracted_po ON transaction_statement_items(extracted_po_number);
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_statement_id ON ocr_corrections(statement_id);
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_field_type ON ocr_corrections(field_type);

-- RLS 정책
ALTER TABLE transaction_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_statement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_corrections ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 조회/삽입/수정 가능
CREATE POLICY "Allow authenticated users to view transaction_statements"
  ON transaction_statements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert transaction_statements"
  ON transaction_statements FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update transaction_statements"
  ON transaction_statements FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete transaction_statements"
  ON transaction_statements FOR DELETE
  TO authenticated
  USING (true);

-- transaction_statement_items
CREATE POLICY "Allow authenticated users to view transaction_statement_items"
  ON transaction_statement_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert transaction_statement_items"
  ON transaction_statement_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update transaction_statement_items"
  ON transaction_statement_items FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete transaction_statement_items"
  ON transaction_statement_items FOR DELETE
  TO authenticated
  USING (true);

-- ocr_corrections
CREATE POLICY "Allow authenticated users to view ocr_corrections"
  ON ocr_corrections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert ocr_corrections"
  ON ocr_corrections FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_transaction_statements_updated_at
  BEFORE UPDATE ON transaction_statements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transaction_statement_items_updated_at
  BEFORE UPDATE ON transaction_statement_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 코멘트
COMMENT ON TABLE transaction_statements IS '거래명세서 이미지 및 OCR 추출 결과';
COMMENT ON TABLE transaction_statement_items IS '거래명세서 품목별 추출/매칭 정보';
COMMENT ON TABLE ocr_corrections IS 'OCR 교정 학습 데이터';
COMMENT ON COLUMN transaction_statements.status IS 'pending: 업로드됨, processing: OCR 처리중, extracted: 추출완료, confirmed: 확정됨, rejected: 거부됨';
COMMENT ON COLUMN transaction_statement_items.match_confidence IS 'OCR/매칭 신뢰도: low, med, high';
COMMENT ON COLUMN transaction_statement_items.is_additional_item IS '추가 공정/부자재 여부';

