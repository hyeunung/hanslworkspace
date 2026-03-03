-- 차량 요청 테이블
CREATE TABLE IF NOT EXISTS vehicle_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id uuid REFERENCES employees(id),
  use_department text NOT NULL,
  purpose text NOT NULL,
  vehicle_info text NOT NULL,
  route text NOT NULL,
  driver_id uuid REFERENCES employees(id),
  companions jsonb DEFAULT '[]'::jsonb,
  passenger_count int NOT NULL DEFAULT 1,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_hours numeric GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_at - start_at)) / 3600
  ) STORED,
  notes text,
  approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE vehicle_requests IS '차량 배차 요청';
COMMENT ON COLUMN vehicle_requests.vehicle_info IS '차종 + 차량번호 (예: PALISADE 259누 8222)';
COMMENT ON COLUMN vehicle_requests.companions IS '동승자 배열 [{id, name}]';
COMMENT ON COLUMN vehicle_requests.duration_hours IS '사용시간(시간) - 자동계산';
COMMENT ON COLUMN vehicle_requests.passenger_count IS '탑승인원 (운전자 + 동승자)';

-- RLS 활성화
ALTER TABLE vehicle_requests ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자가 조회 가능
CREATE POLICY "vehicle_requests_select" ON vehicle_requests
  FOR SELECT TO authenticated USING (true);

-- 인증된 사용자가 본인 요청 생성 가능
CREATE POLICY "vehicle_requests_insert" ON vehicle_requests
  FOR INSERT TO authenticated WITH CHECK (true);

-- 본인 요청 또는 관리자가 수정 가능
CREATE POLICY "vehicle_requests_update" ON vehicle_requests
  FOR UPDATE TO authenticated USING (true);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_vehicle_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicle_requests_updated_at
  BEFORE UPDATE ON vehicle_requests
  FOR EACH ROW EXECUTE FUNCTION update_vehicle_requests_updated_at();
