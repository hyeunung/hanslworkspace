-- 업무용 AI 서비스 사용 지원 신청서 일련번호(HAI) 자동 생성
-- 1) 코드 칼럼 추가
ALTER TABLE ai_service_applications
  ADD COLUMN IF NOT EXISTS application_code text;

COMMENT ON COLUMN ai_service_applications.application_code IS '신청 코드 (HAI+YYMMDD+3자리 일련번호)';

CREATE UNIQUE INDEX IF NOT EXISTS ai_service_applications_application_code_key
  ON ai_service_applications (application_code);

-- 2) HAI 코드 생성 함수 (한국시간 기준 날짜)
CREATE OR REPLACE FUNCTION generate_ai_service_application_code(p_app_date date DEFAULT NULL)
RETURNS text AS $$
DECLARE
  v_date date := COALESCE(p_app_date, timezone('Asia/Seoul', now())::date);
  v_prefix text := 'HAI' || to_char(v_date, 'YYMMDD');
  v_next_seq int;
BEGIN
  -- Lock to prevent duplicates under concurrent inserts
  LOCK TABLE ai_service_applications IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(SUBSTRING(application_code FROM 10 FOR 3)::int), 0) + 1
    INTO v_next_seq
  FROM ai_service_applications
  WHERE application_code LIKE (v_prefix || '%');

  RETURN v_prefix || lpad(v_next_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- 3) 코드 자동 부여 트리거
CREATE OR REPLACE FUNCTION ai_service_applications_assign_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.application_code IS NULL OR btrim(NEW.application_code) = '' THEN
    NEW.application_code := generate_ai_service_application_code(
      COALESCE(NEW.application_date, timezone('Asia/Seoul', now())::date)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_service_applications_assign_code_trigger ON ai_service_applications;
CREATE TRIGGER ai_service_applications_assign_code_trigger
  BEFORE INSERT ON ai_service_applications
  FOR EACH ROW EXECUTE FUNCTION ai_service_applications_assign_code();

-- 4) 기존 데이터 백필
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id,
           COALESCE(application_date, created_at::date, timezone('Asia/Seoul', now())::date) AS d
    FROM ai_service_applications
    WHERE application_code IS NULL OR btrim(application_code) = ''
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE ai_service_applications
       SET application_code = generate_ai_service_application_code(r.d)
     WHERE id = r.id;
  END LOOP;
END $$;
