// ─── 발주/구매 노션식 필터 모델 (순수 함수만) ─────────────────────────────
// 제작현황(productionFilters)의 규칙 pill 골격을 발주 필드로 주입한 버전.
// UI 규칙(PurchaseFilterRule)은 기존 백엔드 어휘(AdvancedFilter{field,condition,value})로
// 변환되어 purchaseFilters.applyAdvancedFilters(품목 단위 확장 포함)를 그대로 재사용한다.

import type { Purchase } from '@/types/purchase'

export type PurchaseFieldType = 'text' | 'number' | 'select' | 'date'

// select 동적 옵션 키 — 화면(PurchaseListMain)이 로드한 목록을 툴바에 주입
export type PurchaseOptionsKey = 'employees' | 'vendors' | 'contacts' | 'paymentSchedules'

export interface PurchaseFilterFieldDef {
  key: string
  label: string
  type: PurchaseFieldType
  options?: string[]              // select 고정 옵션
  optionsKey?: PurchaseOptionsKey // select 동적 옵션
  includeEmptyOption?: boolean    // '공란' 옵션 추가 (지출예정일)
}

// 필터를 걸 수 있는 발주 필드 전체 — key는 purchaseFilters.getFieldValue와 호환
export const PURCHASE_FILTER_FIELDS: PurchaseFilterFieldDef[] = [
  // 날짜
  { key: 'request_date', label: '청구일', type: 'date' },
  { key: 'delivery_request_date', label: '입고요청일', type: 'date' },
  { key: 'payment_completed_at', label: '구매완료일', type: 'date' },
  { key: 'received_at', label: '입고완료일', type: 'date' },
  { key: 'created_at', label: '생성일', type: 'date' },
  { key: 'statement_received_at', label: '거래명세서입고일', type: 'date' },
  // 사용자/업체 (동적 select)
  { key: 'requester_name', label: '요청자', type: 'select', optionsKey: 'employees' },
  { key: 'vendor_name', label: '업체', type: 'select', optionsKey: 'vendors' },
  { key: 'contact_name', label: '담당자', type: 'select', optionsKey: 'contacts' },
  // 텍스트
  { key: 'purchase_order_number', label: '발주번호', type: 'text' },
  { key: 'item_name', label: '품명', type: 'text' },
  { key: 'specification', label: '규격', type: 'text' },
  { key: 'remark', label: '비고', type: 'text' },
  { key: 'project_vendor', label: 'PJ업체', type: 'text' },
  { key: 'project_item', label: 'PJ ITEM', type: 'text' },
  { key: 'sales_order_number', label: '수주번호', type: 'text' },
  // 숫자
  { key: 'quantity', label: '수량', type: 'number' },
  { key: 'unit_price_value', label: '단가', type: 'number' },
  { key: 'total_amount', label: '합계', type: 'number' },
  // 상태 (고정 select)
  { key: 'payment_category', label: '결제종류', type: 'select', options: ['현장결제', '구매 요청', '발주', '현금', '카드'] },
  { key: 'payment_schedule', label: '지출예정일', type: 'select', optionsKey: 'paymentSchedules', includeEmptyOption: true },
  { key: 'is_payment_completed', label: '구매현황', type: 'select', options: ['대기', '완료'] },
  { key: 'is_received', label: '입고현황', type: 'select', options: ['대기', '완료'] },
  { key: 'is_statement_received', label: '거래명세서 확인', type: 'select', options: ['대기', '완료'] },
  { key: 'is_utk_checked', label: 'UTK 확인', type: 'select', options: ['대기', '완료'] },
  { key: 'approval_status', label: '승인상태', type: 'select', options: ['승인대기', '1차승인', '최종승인', '반려'] },
]

export const purchaseFieldDefFor = (key: string): PurchaseFilterFieldDef | undefined =>
  PURCHASE_FILTER_FIELDS.find(f => f.key === key)

export const purchaseFieldLabel = (key: string): string =>
  purchaseFieldDefFor(key)?.label ?? key

// UI 조건(op) — month_in/date_range/after/before는 날짜 전용, 나머지는 기존 백엔드 condition과 동일 키
export type PurchaseFilterOp =
  | 'contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  | 'greater_than' | 'less_than'
  | 'is_empty' | 'is_not_empty'
  | 'month_in' | 'date_range' | 'after' | 'before'

export interface PurchaseFilterRule {
  id: string
  field: string
  op: PurchaseFilterOp
  value?: string   // 텍스트/숫자/셀렉트 값, after/before 날짜, date_range 시작일
  value2?: string  // date_range 종료일
  year?: number | null   // month_in 연도
  month?: number | null  // month_in 월 (null = 전체월 → 해당 연도 전체)
}

// 저장뷰/시작 기본값에 담기는 형태 (세션 전용 id 제외)
export type StoredPurchaseFilterRule = Omit<PurchaseFilterRule, 'id'>

let purchaseRuleSeq = 0
export const newPurchaseRuleId = () => `pr${++purchaseRuleSeq}_${Date.now()}`

const OP_LABELS: Record<PurchaseFilterOp, string> = {
  contains: '포함',
  equals: '같음',
  not_equals: '아님',
  starts_with: '시작함',
  ends_with: '끝남',
  greater_than: '이상',
  less_than: '이하',
  is_empty: '비어있음',
  is_not_empty: '비어있지 않음',
  month_in: '월별',
  date_range: '기간',
  after: '이후',
  before: '이전',
}

export const purchaseOpLabel = (op: PurchaseFilterOp): string => OP_LABELS[op]

// 필드 타입별 사용 가능한 조건 목록 (첫 항목이 기본값)
export const opsForPurchaseField = (key: string): PurchaseFilterOp[] => {
  const def = purchaseFieldDefFor(key)
  switch (def?.type) {
    case 'date':
      return ['month_in', 'date_range', 'after', 'before', 'is_empty', 'is_not_empty']
    case 'select':
      return ['equals', 'not_equals']
    case 'number':
      return ['equals', 'greater_than', 'less_than']
    case 'text':
    default:
      return ['contains', 'equals', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']
  }
}

// 필드에 맞는 새 규칙 초기값 (select는 첫 옵션, 날짜는 현재 연도 월별)
export const defaultRuleForField = (
  field: string,
  dynamicOptions?: Partial<Record<PurchaseOptionsKey, string[]>>
): Omit<PurchaseFilterRule, 'id'> => {
  const def = purchaseFieldDefFor(field)
  const op = opsForPurchaseField(field)[0]
  if (def?.type === 'date') {
    return { field, op, year: new Date().getFullYear(), month: null }
  }
  if (def?.type === 'select') {
    const opts = purchaseSelectOptions(def, dynamicOptions)
    return { field, op, value: opts[0] ?? '' }
  }
  return { field, op, value: '' }
}

// select 필드의 실제 옵션 목록 (고정 + 동적 + '공란')
export const purchaseSelectOptions = (
  def: PurchaseFilterFieldDef,
  dynamicOptions?: Partial<Record<PurchaseOptionsKey, string[]>>
): string[] => {
  const base = def.options ?? (def.optionsKey ? dynamicOptions?.[def.optionsKey] ?? [] : [])
  return def.includeEmptyOption ? ['공란', ...base] : base
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// 기존 백엔드가 이해하는 고급 필터 형태 (purchaseFilters.applyAdvancedFilters 입력)
export interface PurchaseAdvancedFilter {
  id: string
  field: string
  condition: string
  value: string
  label?: string
}

// UI 규칙 1건 → 백엔드 필터 (미완성 규칙은 null = 적용 안 함)
export const toAdvancedFilter = (rule: PurchaseFilterRule): PurchaseAdvancedFilter | null => {
  if (!rule.field) return null
  const label = purchaseFieldLabel(rule.field)
  const base = { id: rule.id, field: rule.field, label }

  switch (rule.op) {
    case 'is_empty':
    case 'is_not_empty':
      return { ...base, condition: rule.op, value: '' }
    case 'month_in': {
      if (rule.year == null) return null
      // 전체월 = 해당 연도 전체 (일 단위 범위로 변환해 월말 경계 문제 회피)
      const value = rule.month == null
        ? `${rule.year}-01-01~${rule.year}-12-31`
        : `${rule.year}-${pad2(rule.month)}`
      return { ...base, condition: 'equals', value }
    }
    case 'date_range': {
      if (!rule.value || !rule.value2) return null
      return { ...base, condition: 'equals', value: `${rule.value}~${rule.value2}` }
    }
    case 'after':
    case 'before': {
      if (!rule.value) return null
      return { ...base, condition: rule.op, value: rule.value }
    }
    default: {
      const v = (rule.value ?? '').trim()
      if (v === '') return null
      return { ...base, condition: rule.op, value: v }
    }
  }
}

export const toAdvancedFilters = (rules: PurchaseFilterRule[]): PurchaseAdvancedFilter[] =>
  rules.map(toAdvancedFilter).filter((f): f is PurchaseAdvancedFilter => f !== null)

// 날짜 필드 값 추출 (연도 목록 계산용) — statement_received_at만 품목에서 가져온다
const dateValueOf = (p: Purchase, field: string): string | null | undefined => {
  if (field === 'statement_received_at') {
    for (const item of p.purchase_request_items ?? []) {
      if (item.statement_received_date) return item.statement_received_date
    }
    return null
  }
  return (p as unknown as Record<string, string | null | undefined>)[field]
}

// 데이터에 존재하는 연도 목록 (내림차순) — month_in 연도 드롭다운용
export const purchaseYearsFor = (purchases: Purchase[], dateField: string): number[] => {
  const years = new Set<number>()
  for (const p of purchases) {
    const raw = dateValueOf(p, dateField)
    const m = typeof raw === 'string' ? raw.match(/^(\d{4})-/) : null
    if (m) years.add(Number(m[1]))
  }
  return [...years].sort((a, b) => b - a)
}
