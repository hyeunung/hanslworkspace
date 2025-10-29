-- Make.com webhook 보호를 위한 마이그레이션
-- 이 파일은 make.com 자동 이메일 발송을 위한 webhook 설정을 보존합니다

-- 1. 기존 Database Webhook 설정 확인 (참고용)
-- Supabase Dashboard > Database > Webhooks에서 설정한 webhook은
-- 테이블 구조가 변경되거나 마이그레이션이 실행될 때 삭제될 수 있습니다

-- 2. Make.com webhook을 위한 안정적인 트리거 함수 생성
-- 이 방법은 테이블 변경에도 webhook이 유지되도록 보장합니다

-- Webhook 트리거 함수 생성 (이미 있으면 대체)
CREATE OR REPLACE FUNCTION notify_makecom_webhook() 
RETURNS trigger AS $$
DECLARE
  payload json;
BEGIN
  -- INSERT, UPDATE, DELETE에 따라 다른 payload 구성
  IF (TG_OP = 'DELETE') THEN
    payload = json_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'old_record', row_to_json(OLD),
      'timestamp', current_timestamp
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    payload = json_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'old_record', row_to_json(OLD),
      'new_record', row_to_json(NEW),
      'timestamp', current_timestamp
    );
  ELSIF (TG_OP = 'INSERT') THEN
    payload = json_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'new_record', row_to_json(NEW),
      'timestamp', current_timestamp
    );
  END IF;
  
  -- NOTIFY를 통해 이벤트 발생
  -- Make.com에서는 Supabase Realtime을 통해 이를 수신할 수 있습니다
  PERFORM pg_notify('makecom_webhook_channel', payload::text);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 발주요청 테이블에 대한 Make.com 트리거 (기존 것 삭제 후 재생성)
DROP TRIGGER IF EXISTS makecom_purchase_requests_trigger ON purchase_requests;
CREATE TRIGGER makecom_purchase_requests_trigger
  AFTER INSERT OR UPDATE ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_makecom_webhook();

-- 발주요청 아이템 테이블에 대한 Make.com 트리거
DROP TRIGGER IF EXISTS makecom_purchase_items_trigger ON purchase_request_items;
CREATE TRIGGER makecom_purchase_items_trigger
  AFTER INSERT OR UPDATE ON purchase_request_items
  FOR EACH ROW
  EXECUTE FUNCTION notify_makecom_webhook();

-- 문의하기 테이블에 대한 Make.com 트리거
DROP TRIGGER IF EXISTS makecom_support_trigger ON support_inquires;
CREATE TRIGGER makecom_support_trigger
  AFTER INSERT ON support_inquires
  FOR EACH ROW
  EXECUTE FUNCTION notify_makecom_webhook();

-- 설정 확인용 쿼리
-- SELECT * FROM pg_trigger WHERE tgname LIKE '%makecom%';

-- 주의사항:
-- 1. 이 트리거는 pg_notify를 사용하므로 Make.com에서 Supabase Realtime 연결이 필요합니다
-- 2. 또는 Supabase Dashboard에서 Database Webhook을 다시 설정하되,
--    webhook 이름을 'makecom_email_webhook' 같이 명확하게 지정하세요
-- 3. 마이그레이션 실행 후 항상 webhook 설정을 확인하세요
