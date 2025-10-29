# Make.com + Supabase Realtime 연동 가이드

## 1. Make.com에서 설정

### Step 1: Supabase 모듈 추가
1. Make.com 시나리오에서 **"+"** 클릭
2. **"Supabase"** 검색하여 선택
3. **"Watch Records (Real-time)"** 선택 (중요!)
   - ❌ "Watch Records" (일반 폴링)
   - ✅ "Watch Records (Real-time)" (실시간)

### Step 2: 연결 설정
1. **Connection** 생성:
   - Supabase URL: `https://fssavlwvnhhplnhhsqgn.supabase.co`
   - Service Role Key: (환경변수에서 확인)
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
   ```

### Step 3: 테이블 설정
1. **Table**: `purchase_requests` 선택
2. **Events**: 
   - ✅ Insert
   - ✅ Update  
   - ⬜ Delete (필요시 선택)
3. **Filter** (선택사항):
   ```
   middle_manager_status = 'approved' AND final_manager_status = 'approved'
   ```

### Step 4: 데이터 처리
Realtime으로 받은 데이터 예시:
```json
{
  "eventType": "INSERT",
  "new": {
    "id": 2365,
    "purchase_order_number": "F20251029_001",
    "requester_name": "홍길동",
    "vendor_name": "ABC업체",
    "request_date": "2025-10-29",
    "middle_manager_status": "approved",
    "final_manager_status": "approved"
  },
  "old": {},
  "table": "purchase_requests"
}
```

## 2. Supabase에서 필요한 설정

### Realtime 활성화 확인
```sql
-- 이미 설정되어 있을 가능성 높음
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_requests;
```

### RLS 정책 확인
```sql
-- Realtime은 RLS를 우회하므로 Service Role Key 사용 시 주의
```

## 3. Make.com 시나리오 예시

### 발주 승인 시 이메일 발송
```
[Supabase Watch Records (Real-time)]
         ↓
[Filter: 승인 완료된 건만]
         ↓
[HTTP Request: 업체 정보 조회]
         ↓
[Email: 발주서 발송]
```

### 필터 조건 예시
```javascript
// Make.com Filter 모듈에서 사용
new.middle_manager_status == "approved" && 
new.final_manager_status == "approved" &&
old.final_manager_status != "approved"  // 방금 승인된 건만
```

## 4. 장점

### Database Webhook 대비 장점
1. **안정성**: 테이블 변경해도 연결 유지
2. **실시간성**: 변경사항 즉시 감지
3. **유연성**: Make.com에서 필터링 가능
4. **관리 편의성**: Make.com에서 모든 설정 관리

### 주의사항
1. Service Role Key 보안 관리 필수
2. 대량 데이터 변경 시 요청 폭주 주의
3. Make.com 요금제의 operation 한도 확인

## 5. 테스트 방법

1. Make.com 시나리오 실행
2. Supabase에서 데이터 변경:
   ```sql
   UPDATE purchase_requests 
   SET final_manager_status = 'approved'
   WHERE id = 2365;
   ```
3. Make.com에서 즉시 트리거 확인

## 6. 문제 해결

### 연결이 안 될 때
- Service Role Key 확인
- Supabase URL 확인 (https:// 포함)
- 테이블명 오타 확인

### 데이터가 안 올 때
- Realtime 활성화 확인
- RLS 정책 확인
- Make.com 필터 조건 확인
