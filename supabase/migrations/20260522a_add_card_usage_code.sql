-- 법인카드 사용 요청 코드(HCU) 자동 생성
-- 출장 미연동 카드가 승인완료되면 HCU+YYMMDD+3자리 일련번호 코드를 부여한다.
-- (출장 연동 카드는 출장코드를 그대로 사용하므로 코드 미생성)

-- 1) 코드 칼럼 추가
ALTER TABLE card_usages
  ADD COLUMN IF NOT EXISTS card_usage_code text;

COMMENT ON COLUMN card_usages.card_usage_code IS '카드사용 코드 (HCU+YYMMDD+3자리 일련번호). 출장 미연동 카드 승인완료 시 자동 생성';

CREATE UNIQUE INDEX IF NOT EXISTS card_usages_card_usage_code_key
  ON card_usages (card_usage_code);

-- 2) HCU 코드 생성 함수 (한국시간 기준 날짜)
CREATE OR REPLACE FUNCTION generate_card_usage_code(p_date date DEFAULT NULL)
RETURNS text AS $$
DECLARE
  v_date date := COALESCE(p_date, timezone('Asia/Seoul', now())::date);
  v_prefix text := 'HCU' || to_char(v_date, 'YYMMDD');
  v_next_seq int;
BEGIN
  LOCK TABLE card_usages IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(SUBSTRING(card_usage_code FROM 10 FOR 3)::int), 0) + 1
    INTO v_next_seq
  FROM card_usages
  WHERE card_usage_code LIKE (v_prefix || '%');

  RETURN v_prefix || lpad(v_next_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- 3) 승인완료 시 코드 자동 부여 트리거
--    승인완료/정산완료/반납완료(approved/settled/returned) && 출장 미연동 && 코드 미보유일 때만 생성
CREATE OR REPLACE FUNCTION card_usages_assign_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.approval_status IN ('approved', 'settled', 'returned')
     AND NEW.business_trip_id IS NULL
     AND (NEW.card_usage_code IS NULL OR btrim(NEW.card_usage_code) = '') THEN
    NEW.card_usage_code := generate_card_usage_code(
      COALESCE(timezone('Asia/Seoul', NEW.created_at), timezone('Asia/Seoul', now()))::date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS card_usages_assign_code_trigger ON card_usages;
CREATE TRIGGER card_usages_assign_code_trigger
  BEFORE INSERT OR UPDATE ON card_usages
  FOR EACH ROW EXECUTE FUNCTION card_usages_assign_code();

-- 4) 기존 승인완료(approved/settled/returned) 출장 미연동 카드에 코드 백필
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id,
           COALESCE(timezone('Asia/Seoul', created_at), timezone('Asia/Seoul', now()))::date AS d
    FROM card_usages
    WHERE approval_status IN ('approved', 'settled', 'returned')
      AND business_trip_id IS NULL
      AND (card_usage_code IS NULL OR btrim(card_usage_code) = '')
    ORDER BY created_at, id
  LOOP
    UPDATE card_usages
       SET card_usage_code = generate_card_usage_code(r.d)
     WHERE id = r.id;
  END LOOP;
END $$;
