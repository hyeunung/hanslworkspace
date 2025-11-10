-- 사용자별 UI 설정 저장 테이블 생성
-- 칼럼 가시성, 필터 설정, 정렬 설정 등을 저장

CREATE TABLE user_ui_settings (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  setting_type TEXT NOT NULL,      -- 'column_visibility', 'filter_preset', 'table_sort' 등
  setting_key TEXT NOT NULL,       -- 'purchase_list_done', 'purchase_list_pending' 등  
  setting_value JSONB NOT NULL,    -- 실제 설정 데이터
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 사용자별 설정 타입별 키별로 고유
  UNIQUE(user_email, setting_type, setting_key)
);

-- 빠른 조회를 위한 인덱스 생성
CREATE INDEX idx_user_ui_settings_lookup 
ON user_ui_settings(user_email, setting_type, setting_key);

-- 사용자별 조회를 위한 추가 인덱스
CREATE INDEX idx_user_ui_settings_user 
ON user_ui_settings(user_email);

-- RLS (Row Level Security) 활성화
ALTER TABLE user_ui_settings ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 설정만 조회/수정 가능
CREATE POLICY "Users can view own UI settings"
  ON user_ui_settings FOR SELECT
  USING (user_email = auth.email());

CREATE POLICY "Users can insert own UI settings"
  ON user_ui_settings FOR INSERT
  WITH CHECK (user_email = auth.email());

CREATE POLICY "Users can update own UI settings"
  ON user_ui_settings FOR UPDATE
  USING (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

CREATE POLICY "Users can delete own UI settings"
  ON user_ui_settings FOR DELETE
  USING (user_email = auth.email());

-- 테이블에 코멘트 추가
COMMENT ON TABLE user_ui_settings IS '사용자별 UI 설정 저장 테이블 (칼럼 가시성, 필터, 정렬 등)';
COMMENT ON COLUMN user_ui_settings.user_email IS '사용자 이메일 (employees.email과 연동)';
COMMENT ON COLUMN user_ui_settings.setting_type IS '설정 타입 (column_visibility, filter_preset, table_sort 등)';
COMMENT ON COLUMN user_ui_settings.setting_key IS '설정 키 (purchase_list_done, purchase_list_pending 등)';
COMMENT ON COLUMN user_ui_settings.setting_value IS '실제 설정 데이터 (JSON 형태)';