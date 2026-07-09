// ─── 제작현황 칼럼 너비 실측 · 칼럼 숨기기 · 편집 대상 칼럼 정의 ─────────
// ProductionListMain.tsx에서 분리한 순수 함수/상수 모음 — 동작 동일

// 표 셀 폰트(10px)와 동일한 폰트로 캔버스에서 텍스트 폭을 실측한다.
// 칼럼 너비 = Max(헤더, 가장 긴 본문) + 좌우 여백(COLUMN_PADDING_SIDE)씩
export const TABLE_FONT_STACK = "Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif"
// 본문 셀 자간: body { font-size:15px; letter-spacing:-0.01em } → computed -0.15px가 셀로 상속됨 (globals.css)
export const BODY_LETTER_SPACING = -0.15
// 헤더 자간: .table-header-text { letter-spacing:0.02em } @10px = +0.2px (globals.css)
export const HEADER_LETTER_SPACING = 0.2
// 데이터가 없을 때(빈 표)에도 각 칼럼이 실제 입력 데이터를 담기에 충분한 최소 폭을 갖도록,
// 각 표(PCB / Cable)의 실제 DB 데이터 평균 길이를 기준으로 산정한 칼럼별 최소 너비(px, 좌우 여백 포함 최종값).
// 헤더 제목 폭·본문 실측 폭과 함께 Math.max 로 비교되어 '바닥값' 역할만 한다(데이터가 길면 더 넓어짐).
// PCB와 Cable은 같은 필드라도 평균 데이터 길이가 다르므로(예: 보드명 34자 vs 품명 20자) 표별로 따로 관리한다.
export const MIN_COLUMN_WIDTH: Record<'pcb' | 'cable', Record<string, number>> = {
  // production_pcbs 실제 데이터의 표시 폭(px, 한글 10px·영문/숫자 5.5px @10px 폰트) 평균 실측 기준
  pcb: {
    sales_order_number: 80,
    production_category: 96,
    board_name: 200, // 평균 193px
    reference: 165, // 평균 159px
    request_date: 60,
    estimate_no: 66,
    delivery_deadline: 60,
    client_name: 60,
    client_manager: 80, // 평균 72px
    hansl_manager: 54,
    creator: 54,
    revision_count: 46,
    quantity: 50,
    artwork_status: 140,
    metal_mask: 74, // 평균 53px + 헤더 'MetalMask' 기준
    changes_memo: 96,
    stock_count: 50,
    pcb_vendor: 56,
    delivery_schedule: 64,
    pcb_lead_time: 80,
    received_quantity: 60,
    received_destination: 52,
    pcb_stock_completed: 80,
    parts_organization: 56,
    assy_hanwha: 72,
    assy_evertech: 72,
    assy_requested_date: 62,
    final_product_stock: 80, // 평균 72px
    qa_passed: 46,
    qa_failed: 46,
    qa_notes: 130, // 평균 121px
    design_review: 115, // 평균 107px
    delivery_quantity: 50,
    delivery_date: 60,
    delivery_destination: 135, // 평균 129px
    delivery_completed: 80,
  },
  // production_cables 실제 데이터의 표시 폭 평균 실측 기준
  cable: {
    sales_order_number: 80,
    production_category: 74,
    board_name: 145, // 품명 평균 116px
    reference: 60,
    request_date: 60,
    estimate_no: 60, // 평균 46px
    delivery_deadline: 60,
    client_name: 56, // 평균 29px + 입력 여유
    client_manager: 66, // 평균 46px + 헤더 '업체 담당자' 기준
    hansl_manager: 48,
    creator: 52,
    revision_count: 46,
    quantity: 50,
    spec_details: 170, // 사양 평균 155px
    cable_vendor: 56, // 평균 39px
    cable_requested_date: 66, // 입고 요청일
    cable_actual_date: 66, // 실제 입고일
    delivery_notes: 85, // 납품/비고 평균 71px
    delivery_completed: 80,
  },
}

let measureCtx: CanvasRenderingContext2D | null = null

export const measureText = (rawText: string, weight: number, letterSpacing: number = BODY_LETTER_SPACING): number => {
  // HTML 렌더링과 동일하게 연속 공백은 1칸으로, 앞뒤 공백은 제거하고 측정
  const text = rawText ? rawText.replace(/\s+/g, ' ').trim() : ''
  if (!text) return 0
  if (typeof document !== 'undefined') {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      measureCtx.font = `${weight} 10px ${TABLE_FONT_STACK}`
      const ctxAny = measureCtx as any
      if ('letterSpacing' in ctxAny) {
        // Chrome/Edge: 캔버스가 자간까지 실측
        ctxAny.letterSpacing = `${letterSpacing}px`
        return measureCtx.measureText(text).width
      }
      // 자간 미지원 브라우저: 글자 수 × 자간으로 보정
      return measureCtx.measureText(text).width + text.length * letterSpacing
    }
  }
  // SSR 대비 근사치 (한글 10px, 영문/숫자 5.5px)
  let len = 0
  for (let i = 0; i < text.length; i++) {
    len += text.charCodeAt(i) > 128 ? 10 : 5.5
  }
  return len
}

// 좌측 고정(sticky) 칼럼: 구분선을 border 대신 box-shadow로 그려서 보더 폭 보정이 불필요
export const STICKY_FIELDS = ['sales_order_number', 'production_category', 'board_name', 'reference', 'request_date']

// ─── 칼럼 숨기기 ─────────────────────────────────────────────────────
// NO./작업은 행 식별·조작용이라 항상 표시하되, 좌측 고정 칼럼(제작번호~요청일)과
// 그 외 본문 칼럼은 모두 표별로 숨길 수 있다. 드롭다운 목록의 그룹은 실제 헤더 그룹 구성을 따르고,
// PCB는 업무 단계 기준 큰 구분선(섹션) 3개로 나눠 섹션 단위 일괄 숨기기/표시를 지원한다.
export type HideableSection = { title: string; groups: { title: string; fields: string[] }[] }
export const HIDEABLE_SECTIONS: Record<'pcb' | 'cable', HideableSection[]> = {
  pcb: [
    {
      title: '기본정보 (좌측고정)',
      groups: [
        { title: '기본정보', fields: ['sales_order_number', 'production_category', 'board_name', 'reference', 'request_date'] },
      ],
    },
    {
      title: '견적NO. ~ PCB 제작',
      groups: [
        { title: '기본', fields: ['estimate_no', 'delivery_deadline', 'creator'] },
        { title: 'PJT 담당자', fields: ['client_name', 'client_manager', 'hansl_manager'] },
        { title: '제작수량', fields: ['revision_count', 'quantity'] },
        { title: 'ARTWORK', fields: ['artwork_status'] },
        { title: 'PCB 제작', fields: ['metal_mask', 'changes_memo', 'stock_count', 'pcb_vendor', 'delivery_schedule', 'pcb_lead_time', 'received_quantity', 'received_destination', 'pcb_stock_completed'] },
      ],
    },
    {
      title: '부품정리 ~ 완제품 입고',
      groups: [
        { title: "부품정리 / ASS'Y / 입고", fields: ['parts_organization', 'assy_hanwha', 'assy_evertech', 'assy_requested_date', 'final_product_stock'] },
      ],
    },
    {
      title: 'IN-House Checking ~ 납품',
      groups: [
        { title: 'IN-House Checking / 리뷰', fields: ['qa_passed', 'qa_failed', 'qa_notes', 'design_review'] },
        { title: '납품', fields: ['delivery_quantity', 'delivery_date', 'delivery_destination', 'delivery_completed'] },
      ],
    },
  ],
  // Cable 표는 칼럼 수가 적어 섹션 구분 없이 단일 목록
  cable: [
    {
      title: '기본정보 (좌측고정)',
      groups: [
        { title: '기본정보', fields: ['sales_order_number', 'production_category', 'board_name', 'reference', 'request_date'] },
      ],
    },
    {
      title: '견적NO. ~ 납품',
      groups: [
        { title: '기본', fields: ['estimate_no', 'delivery_deadline', 'creator'] },
        { title: 'PJT 담당자', fields: ['client_name', 'client_manager', 'hansl_manager'] },
        { title: '제작수량', fields: ['revision_count', 'quantity'] },
        { title: '사양', fields: ['spec_details'] },
        { title: 'CASE/CABLE 입고', fields: ['cable_vendor', 'cable_requested_date', 'cable_actual_date'] },
        { title: '납품', fields: ['delivery_notes', 'delivery_completed'] },
      ],
    },
  ],
}

export const hideableFieldsFor = (type: 'pcb' | 'cable'): string[] =>
  HIDEABLE_SECTIONS[type].flatMap(s => s.groups.flatMap(g => g.fields))

// 그룹 헤더(colSpan) 칼럼 구성 — 숨긴 칼럼 수만큼 colSpan을 줄이고, 전부 숨기면 그룹 헤더째 제거
export const HEADER_SPAN_GROUPS = {
  pjt: ['client_name', 'client_manager', 'hansl_manager'],
  makeQty: ['revision_count', 'quantity'],
  pcbMake: ['metal_mask', 'changes_memo', 'stock_count', 'pcb_vendor', 'delivery_schedule', 'pcb_lead_time', 'received_quantity', 'received_destination', 'pcb_stock_completed'],
  assy: ['assy_hanwha', 'assy_evertech', 'assy_requested_date'],
  inHouse: ['qa_passed', 'qa_failed', 'qa_notes'],
  pcbDelivery: ['delivery_quantity', 'delivery_date', 'delivery_destination', 'delivery_completed'],
  cableStockIn: ['cable_vendor', 'cable_requested_date', 'cable_actual_date'],
  cableDelivery: ['delivery_notes', 'delivery_completed'],
}

// localStorage 숨긴 칼럼 저장 키 — 저장/복원이 항상 같은 키를 쓰도록 한곳에서 관리
export const hiddenColsStorageKey = (type: 'pcb' | 'cable') => `hansl_prod_hidden_cols_${type}`

// localStorage에 저장된 숨긴 칼럼 목록 복원 (알 수 없는 필드는 버림)
export const loadHiddenCols = (type: 'pcb' | 'cable'): string[] => {
  try {
    const raw = localStorage.getItem(hiddenColsStorageKey(type))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = hideableFieldsFor(type)
    return parsed.filter((f: unknown): f is string => typeof f === 'string' && valid.includes(f))
  } catch {
    return []
  }
}

// 내용이 길어질 수 있는 메모성 텍스트 칼럼 — 편집 시 여러 줄 textarea 팝오버로 띄운다
export const MEMO_TEXT_FIELDS = ['reference', 'changes_memo', 'qa_notes', 'design_review', 'delivery_notes', 'spec_details', 'delivery_destination', 'received_destination']

// 같은 칼럼 다중선택 시 '값'을 일괄 편집할 수 있는 필드들. 여기 없는 필드는 색상/스타일 일괄변경만 가능.
// (단일 클릭으로 편집 가능한 필드와 동일하게 맞춘 화이트리스트)
export const BULK_VALUE_EDITABLE = new Set<string>([
  // 날짜 / 하이브리드(날짜·메모)
  'request_date', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date',
  'assy_hanwha', 'assy_evertech', 'delivery_deadline', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed',
  // 숫자
  'revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity',
  // 메모/텍스트
  ...MEMO_TEXT_FIELDS,
  'board_name', 'client_name', 'pcb_vendor', 'client_manager', 'hansl_manager', 'metal_mask', 'estimate_no', 'sales_order_number',
  // select / 특수 편집기
  'production_category', 'artwork_status', 'parts_organization',
])

// select 칼럼의 옵션 (단일 클릭 편집기와 동일)
export const bulkSelectOptions = (type: 'pcb' | 'cable', field: string): string[] | null => {
  if (field === 'production_category') {
    return type === 'pcb' ? ['LG_PCB', 'LG_Socket Board', 'PCB'] : ['LG_Cable', 'LG_Case', 'Cable', 'Case']
  }
  return null
}
