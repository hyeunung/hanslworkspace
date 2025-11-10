# 실시간 업데이트 문제 분석 보고서

## 문제 요구사항
**새로고침 없이 실시간으로 리스트가 업데이트되어야 함**

## 현재 문제점

### 1. 배열 참조 문제
`updatePurchaseInMemory` 함수에서:
```typescript
purchaseMemoryCache.allPurchases[index] = updated  // 배열 내부만 변경
purchaseMemoryCache.lastFetch = Date.now()  // 타임스탬프만 변경
```

**문제**: 배열 객체 자체는 변경되지 않고, 배열 내부의 요소만 변경됨
- `purchaseMemoryCache.allPurchases` 배열 참조는 동일함
- `usePurchaseMemory` 훅이 `[...purchaseMemoryCache.allPurchases]`로 복사하지만, 50ms 폴링 지연이 있음

### 2. 폴링 지연 문제
`usePurchaseMemory` 훅:
```typescript
const interval = setInterval(checkCache, 50)  // 50ms마다 체크
```

**문제**: 최대 50ms 지연이 발생
- 사용자가 즉시 변경을 보지 못함
- 실시간 느낌이 아님

### 3. 필터 재계산 문제
`baseFilteredPurchases`는 `useMemo`로 메모이제이션됨
- `purchases`가 의존성에 추가되었지만, `purchases` 배열 참조가 변경되지 않으면 재계산 안 됨

## 해결 방안

### 방안 1: 배열 참조 변경 (권장)
`updatePurchaseInMemory`에서 새 배열을 생성하여 참조를 변경:
```typescript
purchaseMemoryCache.allPurchases = [
  ...purchaseMemoryCache.allPurchases.slice(0, index),
  updated,
  ...purchaseMemoryCache.allPurchases.slice(index + 1)
]
```

**장점**: 
- 배열 참조가 변경되어 React가 즉시 감지
- 폴링 없이도 동작 가능

### 방안 2: 즉시 상태 업데이트 트리거
`updatePurchaseInMemory` 후 즉시 `usePurchaseMemory`의 상태를 업데이트
- 하지만 훅 외부에서 상태를 직접 업데이트할 수 없음
- 이벤트 시스템이나 콜백 필요

### 방안 3: lastFetch 기반 감지 개선
`usePurchaseMemory`에서 `lastFetch` 변경을 감지하여 즉시 업데이트
- 하지만 `lastFetch`는 `useEffect` 의존성이 아니므로 감지 안 됨

## 권장 해결책

**방안 1을 구현**: `updatePurchaseInMemory`에서 배열 참조를 변경하여 React가 즉시 변경을 감지하도록 함

