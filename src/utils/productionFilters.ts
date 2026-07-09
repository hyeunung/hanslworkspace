// ─── 테이블별 필터 (PCB/Cable 각각 독립, 노션식 규칙 기반) ─────────────
// 위(PCB) 테이블과 아래(Cable) 테이블은 제작구분·칼럼이 서로 달라 필터를 분리한다.
// 필터 = 규칙(칼럼 + 조건 + 값) 목록의 AND 결합. 노션처럼 규칙을 추가/수정/제거할 수 있고,
// 기본 필터(입고대기 + 요청일 현재년도)도 일반 규칙이라 X로 제거 가능하다.
// ProductionListMain.tsx에서 분리한 순수 함수 모음 — 동작 동일
import { StoredFilterRule } from '@/hooks/useProductionFilterViews'
import {
  ARTWORK_FIELD,
  PARTS_FIELD,
  STATUS_FIELDS,
  parseArtworkStatus,
  artworkStatusMatches,
  parsePartsStatus,
  partsStatusMatches,
} from '@/utils/productionStatus'

// 제작구분 칩의 기본 표시/그룹 순서 — 드래그로 재정렬 가능. 이 순서대로 테이블이 제작구분별로 위→아래 그룹핑됨
export const DEFAULT_CATEGORY_ORDER = ['LG_PCB', 'LG_Socket Board', 'LG_Cable', 'LG_Case', 'PCB', 'Cable', 'Case']

export const PCB_CATEGORIES = ['LG_PCB', 'LG_Socket Board', 'PCB']
export const CABLE_CATEGORIES = ['LG_Cable', 'LG_Case', 'Cable', 'Case']

// localStorage 필터 저장 키 — 저장/복원이 항상 같은 키를 쓰도록 한곳에서 관리
export const filterStorageKey = (type: 'pcb' | 'cable') => `hansl_prod_filter_${type}`
export const CATEGORY_ORDER_STORAGE_KEY = 'hansl_prod_filter_category_order'

// 순수 날짜 칼럼(YYYY-MM-DD)과 날짜/메모 혼합 칼럼 — 조건(op) 선택지가 달라진다
export const DATE_ONLY_FIELDS = ['request_date', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date']
export const HYBRID_DATE_FIELDS = ['delivery_deadline', 'assy_hanwha', 'assy_evertech', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed']

// 필터 규칙 하나: field 칼럼에 op 조건 적용. contains류는 value, date_in은 year/month 사용.
export type FilterOp = 'date_in' | 'contains' | 'not_contains' | 'is_empty' | 'not_empty' | 'status_is'
export type FilterRule = {
  id: string
  field: string
  op: FilterOp
  value?: string
  year?: number | null
  month?: number | null
}

export type TableFilter = {
  categories: string[]
  rules: FilterRule[]
}

export const OP_LABELS: Record<FilterOp, string> = {
  date_in: '날짜',
  contains: '포함',
  not_contains: '미포함',
  is_empty: '비어있음',
  not_empty: '비어있지 않음',
  status_is: '상태',
}

// 입고/배송 칼럼(완제품입고/실제입고일/입고완료/배송완료)은 도메인 용어로 표기: 비어있음=대기, 비어있지 않음=완료
// 배송완료는 '배송대기/배송완료'로 구분 표기하고 나머지는 '입고대기/입고됨'을 쓴다
export const STOCK_DATE_LABELS: Record<string, [string, string]> = {
  final_product_stock: ['입고대기', '입고됨'],
  cable_actual_date: ['입고대기', '입고됨'],
  pcb_stock_completed: ['입고대기', '입고됨'],
  delivery_completed: ['배송대기', '배송완료'],
}
export const STOCK_DATE_FIELDS = Object.keys(STOCK_DATE_LABELS)

export const opLabelFor = (field: string, op: FilterOp): string => {
  if (STOCK_DATE_FIELDS.includes(field)) {
    const [waiting, done] = STOCK_DATE_LABELS[field]
    if (op === 'is_empty') return waiting
    if (op === 'not_empty') return done
  }
  if (STATUS_FIELDS.includes(field)) {
    if (op === 'status_is') return '상태'
    if (op === 'contains') return '메모 포함'
    if (op === 'not_contains') return '메모 미포함'
  }
  return OP_LABELS[op]
}

// 칼럼 타입에 따라 선택 가능한 조건 목록
export const opsForField = (field: string): FilterOp[] => {
  if (STATUS_FIELDS.includes(field)) return ['status_is', 'contains', 'not_contains', 'is_empty', 'not_empty']
  // 입고 칼럼(완제품입고 등)은 날짜/입고대기/입고됨만 — 포함·미포함은 날짜 데이터에 의미 중복
  if (STOCK_DATE_FIELDS.includes(field)) return ['date_in', 'is_empty', 'not_empty']
  if (DATE_ONLY_FIELDS.includes(field)) return ['date_in', 'is_empty', 'not_empty']
  if (HYBRID_DATE_FIELDS.includes(field)) return ['date_in', 'contains', 'not_contains', 'is_empty', 'not_empty']
  return ['contains', 'not_contains', 'is_empty', 'not_empty']
}

let filterRuleSeq = 0
export const newRuleId = () => `r${++filterRuleSeq}`

// 저장 필터 ↔ 화면 규칙 변환 — 저장에는 세션 전용 id를 빼고, 복원 시 새 id를 발급한다.
export const toStoredRules = (rules: FilterRule[]): StoredFilterRule[] =>
  rules.map(({ field, op, value, year, month }) => ({ field, op, value, year: year ?? null, month: month ?? null }))
export const fromStoredRules = (rules: StoredFilterRule[]): FilterRule[] =>
  (rules || [])
    .filter(r => r && typeof r.field === 'string' && typeof r.op === 'string' && opsForField(r.field).includes(r.op as FilterOp))
    .map(r => ({
      id: newRuleId(),
      field: r.field,
      op: r.op as FilterOp,
      value: typeof r.value === 'string' ? r.value : undefined,
      year: typeof r.year === 'number' ? r.year : null,
      month: typeof r.month === 'number' ? r.month : null,
    }))

// 기본 필터 규칙: 입고대기(입고 칼럼 비어있음) + 요청일이 현재 년도(월 전체)
export const defaultRules = (type: 'pcb' | 'cable'): FilterRule[] => [
  { id: newRuleId(), field: type === 'pcb' ? 'final_product_stock' : 'cable_actual_date', op: 'is_empty' },
  { id: newRuleId(), field: 'request_date', op: 'date_in', year: new Date().getFullYear(), month: null },
]

export const defaultTableFilter = (type: 'pcb' | 'cable'): TableFilter => ({
  categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES],
  rules: defaultRules(type),
})

// ─── 저장 아이콘(파랑) 판정: "기본값에서 바꿔서 저장해둔 상태"인지 ──────────
// 규칙 비교는 id 제외(id는 세션마다 새로 발급됨). 저장 원본(raw JSON)과 상태 양쪽 모두 처리.
export const normalizeRulesForCompare = (rules: any[]): string =>
  JSON.stringify((rules || []).map(r => ({
    f: r.field, o: r.op,
    v: typeof r.value === 'string' ? r.value : null,
    y: typeof r.year === 'number' ? r.year : null,
    m: typeof r.month === 'number' ? r.month : null,
  })))
export const rulesEqualDefault = (type: 'pcb' | 'cable', rules: any[]): boolean =>
  normalizeRulesForCompare(rules) === normalizeRulesForCompare(defaultRules(type))
export const catsEqualDefault = (type: 'pcb' | 'cable', cats: string[]): boolean => {
  const def = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
  return Array.isArray(cats) && cats.length === def.length && def.every(c => cats.includes(c))
}
export const categoryOrderIsDefault = (order: string[]): boolean =>
  JSON.stringify(order) === JSON.stringify(DEFAULT_CATEGORY_ORDER)

// 규칙 하나를 행에 적용 (AND 결합은 호출부에서). 값이 없는 셀은 date_in/contains에서 제외된다.
export const applyFilterRule = (item: any, rule: FilterRule): boolean => {
  // 칼럼 미선택('칼럼 선택' 상태) 규칙은 아직 필터로 동작하지 않음 (통과)
  if (!rule.field) return true
  const raw = item[rule.field]
  const s = raw == null ? '' : String(raw).trim()
  const empty = s === '' || s === '-'
  // ARTWORK: 상태(status_is)는 파싱한 상태 + 엑셀 이관 텍스트 키워드로, 포함/미포함은 메모 부분만 검색
  if (rule.field === ARTWORK_FIELD) {
    const aw = parseArtworkStatus(s)
    if (rule.op === 'status_is') return artworkStatusMatches(aw, rule.value)
    if (rule.op === 'contains') return !rule.value || aw.memo.toLowerCase().includes(rule.value.toLowerCase())
    if (rule.op === 'not_contains') return !rule.value || !aw.memo.toLowerCase().includes(rule.value.toLowerCase())
    if (rule.op === 'is_empty') return empty
    if (rule.op === 'not_empty') return !empty
  }
  // 부품정리: ARTWORK와 같은 하이브리드(status|||memo) 구조 — 동일하게 처리
  if (rule.field === PARTS_FIELD) {
    const p = parsePartsStatus(s)
    if (rule.op === 'status_is') return partsStatusMatches(p, rule.value)
    if (rule.op === 'contains') return !rule.value || p.memo.toLowerCase().includes(rule.value.toLowerCase())
    if (rule.op === 'not_contains') return !rule.value || !p.memo.toLowerCase().includes(rule.value.toLowerCase())
    if (rule.op === 'is_empty') return empty
    if (rule.op === 'not_empty') return !empty
  }
  switch (rule.op) {
    case 'status_is': return true
    case 'is_empty': return empty
    case 'not_empty': return !empty
    case 'contains': return !rule.value || s.toLowerCase().includes(rule.value.toLowerCase())
    case 'not_contains': return !rule.value || !s.toLowerCase().includes(rule.value.toLowerCase())
    case 'date_in': {
      if (rule.year == null && rule.month == null) return true
      const m = s.match(/^(\d{4})-(\d{2})/)
      if (!m) return false
      if (rule.year != null && Number(m[1]) !== rule.year) return false
      if (rule.month != null && Number(m[2]) !== rule.month) return false
      return true
    }
  }
}

// ─── 통합 검색: 텍스트 + 날짜 패턴 ─────────────────────────────────
// '4월 6일' / '04월 06일' / '4/6' / '4-6' / '2026-04-06' / '2026년 4월 6일' 같은 날짜 입력을 인식해
// 모든 날짜 칼럼(요청일·납품기한·입고일정·완제품입고·실제입고일 등)에서 해당 날짜를 찾는다.
export const parseSearchDate = (q: string): { y: number | null; m: number; d: number } | null => {
  const s = q.trim()
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/)
  if (m) return { y: +m[1], m: +m[2], d: +m[3] }
  m = s.match(/^(\d{1,2})\s*(?:월|[/.-])\s*(\d{1,2})\s*일?$/)
  if (m) return { y: null, m: +m[1], d: +m[2] }
  return null
}

export const SEARCH_TEXT_FIELDS = ['sales_order_number', 'board_name', 'client_name']
export const matchesSearch = (item: any, query: string): boolean => {
  const q = query.trim()
  if (!q) return true
  // 텍스트 매치 (기존과 동일한 3개 필드)
  const ql = q.toLowerCase()
  const textHit = SEARCH_TEXT_FIELDS.some(f => String(item[f] ?? '').toLowerCase().includes(ql))
  if (textHit) return true
  // 날짜 매치: 모든 날짜/혼합 칼럼의 ISO 값에서 (년)월일 일치
  const dq = parseSearchDate(q)
  if (!dq) return false
  const mmdd = `-${String(dq.m).padStart(2, '0')}-${String(dq.d).padStart(2, '0')}`
  const isoHit = (v: unknown): boolean => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return false
    return dq.y != null ? v.startsWith(`${dq.y}${mmdd}`) : v.slice(4, 10) === mmdd
  }
  if ([...DATE_ONLY_FIELDS, ...HYBRID_DATE_FIELDS].some(f => isoHit(item[f]))) return true
  // ARTWORK 발주완료 날짜('ordered|||YYYY-MM-DD|||메모')도 검색 대상
  return isoHit(parseArtworkStatus(item.artwork_status).date)
}

// localStorage에 저장된 테이블 필터 복원 (형식이 어긋나면 기본값, 구버전 형식은 규칙으로 변환)
export const loadTableFilter = (type: 'pcb' | 'cable'): TableFilter => {
  const def = defaultTableFilter(type)
  try {
    const raw = localStorage.getItem(filterStorageKey(type))
    if (!raw) return def
    const p = JSON.parse(raw)
    const validCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
    const categories = Array.isArray(p.categories) ? p.categories.filter((c: string) => validCats.includes(c)) : def.categories
    if (Array.isArray(p.rules)) {
      const rules: FilterRule[] = p.rules
        .filter((r: any) => r && typeof r.field === 'string' && typeof r.op === 'string' && opsForField(r.field).includes(r.op))
        .map((r: any) => ({
          id: newRuleId(),
          field: r.field,
          op: r.op,
          value: typeof r.value === 'string' ? r.value : undefined,
          year: typeof r.year === 'number' ? r.year : null,
          month: typeof r.month === 'number' ? r.month : null,
        }))
      return { categories, rules }
    }
    // 구버전(waitingOnly/year/month/dateField) 형식 → 규칙으로 변환
    const rules: FilterRule[] = []
    if (p.waitingOnly !== false) {
      rules.push({ id: newRuleId(), field: type === 'pcb' ? 'final_product_stock' : 'cable_actual_date', op: 'is_empty' })
    }
    if (typeof p.year === 'number' || typeof p.month === 'number') {
      rules.push({ id: newRuleId(), field: typeof p.dateField === 'string' ? p.dateField : 'request_date', op: 'date_in', year: typeof p.year === 'number' ? p.year : null, month: typeof p.month === 'number' ? p.month : null })
    }
    return { categories, rules }
  } catch {
    return def
  }
}

// localStorage에 저장된 제작구분 그룹 순서 복원 (기본 카테고리 보강)
export const restoreCategoryOrder = (): string[] => {
  try {
    const saved = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      const merged = parsed.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
      for (const c of DEFAULT_CATEGORY_ORDER) if (!merged.includes(c)) merged.push(c)
      return merged
    }
  } catch { /* fall through */ }
  return [...DEFAULT_CATEGORY_ORDER]
}
