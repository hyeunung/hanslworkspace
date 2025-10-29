# 🚨 Make.com Webhook이 지워지는 정확한 원인

## 발견된 문제 코드들

### 1. **CASCADE 옵션 사용 (가장 치명적)**
```sql
-- 20250125_cleanup_unused_tables_and_columns.sql
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS trigger_execution_log CASCADE;
DROP TABLE IF EXISTS notification_sent_log CASCADE;
```

**문제:** `CASCADE`는 해당 테이블에 연결된 **모든 종속 객체를 삭제**합니다:
- 외래 키
- 뷰(View)
- 트리거(Trigger)
- **Database Webhook** ← 이것도 삭제됨!

### 2. **ALTER TABLE 명령어들**
```sql
-- 20250125_cleanup_unused_tables_and_columns.sql
ALTER TABLE purchase_requests 
DROP COLUMN IF EXISTS requester_fax,
DROP COLUMN IF EXISTS email_status,
... (14개 컬럼 삭제)
```

**문제:** Supabase는 테이블 구조가 변경되면 관련 webhook을 자동으로 재설정해야 한다고 판단하여 **기존 webhook을 삭제**합니다.

### 3. **반복되는 마이그레이션 파일들**
- `20250125_cleanup_*.sql` - 여러 개의 정리 파일
- `20250125_deep_cleanup_*.sql` - 추가 정리 파일  
- `20250125_final_cleanup_*.sql` - 최종 정리 파일

**문제:** 같은 작업을 여러 번 반복하면서 webhook이 계속 삭제됨

## 즉시 해결책

### 1. webhook을 코드로 관리
Supabase Dashboard가 아닌 SQL 트리거로 관리:

```sql
-- webhook 대신 트리거 사용
CREATE OR REPLACE FUNCTION send_to_makecom()
RETURNS trigger AS $$
BEGIN
  -- pg_net extension으로 직접 HTTP 요청
  PERFORM net.http_post(
    url := 'https://hook.eu2.make.com/YOUR_WEBHOOK_URL',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'data', row_to_json(NEW)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. 마이그레이션 실행 전 백업
```bash
# webhook 설정 스크린샷 저장
# webhook URL 별도 문서화
```

### 3. CASCADE 사용 금지
```sql
-- 나쁜 예
DROP TABLE IF EXISTS table_name CASCADE;

-- 좋은 예  
DROP TABLE IF EXISTS table_name;
```

## 영구 해결책

1. **Supabase Realtime 사용**
   - Database Webhook 대신 Realtime 구독 사용
   - 테이블 변경에 영향받지 않음

2. **Edge Function 사용**
   - 더 안정적이고 유연함
   - 복잡한 로직 처리 가능

3. **pg_net extension 활용**
   - 트리거에서 직접 HTTP 요청
   - 마이그레이션에 영향받지 않음
