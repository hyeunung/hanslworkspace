-- 부품명 별칭 매핑 테이블 (스펙 ↔ 파트넘버 학습 사전)
-- 같은 스펙(예: 저항(100S))에 대해 여러 파트넘버(CL05B102KB5NNNC 등)를 매핑
-- 확정 시 수동 매칭한 관계를 저장하여 다음 거래명세서 자동 매칭에 활용

CREATE TABLE IF NOT EXISTS item_name_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 시스템 품목 정보 (purchase_request_items 기준)
  system_item_name TEXT NOT NULL,
  system_specification TEXT,
  
  -- 거래명세서에서 온 부품명 (OCR 추출 파트넘버)
  alias_name TEXT NOT NULL,
  
  -- 매칭 횟수 (같은 매핑이 반복되면 신뢰도 증가)
  match_count INTEGER NOT NULL DEFAULT 1,
  
  -- 최초 생성 / 최근 사용
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- 동일 매핑 중복 방지 (시스템 품목명+스펙+별칭명 조합은 유니크)
  UNIQUE(system_item_name, system_specification, alias_name)
);

-- 별칭명으로 빠르게 검색하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_item_name_aliases_alias_name 
  ON item_name_aliases(alias_name);

-- 시스템 품목명으로 검색
CREATE INDEX IF NOT EXISTS idx_item_name_aliases_system_item 
  ON item_name_aliases(system_item_name);

-- RLS
ALTER TABLE item_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to view item_name_aliases"
  ON item_name_aliases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert item_name_aliases"
  ON item_name_aliases FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update item_name_aliases"
  ON item_name_aliases FOR UPDATE
  TO authenticated
  USING (true);

COMMENT ON TABLE item_name_aliases IS '부품명 별칭 매핑 사전 - OCR 추출 파트넘버와 시스템 스펙/품목명의 매핑을 학습';
COMMENT ON COLUMN item_name_aliases.system_item_name IS '시스템 발주 품목명 (purchase_request_items.item_name)';
COMMENT ON COLUMN item_name_aliases.system_specification IS '시스템 발주 규격 (purchase_request_items.specification)';
COMMENT ON COLUMN item_name_aliases.alias_name IS '거래명세서에서 온 부품명/파트넘버 (OCR 추출값)';
COMMENT ON COLUMN item_name_aliases.match_count IS '동일 매핑 반복 횟수 (누적 시 신뢰도 증가)';
