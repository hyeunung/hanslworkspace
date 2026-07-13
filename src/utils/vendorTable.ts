// ─── 업체관리 컴팩트 테이블 모델 (순수 함수만) ──────────────────────────────
// 제작현황(productionFilters/Sort) → 발주(purchaseTable*) → 보드별 정리(bomBoardTable)
// 패턴을 업체 칼럼으로 주입한 버전. 필터/정렬/검색 모두 클라이언트에서 rows에 직접 적용.

import type { Vendor, VendorContact } from '@/types/purchase'

export interface VendorRow {
  id: number
  vendor_name: string
  vendor_alias: string
  vendor_phone: string
  vendor_fax: string
  vendor_payment_schedule: string
  vendor_address: string
  note: string
  created_at: string
  contacts: VendorContact[]
  vendor: Vendor // 모달(상세/수정/담당자) 연동용 원본
}

export const vendorToRow = (v: Vendor): VendorRow => ({
  id: v.id,
  vendor_name: v.vendor_name || '',
  vendor_alias: v.vendor_alias || '',
  vendor_phone: v.vendor_phone || '',
  vendor_fax: v.vendor_fax || '',
  vendor_payment_schedule: v.vendor_payment_schedule || '',
  vendor_address: v.vendor_address || '',
  note: v.note || '',
  created_at: v.created_at || '',
  contacts: v.vendor_contacts || [],
  vendor: v,
})

// ── 필터 필드 정의 ──────────────────────────────────────────────────────────
export type VendorFieldType = 'text' | 'select' | 'date'
// select 동적 옵션 키 — 화면이 rows에서 수집해 툴바에 주입 (지출예정일 목록)
export type VendorOptionsKey = 'paymentSchedules'

export interface VendorFilterFieldDef {
  key: string
  label: string
  type: VendorFieldType
  options?: string[]
  optionsKey?: VendorOptionsKey
}

export const VENDOR_FILTER_FIELDS: VendorFilterFieldDef[] = [
  { key: 'created_at', label: '등록일', type: 'date' },
  { key: 'vendor_name', label: '업체명', type: 'text' },
  { key: 'contact', label: '담당자', type: 'text' },
  { key: 'vendor_phone', label: '전화번호', type: 'text' },
  { key: 'vendor_fax', label: '팩스번호', type: 'text' },
  { key: 'vendor_payment_schedule', label: '지출예정일', type: 'select', optionsKey: 'paymentSchedules' },
  { key: 'note', label: '비고', type: 'text' },
]

export const vendorFieldDefFor = (key: string): VendorFilterFieldDef | undefined =>
  VENDOR_FILTER_FIELDS.find(f => f.key === key)

export const vendorFieldLabel = (key: string): string =>
  vendorFieldDefFor(key)?.label ?? key

// ── 규칙 모델 (발주/보드별 정리와 동일 어휘) ────────────────────────────────
export type VendorFilterOp =
  | 'contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty'
  | 'month_in' | 'date_range' | 'after' | 'before'

export interface VendorFilterRule {
  id: string
  field: string
  op: VendorFilterOp
  value?: string
  value2?: string
  year?: number | null
  month?: number | null
}

export type StoredVendorFilterRule = Omit<VendorFilterRule, 'id'>

let vendorRuleSeq = 0
export const newVendorRuleId = () => `vd${++vendorRuleSeq}_${Date.now()}`

const OP_LABELS: Record<VendorFilterOp, string> = {
  contains: '포함',
  equals: '같음',
  not_equals: '아님',
  starts_with: '시작함',
  ends_with: '끝남',
  is_empty: '비어있음',
  is_not_empty: '비어있지 않음',
  month_in: '월별',
  date_range: '기간',
  after: '이후',
  before: '이전',
}

export const vendorOpLabel = (op: VendorFilterOp): string => OP_LABELS[op]

export const opsForVendorField = (key: string): VendorFilterOp[] => {
  const def = vendorFieldDefFor(key)
  switch (def?.type) {
    case 'date':
      return ['month_in', 'date_range', 'after', 'before']
    case 'select':
      return ['equals', 'not_equals']
    case 'text':
    default:
      return ['contains', 'equals', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']
  }
}

export const vendorSelectOptions = (
  def: VendorFilterFieldDef,
  dynamicOptions?: Partial<Record<VendorOptionsKey, string[]>>
): string[] => def.options ?? (def.optionsKey ? dynamicOptions?.[def.optionsKey] ?? [] : [])

export const defaultVendorRuleForField = (
  field: string,
  dynamicOptions?: Partial<Record<VendorOptionsKey, string[]>>
): Omit<VendorFilterRule, 'id'> => {
  const def = vendorFieldDefFor(field)
  const op = opsForVendorField(field)[0]
  if (def?.type === 'date') {
    return { field, op, year: new Date().getFullYear(), month: null }
  }
  if (def?.type === 'select') {
    const opts = vendorSelectOptions(def, dynamicOptions)
    return { field, op, value: opts[0] ?? '' }
  }
  return { field, op, value: '' }
}

// ── 필터 적용 ───────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')

// 담당자 필드는 이름/직급/전화/이메일을 하나의 문자열로 취급해 매칭
const contactsText = (row: VendorRow): string =>
  row.contacts
    .flatMap(c => [c.contact_name, c.position, c.contact_phone, c.contact_email])
    .filter(Boolean)
    .join(' ')

const textValueOf = (row: VendorRow, field: string): string => {
  switch (field) {
    case 'vendor_name': return row.vendor_name
    case 'contact': return contactsText(row)
    case 'vendor_phone': return row.vendor_phone
    case 'vendor_fax': return row.vendor_fax
    case 'vendor_payment_schedule': return row.vendor_payment_schedule
    case 'note': return row.note
    default: return ''
  }
}

const matchDateRule = (row: VendorRow, rule: VendorFilterRule): boolean => {
  const d = (row.created_at || '').slice(0, 10) // YYYY-MM-DD
  if (!d) return false
  switch (rule.op) {
    case 'month_in':
      if (rule.year == null) return true
      return rule.month == null
        ? d.startsWith(`${rule.year}-`)
        : d.startsWith(`${rule.year}-${pad2(rule.month)}`)
    case 'date_range':
      if (!rule.value || !rule.value2) return true
      return d >= rule.value && d <= rule.value2
    case 'after':
      return !rule.value || d >= rule.value
    case 'before':
      return !rule.value || d <= rule.value
    default:
      return true
  }
}

// 규칙 1건 매칭 (미완성 규칙은 통과 = 적용 안 함)
const matchRule = (row: VendorRow, rule: VendorFilterRule): boolean => {
  if (!rule.field) return true
  const def = vendorFieldDefFor(rule.field)
  if (def?.type === 'date') return matchDateRule(row, rule)

  const raw = textValueOf(row, rule.field)
  if (rule.op === 'is_empty') return raw.trim() === '' || raw === '-'
  if (rule.op === 'is_not_empty') return raw.trim() !== '' && raw !== '-'

  const v = (rule.value ?? '').trim()
  if (v === '') return true
  const a = raw.toLowerCase()
  const b = v.toLowerCase()
  switch (rule.op) {
    case 'contains': return a.includes(b)
    case 'equals': return a === b
    case 'not_equals': return a !== b
    case 'starts_with': return a.startsWith(b)
    case 'ends_with': return a.endsWith(b)
    default: return true
  }
}

export const applyVendorFilters = (rows: VendorRow[], rules: VendorFilterRule[]): VendorRow[] =>
  rules.length === 0 ? rows : rows.filter(row => rules.every(rule => matchRule(row, rule)))

// 통합 검색 — 업체 필드 전체 + 담당자 정보 (기존 업체관리 검색 범위와 동일)
export const applyVendorSearch = (rows: VendorRow[], term: string): VendorRow[] => {
  const q = term.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r =>
    r.vendor_name.toLowerCase().includes(q) ||
    r.vendor_alias.toLowerCase().includes(q) ||
    r.vendor_phone.toLowerCase().includes(q) ||
    r.vendor_fax.toLowerCase().includes(q) ||
    r.vendor_address.toLowerCase().includes(q) ||
    r.vendor_payment_schedule.toLowerCase().includes(q) ||
    r.note.toLowerCase().includes(q) ||
    contactsText(r).toLowerCase().includes(q)
  )
}

// month_in 연도 드롭다운용 — 데이터에 존재하는 등록일 연도 목록 (내림차순)
export const vendorYearsFor = (rows: VendorRow[]): number[] => {
  const years = new Set<number>()
  for (const r of rows) {
    const m = (r.created_at || '').match(/^(\d{4})-/)
    if (m) years.add(Number(m[1]))
  }
  return [...years].sort((a, b) => b - a)
}

// ── 다중 정렬 (노션식) ──────────────────────────────────────────────────────
export type VendorSortDir = 'asc' | 'desc'
export type VendorSortRule = { id: string; field: string; dir: VendorSortDir }

let vendorSortSeq = 0
export const newVendorSortId = () => `vds${++vendorSortSeq}`

export const VENDOR_SORT_STORAGE_KEY = 'hansl_vendor_sort'

export const VENDOR_SORT_FIELDS: { key: string; label: string }[] = [
  { key: 'vendor_name', label: '업체명' },
  { key: 'vendor_phone', label: '전화번호' },
  { key: 'vendor_fax', label: '팩스번호' },
  { key: 'vendor_payment_schedule', label: '지출예정일' },
  { key: 'note', label: '비고' },
  { key: 'created_at', label: '등록일' },
]

export const vendorSortLabel = (key: string): string =>
  VENDOR_SORT_FIELDS.find(f => f.key === key)?.label ?? key

// 기본 정렬 = 업체명 오름차순 (기존 업체관리 기본값과 동일)
export const defaultVendorSortRules = (): VendorSortRule[] => [
  { id: newVendorSortId(), field: 'vendor_name', dir: 'asc' },
]

const sortKeyFor = (r: VendorRow, field: string): string | null => {
  const raw = field === 'created_at' ? r.created_at : textValueOf(r, field)
  if (raw == null || raw.trim() === '' || raw === '-') return null
  return raw
}

// 정렬 규칙 목록(우선순위 순) 비교 — 빈 값은 항상 뒤(노션 동작)
export const compareByVendorSortRules = (a: VendorRow, b: VendorRow, rules: VendorSortRule[]): number => {
  for (const r of rules) {
    const ka = sortKeyFor(a, r.field)
    const kb = sortKeyFor(b, r.field)
    if (ka == null && kb == null) continue
    if (ka == null) return 1
    if (kb == null) return -1
    const cmp = ka.localeCompare(kb, 'ko')
    if (cmp !== 0) return r.dir === 'asc' ? cmp : -cmp
  }
  return 0
}

export const loadVendorSortRules = (): VendorSortRule[] => {
  try {
    const saved = localStorage.getItem(VENDOR_SORT_STORAGE_KEY)
    if (saved) {
      const valid = new Set(VENDOR_SORT_FIELDS.map(f => f.key))
      const parsed = JSON.parse(saved) as VendorSortRule[]
      return parsed
        .filter(r => r && valid.has(r.field) && (r.dir === 'asc' || r.dir === 'desc'))
        .map(r => ({ id: newVendorSortId(), field: r.field, dir: r.dir }))
    }
  } catch { /* fall through */ }
  return defaultVendorSortRules()
}

// ── 칼럼 표시 설정 (localStorage) ──────────────────────────────────────────
export type VendorColumnId =
  | 'vendor_name' | 'contact_count' | 'contacts' | 'vendor_phone' | 'vendor_fax'
  | 'vendor_payment_schedule' | 'note' | 'created_at' | 'actions'

export const VENDOR_COLUMN_LABELS: { id: VendorColumnId; label: string; required?: boolean }[] = [
  { id: 'vendor_name', label: '업체명', required: true },
  { id: 'contact_count', label: '담당자' },
  { id: 'contacts', label: '담당자 정보' },
  { id: 'vendor_phone', label: '전화번호' },
  { id: 'vendor_fax', label: '팩스번호' },
  { id: 'vendor_payment_schedule', label: '지출예정일' },
  { id: 'note', label: '비고' },
  { id: 'created_at', label: '등록일' },
  { id: 'actions', label: '작업' },
]

export const VENDOR_COLUMNS_STORAGE_KEY = 'hansl_vendor_columns'
