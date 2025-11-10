# 전체항목 탭 상세모달 딜레이 원인 분석 보고서

## 문제 현상
- 승인대기, 입고현황, 구매현황 탭: 상세모달이 즉시 열림
- 전체항목(done) 탭: 상세모달이 약간의 딜레이를 가지고 열림

## 원인 분석

### 1. 칼럼 너비 계산 함수 (`calculateOptimalColumnWidths`)

**위치**: `src/components/purchase/PurchaseDetailModal.tsx` Line 657-787

**의존성**: `[purchase, activeTab]`

**탭별 칼럼 수**:
- 승인대기(pending): 7개 칼럼
- 구매현황(purchase): 8개 칼럼
- 입고현황(receipt): 8개 칼럼
- **전체항목(done): 11개 칼럼** (추가 4개: 거래명세서 확인, 회계상 입고일, 처리자, UTK)

### 2. 딜레이 발생 지점

**Line 824-829**: `useEffect`에서 칼럼 너비 계산 실행
```typescript
useEffect(() => {
  if (purchase && purchase.purchase_request_items && purchase.purchase_request_items.length > 0 && !isEditing) {
    calculateOptimalColumnWidths()
  }
}, [purchase, isEditing, activeTab, calculateOptimalColumnWidths])
```

**의존성**: `[purchase, isEditing, activeTab, calculateOptimalColumnWidths]`
- `activeTab`이 의존성에 포함되어 있음
- `activeTab`이 `done`일 때 `calculateOptimalColumnWidths`가 재생성됨
- 재생성된 함수가 `useEffect`를 트리거하여 계산이 실행됨

### 3. 계산 복잡도

**Line 714-767**: 모든 아이템을 순회하면서 각 칼럼의 최대 길이 계산
```typescript
items.forEach(item => {
  // 각 칼럼별로 cellValue 계산
  // 한글/영문 혼합 텍스트 길이 계산 (한글은 1.5배 가중치)
  const adjustedLength = cellValue.split('').reduce((acc, char) => {
    return acc + (/[가-힣]/.test(char) ? 1.5 : 1)
  }, 0)
})
```

**계산량**:
- 승인대기: 7개 칼럼 × 아이템 수
- 구매현황: 8개 칼럼 × 아이템 수
- 입고현황: 8개 칼럼 × 아이템 수
- **전체항목: 11개 칼럼 × 아이템 수** (약 57% 더 많은 계산)

### 4. 추가 계산 항목 (done 탭 전용)

**Line 747-758**: `done` 탭에서만 계산되는 4개 칼럼
1. `transaction_confirm`: `item.is_statement_received ? '확인완료' : '미확인'`
2. `accounting_date`: `item.statement_received_date ? formatDate(...) : ''`
3. `processor`: `item.statement_received_by_name || ''`
4. `utk_confirm`: `item.is_utk_checked ? '완료' : '대기'`

각 칼럼마다:
- 모든 아이템을 순회
- 텍스트 길이 계산
- 한글/영문 혼합 텍스트 길이 계산 (정규식 테스트 포함)

### 5. 실행 순서

1. 모달 열기 → `purchaseId` 설정
2. `useEffect` (Line 626-654) 실행 → 메모리에서 데이터 로드 → `setPurchase` 호출
3. `purchase` 상태 업데이트
4. `calculateOptimalColumnWidths` 재생성 (의존성: `[purchase, activeTab]`)
5. `useEffect` (Line 824-829) 실행 → `calculateOptimalColumnWidths()` 호출
6. **11개 칼럼 × 모든 아이템 순회 계산** (done 탭)
7. `setColumnWidths` 호출
8. 모달 렌더링 완료

### 6. 성능 영향

**계산 시간 추정** (아이템 10개 기준):
- 승인대기: 7칼럼 × 10아이템 = 70회 계산
- 구매현황: 8칼럼 × 10아이템 = 80회 계산
- 입고현황: 8칼럼 × 10아이템 = 80회 계산
- **전체항목: 11칼럼 × 10아이템 = 110회 계산** (약 57% 증가)

**추가 오버헤드**:
- 각 계산마다 정규식 테스트 (`/[가-힣]/.test(char)`)
- 문자열 split 및 reduce 연산
- `formatDate` 함수 호출 (accounting_date 칼럼)

## 결론

**원인**: `done` 탭에서만 추가로 4개의 칼럼을 계산해야 하므로, `calculateOptimalColumnWidths` 함수의 실행 시간이 다른 탭보다 약 57% 더 길어집니다. 이로 인해 모달이 열리기 전에 칼럼 너비 계산이 완료될 때까지 약간의 딜레이가 발생합니다.

**영향 요소**:
1. 칼럼 수 증가 (11개 vs 7-8개)
2. 모든 아이템 순회 계산
3. 한글/영문 혼합 텍스트 길이 계산 (정규식 포함)
4. `formatDate` 함수 호출

**해결 방안**:
1. 칼럼 너비 계산을 비동기로 처리 (모달 먼저 표시, 계산은 백그라운드)
2. `done` 탭의 추가 칼럼 계산을 지연 로딩
3. 칼럼 너비 계산 결과를 메모이제이션
4. 계산을 웹 워커로 이동

