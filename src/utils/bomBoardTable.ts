// ─── 보드별 정리(BOM/좌표) 컴팩트 테이블 모델 (순수 함수만) ─────────────────
// 제작현황(productionFilters/Sort) → 발주(purchaseTable*) 패턴을 보드별 정리 칼럼으로 주입한 버전.
// 필터/정렬/검색 모두 클라이언트에서 rows에 직접 적용한다 (목록이 ~1천 건 규모라 서버 폴백 불필요).

export interface BomBoardRow {
  id: string
  board_name: string
  code_number: string
  sales_order_number: string // 제작번호 (resolveSalesOrderNumber 결과)
  artwork_manager: string
  production_manager: string
  status: 'pending' | 'completed'
  is_migration_unconfirmed: boolean
  status_label: '검토대기' | '이관확인전' | '완료'
  mismatch_count: number
  manual_count: number
  created_at: string
}

export const bomBoardStatusLabel = (b: { status?: string; is_migration_unconfirmed?: boolean }): BomBoardRow['status_label'] =>
  b.status === 'pending' ? '검토대기' : b.is_migration_unconfirmed ? '이관확인전' : '완료'

// ── 필터 필드 정의 ──────────────────────────────────────────────────────────
export type BomBoardFieldType = 'text' | 'select' | 'date'
// select 동적 옵션 키 — 화면이 rows에서 수집해 툴바에 주입 (담당자 목록)
export type BomBoardOptionsKey = 'artworkManagers' | 'productionManagers'

export interface BomBoardFilterFieldDef {
  key: string
  label: string
  type: BomBoardFieldType
  options?: string[]
  optionsKey?: BomBoardOptionsKey
}

export const BOM_BOARD_FILTER_FIELDS: BomBoardFilterFieldDef[] = [
  { key: 'created_at', label: '생성일', type: 'date' },
  { key: 'code_number', label: '코드번호', type: 'text' },
  { key: 'sales_order_number', label: '제작번호', type: 'text' },
  { key: 'board_name', label: '보드명', type: 'text' },
  { key: 'mismatch', label: '불일치', type: 'select', options: ['REF 불일치', '수동 확인', '없음'] },
  { key: 'artwork_manager', label: '아트웍 담당', type: 'select', optionsKey: 'artworkManagers' },
  { key: 'production_manager', label: '생산 담당', type: 'select', optionsKey: 'productionManagers' },
  { key: 'status_label', label: '상태', type: 'select', options: ['검토대기', '이관확인전', '완료'] },
]

export const bomBoardFieldDefFor = (key: string): BomBoardFilterFieldDef | undefined =>
  BOM_BOARD_FILTER_FIELDS.find(f => f.key === key)

export const bomBoardFieldLabel = (key: string): string =>
  bomBoardFieldDefFor(key)?.label ?? key

// ── 규칙 모델 (발주와 동일 어휘) ────────────────────────────────────────────
export type BomBoardFilterOp =
  | 'contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty'
  | 'month_in' | 'date_range' | 'after' | 'before'

export interface BomBoardFilterRule {
  id: string
  field: string
  op: BomBoardFilterOp
  value?: string
  value2?: string
  year?: number | null
  month?: number | null
}

export type StoredBomBoardFilterRule = Omit<BomBoardFilterRule, 'id'>

let bomBoardRuleSeq = 0
export const newBomBoardRuleId = () => `bb${++bomBoardRuleSeq}_${Date.now()}`

const OP_LABELS: Record<BomBoardFilterOp, string> = {
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

export const bomBoardOpLabel = (op: BomBoardFilterOp): string => OP_LABELS[op]

export const opsForBomBoardField = (key: string): BomBoardFilterOp[] => {
  const def = bomBoardFieldDefFor(key)
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

export const bomBoardSelectOptions = (
  def: BomBoardFilterFieldDef,
  dynamicOptions?: Partial<Record<BomBoardOptionsKey, string[]>>
): string[] => def.options ?? (def.optionsKey ? dynamicOptions?.[def.optionsKey] ?? [] : [])

export const defaultBomBoardRuleForField = (
  field: string,
  dynamicOptions?: Partial<Record<BomBoardOptionsKey, string[]>>
): Omit<BomBoardFilterRule, 'id'> => {
  const def = bomBoardFieldDefFor(field)
  const op = opsForBomBoardField(field)[0]
  if (def?.type === 'date') {
    return { field, op, year: new Date().getFullYear(), month: null }
  }
  if (def?.type === 'select') {
    const opts = bomBoardSelectOptions(def, dynamicOptions)
    return { field, op, value: opts[0] ?? '' }
  }
  return { field, op, value: '' }
}

// ── 필터 적용 ───────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')

const textValueOf = (row: BomBoardRow, field: string): string => {
  switch (field) {
    case 'code_number': return row.code_number
    case 'sales_order_number': return row.sales_order_number
    case 'board_name': return row.board_name
    case 'artwork_manager': return row.artwork_manager
    case 'production_manager': return row.production_manager
    case 'status_label': return row.status_label
    default: return ''
  }
}

// 불일치 select 값 매칭 (배지 표시 기준과 동일)
const matchMismatch = (row: BomBoardRow, value: string): boolean => {
  switch (value) {
    case 'REF 불일치': return row.mismatch_count > 0
    case '수동 확인': return row.manual_count > 0
    case '없음': return row.mismatch_count === 0 && row.manual_count === 0
    default: return true
  }
}

const matchDateRule = (row: BomBoardRow, rule: BomBoardFilterRule): boolean => {
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
const matchRule = (row: BomBoardRow, rule: BomBoardFilterRule): boolean => {
  if (!rule.field) return true
  const def = bomBoardFieldDefFor(rule.field)
  if (def?.type === 'date') return matchDateRule(row, rule)

  if (rule.field === 'mismatch') {
    if (!rule.value) return true
    const hit = matchMismatch(row, rule.value)
    return rule.op === 'not_equals' ? !hit : hit
  }

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

export const applyBomBoardFilters = (rows: BomBoardRow[], rules: BomBoardFilterRule[]): BomBoardRow[] =>
  rules.length === 0 ? rows : rows.filter(row => rules.every(rule => matchRule(row, rule)))

// 통합 검색 — 보드명/코드번호/제작번호/담당자
export const applyBomBoardSearch = (rows: BomBoardRow[], term: string): BomBoardRow[] => {
  const q = term.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r =>
    r.board_name.toLowerCase().includes(q) ||
    r.code_number.toLowerCase().includes(q) ||
    r.sales_order_number.toLowerCase().includes(q) ||
    r.artwork_manager.toLowerCase().includes(q) ||
    r.production_manager.toLowerCase().includes(q)
  )
}

// month_in 연도 드롭다운용 — 데이터에 존재하는 생성일 연도 목록 (내림차순)
export const bomBoardYearsFor = (rows: BomBoardRow[]): number[] => {
  const years = new Set<number>()
  for (const r of rows) {
    const m = (r.created_at || '').match(/^(\d{4})-/)
    if (m) years.add(Number(m[1]))
  }
  return [...years].sort((a, b) => b - a)
}

// ── 다중 정렬 (노션식) ──────────────────────────────────────────────────────
export type BomBoardSortDir = 'asc' | 'desc'
export type BomBoardSortRule = { id: string; field: string; dir: BomBoardSortDir }

let bomBoardSortSeq = 0
export const newBomBoardSortId = () => `bbs${++bomBoardSortSeq}`

export const BOM_BOARD_SORT_STORAGE_KEY = 'hansl_bom_board_sort'

export const BOM_BOARD_SORT_FIELDS: { key: string; label: string }[] = [
  { key: 'created_at', label: '생성일' },
  { key: 'code_number', label: '코드번호' },
  { key: 'sales_order_number', label: '제작번호' },
  { key: 'board_name', label: '보드명' },
  { key: 'artwork_manager', label: '아트웍 담당' },
  { key: 'production_manager', label: '생산 담당' },
  { key: 'status_label', label: '상태' },
]

export const bomBoardSortLabel = (key: string): string =>
  BOM_BOARD_SORT_FIELDS.find(f => f.key === key)?.label ?? key

// 기본 정렬 = 생성일 내림차순 (이관 보드는 정리본 원본 날짜로 백필되어 자연히 하단·연도순)
export const defaultBomBoardSortRules = (): BomBoardSortRule[] => [
  { id: newBomBoardSortId(), field: 'created_at', dir: 'desc' },
]

const sortKeyFor = (r: BomBoardRow, field: string): string | null => {
  const raw = field === 'created_at' ? r.created_at : textValueOf(r, field)
  if (raw == null || raw.trim() === '' || raw === '-') return null
  return raw
}

// 정렬 규칙 목록(우선순위 순) 비교 — 빈 값은 항상 뒤(노션 동작)
export const compareByBomBoardSortRules = (a: BomBoardRow, b: BomBoardRow, rules: BomBoardSortRule[]): number => {
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

export const loadBomBoardSortRules = (): BomBoardSortRule[] => {
  try {
    const saved = localStorage.getItem(BOM_BOARD_SORT_STORAGE_KEY)
    if (saved) {
      const valid = new Set(BOM_BOARD_SORT_FIELDS.map(f => f.key))
      const parsed = JSON.parse(saved) as BomBoardSortRule[]
      return parsed
        .filter(r => r && valid.has(r.field) && (r.dir === 'asc' || r.dir === 'desc'))
        .map(r => ({ id: newBomBoardSortId(), field: r.field, dir: r.dir }))
    }
  } catch { /* fall through */ }
  return defaultBomBoardSortRules()
}

// ── 칼럼 표시 설정 (localStorage) ──────────────────────────────────────────
export type BomBoardColumnId =
  | 'code_number' | 'sales_order_number' | 'board_name' | 'mismatch'
  | 'artwork_manager' | 'production_manager' | 'status' | 'created_at' | 'actions'

export const BOM_BOARD_COLUMN_LABELS: { id: BomBoardColumnId; label: string; required?: boolean }[] = [
  { id: 'status', label: '상태' },
  { id: 'code_number', label: '코드번호' },
  { id: 'sales_order_number', label: '제작번호' },
  { id: 'board_name', label: '보드명', required: true },
  { id: 'mismatch', label: '불일치' },
  { id: 'artwork_manager', label: '아트웍 담당' },
  { id: 'production_manager', label: '생산 담당' },
  { id: 'created_at', label: '생성일' },
  { id: 'actions', label: '액션' },
]

export const BOM_BOARD_COLUMNS_STORAGE_KEY = 'hansl_bom_board_columns'
