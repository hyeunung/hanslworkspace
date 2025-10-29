# Make.com Webhook 삭제 문제 분석 보고서

## 🔍 문제 원인 분석

### 1. **마이그레이션 실행 시 webhook 삭제**
- 테이블 구조 변경 시 Supabase Database Webhook이 자동 삭제됨
- 특히 다음 작업 시 webhook이 사라짐:
  - 컬럼 추가/삭제
  - 트리거 재생성
  - 테이블 RLS 정책 변경

### 2. **최근 실행된 마이그레이션들**
- `20251028_remove_support_fk_constraint.sql` - support 테이블 변경
- `20250125c_add_delivery_columns_to_items.sql` - 트리거 재생성
- 다수의 cleanup 마이그레이션 - 테이블 구조 변경

### 3. **Supabase Database Webhook의 한계**
- Supabase Dashboard에서 설정한 webhook은 데이터베이스 스키마와 독립적으로 관리됨
- 테이블이 변경되면 관련 webhook도 삭제됨
- 마이그레이션 코드에 webhook 설정이 없으면 복구되지 않음

## ✅ 해결 방법

### 1. **즉시 해결 - Webhook 재설정**
Supabase Dashboard에서 다시 설정:
1. Database > Webhooks 메뉴로 이동
2. "Create a new webhook" 클릭
3. 다음 설정 입력:
   - Name: `makecom_email_webhook`
   - Table: `purchase_requests` (또는 필요한 테이블)
   - Events: INSERT, UPDATE 선택
   - URL: Make.com webhook URL
   - HTTP Headers: 필요한 경우 추가

### 2. **영구 해결 - 마이그레이션 파일로 관리**
`20251029_preserve_makecom_webhook.sql` 파일을 생성했습니다.
이 파일은:
- Webhook 트리거를 SQL로 정의
- 마이그레이션 실행 시에도 유지됨
- pg_notify를 사용한 안정적인 이벤트 전달

### 3. **Make.com 연결 방법 변경 권장**
현재 Database Webhook 대신 다음 방법 사용:
1. **Supabase Realtime 사용**
   - 더 안정적이고 유지보수가 쉬움
   - 테이블 변경에 영향받지 않음
   
2. **Edge Function 사용**
   - Supabase Edge Function에서 Make.com으로 HTTP 요청
   - 더 복잡한 로직 처리 가능

## 📋 권장사항

1. **단기 대책**
   - Supabase Dashboard에서 webhook 재설정
   - webhook 이름을 명확하게 지정 (예: `makecom_email_webhook`)
   - 설정 스크린샷 저장

2. **장기 대책**
   - 마이그레이션 파일로 webhook 관리
   - 또는 Supabase Realtime + Make.com 연동으로 변경
   - webhook 설정을 코드로 문서화

3. **예방 조치**
   - 마이그레이션 실행 전 webhook 설정 백업
   - 마이그레이션 실행 후 webhook 동작 확인
   - webhook 설정을 프로젝트 문서에 기록
