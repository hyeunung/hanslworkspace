// ─── 테이블별 정렬 (노션식: 칼럼 + 방향 규칙 목록, 우선순위 순) ──────────────
// 제작구분(카테고리)은 항상 그룹 기준(1차 정렬)이라 정렬 대상에서 제외한다.
// 사용자 정렬 규칙은 같은 제작구분 그룹 "안에서" 위→아래 순서를 결정한다.
// ProductionListMain.tsx에서 분리한 순수 함수 모음 — 동작 동일
export type SortDir = 'asc' | 'desc'
export type SortRule = { id: string; field: string; dir: SortDir }

let sortRuleSeq = 0
export const newSortId = () => `s${++sortRuleSeq}`

// localStorage 정렬 저장 키 — 저장/복원이 항상 같은 키를 쓰도록 한곳에서 관리
export const sortStorageKey = (type: 'pcb' | 'cable') => `hansl_prod_sort_${type}`

// 정렬 가능한 칼럼(제작구분 제외). 라벨은 컴포넌트의 getColumnTitle로 표시.
export const PCB_SORT_FIELDS = ['board_name', 'reference', 'request_date', 'estimate_no', 'delivery_deadline', 'client_name', 'client_manager', 'hansl_manager', 'revision_count', 'quantity', 'artwork_status', 'metal_mask', 'changes_memo', 'stock_count', 'pcb_vendor', 'delivery_schedule', 'pcb_lead_time', 'received_quantity', 'received_destination', 'pcb_stock_completed', 'parts_organization', 'assy_hanwha', 'assy_evertech', 'assy_requested_date', 'final_product_stock', 'qa_passed', 'qa_failed', 'qa_notes', 'design_review', 'delivery_quantity', 'delivery_date', 'delivery_destination', 'delivery_completed']
export const CABLE_SORT_FIELDS = ['board_name', 'reference', 'request_date', 'estimate_no', 'delivery_deadline', 'client_name', 'client_manager', 'hansl_manager', 'revision_count', 'quantity', 'spec_details', 'cable_vendor', 'cable_requested_date', 'cable_actual_date', 'delivery_notes', 'delivery_completed']

// 숫자로 비교할 칼럼 / 날짜(YYYY-MM-DD 선두 매칭)로 비교할 칼럼
export const NUMERIC_SORT_FIELDS = new Set(['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'])
export const DATE_SORT_FIELDS = new Set(['request_date', 'delivery_deadline', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed'])

// 정렬 비교 키 추출 — 값 없음(null/빈문자)은 null 반환하여 방향과 무관하게 항상 뒤로 보낸다(노션 동작).
export const sortKeyFor = (item: any, field: string): string | number | null => {
  const raw = item?.[field]
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null
  if (NUMERIC_SORT_FIELDS.has(field)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (DATE_SORT_FIELDS.has(field)) {
    // 순수 날짜 또는 "YYYY-MM-DD (메모)" 혼합 — 선두 ISO 날짜만 뽑으면 사전식=시간순
    const m = typeof raw === 'string' ? raw.match(/(\d{4}-\d{2}-\d{2})/) : null
    return m ? m[1] : null
  }
  return typeof raw === 'string' ? raw : String(raw)
}

// 정렬 규칙 목록(우선순위 순)으로 두 행 비교. 빈 값은 항상 뒤, 동률이면 다음 규칙으로.
export const compareBySortRules = (a: any, b: any, rules: SortRule[]): number => {
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

// localStorage에서 저장된 정렬 규칙 복원 (유효한 칼럼/방향만)
export const loadTableSort = (type: 'pcb' | 'cable'): SortRule[] => {
  try {
    const saved = localStorage.getItem(sortStorageKey(type))
    if (saved) {
      const valid = type === 'pcb' ? PCB_SORT_FIELDS : CABLE_SORT_FIELDS
      const parsed = JSON.parse(saved) as SortRule[]
      return parsed
        .filter(r => r && valid.includes(r.field) && (r.dir === 'asc' || r.dir === 'desc'))
        .map(r => ({ id: newSortId(), field: r.field, dir: r.dir }))
    }
  } catch { /* fall through */ }
  return []
}
