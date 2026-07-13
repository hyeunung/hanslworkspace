// ─── 업체관리 컴팩트 테이블 모델 (순수 함수만) ──────────────────────────────
// 제작현황(productionFilters/Sort) → 발주(purchaseTable*) → 보드별 정리(bomBoardTable)
// 패턴을 업체 칼럼으로 주입한 버전. 업체관리는 조건 필터 없이 통합 검색만 사용한다.

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

// 담당자 필드는 이름/직급/전화/이메일을 하나의 문자열로 취급해 매칭
const contactsText = (row: VendorRow): string =>
  row.contacts
    .flatMap(c => [c.contact_name, c.position, c.contact_phone, c.contact_email])
    .filter(Boolean)
    .join(' ')

const textValueOf = (row: VendorRow, field: string): string => {
  switch (field) {
    case 'vendor_name': return row.vendor_name
    case 'vendor_phone': return row.vendor_phone
    case 'vendor_fax': return row.vendor_fax
    case 'vendor_payment_schedule': return row.vendor_payment_schedule
    case 'note': return row.note
    default: return ''
  }
}

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
