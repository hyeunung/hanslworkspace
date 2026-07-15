// ─────────────────────────────────────────────────────────────
// 제작현황 하이브리드 상태 칼럼(ARTWORK / 부품정리) 유틸
// ProductionListMain.tsx에서 분리한 순수 함수 모음 — 동작 동일
// ─────────────────────────────────────────────────────────────

// HANSL 담당자는 이름만 표시/저장한다. datalist 입력은 자유 텍스트라 "이종근사원"처럼
// 직함이 붙은 값이 타이핑될 수 있어, 저장 직전에 뒤에 붙은 직함을 제거한다.
export const EMPLOYEE_TITLE_SUFFIX = /(사원|주임|대리|과장|차장|부장|이사|상무|전무|팀장|실장|본부장|소장|대표)$/
export const stripEmployeeTitle = (name: string | null | undefined): string => {
  if (!name) return ''
  const trimmed = name.trim()
  const stripped = trimmed.replace(EMPLOYEE_TITLE_SUFFIX, '').trim()
  return stripped || trimmed
};

// ARTWORK/부품정리는 상태 + 메모 하이브리드 구조라 필터에서 전용 조건(status_is)을 쓴다
export const ARTWORK_FIELD = 'artwork_status'
export const PARTS_FIELD = 'parts_organization'
export const STATUS_FIELDS = [ARTWORK_FIELD, PARTS_FIELD]

// ─────────────────────────────────────────────────────────────
// ARTWORK 상태(하이브리드): 상태 선택(진행중/업체 확인중/발주완료/한슬 완제품 입고) + 메모
// 저장 포맷: `<status>|||<date>|||<memo>` (상태 없으면 메모 원문만 저장 → 하위호환)
//  - status: '' | 'progress' | 'checking' | 'ordered' | 'stock_in'
//  - date  : 'YYYY-MM-DD' (ordered 선택한 당일, 한국시간 기준. stock_in은 날짜 기록 안 함)
//  - memo  : 자유 메모
// ─────────────────────────────────────────────────────────────
export const ARTWORK_STATUS_OPTIONS: { code: string; label: string }[] = [
  { code: 'progress', label: '진행중' },
  { code: 'checking', label: '업체 확인중' },
  { code: 'ordered', label: '발주완료' },
  { code: 'stock_in', label: '한슬 완제품 입고' },
]

// 필터 전용 상태 선택지 — 셀 편집 드롭다운(위 4종)에 더해, 구엑셀 이관/직접 입력 텍스트를 아우른다.
//  - delivered: '전달 완료' 계열 텍스트 (셀 편집에는 없는 필터 전용 상태)
//  - text     : 상태 코드도 없고 상태 키워드에도 안 걸리는 순수 직접 입력(예: '한슬 완제품 재고')
export const ARTWORK_FILTER_STATUS_OPTIONS: { code: string; label: string }[] = [
  ...ARTWORK_STATUS_OPTIONS,
  { code: 'delivered', label: '전달완료' },
  { code: 'text', label: '직접입력' },
]

export type ArtworkParts = { status: string; date: string; memo: string }

// 필터 상태 판정 — 드롭다운으로 저장된 상태 코드 외에, 구엑셀 이관 텍스트(예: '4/29 PCB 발주 완료')도
// 키워드로 같은 상태로 취급한다. 키워드 매칭은 상태 코드가 없는(직접 입력) 값에만 적용해 메모 오탐을 막는다.
export const ARTWORK_LEGACY_PATTERNS: Record<string, RegExp> = {
  progress: /(작업|진행)\s*중/,
  checking: /확인\s*중/,
  ordered: /발주\s*완료/,
  delivered: /전달\s*완료/,
  // '완제품 입고'(신규 문구) 외에 구엑셀 이관 시절부터 쓰던 '한슬 완제품 재고'/'한슬 완제품 사용'류
  // 문구(순서 무관하게 완제품+재고 또는 완제품+사용이 함께 있으면 매칭)도 같은 상태로 취급한다.
  stock_in: /(?=.*완제품)(?=.*(?:재고|사용|입고))/,
}
export const artworkStatusMatches = (aw: ArtworkParts, code: string | undefined): boolean => {
  const legacy = aw.status ? '' : aw.memo
  if (code === 'text') return !aw.status && aw.memo.trim() !== '' && !Object.values(ARTWORK_LEGACY_PATTERNS).some(re => re.test(aw.memo))
  if (!code) return false
  return aw.status === code || (ARTWORK_LEGACY_PATTERNS[code]?.test(legacy) ?? false)
}

// 한국시간(KST) 기준 오늘 날짜 'YYYY-MM-DD'
export const getKstTodayISO = (): string => {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const d = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 납품기한 경고: 한국시간 기준 기한 하루 전(D-1)이 되는 날부터 true (기한 당일·경과 포함)
// 값이 ISO 날짜(YYYY-MM-DD)가 아닌 메모 텍스트면 판정하지 않는다.
export const isDeadlineUrgent = (value: string | null | undefined): boolean => {
  if (!value) return false
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() - 1)
  const dMinus1 = d.toISOString().slice(0, 10)
  return getKstTodayISO() >= dMinus1
}

// 'YYYY-MM-DD' -> 'MM월DD일'
export const formatKoreanMMDD = (iso: string): string => {
  const p = iso.split('-')
  if (p.length < 3) return iso
  return `${p[1]}월${p[2]}일`
}

export const parseArtworkStatus = (raw: string | null | undefined): ArtworkParts => {
  if (!raw) return { status: '', date: '', memo: '' }
  if (raw.includes('|||')) {
    const parts = raw.split('|||')
    return { status: parts[0] || '', date: parts[1] || '', memo: parts.slice(2).join('|||') }
  }
  // 하위호환: 구분자가 없으면 전체를 메모로 간주
  return { status: '', date: '', memo: raw }
}

export const serializeArtworkStatus = (p: ArtworkParts): string => {
  if (!p.status && !p.memo) return ''
  if (!p.status) return p.memo // 메모만 있을 때는 원문 저장(하위호환)
  return `${p.status}|||${p.date || ''}|||${p.memo || ''}`
}

// 셀 표시용 문자열 (예: '07월06일 발주완료 │ 추가 메모')
export const formatArtworkDisplay = (raw: string | null | undefined): string => {
  const { status, date, memo } = parseArtworkStatus(raw)
  let label = ''
  if (status === 'progress') label = '진행중'
  else if (status === 'checking') label = '업체 확인중'
  else if (status === 'ordered') label = `${date ? formatKoreanMMDD(date) + ' ' : ''}발주완료`
  else if (status === 'stock_in') label = '한슬 완제품 입고'
  if (label && memo) return `${label} │ ${memo}`
  if (label) return label
  return memo || ''
}

// ─────────────────────────────────────────────────────────────
// 부품정리(parts_organization) 상태 처리 — ARTWORK와 동일한 방식이나
// 상태는 '진행중 / 완료' 두 가지, 날짜는 기록하지 않는다.
// 저장 포맷: 'status|||memo' (구분자 없으면 전체를 메모로 간주)
//  - status: '' | 'progress' | 'done'
//  - memo  : 자유 메모
// ─────────────────────────────────────────────────────────────
export const PARTS_STATUS_OPTIONS: { code: string; label: string }[] = [
  { code: 'progress', label: '진행중' },
  { code: 'done', label: '완료' },
]

// 필터 전용 상태 선택지 — ARTWORK와 동일하게 직접 입력 텍스트('홀딩' 등)를 잡는 항목을 더한다
export const PARTS_FILTER_STATUS_OPTIONS: { code: string; label: string }[] = [
  ...PARTS_STATUS_OPTIONS,
  { code: 'text', label: '직접입력' },
]

export type PartsParts = { status: string; memo: string }

// 필터 상태 판정 — 상태 코드 외에 구엑셀 이관 텍스트('완료'/'진행중')도 같은 상태로 취급 (ARTWORK와 동일 원칙)
export const PARTS_LEGACY_PATTERNS: Record<string, RegExp> = {
  progress: /진행\s*중/,
  done: /완료/,
}
export const partsStatusMatches = (p: PartsParts, code: string | undefined): boolean => {
  const legacy = p.status ? '' : p.memo
  if (code === 'text') return !p.status && p.memo.trim() !== '' && !Object.values(PARTS_LEGACY_PATTERNS).some(re => re.test(p.memo))
  if (!code) return false
  return p.status === code || (PARTS_LEGACY_PATTERNS[code]?.test(legacy) ?? false)
}

// 필터 status_is 드롭다운에 쓸 선택지 (칼럼별)
export const filterStatusOptionsFor = (field: string) =>
  field === PARTS_FIELD ? PARTS_FILTER_STATUS_OPTIONS : ARTWORK_FILTER_STATUS_OPTIONS

export const parsePartsStatus = (raw: string | null | undefined): PartsParts => {
  if (!raw) return { status: '', memo: '' }
  if (raw.includes('|||')) {
    const parts = raw.split('|||')
    return { status: parts[0] || '', memo: parts.slice(1).join('|||') }
  }
  // 하위호환: 구분자가 없으면 전체를 메모로 간주
  return { status: '', memo: raw }
}

export const serializePartsStatus = (p: PartsParts): string => {
  if (!p.status && !p.memo) return ''
  if (!p.status) return p.memo // 메모만 있을 때는 원문 저장(하위호환)
  return `${p.status}|||${p.memo || ''}`
}

// 셀 표시용 문자열 (예: '완료 │ 추가 메모')
export const formatPartsDisplay = (raw: string | null | undefined): string => {
  const { status, memo } = parsePartsStatus(raw)
  let label = ''
  if (status === 'progress') label = '진행중'
  else if (status === 'done') label = '완료'
  if (label && memo) return `${label} │ ${memo}`
  if (label) return label
  return memo || ''
}
