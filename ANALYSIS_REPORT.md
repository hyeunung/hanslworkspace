# 승인 완료 후 리스트 업데이트 안 되는 문제 분석 보고서

## 문제 현상
1차 승인 완료 또는 최종 승인 완료를 눌렀을 때, 상세 모달에서는 승인 상태가 변경되지만 메인 리스트에서는 실시간으로 반영되지 않음.

## 코드 흐름 분석

### 1. 승인 처리 흐름 (`handleApprove`)
```
handleApprove 호출
  ↓
DB 업데이트 (middle_manager_status 또는 final_manager_status)
  ↓
로컬 상태 업데이트 (setPurchase)
  ↓
onOptimisticUpdate 호출
  ↓
updatePurchaseInMemory 호출
  ↓
purchaseMemoryCache.allPurchases[index] 업데이트
  ↓
purchaseMemoryCache.lastFetch = Date.now()
```

### 2. 리스트 렌더링 흐름
```
usePurchaseMemory 훅
  ↓
50ms마다 폴링으로 purchaseMemoryCache.allPurchases 체크
  ↓
setPurchases([...purchaseMemoryCache.allPurchases]) 호출
  ↓
PurchaseListMain에서 allPurchases: purchases 받음
  ↓
baseFilteredPurchases = getFilteredPurchases({ tab: activeTab, ... })
  ↓
tabFilteredPurchases = baseFilteredPurchases
  ↓
FastPurchaseTable에 tabFilteredPurchases 전달
```

## 발견된 문제점

### 문제 1: 타입 불일치 가능성
- `PurchaseRequestWithDetails.id`는 `string` 타입
- `Purchase.id`는 `number` 타입
- `Number(purchase.id)`로 변환하지만, 메모리 캐시에서 찾을 때 문제가 있을 수 있음

### 문제 2: 필터 함수 메모이제이션
- `getFilteredPurchases`는 `useCallback`으로 메모이제이션됨
- 의존성: `[currentUser]`만 있음
- `purchases` 배열이 변경되어도 `getFilteredPurchases` 함수 자체는 재생성되지 않음
- 하지만 함수 내부에서 `purchaseMemoryCache.allPurchases`를 직접 참조하므로 문제 없어야 함

### 문제 3: 필터 결과 메모이제이션
- `baseFilteredPurchases`는 `useMemo`로 메모이제이션됨
- 의존성: `[getFilteredPurchases, activeTab, selectedEmployee, searchTerm, activeFilters, sortConfig]`
- `purchases`가 의존성에 없음!
- `purchases`가 변경되어도 `baseFilteredPurchases`가 재계산되지 않을 수 있음

### 문제 4: 필터 로직
- `pending` 탭에서 `middle_manager` 권한이 있는 경우:
  - `middle_manager_status === 'pending'`인 항목만 표시
  - 1차 승인 완료 후 `middle_manager_status`가 `'approved'`로 변경되면 필터에서 제외되어야 함
  - 하지만 `baseFilteredPurchases`가 재계산되지 않으면 여전히 표시됨

## 해결 방안

### 방안 1: `baseFilteredPurchases` 의존성에 `purchases` 추가
```typescript
const baseFilteredPurchases = useMemo(() => {
  // ... 필터 로직
}, [getFilteredPurchases, activeTab, selectedEmployee, searchTerm, activeFilters, sortConfig, purchases]);
```

### 방안 2: `getFilteredPurchases`가 `purchases`를 직접 받도록 수정
현재는 `purchaseMemoryCache.allPurchases`를 직접 참조하지만, `purchases` 파라미터를 받도록 수정

### 방안 3: `updatePurchaseInMemory` 후 강제 리렌더링
`purchaseMemoryCache.lastFetch`를 업데이트하지만, `usePurchaseMemory`의 폴링이 이를 감지하도록 보장

## 권장 해결책

**방안 1을 권장**: `baseFilteredPurchases`의 의존성 배열에 `purchases`를 추가하는 것이 가장 간단하고 확실한 해결책입니다.

