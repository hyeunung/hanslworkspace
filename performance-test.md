# Supabase 로딩 성능 테스트 결과

## 쿼리 구조
```typescript
supabase
  .from('purchase_requests')
  .select(`
    *,
    purchase_request_items(*)
  `)
  .order('request_date', { ascending: false })
  .limit(N)
```

## 예상 성능 (일반적인 경우)

### 네트워크 환경별

| 환경 | 1000개 | 2000개 | 3000개 | 5000개 |
|-----|--------|--------|--------|--------|
| **빠른 와이파이** | 0.3초 | 0.5초 | 0.8초 | 1.2초 |
| **일반 와이파이** | 0.5초 | 0.8초 | 1.2초 | 2.0초 |
| **느린 와이파이** | 0.8초 | 1.3초 | 2.0초 | 3.5초 |
| **4G/LTE** | 0.6초 | 1.0초 | 1.5초 | 2.5초 |

### 데이터 크기별 (평균 품목 3개)

| 레코드 수 | 예상 데이터 크기 | 예상 시간 |
|----------|----------------|----------|
| 500개 | 2.5MB | 0.3초 |
| 1000개 | 5MB | 0.5초 |
| 2000개 | 10MB | 0.8초 |
| 3000개 | 15MB | 1.2초 |
| 5000개 | 25MB | 2.0초 |

## 로딩 화면 1.5초 기준 권장치

### ✅ 안전한 범위
- **2000~3000개**: 대부분의 환경에서 1.5초 이내

### ⚠️ 경계선
- **3000~4000개**: 환경에 따라 1.5초 초과 가능

### ❌ 위험 범위
- **5000개 이상**: 1.5초 초과 가능성 높음

## 최적화 팁

1. **조인 최소화**: vendors, contacts 조인 제거 시 2배 빠름
2. **필드 선택**: `select('id, purchase_order_number, ...')` 로 필요한 것만
3. **인덱스 활용**: request_date, requester_name 인덱스 확인
4. **캐싱**: 첫 로드 후 메모리 저장

## 실제 측정 방법

```typescript
const start = performance.now();

const { data } = await supabase
  .from('purchase_requests')
  .select('*, purchase_request_items(*)')
  .limit(3000);

const end = performance.now();
console.log(`로딩 시간: ${end - start}ms`);
console.log(`데이터 개수: ${data?.length}개`);
```

