// ─── 영수증 컴팩트 테이블 모델 (순수 함수만) ────────────────────────────────
// 제작현황(productionFilters/Sort) → 발주(purchaseTable*) → 보드별 정리(bomBoardTable) 패턴을
// 영수증 칼럼으로 주입한 버전. 그룹(여러 장 묶음)은 영수증 1장 = 1행으로 전개해
// 고정 행높이 가상화에 맞추고, 인쇄/삭제/상세보기는 그룹 단위 동작을 유지한다.

import type { ReceiptItem, ReceiptGroup } from '@/types/receipt'
import { formatDateISO } from '@/utils/helpers'

export interface ReceiptRow {
  id: string
  receipt: ReceiptItem
  group: ReceiptGroup
  group_count: number
  printed: boolean // 그룹 전체 인쇄완료 여부
  uploaded_date: string // YYYY-MM-DD (KST)
  payment_date: string // YYYY-MM-DD ('' = OCR 없음)
  merchant: string
  item_name: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  memo: string
  file_name: string
  uploader: string
}

// 기존 ReceiptsMain의 그룹 빌더를 그대로 이동 — group_id 묶음 + 단건, 최신 업로드순
export const buildReceiptGroups = (receipts: ReceiptItem[]): ReceiptGroup[] => {
  const groupMap = new Map<string, ReceiptItem[]>()
  const singles: ReceiptItem[] = []

  for (const r of receipts) {
    if (r.group_id) {
      const list = groupMap.get(r.group_id) || []
      list.push(r)
      groupMap.set(r.group_id, list)
    } else {
      singles.push(r)
    }
  }

  const groups: ReceiptGroup[] = []
  for (const [gid, items] of groupMap) {
    items.sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime())
    groups.push({ group_id: gid, receipts: items, primary: items[0], count: items.length })
  }
  for (const s of singles) {
    groups.push({ group_id: null, receipts: [s], primary: s, count: 1 })
  }

  groups.sort((a, b) => new Date(b.primary.uploaded_at).getTime() - new Date(a.primary.uploaded_at).getTime())
  return groups
}

const paymentDateOf = (r: ReceiptItem): string => {
  const d = (r.ocr_payment_date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

export const buildReceiptRows = (groups: ReceiptGroup[]): ReceiptRow[] => {
  const rows: ReceiptRow[] = []
  for (const g of groups) {
    const printed = g.receipts.every(item => !!item.is_printed)
    for (const r of g.receipts) {
      rows.push({
        id: String(r.id),
        receipt: r,
        group: g,
        group_count: g.count,
        printed,
        uploaded_date: formatDateISO(r.uploaded_at),
        payment_date: paymentDateOf(r),
        merchant: r.ocr_merchant_name || '',
        item_name: r.ocr_item_name || '',
        quantity: r.ocr_quantity ?? null,
        unit_price: r.ocr_unit_price ?? null,
        total_amount: r.ocr_total_amount ?? null,
        memo: r.memo || '',
        file_name: r.file_name || '',
        uploader: r.uploaded_by_name || r.uploaded_by || '',
      })
    }
  }
  return rows
}

// 표시 포맷 — 기존 화면과 동일 ('YY.MM.DD, ₩천단위)
export const formatReceiptDate = (isoDate: string): string =>
  isoDate ? isoDate.slice(2).replace(/-/g, '.') : '-'

export const formatKrw = (value?: number | null): string => {
  if (value == null || !Number.isFinite(value)) return '-'
  return `₩${Math.round(value).toLocaleString('ko-KR')}`
}

// ── 필터 필드 정의 ──────────────────────────────────────────────────────────
export type ReceiptFieldType = 'text' | 'select' | 'date'
// select 동적 옵션 키 — 화면이 rows에서 수집해 툴바에 주입 (등록인 목록)
export type ReceiptOptionsKey = 'uploaders'

export interface ReceiptFilterFieldDef {
  key: string
  label: string
  type: ReceiptFieldType
  options?: string[]
  optionsKey?: ReceiptOptionsKey
}

export const RECEIPT_FILTER_FIELDS: ReceiptFilterFieldDef[] = [
  { key: 'uploaded_date', label: '업로드일', type: 'date' },
  { key: 'payment_date', label: '결제일', type: 'date' },
  { key: 'merchant', label: '거래처', type: 'text' },
  { key: 'item_name', label: '품명', type: 'text' },
  { key: 'memo', label: '메모', type: 'text' },
  { key: 'file_name', label: '파일명', type: 'text' },
  { key: 'printed', label: '인쇄완료', type: 'select', options: ['완료', '미완료'] },
  { key: 'uploader', label: '등록인', type: 'select', optionsKey: 'uploaders' },
]

export const receiptFieldDefFor = (key: string): ReceiptFilterFieldDef | undefined =>
  RECEIPT_FILTER_FIELDS.find(f => f.key === key)

export const receiptFieldLabel = (key: string): string =>
  receiptFieldDefFor(key)?.label ?? key

// ── 규칙 모델 (발주/보드별 정리와 동일 어휘) ────────────────────────────────
export type ReceiptFilterOp =
  | 'contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty'
  | 'month_in' | 'date_range' | 'after' | 'before'

export interface ReceiptFilterRule {
  id: string
  field: string
  op: ReceiptFilterOp
  value?: string
  value2?: string
  year?: number | null
  month?: number | null
}

export type StoredReceiptFilterRule = Omit<ReceiptFilterRule, 'id'>

let receiptRuleSeq = 0
export const newReceiptRuleId = () => `rc${++receiptRuleSeq}_${Date.now()}`

const OP_LABELS: Record<ReceiptFilterOp, string> = {
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

export const receiptOpLabel = (op: ReceiptFilterOp): string => OP_LABELS[op]

export const opsForReceiptField = (key: string): ReceiptFilterOp[] => {
  const def = receiptFieldDefFor(key)
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

export const receiptSelectOptions = (
  def: ReceiptFilterFieldDef,
  dynamicOptions?: Partial<Record<ReceiptOptionsKey, string[]>>
): string[] => def.options ?? (def.optionsKey ? dynamicOptions?.[def.optionsKey] ?? [] : [])

export const defaultReceiptRuleForField = (
  field: string,
  dynamicOptions?: Partial<Record<ReceiptOptionsKey, string[]>>
): Omit<ReceiptFilterRule, 'id'> => {
  const def = receiptFieldDefFor(field)
  const op = opsForReceiptField(field)[0]
  if (def?.type === 'date') {
    return { field, op, year: new Date().getFullYear(), month: null }
  }
  if (def?.type === 'select') {
    const opts = receiptSelectOptions(def, dynamicOptions)
    return { field, op, value: opts[0] ?? '' }
  }
  return { field, op, value: '' }
}

// ── 필터 적용 ───────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')

const textValueOf = (row: ReceiptRow, field: string): string => {
  switch (field) {
    case 'merchant': return row.merchant
    case 'item_name': return row.item_name
    case 'memo': return row.memo
    case 'file_name': return row.file_name
    case 'uploader': return row.uploader
    case 'printed': return row.printed ? '완료' : '미완료'
    default: return ''
  }
}

const dateValueOf = (row: ReceiptRow, field: string): string =>
  field === 'payment_date' ? row.payment_date : row.uploaded_date

const matchDateRule = (row: ReceiptRow, rule: ReceiptFilterRule): boolean => {
  const d = dateValueOf(row, rule.field)
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
const matchRule = (row: ReceiptRow, rule: ReceiptFilterRule): boolean => {
  if (!rule.field) return true
  const def = receiptFieldDefFor(rule.field)
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

export const applyReceiptFilters = (rows: ReceiptRow[], rules: ReceiptFilterRule[]): ReceiptRow[] =>
  rules.length === 0 ? rows : rows.filter(row => rules.every(rule => matchRule(row, rule)))

// 통합 검색 — 파일명/메모/거래처/품명/결제일/업로드일/등록인
export const applyReceiptSearch = (rows: ReceiptRow[], term: string): ReceiptRow[] => {
  const q = term.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r =>
    r.file_name.toLowerCase().includes(q) ||
    r.memo.toLowerCase().includes(q) ||
    r.merchant.toLowerCase().includes(q) ||
    r.item_name.toLowerCase().includes(q) ||
    r.payment_date.includes(q) ||
    r.uploaded_date.includes(q) ||
    r.uploader.toLowerCase().includes(q)
  )
}

// month_in 연도 드롭다운용 — 데이터에 존재하는 업로드일/결제일 연도 목록 (내림차순)
export const receiptYearsFor = (rows: ReceiptRow[]): number[] => {
  const years = new Set<number>()
  for (const r of rows) {
    for (const d of [r.uploaded_date, r.payment_date]) {
      const m = d.match(/^(\d{4})-/)
      if (m) years.add(Number(m[1]))
    }
  }
  return [...years].sort((a, b) => b - a)
}

// ── 다중 정렬 (노션식) ──────────────────────────────────────────────────────
export type ReceiptSortDir = 'asc' | 'desc'
export type ReceiptSortRule = { id: string; field: string; dir: ReceiptSortDir }

let receiptSortSeq = 0
export const newReceiptSortId = () => `rcs${++receiptSortSeq}`

export const RECEIPT_SORT_STORAGE_KEY = 'hansl_receipt_sort'

export const RECEIPT_SORT_FIELDS: { key: string; label: string }[] = [
  { key: 'uploaded_date', label: '업로드일' },
  { key: 'payment_date', label: '결제일' },
  { key: 'merchant', label: '거래처' },
  { key: 'item_name', label: '품명' },
  { key: 'quantity', label: '수량' },
  { key: 'unit_price', label: '단가' },
  { key: 'total_amount', label: '합계' },
  { key: 'printed', label: '인쇄완료' },
  { key: 'uploader', label: '등록인' },
]

export const receiptSortLabel = (key: string): string =>
  RECEIPT_SORT_FIELDS.find(f => f.key === key)?.label ?? key

// 기본 정렬 = 업로드일 내림차순 (기존 화면과 동일: 최신 업로드가 위)
export const defaultReceiptSortRules = (): ReceiptSortRule[] => [
  { id: newReceiptSortId(), field: 'uploaded_date', dir: 'desc' },
]

const NUMERIC_SORT_FIELDS = new Set(['quantity', 'unit_price', 'total_amount'])

const numericKeyFor = (r: ReceiptRow, field: string): number | null => {
  switch (field) {
    case 'quantity': return r.quantity
    case 'unit_price': return r.unit_price
    case 'total_amount': return r.total_amount
    default: return null
  }
}

const sortKeyFor = (r: ReceiptRow, field: string): string | null => {
  const raw =
    field === 'uploaded_date' ? r.uploaded_date :
    field === 'payment_date' ? r.payment_date :
    textValueOf(r, field)
  if (raw == null || raw.trim() === '' || raw === '-') return null
  return raw
}

// 정렬 규칙 목록(우선순위 순) 비교 — 빈 값은 항상 뒤(노션 동작), 금액/수량은 숫자 비교
export const compareByReceiptSortRules = (a: ReceiptRow, b: ReceiptRow, rules: ReceiptSortRule[]): number => {
  for (const r of rules) {
    if (NUMERIC_SORT_FIELDS.has(r.field)) {
      const na = numericKeyFor(a, r.field)
      const nb = numericKeyFor(b, r.field)
      if (na == null && nb == null) continue
      if (na == null) return 1
      if (nb == null) return -1
      if (na !== nb) return r.dir === 'asc' ? na - nb : nb - na
      continue
    }
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

export const loadReceiptSortRules = (): ReceiptSortRule[] => {
  try {
    const saved = localStorage.getItem(RECEIPT_SORT_STORAGE_KEY)
    if (saved) {
      const valid = new Set(RECEIPT_SORT_FIELDS.map(f => f.key))
      const parsed = JSON.parse(saved) as ReceiptSortRule[]
      return parsed
        .filter(r => r && valid.has(r.field) && (r.dir === 'asc' || r.dir === 'desc'))
        .map(r => ({ id: newReceiptSortId(), field: r.field, dir: r.dir }))
    }
  } catch { /* fall through */ }
  return defaultReceiptSortRules()
}

// ── 칼럼 표시 설정 (localStorage) ──────────────────────────────────────────
export type ReceiptColumnId =
  | 'printed' | 'uploaded_date' | 'payment_date' | 'merchant' | 'item_name'
  | 'quantity' | 'unit_price' | 'total_amount' | 'memo' | 'uploader' | 'actions'

export const RECEIPT_COLUMN_LABELS: { id: ReceiptColumnId; label: string; required?: boolean }[] = [
  { id: 'printed', label: '인쇄완료' },
  { id: 'uploaded_date', label: '업로드일' },
  { id: 'payment_date', label: '결제일' },
  { id: 'merchant', label: '거래처', required: true },
  { id: 'item_name', label: '품명' },
  { id: 'quantity', label: '수량' },
  { id: 'unit_price', label: '단가' },
  { id: 'total_amount', label: '합계' },
  { id: 'memo', label: '메모' },
  { id: 'uploader', label: '등록인' },
  { id: 'actions', label: '액션' },
]

export const RECEIPT_COLUMNS_STORAGE_KEY = 'hansl_receipt_columns'
