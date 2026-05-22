-- 출장/카드 경비 사용처 전용 테이블
-- vendors(거래처 마스터)와 분리: 모텔/식당/주유소 등 경비 사용처가
-- 발주 거래처 마스터(vendors)를 오염시키지 않도록 별도 관리한다.

BEGIN;

-- 1) 경비 사용처 마스터
CREATE TABLE IF NOT EXISTS trip_expense_places (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  place_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trip_expense_places IS '출장/카드 경비 사용처 (모텔·식당·주유소 등). vendors 거래처 마스터와 분리';
COMMENT ON COLUMN trip_expense_places.place_name IS '사용처 이름';

ALTER TABLE trip_expense_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_expense_places_select_policy ON trip_expense_places
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY trip_expense_places_insert_policy ON trip_expense_places
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY trip_expense_places_update_policy ON trip_expense_places
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY trip_expense_places_delete_policy ON trip_expense_places
  FOR DELETE USING (auth.role() = 'authenticated');

-- 2) 발주: 출장/카드 자동생성 발주는 vendors 대신 trip_expense_places 를 가리킴
--    일반 발주는 기존대로 vendor_id 사용 (변경 없음)
ALTER TABLE purchase_requests ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS trip_expense_place_id bigint
  REFERENCES trip_expense_places(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_requests.trip_expense_place_id IS '출장/카드 경비 자동발주의 사용처. 일반 발주는 NULL(vendor_id 사용)';

CREATE INDEX IF NOT EXISTS idx_purchase_requests_trip_expense_place_id
  ON purchase_requests(trip_expense_place_id);

-- 3) 기존 경비 사용처 데이터로 초기 시드 (출장 비용 + 카드 영수증)
INSERT INTO trip_expense_places (place_name)
SELECT DISTINCT TRIM(vendor_name)
FROM business_trip_expenses
WHERE vendor_name IS NOT NULL
  AND TRIM(vendor_name) <> ''
  AND TRIM(vendor_name) <> '미입력'
ON CONFLICT (place_name) DO NOTHING;

INSERT INTO trip_expense_places (place_name)
SELECT DISTINCT TRIM(merchant_name)
FROM card_usage_receipts
WHERE merchant_name IS NOT NULL
  AND TRIM(merchant_name) <> ''
  AND TRIM(merchant_name) <> '미입력'
ON CONFLICT (place_name) DO NOTHING;

COMMIT;
