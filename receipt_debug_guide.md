# 영수증 인쇄완료 기능 디버깅 가이드

## 문제 상황
- **정현웅**: 인쇄완료 버튼 정상 작동 (백엔드 업데이트 됨)
- **이채령**: 인쇄완료 버튼 눌러도 백엔드 업데이트 안됨

## 디버깅 도구 사용법

### 1. 브라우저 콘솔 디버깅 스크립트

파일: `/debug_receipt_print_issue.js`

#### 사용법
1. 브라우저에서 영수증 관리 페이지 접속
2. 개발자 도구 콘솔 열기 (F12)
3. 디버깅 스크립트 로드:
   ```javascript
   // 스크립트 파일 내용을 콘솔에 복사 붙여넣기
   ```
4. 전체 진단 실행:
   ```javascript
   ReceiptDebugger.runFullDiagnosis('영수증_ID')
   ```

#### 개별 테스트
```javascript
// 사용자 인증 정보 확인
ReceiptDebugger.checkAuthInfo()

// 사용자 권한 확인
ReceiptDebugger.checkUserPermissions('user@email.com')

// RLS 정책 테스트
ReceiptDebugger.testRLSPolicies('영수증_ID')

// 브라우저 환경 확인
ReceiptDebugger.checkBrowserEnvironment()

// 네트워크 모니터링 시작
ReceiptDebugger.startNetworkMonitoring()

// 실제 인쇄완료 테스트
ReceiptDebugger.testPrintCompletion('영수증_ID')
```

### 2. 백엔드 SQL 디버깅

파일: `/debug_receipt_backend.sql`

#### 사용법
1. Supabase 관리자 대시보드 접속
2. SQL Editor 열기
3. 스크립트 섹션별로 실행
4. 정현웅과 이채령의 결과 비교

#### 주요 확인 사항
- 사용자별 기본 정보 및 권한
- 영수증 인쇄 기록 분석
- RLS 정책 현황
- 사용자 인증 정보 (auth.users)
- 최근 업데이트 시도 분석

### 3. 실시간 모니터링 시스템

파일: `/src/utils/receiptDebugMonitor.ts`

#### 자동 활성화
개발 환경에서 자동으로 다음 이벤트를 추적:
- 사용자 인증 상태
- 권한 변경
- 네트워크 요청/응답
- 업데이트 성공/실패
- 오류 발생

#### 수동 조작
```javascript
// 디버깅 세션 시작
ReceiptDebugMonitor.startSession()

// 현재 세션 정보 확인
ReceiptDebugMonitor.getSession()

// 비교 리포트 생성
ReceiptDebugMonitor.generateComparisonReport()

// 세션 데이터 내보내기
ReceiptDebugMonitor.exportSessionData()

// 세션 종료
ReceiptDebugMonitor.stopSession()
```

## 단계별 디버깅 절차

### 정현웅 (정상 작동 사용자)
1. 브라우저에서 영수증 관리 페이지 접속
2. 개발자 도구 콘솔에서 `ReceiptDebugger.runFullDiagnosis('영수증_ID')` 실행
3. 인쇄완료 버튼 클릭
4. 콘솔 로그 및 네트워크 탭에서 요청/응답 확인
5. 결과를 JSON으로 저장: `ReceiptDebugger.exportSessionData()`

### 이채령 (문제 발생 사용자)
1. 동일한 절차 실행
2. 결과를 정현웅과 비교
3. 차이점 분석

### 백엔드 분석
1. Supabase SQL Editor에서 `/debug_receipt_backend.sql` 실행
2. 두 사용자의 데이터베이스 레코드 비교
3. RLS 정책 및 권한 차이 확인

## 예상 차이점 분석 영역

### 1. 사용자 인증 차이
- Auth token 유효성
- 세션 만료 상태
- 로그인 방식 차이

### 2. 권한 데이터 불일치
- `employees.purchase_role` 필드 값 차이
- 대소문자 또는 공백 문제
- 권한 업데이트 시차

### 3. 브라우저 환경 차이
- 쿠키/로컬 스토리지 상태
- 브라우저 버전 차이
- 네트워크 환경 (프록시, VPN 등)

### 4. RLS (Row Level Security) 정책
- 정책 조건 세부 사항
- 사용자별 적용 차이
- 데이터베이스 권한 불일치

### 5. 네트워크 요청 차이
- 요청 헤더 차이
- 응답 상태 코드
- 타임아웃 발생

### 6. 타이밍/동시성 문제
- 데이터베이스 락
- 트랜잭션 충돌
- 네트워크 지연

## 강화된 로깅 시스템

### 새로 추가된 로그 포인트
- 🖨️ 인쇄완료 처리 시작
- 🔐 사용자 인증 정보 확인
- 👤 직원 정보 조회
- 🛡️ 권한 검증
- 📝 업데이트 데이터 준비
- 🔄 데이터베이스 업데이트 실행
- ✅ 업데이트 성공
- ❌ 업데이트 실패
- 💥 예외 발생

### 로그 검색 방법
브라우저 콘솔에서:
```javascript
// 특정 타입 로그만 필터링
console.log(performance.getEntriesByType('navigation'))

// 네트워크 요청 확인
// Network 탭에서 'purchase_receipts' 필터링

// 로컬/세션 스토리지 확인
Object.keys(localStorage).filter(key => key.includes('supabase'))
```

## 문제 해결 예상 시나리오

### 시나리오 1: 권한 데이터 불일치
**증상**: 이채령의 권한이 다르게 표시됨
**해결**: `employees` 테이블의 `purchase_role` 필드 확인 및 수정

### 시나리오 2: RLS 정책 문제
**증상**: 업데이트 시 권한 오류 발생
**해결**: `purchase_receipts` 테이블 RLS 정책 재검토

### 시나리오 3: 브라우저 캐시 문제
**증상**: 이전 권한 정보가 캐시됨
**해결**: 브라우저 캐시 클리어, 하드 리프레시

### 시나리오 4: 네트워크 요청 실패
**증상**: 요청이 전송되지 않거나 응답이 오지 않음
**해결**: 네트워크 환경 확인, 프록시/방화벽 설정

### 시나리오 5: 동시성 문제
**증상**: 특정 조건에서만 실패
**해결**: 데이터베이스 격리 수준 조정, 재시도 로직 추가

## 다음 단계

1. **정현웅과 이채령 모두 디버깅 스크립트 실행**
2. **결과 비교 분석**
3. **차이점을 바탕으로 근본 원인 파악**
4. **해결책 구현 및 테스트**
5. **디버깅 로그 제거 (프로덕션 배포 전)**

## 참고 사항

- 모든 디버깅 로그는 개발 환경에서만 활성화됨
- 개인정보가 포함된 로그는 마스킹 처리됨
- 디버깅 완료 후 관련 로그 코드는 제거하거나 조건부 활성화로 변경 필요

---

**최종 업데이트**: 2025-10-29
**담당자**: Claude Code Assistant