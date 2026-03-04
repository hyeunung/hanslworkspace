-- 법인카드 사용 요청 테이블
CREATE TABLE IF NOT EXISTS card_usages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id uuid REFERENCES employees(id),
  card_number text NOT NULL,
  usage_category text NOT NULL,
  usage_date_start date NOT NULL,
  usage_date_end date,
  description text,
  approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'settled', 'returned', 'rejected')),
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  rejection_reason text,
  card_returned boolean NOT NULL DEFAULT false,
  card_returned_at timestamptz,
  card_returned_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE card_usages IS '법인카드 사용 요청';
COMMENT ON COLUMN card_usages.card_number IS '법인카드 (예: 공용1 8967)';
COMMENT ON COLUMN card_usages.usage_category IS '사용용도 (출장/손님접대/자재구매/회식/기타직접입력)';
COMMENT ON COLUMN card_usages.usage_date_start IS '사용예정 시작일';
COMMENT ON COLUMN card_usages.usage_date_end IS '사용예정 종료일 (NULL이면 당일)';
COMMENT ON COLUMN card_usages.approval_status IS 'pending→approved→settled→returned / rejected';
COMMENT ON COLUMN card_usages.card_returned IS '카드 반납 완료 여부';

-- 영수증 + 품목 테이블 (영수증 1장당 1행)
CREATE TABLE IF NOT EXISTS card_usage_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_usage_id bigint NOT NULL REFERENCES card_usages(id) ON DELETE CASCADE,
  receipt_url text NOT NULL,
  merchant_name text NOT NULL,
  item_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric,
  total_amount numeric NOT NULL DEFAULT 0,
  remark text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE card_usage_receipts IS '법인카드 영수증 및 품목 내역';
COMMENT ON COLUMN card_usage_receipts.receipt_url IS '영수증 이미지 URL (Supabase Storage)';
COMMENT ON COLUMN card_usage_receipts.unit_price IS '단가 (NULL 가능 - 합계만 기입하는 경우)';

-- RLS 활성화
ALTER TABLE card_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_usage_receipts ENABLE ROW LEVEL SECURITY;

-- card_usages 정책
CREATE POLICY "card_usages_select" ON card_usages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "card_usages_insert" ON card_usages
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "card_usages_update" ON card_usages
  FOR UPDATE TO authenticated USING (true);

-- card_usage_receipts 정책
CREATE POLICY "card_usage_receipts_select" ON card_usage_receipts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "card_usage_receipts_insert" ON card_usage_receipts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "card_usage_receipts_update" ON card_usage_receipts
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "card_usage_receipts_delete" ON card_usage_receipts
  FOR DELETE TO authenticated USING (true);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_card_usages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER card_usages_updated_at
  BEFORE UPDATE ON card_usages
  FOR EACH ROW EXECUTE FUNCTION update_card_usages_updated_at();

-- 영수증 이미지 저장용 Storage 버킷 (이미 receipt-images 버킷이 존재하면 무시)
INSERT INTO storage.buckets (id, name, public)
VALUES ('card-receipts', 'card-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage 정책
CREATE POLICY "card_receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-receipts');

CREATE POLICY "card_receipts_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'card-receipts');

CREATE POLICY "card_receipts_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'card-receipts');
