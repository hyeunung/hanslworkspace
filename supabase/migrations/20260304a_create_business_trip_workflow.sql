-- 출장 사전승인/사후정산 통합 워크플로우
-- HBT + YYMMDD + 3자리 순번 코드 자동 생성

-- 1) 출장 메인 테이블 (사전 승인 정보 + 정산 상태)
CREATE TABLE IF NOT EXISTS business_trips (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_code text NOT NULL UNIQUE,
  requester_id uuid REFERENCES employees(id),
  request_department text NOT NULL,
  project_name text,
  trip_purpose text NOT NULL,
  trip_destination text NOT NULL,
  trip_start_date date NOT NULL,
  trip_end_date date NOT NULL,
  companions jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_corporate_card boolean NOT NULL DEFAULT false,
  requested_card_number text,
  expected_total_amount numeric NOT NULL DEFAULT 0,
  precheck_note text,
  approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'completed')),
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  rejection_reason text,
  settlement_status text NOT NULL DEFAULT 'draft'
    CHECK (settlement_status IN ('draft', 'submitted', 'approved', 'rejected')),
  settlement_submitted_at timestamptz,
  settlement_approved_by uuid REFERENCES employees(id),
  settlement_approved_at timestamptz,
  settlement_rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_trips_date_range_check CHECK (trip_end_date >= trip_start_date)
);

COMMENT ON TABLE business_trips IS '출장 요청(사전 승인 + 사후 정산 상태) 메인';
COMMENT ON COLUMN business_trips.trip_code IS '출장 코드 (예: HBT260304001)';
COMMENT ON COLUMN business_trips.request_department IS '요청 시점의 부서 스냅샷';
COMMENT ON COLUMN business_trips.trip_purpose IS '출장 목적';
COMMENT ON COLUMN business_trips.trip_destination IS '출장 지역/장소';
COMMENT ON COLUMN business_trips.request_corporate_card IS '출장카드 선택 여부(선택 시 true)';
COMMENT ON COLUMN business_trips.requested_card_number IS '요청 카드 (예: 출장용 5914)';
COMMENT ON COLUMN business_trips.expected_total_amount IS '사전 예상비용';
COMMENT ON COLUMN business_trips.settlement_status IS '사후 정산 상태';

CREATE INDEX IF NOT EXISTS idx_business_trips_requester_id ON business_trips(requester_id);
CREATE INDEX IF NOT EXISTS idx_business_trips_approval_status ON business_trips(approval_status);
CREATE INDEX IF NOT EXISTS idx_business_trips_trip_dates ON business_trips(trip_start_date, trip_end_date);

-- 2) 출장 비용 상세 (법인카드/개인카드/현금)
CREATE TABLE IF NOT EXISTS business_trip_expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_trip_id bigint NOT NULL REFERENCES business_trips(id) ON DELETE CASCADE,
  line_order int NOT NULL DEFAULT 1,
  expense_type text NOT NULL
    CHECK (expense_type IN ('corporate_card', 'personal_card', 'cash')),
  expense_date date NOT NULL,
  vendor_name text NOT NULL,
  category_detail text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KRW',
  companion_note text,
  expense_purpose text,
  linked_card_usage_id bigint REFERENCES card_usages(id) ON DELETE SET NULL,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE business_trip_expenses IS '출장 비용 상세 내역';
COMMENT ON COLUMN business_trip_expenses.expense_type IS 'corporate_card / personal_card / cash';
COMMENT ON COLUMN business_trip_expenses.category_detail IS '분류-상세(계정과목)';
COMMENT ON COLUMN business_trip_expenses.companion_note IS '동반직원(본인포함)';
COMMENT ON COLUMN business_trip_expenses.linked_card_usage_id IS '출장과 연결된 법인카드 사용 요청';

CREATE INDEX IF NOT EXISTS idx_business_trip_expenses_trip_id ON business_trip_expenses(business_trip_id);
CREATE INDEX IF NOT EXISTS idx_business_trip_expenses_date ON business_trip_expenses(expense_date);

-- 3) 개인차량 마일리지
CREATE TABLE IF NOT EXISTS business_trip_mileages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_trip_id bigint NOT NULL REFERENCES business_trips(id) ON DELETE CASCADE,
  line_order int NOT NULL DEFAULT 1,
  travel_date date NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  distance_km numeric NOT NULL DEFAULT 0,
  description text,
  mileage_unit_amount numeric NOT NULL DEFAULT 300,
  mileage_amount numeric GENERATED ALWAYS AS (distance_km * mileage_unit_amount) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE business_trip_mileages IS '출장 마일리지(개인차량) 내역';
COMMENT ON COLUMN business_trip_mileages.mileage_unit_amount IS '기준 금액 (기본 300원/km)';

CREATE INDEX IF NOT EXISTS idx_business_trip_mileages_trip_id ON business_trip_mileages(business_trip_id);

-- 4) 출장 업무 내용
CREATE TABLE IF NOT EXISTS business_trip_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_trip_id bigint NOT NULL REFERENCES business_trips(id) ON DELETE CASCADE,
  line_order int NOT NULL DEFAULT 1,
  work_date date NOT NULL,
  work_place text NOT NULL,
  work_content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE business_trip_tasks IS '출장 업무 내용';

CREATE INDEX IF NOT EXISTS idx_business_trip_tasks_trip_id ON business_trip_tasks(business_trip_id);

-- 5) 일비
CREATE TABLE IF NOT EXISTS business_trip_allowances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_trip_id bigint NOT NULL REFERENCES business_trips(id) ON DELETE CASCADE,
  line_order int NOT NULL DEFAULT 1,
  region text NOT NULL CHECK (region IN ('Domestic', 'Overseas')),
  day_count numeric NOT NULL DEFAULT 0,
  unit_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric GENERATED ALWAYS AS (day_count * unit_amount) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE business_trip_allowances IS '출장 일비 내역';

CREATE INDEX IF NOT EXISTS idx_business_trip_allowances_trip_id ON business_trip_allowances(business_trip_id);

-- 6) 출장 비용 영수증 (개인카드/현금 포함)
CREATE TABLE IF NOT EXISTS business_trip_expense_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_trip_expense_id bigint NOT NULL REFERENCES business_trip_expenses(id) ON DELETE CASCADE,
  receipt_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE business_trip_expense_receipts IS '출장 비용 영수증';

CREATE INDEX IF NOT EXISTS idx_business_trip_expense_receipts_expense_id
  ON business_trip_expense_receipts(business_trip_expense_id);

-- 7) card_usages <- business_trips 연동
ALTER TABLE card_usages
  ADD COLUMN IF NOT EXISTS business_trip_id bigint REFERENCES business_trips(id) ON DELETE SET NULL;

ALTER TABLE card_usages
  ADD COLUMN IF NOT EXISTS auto_created_by_trip boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN card_usages.business_trip_id IS '연결된 출장 요청 ID';
COMMENT ON COLUMN card_usages.auto_created_by_trip IS '출장 신청 시 자동 생성된 카드 요청 여부';

CREATE INDEX IF NOT EXISTS idx_card_usages_business_trip_id ON card_usages(business_trip_id);

-- 8) 공통 updated_at 트리거 함수
CREATE OR REPLACE FUNCTION set_business_trip_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_trips_set_updated_at ON business_trips;
CREATE TRIGGER business_trips_set_updated_at
  BEFORE UPDATE ON business_trips
  FOR EACH ROW EXECUTE FUNCTION set_business_trip_updated_at();

DROP TRIGGER IF EXISTS business_trip_expenses_set_updated_at ON business_trip_expenses;
CREATE TRIGGER business_trip_expenses_set_updated_at
  BEFORE UPDATE ON business_trip_expenses
  FOR EACH ROW EXECUTE FUNCTION set_business_trip_updated_at();

DROP TRIGGER IF EXISTS business_trip_mileages_set_updated_at ON business_trip_mileages;
CREATE TRIGGER business_trip_mileages_set_updated_at
  BEFORE UPDATE ON business_trip_mileages
  FOR EACH ROW EXECUTE FUNCTION set_business_trip_updated_at();

DROP TRIGGER IF EXISTS business_trip_tasks_set_updated_at ON business_trip_tasks;
CREATE TRIGGER business_trip_tasks_set_updated_at
  BEFORE UPDATE ON business_trip_tasks
  FOR EACH ROW EXECUTE FUNCTION set_business_trip_updated_at();

DROP TRIGGER IF EXISTS business_trip_allowances_set_updated_at ON business_trip_allowances;
CREATE TRIGGER business_trip_allowances_set_updated_at
  BEFORE UPDATE ON business_trip_allowances
  FOR EACH ROW EXECUTE FUNCTION set_business_trip_updated_at();

-- 9) HBT 코드 자동 생성
CREATE OR REPLACE FUNCTION generate_business_trip_code(p_trip_date date DEFAULT NULL)
RETURNS text AS $$
DECLARE
  v_date date := COALESCE(p_trip_date, timezone('Asia/Seoul', now())::date);
  v_prefix text := 'HBT' || to_char(v_date, 'YYMMDD');
  v_next_seq int;
BEGIN
  LOCK TABLE business_trips IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(SUBSTRING(trip_code FROM 10 FOR 3)::int), 0) + 1
    INTO v_next_seq
  FROM business_trips
  WHERE trip_code LIKE (v_prefix || '%');

  RETURN v_prefix || lpad(v_next_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION business_trips_before_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trip_code IS NULL OR btrim(NEW.trip_code) = '' THEN
    NEW.trip_code := generate_business_trip_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_trips_before_insert_trigger ON business_trips;
CREATE TRIGGER business_trips_before_insert_trigger
  BEFORE INSERT ON business_trips
  FOR EACH ROW EXECUTE FUNCTION business_trips_before_insert();

-- 10) 출장 승인 상태와 출장카드 요청 동기화
CREATE OR REPLACE FUNCTION sync_business_trip_card_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(BTRIM(COALESCE(NEW.requested_card_number, '')), '') IS NOT NULL THEN
      INSERT INTO card_usages (
        requester_id,
        card_number,
        usage_category,
        usage_date_start,
        usage_date_end,
        description,
        approval_status,
        business_trip_id,
        auto_created_by_trip
      ) VALUES (
        NEW.requester_id,
        NEW.requested_card_number,
        '출장',
        NEW.trip_start_date,
        NEW.trip_end_date,
        '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
        CASE
          WHEN NEW.approval_status = 'approved' THEN 'approved'
          WHEN NEW.approval_status = 'rejected' THEN 'rejected'
          ELSE 'pending'
        END,
        NEW.id,
        true
      );
    END IF;
    RETURN NEW;
  END IF;

  -- 일정/카드 선택/설명 변경 반영
  UPDATE card_usages
     SET usage_date_start = NEW.trip_start_date,
         usage_date_end = NEW.trip_end_date,
         card_number = COALESCE(NEW.requested_card_number, card_number),
         description = '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, '')
   WHERE business_trip_id = NEW.id
     AND auto_created_by_trip = true;

  -- 승인 상태 동기화
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE card_usages
       SET approval_status = CASE
         WHEN NEW.approval_status = 'approved' THEN 'approved'
         WHEN NEW.approval_status = 'rejected' THEN 'rejected'
         ELSE 'pending'
       END,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '출장 승인 반려') ELSE NULL END
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true;
  END IF;

  -- 출장카드가 새로 선택된 경우 자동 생성
  IF NULLIF(BTRIM(COALESCE(NEW.requested_card_number, '')), '') IS NOT NULL
     AND (
       NULLIF(BTRIM(COALESCE(OLD.requested_card_number, '')), '') IS NULL
       OR NEW.requested_card_number IS DISTINCT FROM OLD.requested_card_number
     ) THEN
    INSERT INTO card_usages (
      requester_id,
      card_number,
      usage_category,
      usage_date_start,
      usage_date_end,
      description,
      approval_status,
      business_trip_id,
      auto_created_by_trip
    )
    SELECT
      NEW.requester_id,
      NEW.requested_card_number,
      '출장',
      NEW.trip_start_date,
      NEW.trip_end_date,
      '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
      CASE
        WHEN NEW.approval_status = 'approved' THEN 'approved'
        WHEN NEW.approval_status = 'rejected' THEN 'rejected'
        ELSE 'pending'
      END,
      NEW.id,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM card_usages cu
      WHERE cu.business_trip_id = NEW.id
        AND cu.auto_created_by_trip = true
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_trips_sync_card_usage_trigger ON business_trips;
CREATE TRIGGER business_trips_sync_card_usage_trigger
  AFTER INSERT OR UPDATE ON business_trips
  FOR EACH ROW EXECUTE FUNCTION sync_business_trip_card_usage();

-- 11) RLS
ALTER TABLE business_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_mileages ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_expense_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_trips_select" ON business_trips
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trips_insert" ON business_trips
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trips_update" ON business_trips
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trips_delete" ON business_trips
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "business_trip_expenses_select" ON business_trip_expenses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trip_expenses_insert" ON business_trip_expenses
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trip_expenses_update" ON business_trip_expenses
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trip_expenses_delete" ON business_trip_expenses
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "business_trip_mileages_select" ON business_trip_mileages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trip_mileages_insert" ON business_trip_mileages
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trip_mileages_update" ON business_trip_mileages
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trip_mileages_delete" ON business_trip_mileages
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "business_trip_tasks_select" ON business_trip_tasks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trip_tasks_insert" ON business_trip_tasks
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trip_tasks_update" ON business_trip_tasks
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trip_tasks_delete" ON business_trip_tasks
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "business_trip_allowances_select" ON business_trip_allowances
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trip_allowances_insert" ON business_trip_allowances
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trip_allowances_update" ON business_trip_allowances
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trip_allowances_delete" ON business_trip_allowances
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "business_trip_expense_receipts_select" ON business_trip_expense_receipts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_trip_expense_receipts_insert" ON business_trip_expense_receipts
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_trip_expense_receipts_update" ON business_trip_expense_receipts
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_trip_expense_receipts_delete" ON business_trip_expense_receipts
  FOR DELETE TO authenticated USING (true);

-- 12) 출장 영수증 버킷
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-trip-receipts', 'business-trip-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "business_trip_receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'business-trip-receipts');

CREATE POLICY "business_trip_receipts_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'business-trip-receipts');

CREATE POLICY "business_trip_receipts_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'business-trip-receipts');
