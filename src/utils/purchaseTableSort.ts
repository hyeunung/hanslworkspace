// ─── 발주/구매 다중 정렬 (노션식: 칼럼 + 방향 규칙 목록, 우선순위 순) ──────────
// productionSort.ts 패턴을 발주 필드로 주입한 순수 함수 모음.
// 규칙은 화면 필터/서버검색 병합 이후의 표시 목록에 적용한다.

import type { Purchase } from '@/types/purchase'

export type PurchaseSortDir = 'asc' | 'desc'
export type PurchaseSortRule = { id: string; field: string; dir: PurchaseSortDir }

let purchaseSortSeq = 0
export const newPurchaseSortId = () => `ps${++purchaseSortSeq}`

// localStorage 정렬 저장 키 — 저장/복원이 항상 같은 키를 쓰도록 한곳에서 관리
export const PURCHASE_SORT_STORAGE_KEY = 'hansl_purchase_sort'

// 정렬 가능한 칼럼과 라벨
export const PURCHASE_SORT_FIELDS: { key: string; label: string }[] = [
  { key: 'request_date', label: '청구일' },
  { key: 'purchase_order_number', label: '발주번호' },
  { key: 'vendor_name', label: '업체' },
  { key: 'requester_name', label: '요청자' },
  { key: 'total_amount', label: '합계' },
  { key: 'delivery_request_date', label: '입고요청일' },
  { key: 'created_at', label: '생성일' },
]

export const purchaseSortLabel = (key: string): string =>
  PURCHASE_SORT_FIELDS.find(f => f.key === key)?.label ?? key

const NUMERIC_FIELDS = new Set(['total_amount'])
const DATE_FIELDS = new Set(['request_date', 'delivery_request_date', 'created_at'])

// 기본 정렬 = 생성일 내림차순 (기존 발주 목록 기본값과 동일)
export const defaultPurchaseSortRules = (): PurchaseSortRule[] => [
  { id: newPurchaseSortId(), field: 'created_at', dir: 'desc' },
]

// 정렬 비교 키 — 값 없음(null/빈문자)은 null 반환하여 방향과 무관하게 항상 뒤로(노션 동작)
const sortKeyFor = (p: Purchase, field: string): string | number | null => {
  const raw = (p as unknown as Record<string, unknown>)[field]
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (DATE_FIELDS.has(field)) {
    // ISO 선두 매칭 — 사전식 = 시간순 (타임스탬프 포함 값도 그대로 비교 가능)
    return typeof raw === 'string' ? raw : String(raw)
  }
  return typeof raw === 'string' ? raw : String(raw)
}

// 정렬 규칙 목록(우선순위 순)으로 두 행 비교. 빈 값은 항상 뒤, 동률이면 다음 규칙으로.
export const compareByPurchaseSortRules = (a: Purchase, b: Purchase, rules: PurchaseSortRule[]): number => {
  for (const r of rules) {
    const ka = sortKeyFor(a, r.field)
    const kb = sortKeyFor(b, r.field)
    if (ka == null && kb == null) continue
    if (ka == null) return 1
    if (kb == null) return -1
    let cmp: number
    if (typeof ka === 'number' && typeof kb === 'number') cmp = ka - kb
    else cmp = String(ka).localeCompare(String(kb), 'ko')
    if (cmp !== 0) return r.dir === 'asc' ? cmp : -cmp
  }
  return 0
}

// localStorage에서 저장된 정렬 규칙 복원 (유효한 칼럼/방향만, 없으면 기본 정렬)
export const loadPurchaseSortRules = (): PurchaseSortRule[] => {
  try {
    const saved = localStorage.getItem(PURCHASE_SORT_STORAGE_KEY)
    if (saved) {
      const valid = new Set(PURCHASE_SORT_FIELDS.map(f => f.key))
      const parsed = JSON.parse(saved) as PurchaseSortRule[]
      return parsed
        .filter(r => r && valid.has(r.field) && (r.dir === 'asc' || r.dir === 'desc'))
        .map(r => ({ id: newPurchaseSortId(), field: r.field, dir: r.dir }))
    }
  } catch { /* fall through */ }
  return defaultPurchaseSortRules()
}
