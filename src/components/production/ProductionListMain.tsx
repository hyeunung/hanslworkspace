import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { productionService, ProductionPcb, ProductionCable } from '@/services/productionService'
import { Plus, Search, Edit2, X, Filter, Save, RotateCcw, ChevronDown, SlidersHorizontal, Download, Printer, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Bookmark, Star, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useProductionFilterViews, StoredFilterRule, FilterDefaultSnapshot } from '@/hooks/useProductionFilterViews'
import { vendorService } from '@/services/vendorService'
import { Calendar } from '@/components/ui/calendar'


interface Employee {
  id: string
  name: string
  email: string
}

// ─── 칼럼 너비 실측 유틸 ─────────────────────────────────────────────
// 표 셀 폰트(10px)와 동일한 폰트로 캔버스에서 텍스트 폭을 실측한다.
// 칼럼 너비 = Max(헤더, 가장 긴 본문) + 좌우 여백(COLUMN_PADDING_SIDE)씩
const TABLE_FONT_STACK = "Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif"
// 본문 셀 자간: body { font-size:15px; letter-spacing:-0.01em } → computed -0.15px가 셀로 상속됨 (globals.css)
const BODY_LETTER_SPACING = -0.15
// 헤더 자간: .table-header-text { letter-spacing:0.02em } @10px = +0.2px (globals.css)
const HEADER_LETTER_SPACING = 0.2
// 데이터가 없을 때(빈 표)에도 각 칼럼이 실제 입력 데이터를 담기에 충분한 최소 폭을 갖도록,
// 각 표(PCB / Cable)의 실제 DB 데이터 평균 길이를 기준으로 산정한 칼럼별 최소 너비(px, 좌우 여백 포함 최종값).
// 헤더 제목 폭·본문 실측 폭과 함께 Math.max 로 비교되어 '바닥값' 역할만 한다(데이터가 길면 더 넓어짐).
// PCB와 Cable은 같은 필드라도 평균 데이터 길이가 다르므로(예: 보드명 34자 vs 품명 20자) 표별로 따로 관리한다.
const MIN_COLUMN_WIDTH: Record<'pcb' | 'cable', Record<string, number>> = {
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

const measureText = (rawText: string, weight: number, letterSpacing: number = BODY_LETTER_SPACING): number => {
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
const STICKY_FIELDS = ['sales_order_number', 'production_category', 'board_name', 'reference', 'request_date']

// 제작구분 칩의 기본 표시/그룹 순서 — 드래그로 재정렬 가능. 이 순서대로 테이블이 제작구분별로 위→아래 그룹핑됨
const DEFAULT_CATEGORY_ORDER = ['LG_PCB', 'LG_Socket Board', 'LG_Cable', 'LG_Case', 'PCB', 'Cable', 'Case']

// ─── 칼럼 숨기기 ─────────────────────────────────────────────────────
// NO./작업은 행 식별·조작용이라 항상 표시하되, 좌측 고정 칼럼(제작번호~요청일)과
// 그 외 본문 칼럼은 모두 표별로 숨길 수 있다. 드롭다운 목록의 그룹은 실제 헤더 그룹 구성을 따르고,
// PCB는 업무 단계 기준 큰 구분선(섹션) 3개로 나눠 섹션 단위 일괄 숨기기/표시를 지원한다.
type HideableSection = { title: string; groups: { title: string; fields: string[] }[] }
const HIDEABLE_SECTIONS: Record<'pcb' | 'cable', HideableSection[]> = {
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

const hideableFieldsFor = (type: 'pcb' | 'cable'): string[] =>
  HIDEABLE_SECTIONS[type].flatMap(s => s.groups.flatMap(g => g.fields))

// 그룹 헤더(colSpan) 칼럼 구성 — 숨긴 칼럼 수만큼 colSpan을 줄이고, 전부 숨기면 그룹 헤더째 제거
const HEADER_SPAN_GROUPS = {
  pjt: ['client_name', 'client_manager', 'hansl_manager'],
  makeQty: ['revision_count', 'quantity'],
  pcbMake: ['metal_mask', 'changes_memo', 'stock_count', 'pcb_vendor', 'delivery_schedule', 'pcb_lead_time', 'received_quantity', 'received_destination', 'pcb_stock_completed'],
  assy: ['assy_hanwha', 'assy_evertech', 'assy_requested_date'],
  inHouse: ['qa_passed', 'qa_failed', 'qa_notes'],
  pcbDelivery: ['delivery_quantity', 'delivery_date', 'delivery_destination', 'delivery_completed'],
  cableStockIn: ['cable_vendor', 'cable_requested_date', 'cable_actual_date'],
  cableDelivery: ['delivery_notes', 'delivery_completed'],
}

// localStorage에 저장된 숨긴 칼럼 목록 복원 (알 수 없는 필드는 버림)
const loadHiddenCols = (type: 'pcb' | 'cable'): string[] => {
  try {
    const raw = localStorage.getItem(`hansl_prod_hidden_cols_${type}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = hideableFieldsFor(type)
    return parsed.filter((f: unknown): f is string => typeof f === 'string' && valid.includes(f))
  } catch {
    return []
  }
}

// ─── 테이블별 필터 (PCB/Cable 각각 독립, 노션식 규칙 기반) ─────────────
// 위(PCB) 테이블과 아래(Cable) 테이블은 제작구분·칼럼이 서로 달라 필터를 분리한다.
// 필터 = 규칙(칼럼 + 조건 + 값) 목록의 AND 결합. 노션처럼 규칙을 추가/수정/제거할 수 있고,
// 기본 필터(입고대기 + 요청일 현재년도)도 일반 규칙이라 X로 제거 가능하다.
const PCB_CATEGORIES = ['LG_PCB', 'LG_Socket Board', 'PCB']
const CABLE_CATEGORIES = ['LG_Cable', 'LG_Case', 'Cable', 'Case']

// 내용이 길어질 수 있는 메모성 텍스트 칼럼 — 편집 시 여러 줄 textarea 팝오버로 띄운다
const MEMO_TEXT_FIELDS = ['reference', 'changes_memo', 'qa_notes', 'design_review', 'delivery_notes', 'spec_details', 'delivery_destination', 'received_destination']

// 같은 칼럼 다중선택 시 '값'을 일괄 편집할 수 있는 필드들. 여기 없는 필드는 색상/스타일 일괄변경만 가능.
// (단일 클릭으로 편집 가능한 필드와 동일하게 맞춘 화이트리스트)
const BULK_VALUE_EDITABLE = new Set<string>([
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
const bulkSelectOptions = (type: 'pcb' | 'cable', field: string): string[] | null => {
  if (field === 'production_category') {
    return type === 'pcb' ? ['LG_PCB', 'LG_Socket Board', 'PCB'] : ['LG_Cable', 'LG_Case', 'Cable', 'Case']
  }
  return null
}

// 순수 날짜 칼럼(YYYY-MM-DD)과 날짜/메모 혼합 칼럼 — 조건(op) 선택지가 달라진다
const DATE_ONLY_FIELDS = ['request_date', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date']
const HYBRID_DATE_FIELDS = ['delivery_deadline', 'assy_hanwha', 'assy_evertech', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed']

// 필터 규칙 하나: field 칼럼에 op 조건 적용. contains류는 value, date_in은 year/month 사용.
type FilterOp = 'date_in' | 'contains' | 'not_contains' | 'is_empty' | 'not_empty' | 'status_is'
type FilterRule = {
  id: string
  field: string
  op: FilterOp
  value?: string
  year?: number | null
  month?: number | null
}

type TableFilter = {
  categories: string[]
  rules: FilterRule[]
}

const OP_LABELS: Record<FilterOp, string> = {
  date_in: '날짜',
  contains: '포함',
  not_contains: '미포함',
  is_empty: '비어있음',
  not_empty: '비어있지 않음',
  status_is: '상태',
}

// 입고/배송 칼럼(완제품입고/실제입고일/입고완료/배송완료)은 도메인 용어로 표기: 비어있음=대기, 비어있지 않음=완료
// 배송완료는 '배송대기/배송완료'로 구분 표기하고 나머지는 '입고대기/입고됨'을 쓴다
const STOCK_DATE_LABELS: Record<string, [string, string]> = {
  final_product_stock: ['입고대기', '입고됨'],
  cable_actual_date: ['입고대기', '입고됨'],
  pcb_stock_completed: ['입고대기', '입고됨'],
  delivery_completed: ['배송대기', '배송완료'],
}
const STOCK_DATE_FIELDS = Object.keys(STOCK_DATE_LABELS)
// ARTWORK/부품정리는 상태 + 메모 하이브리드 구조라 전용 조건(status_is)을 쓴다
// (상태 목록은 ARTWORK_STATUS_OPTIONS / PARTS_STATUS_OPTIONS, 필터 선택지는 *_FILTER_STATUS_OPTIONS)
const ARTWORK_FIELD = 'artwork_status'
const PARTS_FIELD = 'parts_organization'
const STATUS_FIELDS = [ARTWORK_FIELD, PARTS_FIELD]
const opLabelFor = (field: string, op: FilterOp): string => {
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
const opsForField = (field: string): FilterOp[] => {
  if (STATUS_FIELDS.includes(field)) return ['status_is', 'contains', 'not_contains', 'is_empty', 'not_empty']
  // 입고 칼럼(완제품입고 등)은 날짜/입고대기/입고됨만 — 포함·미포함은 날짜 데이터에 의미 중복
  if (STOCK_DATE_FIELDS.includes(field)) return ['date_in', 'is_empty', 'not_empty']
  if (DATE_ONLY_FIELDS.includes(field)) return ['date_in', 'is_empty', 'not_empty']
  if (HYBRID_DATE_FIELDS.includes(field)) return ['date_in', 'contains', 'not_contains', 'is_empty', 'not_empty']
  return ['contains', 'not_contains', 'is_empty', 'not_empty']
}

let filterRuleSeq = 0
const newRuleId = () => `r${++filterRuleSeq}`

// 저장 필터 ↔ 화면 규칙 변환 — 저장에는 세션 전용 id를 빼고, 복원 시 새 id를 발급한다.
const toStoredRules = (rules: FilterRule[]): StoredFilterRule[] =>
  rules.map(({ field, op, value, year, month }) => ({ field, op, value, year: year ?? null, month: month ?? null }))
const fromStoredRules = (rules: StoredFilterRule[]): FilterRule[] =>
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
const defaultRules = (type: 'pcb' | 'cable'): FilterRule[] => [
  { id: newRuleId(), field: type === 'pcb' ? 'final_product_stock' : 'cable_actual_date', op: 'is_empty' },
  { id: newRuleId(), field: 'request_date', op: 'date_in', year: new Date().getFullYear(), month: null },
]

const defaultTableFilter = (type: 'pcb' | 'cable'): TableFilter => ({
  categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES],
  rules: defaultRules(type),
})

// ─── 저장 아이콘(파랑) 판정: "기본값에서 바꿔서 저장해둔 상태"인지 ──────────
// 규칙 비교는 id 제외(id는 세션마다 새로 발급됨). 저장 원본(raw JSON)과 상태 양쪽 모두 처리.
const normalizeRulesForCompare = (rules: any[]): string =>
  JSON.stringify((rules || []).map(r => ({
    f: r.field, o: r.op,
    v: typeof r.value === 'string' ? r.value : null,
    y: typeof r.year === 'number' ? r.year : null,
    m: typeof r.month === 'number' ? r.month : null,
  })))
const rulesEqualDefault = (type: 'pcb' | 'cable', rules: any[]): boolean =>
  normalizeRulesForCompare(rules) === normalizeRulesForCompare(defaultRules(type))
const catsEqualDefault = (type: 'pcb' | 'cable', cats: string[]): boolean => {
  const def = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
  return Array.isArray(cats) && cats.length === def.length && def.every(c => cats.includes(c))
}
const categoryOrderIsDefault = (order: string[]): boolean =>
  JSON.stringify(order) === JSON.stringify(DEFAULT_CATEGORY_ORDER)

// ─── 테이블별 정렬 (노션식: 칼럼 + 방향 규칙 목록, 우선순위 순) ──────────────
// 제작구분(카테고리)은 항상 그룹 기준(1차 정렬)이라 정렬 대상에서 제외한다.
// 사용자 정렬 규칙은 같은 제작구분 그룹 "안에서" 위→아래 순서를 결정한다.
type SortDir = 'asc' | 'desc'
type SortRule = { id: string; field: string; dir: SortDir }

let sortRuleSeq = 0
const newSortId = () => `s${++sortRuleSeq}`

// 정렬 가능한 칼럼(제작구분 제외). 라벨은 컴포넌트의 getColumnTitle로 표시.
const PCB_SORT_FIELDS = ['board_name', 'reference', 'request_date', 'estimate_no', 'delivery_deadline', 'client_name', 'client_manager', 'hansl_manager', 'revision_count', 'quantity', 'artwork_status', 'metal_mask', 'changes_memo', 'stock_count', 'pcb_vendor', 'delivery_schedule', 'pcb_lead_time', 'received_quantity', 'received_destination', 'pcb_stock_completed', 'parts_organization', 'assy_hanwha', 'assy_evertech', 'assy_requested_date', 'final_product_stock', 'qa_passed', 'qa_failed', 'qa_notes', 'design_review', 'delivery_quantity', 'delivery_date', 'delivery_destination', 'delivery_completed']
const CABLE_SORT_FIELDS = ['board_name', 'reference', 'request_date', 'estimate_no', 'delivery_deadline', 'client_name', 'client_manager', 'hansl_manager', 'revision_count', 'quantity', 'spec_details', 'cable_vendor', 'cable_requested_date', 'cable_actual_date', 'delivery_notes', 'delivery_completed']

// 숫자로 비교할 칼럼 / 날짜(YYYY-MM-DD 선두 매칭)로 비교할 칼럼
const NUMERIC_SORT_FIELDS = new Set(['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'])
const DATE_SORT_FIELDS = new Set(['request_date', 'delivery_deadline', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed'])

// 정렬 비교 키 추출 — 값 없음(null/빈문자)은 null 반환하여 방향과 무관하게 항상 뒤로 보낸다(노션 동작).
const sortKeyFor = (item: any, field: string): string | number | null => {
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
const compareBySortRules = (a: any, b: any, rules: SortRule[]): number => {
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
const loadTableSort = (type: 'pcb' | 'cable'): SortRule[] => {
  try {
    const saved = localStorage.getItem(`hansl_prod_sort_${type}`)
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

// 규칙 하나를 행에 적용 (AND 결합은 호출부에서). 값이 없는 셀은 date_in/contains에서 제외된다.
const applyFilterRule = (item: any, rule: FilterRule): boolean => {
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
const parseSearchDate = (q: string): { y: number | null; m: number; d: number } | null => {
  const s = q.trim()
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/)
  if (m) return { y: +m[1], m: +m[2], d: +m[3] }
  m = s.match(/^(\d{1,2})\s*(?:월|[/.-])\s*(\d{1,2})\s*일?$/)
  if (m) return { y: null, m: +m[1], d: +m[2] }
  return null
}

const SEARCH_TEXT_FIELDS = ['sales_order_number', 'board_name', 'client_name']
const matchesSearch = (item: any, query: string): boolean => {
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
const loadTableFilter = (type: 'pcb' | 'cable'): TableFilter => {
  const def = defaultTableFilter(type)
  try {
    const raw = localStorage.getItem(`hansl_prod_filter_${type}`)
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
const restoreCategoryOrder = (): string[] => {
  try {
    const saved = localStorage.getItem('hansl_prod_filter_category_order')
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      const merged = parsed.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
      for (const c of DEFAULT_CATEGORY_ORDER) if (!merged.includes(c)) merged.push(c)
      return merged
    }
  } catch { /* fall through */ }
  return [...DEFAULT_CATEGORY_ORDER]
}

// 필터 저장 버튼 아이콘.
//  - 미저장: 기본 lucide Save(회색 아웃라인, 버튼 색 상속)
//  - 저장됨: 몸통·바깥 테두리는 진파랑(#1777CB), 안쪽 디테일 선만 흰색 (lucide는 선 색이 하나뿐이라 커스텀 SVG로 분리)
function FilterSaveIcon({ saved }: { saved: boolean }) {
  if (!saved) return <Save className="w-3.5 h-3.5" />
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="#1777CB" stroke="#1777CB" strokeWidth="2" strokeLinejoin="round" />
      <polyline points="17 21 17 13 7 13 7 21" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 3 7 8 15 8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Date utilities for formatting text inputs (e.g. 7/6 -> 07월 06일)
const formatDbDateToDisplay = (dbDate: string | null | undefined): string => {
  if (!dbDate || dbDate.trim() === '' || dbDate === '-') return '-월 -일';
  const match = dbDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}월 ${match[3]}일`;
  }
  return dbDate;
};

const formatDisplayDateToDb = (displayDate: string | null | undefined): string | null => {
  if (!displayDate || displayDate.trim() === '' || displayDate === '-') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
    return displayDate;
  }
  const match = displayDate.match(/(\d+)월\s*(\d+)일/);
  if (match) {
    const year = new Date().getFullYear();
    const mm = match[1].padStart(2, '0');
    const dd = match[2].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  const numbers = displayDate.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    const year = new Date().getFullYear();
    const mm = numbers[0].padStart(2, '0');
    const dd = numbers[1].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  return null;
};

const parseAndFormatInputDate = (val: string, defaultMonth?: number | null): string => {
  if (!val) return '';
  const clean = val.trim();
  if (!clean) return '';
  if (clean.includes('월') && clean.includes('일')) {
    // 'YYYY년 MM월 DD일'처럼 연도가 있으면 연도를 보존하여 ISO로 승격
    const ky = clean.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (ky) return `${ky[1]}-${ky[2].padStart(2, '0')}-${ky[3].padStart(2, '0')}`;
    return clean;
  }
  const numbers = clean.match(/\d+/g);
  if (!numbers || numbers.length === 0) return val;

  // 입력에 4자리 연도가 있으면 그 연도를 보존하여 ISO(YYYY-MM-DD)로 반환.
  // (formatDisplayDateToDb가 ISO 형식은 그대로 통과시키므로 연도가 유지된다)
  if (numbers.length >= 3 && numbers[0].length === 4) {
    const yStr = numbers[0];
    const mm = String(Math.min(12, Math.max(1, parseInt(numbers[1], 10)))).padStart(2, '0');
    const dd = String(Math.min(31, Math.max(1, parseInt(numbers[2], 10)))).padStart(2, '0');
    return `${yStr}-${mm}-${dd}`;
  }

  let month = defaultMonth || (new Date().getMonth() + 1);
  let day = 1;

  if (numbers.length >= 2) {
    month = parseInt(numbers[0], 10);
    day = parseInt(numbers[1], 10);
  } else if (numbers.length === 1) {
    day = parseInt(numbers[0], 10);
  }

  const mStr = String(Math.min(12, Math.max(1, month))).padStart(2, '0');
  const dStr = String(Math.min(31, Math.max(1, day))).padStart(2, '0');
  return `${mStr}월 ${dStr}일`;
};

// ASS'Y(환화/에버텍)처럼 '날짜 또는 메모' 하이브리드 칼럼용 유틸.
// 입력 '전체'가 날짜 토큰일 때만 날짜로 인식하고, 그 외(숫자가 섞인 메모 포함)는 메모 원문으로 취급한다.
const isDateLikeInput = (raw: string | null | undefined): boolean => {
  const s = (raw || '').trim();
  if (!s) return false;
  // 2026-07-06 / 2026.7.6 / 2026/07/06
  if (/^\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}$/.test(s)) return true;
  // 7/6 / 12-26 / 7.6
  if (/^\d{1,2}\s*[.\-/]\s*\d{1,2}$/.test(s)) return true;
  // 7월 6일 / 2026년 7월 6일 / 7월6일
  if (/^(\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일$/.test(s)) return true;
  return false;
};

// 하이브리드 칼럼 저장값 계산: 날짜 토큰이면 YYYY-MM-DD, 아니면 메모 원문, 빈값이면 null
const toDateOrMemo = (val: string, defaultMonth?: number | null): string | null => {
  if (!val || val.trim() === '') return null;
  if (isDateLikeInput(val)) {
    const db = formatDisplayDateToDb(parseAndFormatInputDate(val, defaultMonth));
    if (db) return db;
  }
  return val;
};

// 하이브리드 칼럼 표시값: YYYY-MM-DD -> 'MM월 DD일', 그 외는 메모 원문, 빈값은 '-'
const formatDateOrMemo = (value: string | null | undefined): string => {
  if (!value || value.trim() === '' || value === '-') return '-';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[2]}월 ${m[3]}일`;
  return value;
};

// 완제품 입고 표시 정규화: 경로별로 섞인 값을 'MM월 DD일'로 통일해 보여준다.
// - ISO(YYYY-MM-DD) → 'MM월 DD일' (엑셀 임포트분)
// - 'MM월 DD일 입고' → 'MM월 DD일' (버튼 스탬프 구형: '입고' 제거)
// - 그 외(완료/납품/분할입고 메모 등)는 의미가 있어 원문 유지
const formatStockInDisplay = (value: string | null | undefined): string => {
  if (!value) return '-';
  const s = String(value).trim();
  if (!s || s === '-') return '-';
  // ISO(YYYY-MM-DD) → MM월 DD일 (엑셀 임포트분)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}월 ${iso[3]}일`;
  // 'MM월 DD일' + 선택적 상태어(입고/완료/납품) → MM월 DD일
  const md = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(?:입고|완료|납품))?$/);
  if (md) return `${md[1].padStart(2, '0')}월 ${md[2].padStart(2, '0')}일`;
  // 'M/D' 또는 'M/D 입고' → MM월 DD일
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\s*입고)?$/);
  if (slash) return `${slash[1].padStart(2, '0')}월 ${slash[2].padStart(2, '0')}일`;
  // 그 외(분할입고 수량/재고/회수 메모, 오타 등)는 의미가 있어 원문 유지
  return s;
};

// 입고완료(PCB 제작) / 배송완료(납품) 표시 정규화: 완제품입고와 달리 'M/D 완료' 형식(0채움 없음)으로 통일
// - ISO(YYYY-MM-DD) → 'M/D 완료'
// - 'MM월 DD일'/'M/D' + 선택적 상태어 → 'M/D 완료'
// - 그 외 메모 원문은 의미가 있어 유지
const formatCompletedDisplay = (value: string | null | undefined): string => {
  if (!value) return '-';
  const s = String(value).trim();
  if (!s || s === '-') return '-';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])} 완료`;
  const md = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(?:입고|완료|납품|배송))?$/);
  if (md) return `${Number(md[1])}/${Number(md[2])} 완료`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\s*(?:입고|완료|배송))?$/);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])} 완료`;
  return s;
};

// 입고/배송 대기 버튼 문구·팝오버 라벨: 완제품입고류는 '입고', 배송완료는 '배송'으로 구분
const STOCK_WAITING_LABEL: Record<string, string> = {
  final_product_stock: '입고대기',
  cable_actual_date: '입고대기',
  pcb_stock_completed: '입고대기',
  delivery_completed: '배송대기',
}
const stockPickerLabel = (field: string): string => field === 'delivery_completed' ? '배송일' : '입고일'

// ─── 셀 내 URL → '링크' 하이퍼링크 표시 ─────────────────────────────
// 셀 값에 웹사이트 주소가 들어 있으면 긴 URL 대신 '링크' 텍스트로 축약해 새 탭으로 연결한다.
// 편집 모드에서는 원본 URL이 그대로 보이므로 수정에는 지장 없음.
const URL_IN_TEXT_REGEX = /(https?:\/\/[^\s]+)/g

// 칼럼 폭 실측용: URL을 표시 텍스트('링크')와 동일하게 치환한 문자열
const collapseUrlsForMeasure = (s: string): string => s.replace(URL_IN_TEXT_REGEX, '링크')

const renderCellValueWithLinks = (value: React.ReactNode, onLinkClick?: () => void): React.ReactNode => {
  if (typeof value !== 'string' || !/https?:\/\//.test(value)) return value
  const parts = value.split(URL_IN_TEXT_REGEX)
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        // 편집 진입은 막되(전파 차단), 새 탭으로 열리면서 셀 선택은 되도록 콜백 호출
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onLinkClick?.() }}
        className="text-blue-600 underline hover:text-blue-800"
        title={part}
      >
        링크
      </a>
    ) : (
      part
    )
  )
}

// ─── 셀 팝오버를 브라우저 최상위 레이어로 ─────────────────────────────
// 셀 편집/입고일/색상 팝오버가 테이블 스크롤 박스(overflow)에 잘려 아래쪽 행에서는
// 스크롤해야 보이던 문제 해결: body 포털 + fixed로 테이블 박스 위에 겹쳐 띄운다.
// 기본은 셀 아래에 붙고, 화면 아래 공간이 부족하면 셀 위로 뒤집는다(prefer='above'는 그 반대).
// 숨김 span을 td 안에 남겨 앵커(td) 위치를 추적하고, 표 스크롤/리사이즈/내용 변화에 따라 재배치한다.
function CellPopoverPortal({ prefer = 'below', innerRef, className, style, children, ...rest }: {
  prefer?: 'below' | 'above'
  innerRef?: React.MutableRefObject<HTMLDivElement | null>
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'>) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  React.useLayoutEffect(() => {
    const update = () => {
      const td = anchorRef.current?.closest('td')
      const box = boxRef.current
      if (!td || !box) return
      const r = td.getBoundingClientRect()
      const bw = box.offsetWidth
      const bh = box.offsetHeight
      const left = Math.max(4, Math.min(r.left, window.innerWidth - bw - 8))
      const below = r.bottom + 2
      const above = r.top - bh - 2
      let top = prefer === 'above' ? above : below
      if (prefer === 'below' && below + bh > window.innerHeight - 4 && above >= 4) top = above
      if (prefer === 'above' && above < 4) top = below
      setPos(p => (p && Math.abs(p.top - top) < 1 && Math.abs(p.left - left) < 1 ? p : { top, left }))
    }
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (boxRef.current) ro?.observe(boxRef.current)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [prefer])
  return (
    <span ref={anchorRef} className="hidden">
      {createPortal(
        <div
          ref={(el) => { boxRef.current = el; if (innerRef) innerRef.current = el }}
          className={className}
          style={{ ...style, position: 'fixed', top: pos ? pos.top : -9999, left: pos ? pos.left : -9999, zIndex: 100 }}
          {...rest}
        >
          {children}
        </div>,
        document.body
      )}
    </span>
  )
}

// HANSL 담당자는 이름만 표시/저장한다. datalist 입력은 자유 텍스트라 "이종근사원"처럼
// 직함이 붙은 값이 타이핑될 수 있어, 저장 직전에 뒤에 붙은 직함을 제거한다.
const EMPLOYEE_TITLE_SUFFIX = /(사원|주임|대리|과장|차장|부장|이사|상무|전무|팀장|실장|본부장|소장|대표)$/
const stripEmployeeTitle = (name: string | null | undefined): string => {
  if (!name) return ''
  const trimmed = name.trim()
  const stripped = trimmed.replace(EMPLOYEE_TITLE_SUFFIX, '').trim()
  return stripped || trimmed
};

// ─────────────────────────────────────────────────────────────
// ARTWORK 상태(하이브리드): 상태 선택(진행중/업체 확인중/발주완료) + 메모
// 저장 포맷: `<status>|||<date>|||<memo>` (상태 없으면 메모 원문만 저장 → 하위호환)
//  - status: '' | 'progress' | 'checking' | 'ordered'
//  - date  : 'YYYY-MM-DD' (ordered일 때 발주완료 누른 당일, 한국시간 기준)
//  - memo  : 자유 메모
// ─────────────────────────────────────────────────────────────
const ARTWORK_STATUS_OPTIONS: { code: string; label: string }[] = [
  { code: 'progress', label: '진행중' },
  { code: 'checking', label: '업체 확인중' },
  { code: 'ordered', label: '발주완료' },
]

// 필터 전용 상태 선택지 — 셀 편집 드롭다운(위 3종)에 더해, 구엑셀 이관/직접 입력 텍스트를 아우른다.
//  - delivered: '전달 완료' 계열 텍스트 (셀 편집에는 없는 필터 전용 상태)
//  - text     : 상태 코드도 없고 상태 키워드에도 안 걸리는 순수 직접 입력(예: '한슬 완제품 재고')
const ARTWORK_FILTER_STATUS_OPTIONS: { code: string; label: string }[] = [
  ...ARTWORK_STATUS_OPTIONS,
  { code: 'delivered', label: '전달완료' },
  { code: 'text', label: '직접입력' },
]

type ArtworkParts = { status: string; date: string; memo: string }

// 필터 상태 판정 — 드롭다운으로 저장된 상태 코드 외에, 구엑셀 이관 텍스트(예: '4/29 PCB 발주 완료')도
// 키워드로 같은 상태로 취급한다. 키워드 매칭은 상태 코드가 없는(직접 입력) 값에만 적용해 메모 오탐을 막는다.
const ARTWORK_LEGACY_PATTERNS: Record<string, RegExp> = {
  progress: /(작업|진행)\s*중/,
  checking: /확인\s*중/,
  ordered: /발주\s*완료/,
  delivered: /전달\s*완료/,
}
const artworkStatusMatches = (aw: ArtworkParts, code: string | undefined): boolean => {
  const legacy = aw.status ? '' : aw.memo
  if (code === 'text') return !aw.status && aw.memo.trim() !== '' && !Object.values(ARTWORK_LEGACY_PATTERNS).some(re => re.test(aw.memo))
  if (!code) return false
  return aw.status === code || (ARTWORK_LEGACY_PATTERNS[code]?.test(legacy) ?? false)
}

// 한국시간(KST) 기준 오늘 날짜 'YYYY-MM-DD'
const getKstTodayISO = (): string => {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const d = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 납품기한 경고: 한국시간 기준 기한 하루 전(D-1)이 되는 날부터 true (기한 당일·경과 포함)
// 값이 ISO 날짜(YYYY-MM-DD)가 아닌 메모 텍스트면 판정하지 않는다.
const isDeadlineUrgent = (value: string | null | undefined): boolean => {
  if (!value) return false
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() - 1)
  const dMinus1 = d.toISOString().slice(0, 10)
  return getKstTodayISO() >= dMinus1
}

// 'YYYY-MM-DD' -> 'MM월DD일'
const formatKoreanMMDD = (iso: string): string => {
  const p = iso.split('-')
  if (p.length < 3) return iso
  return `${p[1]}월${p[2]}일`
}

const parseArtworkStatus = (raw: string | null | undefined): ArtworkParts => {
  if (!raw) return { status: '', date: '', memo: '' }
  if (raw.includes('|||')) {
    const parts = raw.split('|||')
    return { status: parts[0] || '', date: parts[1] || '', memo: parts.slice(2).join('|||') }
  }
  // 하위호환: 구분자가 없으면 전체를 메모로 간주
  return { status: '', date: '', memo: raw }
}

const serializeArtworkStatus = (p: ArtworkParts): string => {
  if (!p.status && !p.memo) return ''
  if (!p.status) return p.memo // 메모만 있을 때는 원문 저장(하위호환)
  return `${p.status}|||${p.date || ''}|||${p.memo || ''}`
}

// 셀 표시용 문자열 (예: '07월06일 발주완료 │ 추가 메모')
const formatArtworkDisplay = (raw: string | null | undefined): string => {
  const { status, date, memo } = parseArtworkStatus(raw)
  let label = ''
  if (status === 'progress') label = '진행중'
  else if (status === 'checking') label = '업체 확인중'
  else if (status === 'ordered') label = `${date ? formatKoreanMMDD(date) + ' ' : ''}발주완료`
  if (label && memo) return `${label} │ ${memo}`
  if (label) return label
  return memo || ''
}

// 행 추가(입력행) 텍스트 입력 — 칼럼이 좁으면(자기 폭이 6자≈66px 이하) 또는 메모형이면
// 포커스 시 셀 아래에 넉넉한 말풍선(팝오버) 입력창을 띄워 적은 내용을 보면서 타이핑할 수 있게 한다.
function AddPopoverInput({
  value, onChange, placeholder, className, memo = false, listId, inputType = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className: string
  memo?: boolean
  listId?: string
  inputType?: 'text' | 'number'
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  // 고정(sticky) 칼럼 안에서 열리면 옆 칼럼에 가려지므로, 팝오버는 화면 기준 fixed로 띄운다.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const decideOpen = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    if (!(memo || r.width < 66)) { setPos(null); return } // 6자(≈66px) 이하 좁은 칼럼/메모형만
    const W = memo ? 316 : 236
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
    setPos({ top: r.bottom + 2, left })
  }
  return (
    <div className="relative" ref={wrapRef}>
      <input
        type={inputType}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={decideOpen}
        placeholder={placeholder}
        className={className}
      />
      {open && pos && (
        <div
          className="fixed z-[9999] bg-white border border-gray-300 rounded-md shadow-lg p-1.5"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {placeholder && <div className="text-[9px] font-semibold text-gray-400 mb-1 px-0.5">{placeholder}</div>}
          {memo ? (
            <textarea
              autoFocus
              rows={3}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setPos(null)}
              onKeyDown={(e) => { if (e.key === 'Escape') setPos(null) }}
              placeholder={`${placeholder ?? ''} (줄바꿈 가능)`}
              className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-[11px] leading-snug focus:outline-none focus:border-[#1777CB] resize-y"
              style={{ width: '300px' }}
            />
          ) : (
            <input
              autoFocus
              type={inputType}
              list={listId}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setPos(null)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setPos(null) }}
              placeholder={placeholder}
              className="w-full h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:border-[#1777CB]"
              style={{ width: '220px' }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// 행 추가(입력행) 전용 ARTWORK 콤보 입력: 기본은 메모 입력창 하나 —
// 수동으로 타이핑하거나, 창 클릭 시 아래에 뜨는 드롭다운에서 상태(진행중/업체 확인중/발주완료)를 선택.
// '발주완료' 선택 시 오늘(KST) 날짜 자동 기록, 같은 항목 재선택 시 해제.
function ArtworkAddInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = parseArtworkStatus(value)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 고정 칼럼 밑으로 스크롤돼도 안 가려지게 드롭다운은 화면 기준 fixed로 띄운다.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 180))
    setPos({ top: r.bottom + 2, left })
  }
  const statusLabel =
    parts.status === 'progress' ? '진행중'
    : parts.status === 'checking' ? '업체 확인중'
    : parts.status === 'ordered' ? `${parts.date ? formatKoreanMMDD(parts.date) + ' ' : ''}발주완료`
    : ''
  const pick = (code: string) => {
    if (parts.status === code) {
      onChange(serializeArtworkStatus({ ...parts, status: '', date: '' }))
    } else {
      onChange(serializeArtworkStatus({ status: code, date: code === 'ordered' ? getKstTodayISO() : '', memo: parts.memo }))
    }
    setPos(null)
  }
  return (
    <div className="relative" ref={wrapRef}>
      {/* 셀 아무 데나 클릭하면 드롭다운이 열린다 (화살표 없음) */}
      <div
        className="flex items-center gap-1 w-full bg-white border border-gray-300 rounded px-1 cursor-pointer"
        onClick={openMenu}
      >
        {statusLabel && (
          <span className="shrink-0 text-[9px] text-blue-600 font-semibold whitespace-nowrap">{statusLabel} │</span>
        )}
        <input
          type="text"
          value={parts.memo}
          onChange={(e) => onChange(serializeArtworkStatus({ ...parts, memo: e.target.value }))}
          onFocus={openMenu}
          placeholder="ARTWORK 메모"
          className="w-full bg-transparent text-[10px] focus:outline-none"
          style={{ border: 'none', boxShadow: 'none', outline: 'none' }}
        />
      </div>
      {open && pos && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setPos(null)} />
          <div
            className="fixed z-[9999] bg-white border border-gray-200 rounded-md shadow-lg py-0.5 w-max min-w-[150px] flex flex-col"
            style={{ top: pos.top, left: pos.left }}
          >
            {([['progress', '진행중'], ['checking', '업체 확인중'], ['ordered', '발주완료 (오늘 날짜 기록)']] as const).map(([code, label]) => (
              <button
                key={code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(code)}
                className={`block w-full text-left whitespace-nowrap px-2 py-1 text-[11px] hover:bg-gray-50 transition-colors ${parts.status === code ? 'text-[#1777CB] font-bold' : 'text-gray-700'}`}
              >
                {parts.status === code ? '✓ ' : ''}{label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// 상태 선택 칩 + 구분선 + 메모 입력을 함께 제공하는 재사용 에디터
function ArtworkStatusEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocusMemo = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  onCancel?: () => void
  autoFocusMemo?: boolean
}) {
  const parts = parseArtworkStatus(value)
  const pickStatus = (code: string) => {
    if (parts.status === code) {
      // 같은 상태 재클릭 → 해제 (메모만 남기기)
      onChange(serializeArtworkStatus({ ...parts, status: '', date: '' }))
    } else if (code === 'ordered') {
      onChange(serializeArtworkStatus({ ...parts, status: 'ordered', date: getKstTodayISO() }))
    } else {
      onChange(serializeArtworkStatus({ ...parts, status: code, date: '' }))
    }
  }
  const setMemo = (m: string) => onChange(serializeArtworkStatus({ ...parts, memo: m }))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5">
        {ARTWORK_STATUS_OPTIONS.map(({ code, label }) => {
          const active = parts.status === code
          return (
            <button
              key={code}
              type="button"
              // onMouseDown + preventDefault: 메모 인풋의 포커스를 뺏지 않아 blur 저장이 오작동하지 않도록 함
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                pickStatus(code)
              }}
              className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border text-left transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {label}
              {code === 'ordered' && active && parts.date ? ` (${formatKoreanMMDD(parts.date)})` : ''}
            </button>
          )
        })}
      </div>
      {/* 구분선 */}
      <div className="border-t border-gray-200" />
      <input
        type="text"
        autoFocus={autoFocusMemo}
        value={parts.memo}
        onChange={(e) => setMemo(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit?.()
          if (e.key === 'Escape') onCancel?.()
        }}
        onBlur={() => onCommit?.()}
        placeholder="메모"
        className="w-full h-5 bg-white border border-gray-300 rounded px-1 text-[10px] focus:outline-none"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 부품정리(parts_organization) 상태 처리 — ARTWORK와 동일한 방식이나
// 상태는 '진행중 / 완료' 두 가지, 날짜는 기록하지 않는다.
// 저장 포맷: 'status|||memo' (구분자 없으면 전체를 메모로 간주)
//  - status: '' | 'progress' | 'done'
//  - memo  : 자유 메모
// ─────────────────────────────────────────────────────────────
const PARTS_STATUS_OPTIONS: { code: string; label: string }[] = [
  { code: 'progress', label: '진행중' },
  { code: 'done', label: '완료' },
]

// 필터 전용 상태 선택지 — ARTWORK와 동일하게 직접 입력 텍스트('홀딩' 등)를 잡는 항목을 더한다
const PARTS_FILTER_STATUS_OPTIONS: { code: string; label: string }[] = [
  ...PARTS_STATUS_OPTIONS,
  { code: 'text', label: '직접입력' },
]

type PartsParts = { status: string; memo: string }

// 필터 상태 판정 — 상태 코드 외에 구엑셀 이관 텍스트('완료'/'진행중')도 같은 상태로 취급 (ARTWORK와 동일 원칙)
const PARTS_LEGACY_PATTERNS: Record<string, RegExp> = {
  progress: /진행\s*중/,
  done: /완료/,
}
const partsStatusMatches = (p: PartsParts, code: string | undefined): boolean => {
  const legacy = p.status ? '' : p.memo
  if (code === 'text') return !p.status && p.memo.trim() !== '' && !Object.values(PARTS_LEGACY_PATTERNS).some(re => re.test(p.memo))
  if (!code) return false
  return p.status === code || (PARTS_LEGACY_PATTERNS[code]?.test(legacy) ?? false)
}

// 필터 status_is 드롭다운에 쓸 선택지 (칼럼별)
const filterStatusOptionsFor = (field: string) =>
  field === PARTS_FIELD ? PARTS_FILTER_STATUS_OPTIONS : ARTWORK_FILTER_STATUS_OPTIONS

const parsePartsStatus = (raw: string | null | undefined): PartsParts => {
  if (!raw) return { status: '', memo: '' }
  if (raw.includes('|||')) {
    const parts = raw.split('|||')
    return { status: parts[0] || '', memo: parts.slice(1).join('|||') }
  }
  // 하위호환: 구분자가 없으면 전체를 메모로 간주
  return { status: '', memo: raw }
}

const serializePartsStatus = (p: PartsParts): string => {
  if (!p.status && !p.memo) return ''
  if (!p.status) return p.memo // 메모만 있을 때는 원문 저장(하위호환)
  return `${p.status}|||${p.memo || ''}`
}

// 셀 표시용 문자열 (예: '완료 │ 추가 메모')
const formatPartsDisplay = (raw: string | null | undefined): string => {
  const { status, memo } = parsePartsStatus(raw)
  let label = ''
  if (status === 'progress') label = '진행중'
  else if (status === 'done') label = '완료'
  if (label && memo) return `${label} │ ${memo}`
  if (label) return label
  return memo || ''
}

// 행 추가(입력행) 전용 부품정리 콤보 입력: 메모 입력창 + 클릭 시 상태 드롭다운(진행중/완료)
function PartsAddInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = parsePartsStatus(value)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 180))
    setPos({ top: r.bottom + 2, left })
  }
  const statusLabel =
    parts.status === 'progress' ? '진행중'
    : parts.status === 'done' ? '완료'
    : ''
  const pick = (code: string) => {
    if (parts.status === code) {
      onChange(serializePartsStatus({ ...parts, status: '' }))
    } else {
      onChange(serializePartsStatus({ status: code, memo: parts.memo }))
    }
    setPos(null)
  }
  return (
    <div className="relative" ref={wrapRef}>
      <div
        className="flex items-center gap-1 w-full bg-white border border-gray-300 rounded px-1 cursor-pointer"
        onClick={openMenu}
      >
        {statusLabel && (
          <span className="shrink-0 text-[9px] text-blue-600 font-semibold whitespace-nowrap">{statusLabel} │</span>
        )}
        <input
          type="text"
          value={parts.memo}
          onChange={(e) => onChange(serializePartsStatus({ ...parts, memo: e.target.value }))}
          onFocus={openMenu}
          placeholder="부품정리 메모"
          className="w-full bg-transparent text-[10px] focus:outline-none"
          style={{ border: 'none', boxShadow: 'none', outline: 'none' }}
        />
      </div>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setPos(null)} />
          <div
            className="fixed z-[9999] bg-white border border-gray-200 rounded-md shadow-lg py-0.5 w-max min-w-[150px] flex flex-col"
            style={{ top: pos.top, left: pos.left }}
          >
            {PARTS_STATUS_OPTIONS.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(code)}
                className={`block w-full text-left whitespace-nowrap px-2 py-1 text-[11px] hover:bg-gray-50 transition-colors ${parts.status === code ? 'text-[#1777CB] font-bold' : 'text-gray-700'}`}
              >
                {parts.status === code ? '✓ ' : ''}{label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// 상태 선택 칩(진행중/완료) + 구분선 + 메모 입력을 함께 제공하는 재사용 에디터
function PartsStatusEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocusMemo = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  onCancel?: () => void
  autoFocusMemo?: boolean
}) {
  const parts = parsePartsStatus(value)
  const pickStatus = (code: string) => {
    if (parts.status === code) {
      onChange(serializePartsStatus({ ...parts, status: '' }))
    } else {
      onChange(serializePartsStatus({ ...parts, status: code }))
    }
  }
  const setMemo = (m: string) => onChange(serializePartsStatus({ ...parts, memo: m }))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5">
        {PARTS_STATUS_OPTIONS.map(({ code, label }) => {
          const active = parts.status === code
          return (
            <button
              key={code}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                pickStatus(code)
              }}
              className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border text-left transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="border-t border-gray-200" />
      <input
        type="text"
        autoFocus={autoFocusMemo}
        value={parts.memo}
        onChange={(e) => setMemo(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit?.()
          if (e.key === 'Escape') onCancel?.()
        }}
        onBlur={() => onCommit?.()}
        placeholder="메모"
        className="w-full h-5 bg-white border border-gray-300 rounded px-1 text-[10px] focus:outline-none"
      />
    </div>
  )
}

// ─── 엑셀식 복사/붙여넣기 TSV 유틸 ─────────────────────────────────
// 엑셀이 클립보드에 쓰는 형식과 동일: 셀은 탭, 행은 줄바꿈으로 구분.
// 탭/줄바꿈/따옴표가 든 값은 "..."로 감싼다 (엑셀 규칙 그대로).
const toTsvCell = (v: any): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// 엑셀 호환 TSV 파서: "..." 안의 줄바꿈/탭은 셀 내용으로 취급
const parseTsvGrid = (text: string): string[][] => {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === '\t') {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  row.push(cell); rows.push(row)
  // 엑셀 복사분은 끝에 개행이 붙어 빈 행이 생기므로 제거
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop()
  return rows
}

// ─── 행 렌더 격리 유틸 ──────────────────────────────────────────────
// 항상 같은 함수 객체를 유지하면서 내부는 "최신 렌더"의 로직을 실행한다.
// MemoRow가 렌더를 스킵한 행의 이벤트 핸들러(이전 렌더의 element에 붙어 있음)가
// 오래된 상태(stale closure)를 읽는 것을 방지하는 장치.
function useStableHandler<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  const stableRef = useRef(((...args: any[]) => ref.current(...args)) as T)
  return stableRef.current
}

// 행 렌더 격리: 자신의 데이터(item)나 자신과 관련된 UI 상태 요약(sig), 칼럼폭(widths)이
// 바뀔 때만 다시 그린다. renderRow 함수 프롭은 비교에서 의도적으로 무시 — 행 내부의
// 커스텀 이벤트 핸들러가 모두 useStableHandler로 안정화되어 있어 안전하다.
type MemoRowProps = {
  item: any
  index: number
  sig: string
  widths: Record<string, number>
  renderRow: (item: any, index: number) => React.ReactElement
}
const MemoRow = React.memo(
  ({ item, index, renderRow }: MemoRowProps) => renderRow(item, index),
  (a, b) => a.item === b.item && a.index === b.index && a.sig === b.sig && a.widths === b.widths
)
MemoRow.displayName = 'MemoRow'

// ─── 앵커 고정 포털 팝오버 ─────────────────────────────────────────────
// 셀/버튼에 붙는 팝오버를 document.body로 포털해 테이블·카드의 overflow에 잘리지 않게 띄운다.
// anchorEl 바로 아래에 fixed로 배치하고, 화면 우/하단을 벗어나면 안쪽(위쪽)으로 보정한다.
// 스크롤·리사이즈 시 앵커를 따라 재배치. (React 이벤트는 포털을 넘어 부모로 버블되므로 기존 stopPropagation 동작 유지)
function AnchoredPortal({ anchorEl, children, align = 'left', gap = 2, zIndex = 9999 }: {
  anchorEl: HTMLElement | null
  children: React.ReactNode
  align?: 'left' | 'right'
  gap?: number
  zIndex?: number
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchorEl) return
    const place = () => {
      const a = anchorEl.getBoundingClientRect()
      const w = boxRef.current?.offsetWidth ?? 0
      const h = boxRef.current?.offsetHeight ?? 0
      let left = align === 'right' ? a.right - w : a.left
      let top = a.bottom + gap
      if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w
      if (left < 8) left = 8
      // 아래 공간이 부족하면 앵커 위로 뒤집기 (위도 부족하면 화면 안으로 클램프)
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - gap - h)
      setPos({ left, top })
    }
    place()
    // 내용 크기가 렌더 후 확정되거나 이후 변하는 팝오버(가변 폭 메모, 정렬 규칙 추가 등)를 따라 재배치
    const raf = requestAnimationFrame(place)
    const ro = boxRef.current ? new ResizeObserver(place) : null
    if (boxRef.current) ro?.observe(boxRef.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorEl, align, gap])
  if (!anchorEl) return null
  return createPortal(
    <div ref={boxRef} style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex }}>
      {children}
    </div>,
    document.body
  )
}

export default function ProductionListMain() {
  const [pcbs, setPcbs] = useState<ProductionPcb[]>([])
  const [cables, setCables] = useState<ProductionCable[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [addingPcbRow, setAddingPcbRow] = useState<Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'> | null>(null)
  const [addingCableRow, setAddingCableRow] = useState<Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'> | null>(null)

  // 필터 및 검색 상태 — PCB/Cable 테이블별 독립 필터 (저장된 필터가 있으면 처음부터 반영)
  // 검색어도 필터·정렬·칼럼 설정과 마찬가지로 테이블별 독립 (PCB표 검색은 PCB표에만 적용)
  const [pcbSearch, setPcbSearch] = useState('')
  const [cableSearch, setCableSearch] = useState('')
  const [pcbFilter, setPcbFilter] = useState<TableFilter>(() => loadTableFilter('pcb'))
  const [cableFilter, setCableFilter] = useState<TableFilter>(() => loadTableFilter('cable'))

  // 필터 "저장됨" 상태 — 조건(규칙) 필터와 제작구분 필터는 서로 독립적으로 저장/초기화된다.
  // 표(pcb/cable) × 섹션(rules/cats)별로 저장 이력(hasSaved)과 변경 여부(dirty)를 따로 추적한다.
  // 저장됨 = 저장 이력 있음 && 저장 이후 그 섹션을 건드리지 않음.
  type FilterSectionFlags = { pcb: { rules: boolean; cats: boolean }; cable: { rules: boolean; cats: boolean } }
  const [filterHasSaved, setFilterHasSaved] = useState<FilterSectionFlags>(() => {
    // 파랑(저장됨) = 기본값과 "다른" 내용이 저장돼 있을 때만. 키가 있어도 내용이 기본값이면 흰색.
    const calc = (type: 'pcb' | 'cable') => {
      if (localStorage.getItem(`hansl_prod_filter_${type}`) === null) return { rules: false, cats: false }
      const f = loadTableFilter(type)
      const orderCustom = !categoryOrderIsDefault(restoreCategoryOrder())
      return {
        rules: !rulesEqualDefault(type, f.rules),
        cats: !catsEqualDefault(type, f.categories) || orderCustom,
      }
    }
    return { pcb: calc('pcb'), cable: calc('cable') }
  })
  const [filterDirty, setFilterDirty] = useState<FilterSectionFlags>(() => ({
    pcb: { rules: false, cats: false }, cable: { rules: false, cats: false },
  }))
  const markFilterDirty = (type: 'pcb' | 'cable', section: 'rules' | 'cats') =>
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], [section]: true } }))

  const filterFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbFilter : cableFilter)
  const setFilterFor = (type: 'pcb' | 'cable', patch: Partial<TableFilter>) => {
    if (type === 'pcb') setPcbFilter(prev => ({ ...prev, ...patch }))
    else setCableFilter(prev => ({ ...prev, ...patch }))
    // 패치 내용에 따라 해당 섹션만 dirty 처리 (규칙 vs 제작구분)
    if ('rules' in patch) markFilterDirty(type, 'rules')
    if ('categories' in patch) markFilterDirty(type, 'cats')
  }

  // ─── 저장 필터(사용자별·DB 동기화) ───────────────────────────────────
  // user_ui_settings에 저장된 "이름 붙인 필터 목록"과 "표별 시작 기본값"을 관리한다.
  // 로컬스토리지 초기화로 즉시 렌더한 뒤, DB 설정이 로드되면 기본값을 한 번 적용해 장치 간 동기화한다.
  const { config: filterViewsConfig, loaded: filterViewsLoaded, saveView, deleteView, renameView, setDefault } = useProductionFilterViews()
  const defaultsAppliedRef = useRef(false)
  const [viewsMenuFor, setViewsMenuFor] = useState<'pcb' | 'cable' | null>(null)
  const [viewsAnchor, setViewsAnchor] = useState<HTMLElement | null>(null)
  // 저장 필터 이름 인라인 입력 모드 — window.prompt 대신 드롭다운 안 입력창으로 이름을 정한다
  const [namingViewFor, setNamingViewFor] = useState<'pcb' | 'cable' | null>(null)
  const [newViewName, setNewViewName] = useState('')

  // 표별 스냅샷(현재 조건+제작구분+그룹순서)을 만든다 — 저장 필터/기본값 공통 payload
  const snapshotFilter = (type: 'pcb' | 'cable'): FilterDefaultSnapshot => {
    const cur = filterFor(type)
    return { rules: toStoredRules(cur.rules), categories: [...cur.categories], categoryOrder: [...categoryOrder] }
  }

  // 스냅샷을 화면/로컬스토리지에 적용한다 (저장 필터 불러오기·기본값 적용 공통 경로)
  const applySnapshot = (type: 'pcb' | 'cable', snap: FilterDefaultSnapshot) => {
    const rules = fromStoredRules(snap.rules)
    const validCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
    const categories = Array.isArray(snap.categories) ? snap.categories.filter(c => validCats.includes(c)) : validCats
    setFilterFor(type, { rules, categories })
    if (Array.isArray(snap.categoryOrder) && snap.categoryOrder.length) {
      const merged = snap.categoryOrder.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
      for (const c of DEFAULT_CATEGORY_ORDER) if (!merged.includes(c)) merged.push(c)
      setCategoryOrder(merged)
      try { localStorage.setItem('hansl_prod_filter_category_order', JSON.stringify(merged)) } catch { /* ignore */ }
    }
    // 로컬스토리지에도 반영해 새로고침·아이콘 상태를 일관되게 유지
    try {
      localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({ categories, rules }))
    } catch { /* ignore quota */ }
  }

  // DB에 저장된 시작 기본값을 최초 1회 적용 (로컬 초기 렌더 이후 동기화)
  useEffect(() => {
    if (!filterViewsLoaded || defaultsAppliedRef.current) return
    defaultsAppliedRef.current = true
    ;(['pcb', 'cable'] as const).forEach(type => {
      const snap = filterViewsConfig.defaults[type]
      if (!snap) return
      applySnapshot(type, snap)
      // 지금 화면이 곧 '시작 기본값'(기준값)이므로 변경 안 함 + 저장됨(파랑) 표시 안 함
      // — 사용자가 정한 기본값 자체는 '저장 표시' 대상이 아니다
      setFilterHasSaved(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
    })
  }, [filterViewsLoaded, filterViewsConfig])

  // 현재 필터를 이름 붙여 저장 (무제한) — 인라인 입력창에서 확정된 이름으로 저장
  const commitSaveView = async (type: 'pcb' | 'cable') => {
    const name = newViewName.trim()
    if (!name) return
    const view = { id: `v${Date.now()}`, name, scope: type, ...snapshotFilter(type) }
    const ok = await saveView(view)
    toast[ok ? 'success' : 'error'](ok ? `필터 "${name}" 저장됨` : '필터 저장에 실패했습니다.')
    if (ok) {
      setNamingViewFor(null)
      setNewViewName('')
      setViewsMenuFor(null)
      setViewsAnchor(null)
    }
  }

  // 저장 필터 불러오기
  const handleApplyView = (viewId: string) => {
    const v = filterViewsConfig.views.find(x => x.id === viewId)
    if (!v) return
    applySnapshot(v.scope, { rules: v.rules, categories: v.categories, categoryOrder: v.categoryOrder })
    setViewsMenuFor(null)
    toast.success(`필터 "${v.name}" 적용됨`)
  }

  const handleDeleteView = async (viewId: string, name: string) => {
    const ok = await deleteView(viewId)
    toast[ok ? 'success' : 'error'](ok ? `필터 "${name}" 삭제됨` : '삭제에 실패했습니다.')
  }

  const handleRenameView = async (viewId: string, prevName: string) => {
    const name = window.prompt('필터 이름 변경', prevName)?.trim()
    if (!name || name === prevName) return
    const ok = await renameView(viewId, name)
    toast[ok ? 'success' : 'error'](ok ? '이름이 변경되었습니다.' : '이름 변경에 실패했습니다.')
  }

  // 현재 필터를 시작 기본값으로 저장 (다음 접속 시 이 필터로 시작 — 장치 간 동기화)
  const handleSetDefault = async (type: 'pcb' | 'cable') => {
    const ok = await setDefault(type, snapshotFilter(type))
    if (ok) {
      // 로컬스토리지 기본값도 갱신. 현재 필터가 곧 '기준값'이 됐으므로
      // 저장됨(파랑)·변경 표시 모두 끈다 — 기본값 자체는 '저장 표시' 대상이 아니다
      applySnapshot(type, snapshotFilter(type))
      setFilterHasSaved(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
    }
    toast[ok ? 'success' : 'error'](ok ? '현재 필터를 기본값으로 저장했습니다.' : '기본값 저장에 실패했습니다.')
  }

  const handleClearDefault = async (type: 'pcb' | 'cable') => {
    const ok = await setDefault(type, null)
    toast[ok ? 'info' : 'error'](ok ? '시작 기본값을 해제했습니다.' : '해제에 실패했습니다.')
  }

  // 정렬 상태 — PCB/Cable 독립. 저장된 정렬이 있으면 처음부터 반영하고, 변경 시 즉시 localStorage에 보존.
  const [pcbSort, setPcbSort] = useState<SortRule[]>(() => loadTableSort('pcb'))
  const [cableSort, setCableSort] = useState<SortRule[]>(() => loadTableSort('cable'))
  const [sortMenuFor, setSortMenuFor] = useState<'pcb' | 'cable' | null>(null)
  const sortFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbSort : cableSort)
  // 정렬 규칙 갱신 + 즉시 저장 (updater로 이전값 기반 안전 갱신)
  const commitSort = (type: 'pcb' | 'cable', updater: (prev: SortRule[]) => SortRule[]) => {
    const setter = type === 'pcb' ? setPcbSort : setCableSort
    setter(prev => {
      const next = updater(prev)
      try {
        localStorage.setItem(`hansl_prod_sort_${type}`, JSON.stringify(next.map(r => ({ field: r.field, dir: r.dir }))))
      } catch { /* ignore quota */ }
      return next
    })
  }
  const addSortRule = (type: 'pcb' | 'cable') => {
    const fields = type === 'pcb' ? PCB_SORT_FIELDS : CABLE_SORT_FIELDS
    commitSort(type, prev => {
      const used = new Set(prev.map(r => r.field))
      const field = fields.find(f => !used.has(f)) ?? fields[0]
      return [...prev, { id: newSortId(), field, dir: 'asc' }]
    })
  }
  const updateSortRule = (type: 'pcb' | 'cable', id: string, patch: Partial<SortRule>) =>
    commitSort(type, prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const removeSortRule = (type: 'pcb' | 'cable', id: string) =>
    commitSort(type, prev => prev.filter(r => r.id !== id))
  const clearSort = (type: 'pcb' | 'cable') => commitSort(type, () => [])

  // 필터 패널 접기/펴기 (좌측 사이드바처럼) — 기본값은 '닫힘', 사용자가 명시적으로 '0'(펼침) 저장 시에만 펼침
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => localStorage.getItem('hansl_prod_filter_collapsed') !== '0')
  // Cable 테이블 필터 자체 접기 (상단 패널과 독립)
  const [cableFilterCollapsed, setCableFilterCollapsed] = useState<boolean>(() => localStorage.getItem('hansl_prod_filter_collapsed_cable') !== '0')
  const toggleCableFilterCollapsed = () => setCableFilterCollapsed(prev => {
    const next = !prev
    localStorage.setItem('hansl_prod_filter_collapsed_cable', next ? '1' : '0')
    return next
  })
  const toggleFilterCollapsed = () => setFilterCollapsed(prev => {
    const next = !prev
    localStorage.setItem('hansl_prod_filter_collapsed', next ? '1' : '0')
    return next
  })

  // 테이블 뷰 모드 — 전체/PCB/Cable&Case 중 선택. 선택 시 localStorage에 저장해 재방문 시 복원.
  const [tableView, setTableView] = useState<'all' | 'pcb' | 'cable'>(() => {
    const saved = localStorage.getItem('hansl_prod_table_view')
    return saved === 'pcb' || saved === 'cable' || saved === 'all' ? saved : 'all'
  })
  const selectTableView = (v: 'all' | 'pcb' | 'cable') => {
    setTableView(v)
    localStorage.setItem('hansl_prod_table_view', v)
  }

  // 칼럼 숨기기 — 표별 숨긴 칼럼 목록. 토글 즉시 적용 + localStorage 저장.
  // 행 추가 중에는 입력행 셀이 칼럼 순서대로 하드코딩돼 있어(정렬 어긋남 방지 + 입력 누락 방지) 전 칼럼을 임시 표시한다.
  const [hiddenCols, setHiddenCols] = useState<Record<'pcb' | 'cable', string[]>>(() => ({
    pcb: loadHiddenCols('pcb'),
    cable: loadHiddenCols('cable'),
  }))
  const [columnMenuFor, setColumnMenuFor] = useState<'pcb' | 'cable' | null>(null)

  const isColHidden = (type: 'pcb' | 'cable', field: string): boolean => {
    if (type === 'pcb' ? addingPcbRow : addingCableRow) return false
    return hiddenCols[type].includes(field)
  }

  const toggleHiddenCol = (type: 'pcb' | 'cable', field: string) => {
    setHiddenCols(prev => {
      const cur = prev[type]
      const next = cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field]
      localStorage.setItem(`hansl_prod_hidden_cols_${type}`, JSON.stringify(next))
      return { ...prev, [type]: next }
    })
  }

  const resetHiddenCols = (type: 'pcb' | 'cable') => {
    setHiddenCols(prev => ({ ...prev, [type]: [] }))
    localStorage.setItem(`hansl_prod_hidden_cols_${type}`, JSON.stringify([]))
  }

  // 섹션(구분선 단위) 일괄 숨기기/표시
  const setSectionHidden = (type: 'pcb' | 'cable', fields: string[], hide: boolean) => {
    setHiddenCols(prev => {
      const cur = prev[type]
      const next = hide
        ? [...new Set([...cur, ...fields])]
        : cur.filter(f => !fields.includes(f))
      localStorage.setItem(`hansl_prod_hidden_cols_${type}`, JSON.stringify(next))
      return { ...prev, [type]: next }
    })
  }

  // 그룹 헤더 colSpan: 그룹 내 표시 중인 칼럼 수 (0이면 그룹 헤더를 렌더하지 않음)
  const visibleSpan = (type: 'pcb' | 'cable', fields: string[]): number =>
    fields.filter(f => !isColHidden(type, f)).length

  // 제작구분 그룹 순서 — 저장된 순서가 있으면 반영하고, 누락된 기본 카테고리는 뒤에 보강
  const [categoryOrder, setCategoryOrder] = useState<string[]>(restoreCategoryOrder)

  // 드래그 중인 칩 (ref: 드롭 핸들러의 최신값 보장 / state: 시각 표시용)
  const dragCatRef = useRef<string | null>(null)
  const [dragCat, setDragCat] = useState<string | null>(null)
  // 삽입 지점 (0 = 맨 앞, N = 맨 뒤) + 어느 테이블 툴바인지. 칩 사이에 세로 표시선으로 보여줌
  const [dropIndex, setDropIndex] = useState<{ type: 'pcb' | 'cable'; index: number } | null>(null)
  // 툴바가 PCB/Cable 두 벌이라 칩 컨테이너 ref도 테이블별로 관리
  const pcbChipContainerRef = useRef<HTMLDivElement>(null)
  const cableChipContainerRef = useRef<HTMLDivElement>(null)
  const chipRefFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbChipContainerRef : cableChipContainerRef)

  // 커서 X좌표 기준으로 "칩과 칩 사이" 어느 지점에 꽂힐지 인덱스 계산 (빈 간격에 놔도 인식됨)
  const computeDropIndex = (type: 'pcb' | 'cable', clientX: number): number => {
    const container = chipRefFor(type).current
    if (!container) return 0
    const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-cat]'))
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return chips.length
  }

  // 드래그한 칩을 계산된 삽입 지점으로 이동 (제거로 인한 인덱스 밀림 보정)
  // index는 "해당 테이블 칩 목록 내" 인덱스 — 전역 categoryOrder에서 그 테이블 슬롯만 새 순서로 치환
  const dropCategoryAt = (type: 'pcb' | 'cable', index: number) => {
    const from = dragCatRef.current
    if (!from) return
    setCategoryOrder(prev => {
      const cats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
      const sub = prev.filter(c => cats.includes(c))
      const fromIdx = sub.indexOf(from)
      if (fromIdx < 0) return prev
      const arr = [...sub]
      arr.splice(fromIdx, 1)
      let target = index
      if (fromIdx < index) target -= 1
      target = Math.max(0, Math.min(arr.length, target))
      arr.splice(target, 0, from)
      let k = 0
      return prev.map(c => (cats.includes(c) ? arr[k++] : c))
    })
    markFilterDirty(type, 'cats')
  }

  // 포인터 기반 드래그 — 네이티브 HTML5 DnD 대신 pointermove/up으로 직접 처리 (실사용/검증 모두 안정적)
  const dragStartXRef = useRef(0)
  const dragMovedRef = useRef(false)
  const DRAG_THRESHOLD = 4 // px 이상 움직이면 드래그, 아니면 클릭(선택 토글)로 간주

  const handleChipPointerDown = (e: React.PointerEvent<HTMLButtonElement>, cat: string, type: 'pcb' | 'cable') => {
    if (e.button !== 0) return
    dragCatRef.current = cat
    dragStartXRef.current = e.clientX
    dragMovedRef.current = false
    setDragCat(cat)

    const onMove = (ev: PointerEvent) => {
      if (!dragCatRef.current) return
      if (!dragMovedRef.current && Math.abs(ev.clientX - dragStartXRef.current) < DRAG_THRESHOLD) return
      dragMovedRef.current = true
      setDropIndex({ type, index: computeDropIndex(type, ev.clientX) })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragMovedRef.current) {
        dropCategoryAt(type, computeDropIndex(type, ev.clientX)) // 놓은 자리에 삽입
      } else if (dragCatRef.current) {
        toggleCategory(type, dragCatRef.current)                  // 안 움직였으면 클릭 = 표시 토글
      }
      dragCatRef.current = null
      dragMovedRef.current = false
      setDragCat(null)
      setDropIndex(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 저장된 필터 JSON을 읽어 오되 형식이 깨졌으면 빈 객체
  const readStoredFilter = (type: 'pcb' | 'cable'): any => {
    try { return JSON.parse(localStorage.getItem(`hansl_prod_filter_${type}`) || '{}') } catch { return {} }
  }

  // 조건(규칙) 필터만 저장 — 같은 키의 제작구분(categories)은 기존 저장값 보존
  const saveRulesFilter = (type: 'pcb' | 'cable') => {
    const cur = filterFor(type)
    const stored = readStoredFilter(type)
    localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({
      categories: Array.isArray(stored.categories) ? stored.categories : cur.categories,
      rules: cur.rules,
    }))
    // 기본값 그대로 저장한 경우엔 파랑 표시 안 함 (파랑 = 기본값에서 바꿔 저장한 상태)
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: !rulesEqualDefault(type, cur.rules) } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    toast.success('조건 필터가 저장되었습니다.')
  }

  // 제작구분 필터만 저장 — 같은 키의 규칙(rules)은 기존 저장값 보존 + 그룹 순서 저장
  const saveCategoryFilter = (type: 'pcb' | 'cable') => {
    const cur = filterFor(type)
    const stored = readStoredFilter(type)
    localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({
      categories: cur.categories,
      rules: Array.isArray(stored.rules) ? stored.rules : cur.rules,
    }))
    localStorage.setItem('hansl_prod_filter_category_order', JSON.stringify(categoryOrder))
    // 기본값 그대로(전체 선택 + 기본 순서) 저장한 경우엔 파랑 표시 안 함
    const catsCustom = !catsEqualDefault(type, cur.categories) || !categoryOrderIsDefault(categoryOrder)
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: catsCustom } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    toast.success('제작구분 필터가 저장되었습니다.')
  }

  const handleResetRules = (type: 'pcb' | 'cable') => {
    // 시작 기본값을 저장해 뒀으면 코드 기본값이 아니라 그 저장된 기본값으로 되돌린다
    const savedDefault = filterViewsConfig.defaults[type]
    if (savedDefault) {
      const rules = fromStoredRules(savedDefault.rules)
      setFilterFor(type, { rules })
      const stored = readStoredFilter(type)
      const cats = Array.isArray(stored.categories) ? stored.categories : (type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES])
      localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({ categories: cats, rules }))
      // 시작 기본값으로 되돌렸으니 현재 = 기준값 → 저장됨(파랑) 표시 안 함
      setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
      toast.info('저장된 시작 기본값으로 초기화되었습니다.')
      return
    }
    // 기본 세팅 = 입고대기 + 요청일 현재 년도(월 전체)
    setFilterFor(type, { rules: defaultRules(type) })
    // 저장본의 규칙도 기본값으로 되돌림 — 안 그러면 새로고침 시 이전 저장 규칙이 되살아나고 아이콘도 다시 파랑이 됨
    const stored = readStoredFilter(type)
    const catsStillCustom = Array.isArray(stored.categories) && !catsEqualDefault(type, stored.categories)
    if (catsStillCustom) {
      localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({ categories: stored.categories, rules: defaultRules(type) }))
    } else {
      localStorage.removeItem(`hansl_prod_filter_${type}`)
    }
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    toast.info('필터가 기본값으로 초기화되었습니다.')
  }

  const handleResetCategoryFilter = (type: 'pcb' | 'cable') => {
    // 시작 기본값을 저장해 뒀으면 그 저장된 제작구분/그룹순서로 되돌린다
    const savedDefault = filterViewsConfig.defaults[type]
    if (savedDefault) {
      const validCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
      const cats = Array.isArray(savedDefault.categories) ? savedDefault.categories.filter(c => validCats.includes(c)) : [...validCats]
      setFilterFor(type, { categories: cats })
      let order = categoryOrder
      if (Array.isArray(savedDefault.categoryOrder) && savedDefault.categoryOrder.length) {
        order = savedDefault.categoryOrder.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
        for (const c of DEFAULT_CATEGORY_ORDER) if (!order.includes(c)) order.push(c)
        setCategoryOrder(order)
        localStorage.setItem('hansl_prod_filter_category_order', JSON.stringify(order))
      }
      const stored = readStoredFilter(type)
      const rules = Array.isArray(stored.rules) ? stored.rules : filterFor(type).rules
      localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({ categories: cats, rules }))
      // 시작 기본값으로 되돌렸으니 현재 = 기준값 → 저장됨(파랑) 표시 안 함
      setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
      toast.info('저장된 시작 기본값으로 초기화되었습니다.')
      return
    }
    setFilterFor(type, { categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES] })
    setCategoryOrder([...DEFAULT_CATEGORY_ORDER])
    // 저장본의 제작구분/그룹순서도 기본값으로 되돌림 (규칙이 커스텀이면 규칙만 보존)
    localStorage.removeItem('hansl_prod_filter_category_order')
    const stored = readStoredFilter(type)
    const rulesStillCustom = Array.isArray(stored.rules) && !rulesEqualDefault(type, stored.rules)
    if (rulesStillCustom) {
      localStorage.setItem(`hansl_prod_filter_${type}`, JSON.stringify({
        categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES],
        rules: stored.rules,
      }))
    } else {
      localStorage.removeItem(`hansl_prod_filter_${type}`)
    }
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    toast.info('제작구분 필터가 초기화되었습니다.')
  }

  // 필터 규칙 조작 (노션식 추가/수정/제거)
  const addRule = (type: 'pcb' | 'cable') => {
    const f = filterFor(type)
    // 칼럼 미선택 상태로 시작 — 사용자가 '칼럼 선택'에서 직접 고르게 한다 (임의로 보드명이 잡히지 않도록)
    setFilterFor(type, { rules: [...f.rules, { id: newRuleId(), field: '', op: 'contains', value: '' }] })
  }
  const updateRule = (type: 'pcb' | 'cable', id: string, patch: Partial<FilterRule>) => {
    const f = filterFor(type)
    setFilterFor(type, { rules: f.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) })
  }
  const removeRule = (type: 'pcb' | 'cable', id: string) => {
    const f = filterFor(type)
    setFilterFor(type, { rules: f.rules.filter(r => r.id !== id) })
  }

  // 컬럼 좌우 여백 (각각 5px, 총 10px) — globals.css의 .production-compact-table th/td 패딩과 반드시 동일하게 유지
  const COLUMN_PADDING_SIDE = 5

  // 웹폰트(Pretendard) 로드 완료 후 한 번 재렌더 → 캔버스 실측 폭을 실제 렌더 폰트와 일치시킴 (칼럼폭 캐시 재계산 트리거)
  const [fontsLoaded, setFontsReady] = useState(false)
  useEffect(() => {
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => setFontsReady(true))
    }
  }, [])

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState<'pcb' | 'cable'>('pcb')
  const [modalAction, setModalAction] = useState<'add' | 'edit'>('add')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'pcb' | 'cable', ids: string[] } | null>(null)

  // 인라인 셀 수정 상태
  const [editingCell, setEditingCell] = useState<{ id: string, type: 'pcb' | 'cable', field: string } | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  // 정렬/칼럼 메뉴 포털 앵커 = 클릭한 버튼 (메뉴는 한 번에 하나만 열림) — 셀 팝오버는 CellPopoverPortal이 담당
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  // 줄바꿈 셀 접힘/펼침 상태 (key: `${id}::${field}`) — 펼치면 해당 셀만 세로로 확장
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())
  const toggleCellExpand = (id: string, field: string) => {
    const key = `${id}::${field}`
    setExpandedCells(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // 납품 분할: 납품 수량 팝오버의 `[N]분할` — 같은 제작 행(앞 칼럼 전부 동일)을 N개로 만들어
  // 분할 납품(같은 제작번호, 납품처/일자/수량만 다름)을 행 단위로 입력할 수 있게 한다.
  // 새 행들은 납품 3칸(수량/일자/배송처)이 빈 상태로 시작한다. (수량 입력이 납품 입력의 시작이므로)
  const splitInputRef = useRef<HTMLInputElement | null>(null)
  const handleSplitDelivery = useStableHandler(async (id: string, n: number) => {
    if (!Number.isInteger(n) || n < 2 || n > 50) {
      toast.error('분할 개수는 2~50 사이 숫자로 입력해주세요.')
      return
    }
    const item = pcbs.find(p => p.id === id)
    if (!item) return
    try {
      const supabase = createClient()
      // 앞 칼럼은 그대로 복사, 납품 3칸만 비움 (id/타임스탬프 제외)
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = item as any
      const copy = { ...rest, delivery_quantity: null, delivery_date: null, delivery_destination: null }
      const payloads = Array.from({ length: n - 1 }, () => ({ ...copy }))
      const { data, error } = await supabase.from('production_pcbs').insert(payloads).select('id')
      if (error) throw error
      for (const r of (data || [])) {
        pushUndo({ kind: 'deleteInserted', table: 'production_pcbs', id: r.id, label: `납품 ${n}분할` })
      }
      setEditingCell(null)
      toast.success(`납품이 ${n}개 행으로 분할되었습니다. 각 행에 수량/일자/배송처를 입력하세요.`)
      await loadData()
    } catch (err) {
      console.error(err)
      toast.error('분할에 실패했습니다.')
    }
  })

  // 완제품 입고 날짜 선택 팝오버: '입고대기' 클릭 시 열림 (직접 입력 + 달력 클릭 선택)
  const [stockInPicker, setStockInPicker] = useState<{ id: string, type: 'pcb' | 'cable', field: string } | null>(null)
  const [stockInInput, setStockInInput] = useState<string>('')
  const stockInPopoverRef = useRef<HTMLDivElement | null>(null)

  // 제작번호 선택 팝오버: 재발주 시 자동 채번된 번호를 기존 제작번호로 바꿀 수 있게 한다
  // (셀 클릭 → 기존 번호 목록, 타이핑 = 필터, 클릭/Enter = 선택)
  const [orderNoPicker, setOrderNoPicker] = useState<{ id: string, type: 'pcb' | 'cable' } | null>(null)
  const [orderNoInput, setOrderNoInput] = useState<string>('')
  const orderNoPopoverRef = useRef<HTMLDivElement | null>(null)

  // 로그인 사용자 및 직원 정보
  const { currentUserName, employee } = useAuth()

  // 업체 관리 DB 연동 상태
  const [vendors, setVendors] = useState<any[]>([])

  // 행 색상 피커 상태
  const [activeColorPicker, setActiveColorPicker] = useState<{ id: string, type: 'pcb' | 'cable' } | null>(null)

  // 드래그 선택 관련 상태 정의
  // dragStartCell은 ref로 관리한다: mousedown 시점에 곧바로 selectedCells를 채우면
  // 뒤이은 click에서 "이미 선택됨"으로 오판해 1클릭 편집 진입 버그가 재발한다.
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  // 셀 개수가 많은 선택(열 전체 등)에서 각 셀의 isSelected 판정이 O(1)이 되도록 Set을 함께 유지
  const selectedCellsSet = useMemo(() => new Set(selectedCells), [selectedCells])
  const [isDragging, setIsDragging] = useState(false)
  const dragStartCellRef = useRef<{ id: string; field: string; type: 'pcb' | 'cable' } | null>(null)
  // 키보드 내비게이션용 앵커(선택 시작점)/포커스(활성 셀) — 클릭·드래그·방향키 이동 시 갱신
  const selAnchorRef = useRef<{ id: string; field: string; type: 'pcb' | 'cable' } | null>(null)
  const selFocusRef = useRef<{ id: string; field: string; type: 'pcb' | 'cable' } | null>(null)
  // Shift/Ctrl(Cmd)+클릭 선택을 mousedown에서 처리했음을 뒤이은 click 핸들러에 알리는 플래그
  // (click이 편집 진입/팝오버 열기로 이어지지 않도록). 매 mousedown마다 새로 계산된다.
  const modifierSelectRef = useRef(false)
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null)
  // 같은 칼럼 다중선택 시 값 일괄 입력용 편집값 (플로팅 메뉴 안 편집기 상태)
  const [bulkEditValue, setBulkEditValue] = useState('')

  const pcbColumns = [
    'sales_order_number',
    'production_category',
    'board_name',
    'reference',
    'request_date',
    'estimate_no',
    'delivery_deadline',
    'client_name',
    'client_manager',
    'hansl_manager',
    'revision_count',
    'quantity',
    'artwork_status',
    'metal_mask',
    'changes_memo',
    'stock_count',
    'pcb_vendor',
    'delivery_schedule',
    'pcb_lead_time',
    'received_quantity',
    'received_destination',
    'pcb_stock_completed',
    'parts_organization',
    'assy_hanwha',
    'assy_evertech',
    'assy_requested_date',
    'final_product_stock',
    'qa_passed',
    'qa_failed',
    'qa_notes',
    'design_review',
    'delivery_quantity',
    'delivery_date',
    'delivery_destination',
    'delivery_completed'
  ]

  const cableColumns = [
    'sales_order_number',
    'production_category',
    'board_name',
    'reference',
    'request_date',
    'estimate_no',
    'delivery_deadline',
    'client_name',
    'client_manager',
    'hansl_manager',
    'revision_count',
    'quantity',
    'spec_details',
    'cable_vendor',
    'cable_requested_date',
    'cable_actual_date',
    'delivery_notes',
    'delivery_completed'
  ]

  const getRowIndex = (type: 'pcb' | 'cable', id: string) => {
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    return list.findIndex(item => item.id === id)
  }

  // 같은 칼럼 다중선택일 때 일괄 입력 편집기에 미리 채울 값 (모두 같은 값이면 그 값, 아니면 빈칸)
  const computeBulkPrefill = (cells: string[], type: 'pcb' | 'cable'): string => {
    const fields = Array.from(new Set(cells.map(k => k.split('::')[1])))
    if (fields.length !== 1) return ''
    const field = fields[0]
    const list = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
    const vals = Array.from(new Set(cells.map(k => {
      const rid = k.split('::')[0]
      const v = (list.find(i => i.id === rid) as any)?.[field]
      return v === null || v === undefined ? '' : String(v)
    })))
    return vals.length === 1 ? vals[0] : ''
  }

  const handleCellMouseDown = useStableHandler((e: React.MouseEvent, id: string, field: string, type: 'pcb' | 'cable') => {
    if (e.button !== 0) return // 마우스 왼쪽 클릭만 지원
    const mod = e.ctrlKey || e.metaKey
    // Shift/Ctrl 클릭 선택을 여기서 처리했으면 true — 뒤이은 click 핸들러(편집 진입/팝오버)가 양보한다
    modifierSelectRef.current = false

    // Shift+클릭: 앵커(마지막 클릭 셀)→클릭 셀 사각 범위 선택 (엑셀과 동일)
    if (e.shiftKey && !mod && selectedCells.length > 0) {
      const anchor = selAnchorRef.current
      if (anchor && anchor.type === type) {
        const cols = (type === 'pcb' ? pcbColumns : cableColumns).filter(f => !isColHidden(type, f))
        const list = type === 'pcb' ? filteredPcbs : filteredCables
        const aR = getRowIndex(type, anchor.id), aC = cols.indexOf(anchor.field)
        const bR = getRowIndex(type, id), bC = cols.indexOf(field)
        if (aR !== -1 && aC !== -1 && bR !== -1 && bC !== -1) {
          const sel: string[] = []
          for (let r = Math.min(aR, bR); r <= Math.max(aR, bR); r++)
            for (let c = Math.min(aC, bC); c <= Math.max(aC, bC); c++)
              sel.push(`${list[r].id}::${cols[c]}`)
          setSelectedCells(sel)
          selFocusRef.current = { id, field, type }
          dragStartCellRef.current = { ...anchor } // 이어서 드래그하면 앵커 기준으로 계속 확장
          modifierSelectRef.current = true
          if (editingCell) setEditingCell(null)
          if (sel.length > 1) {
            setFloatingMenuPos({ x: e.clientX, y: e.clientY })
            setBulkEditValue(computeBulkPrefill(sel, type))
          } else setFloatingMenuPos(null)
          return
        }
      }
    }

    // Ctrl/Cmd+클릭: 개별 셀 추가/제거 (비연속 다중 선택, 엑셀과 동일)
    if (mod && !e.shiftKey) {
      const cellKey = `${id}::${field}`
      // 다른 테이블의 선택과는 섞을 수 없으므로 테이블이 바뀌면 새로 시작
      const sameTable = selAnchorRef.current?.type === type && selectedCells.length > 0
      const base = sameTable ? selectedCells : []
      const next = base.includes(cellKey) ? base.filter(k => k !== cellKey) : [...base, cellKey]
      setSelectedCells(next)
      selAnchorRef.current = { id, field, type }
      selFocusRef.current = { id, field, type }
      dragStartCellRef.current = { id, field, type }
      modifierSelectRef.current = true
      if (editingCell) setEditingCell(null)
      if (next.length > 1) {
        setFloatingMenuPos({ x: e.clientX, y: e.clientY })
        setBulkEditValue(computeBulkPrefill(next, type))
      } else setFloatingMenuPos(null)
      return
    }

    // 실제 드래그로 판명되기 전까지는 ref에만 기록한다.
    // 여기서 곧바로 setSelectedCells를 호출하면 뒤이은 click 핸들러가 "이미 선택된 셀"로 오판해
    // 첫 클릭에 곧장 편집 모드로 들어가버린다 (선택→편집 2단계 클릭이 깨짐).
    dragStartCellRef.current = { id, field, type }
    // 키보드 내비게이션 기준점도 함께 갱신 (클릭한 셀 = 앵커 = 활성 셀)
    selAnchorRef.current = { id, field, type }
    selFocusRef.current = { id, field, type }
    if (editingCell) setEditingCell(null)
    if (floatingMenuPos) setFloatingMenuPos(null)
  })

  const handleCellMouseEnter = useStableHandler((e: React.MouseEvent, id: string, field: string, type: 'pcb' | 'cable') => {
    const dragStartCell = dragStartCellRef.current
    if (!dragStartCell || dragStartCell.type !== type) return
    if ((e.buttons & 1) === 0) return // 왼쪽 버튼이 눌린 상태에서 이동할 때만 드래그로 인정
    if (!isDragging) setIsDragging(true)

    // 숨긴 칼럼은 드래그 범위에서 제외 — 안 보이는 셀이 선택돼 Delete로 값이 지워지는 사고 방지
    const cols = (type === 'pcb' ? pcbColumns : cableColumns).filter(f => !isColHidden(type, f))
    const startRowIdx = getRowIndex(type, dragStartCell.id)
    const endRowIdx = getRowIndex(type, id)
    const startColIdx = cols.indexOf(dragStartCell.field)
    const endColIdx = cols.indexOf(field)
    
    if (startRowIdx === -1 || endRowIdx === -1 || startColIdx === -1 || endColIdx === -1) return
    
    const minRow = Math.min(startRowIdx, endRowIdx)
    const maxRow = Math.max(startRowIdx, endRowIdx)
    const minCol = Math.min(startColIdx, endColIdx)
    const maxCol = Math.max(startColIdx, endColIdx)
    
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    const newSelection: string[] = []
    
    for (let r = minRow; r <= maxRow; r++) {
      const rowId = list[r].id
      for (let c = minCol; c <= maxCol; c++) {
        newSelection.push(`${rowId}::${cols[c]}`)
      }
    }
    
    setSelectedCells(newSelection)
    selFocusRef.current = { id, field, type } // 드래그 중 마지막으로 지나간 셀 = 포커스
  })

  // 드래그 종료 마우스 리스너 및 아웃사이드 클릭 해제 처리
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDragging) {
        setIsDragging(false)
        if (selectedCells.length > 1) {
          setFloatingMenuPos({ x: e.clientX, y: e.clientY })
          // 값 편집기 프리필: 선택 셀이 모두 같은 칼럼이고 현재 값도 동일하면 그 값을 미리 채운다
          // (단일 클릭 편집기가 현재값을 보여주는 것과 동일한 감각). 값이 제각각이면 빈칸.
          setBulkEditValue(computeBulkPrefill(selectedCells, dragStartCellRef.current?.type || 'pcb'))
        }
      }
    }

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('.floating-bulk-picker') || 
        target.closest('.cursor-pointer') || 
        target.closest('.color-picker-trigger') || 
        target.closest('.color-picker-popover')
      ) {
        return
      }
      setSelectedCells([])
      setFloatingMenuPos(null)
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousedown', handleOutsideClick)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [isDragging, selectedCells])

  // ─── 되돌리기(Undo) 인프라 ──────────────────────────────────────────
  // 각 변경(텍스트 수정·값삭제·색상·행추가/삭제) 직전에 "이전 상태"를 스택에 쌓고,
  // Ctrl+Z(편집칸 밖)로 스택에서 꺼내 DB에 되돌려 쓴다. 브라우저 세션(메모리) 한정.
  type UndoEntry =
    | { kind: 'restore'; table: 'production_pcbs' | 'production_cables'; rows: Array<{ id: string; data: Record<string, any> }>; label: string }
    | { kind: 'deleteInserted'; table: 'production_pcbs' | 'production_cables'; id: string; label: string }
    | { kind: 'reinsert'; table: 'production_pcbs' | 'production_cables'; row: Record<string, any>; label: string }
  const undoStackRef = useRef<UndoEntry[]>([])
  const redoStackRef = useRef<UndoEntry[]>([])
  const undoingRef = useRef(false)
  const UNDO_LIMIT = 100
  // 최신 데이터/편집상태를 stale closure 없이 참조하기 위한 ref (렌더마다 갱신)
  const liveDataRef = useRef<{ pcbs: ProductionPcb[]; cables: ProductionCable[] }>({ pcbs, cables })
  liveDataRef.current = { pcbs, cables }
  const editingCellRef = useRef(editingCell)
  editingCellRef.current = editingCell

  const tableOf = (type: 'pcb' | 'cable') => (type === 'pcb' ? 'production_pcbs' : 'production_cables') as 'production_pcbs' | 'production_cables'
  // 되돌리기용 행 스냅샷: id/created_at/updated_at 제외한 전체 칼럼을 복사(색상·삭제표식 포함)
  const UNDO_EXCLUDE = new Set(['id', 'created_at', 'updated_at'])
  const snapshotRows = (type: 'pcb' | 'cable', ids: string[]): Array<{ id: string; data: Record<string, any> }> => {
    const list: any[] = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
    const rows: Array<{ id: string; data: Record<string, any> }> = []
    for (const id of ids) {
      const item = list.find(i => i.id === id)
      if (!item) continue
      const data: Record<string, any> = {}
      for (const k of Object.keys(item)) if (!UNDO_EXCLUDE.has(k)) data[k] = item[k]
      rows.push({ id, data })
    }
    return rows
  }
  const pushUndo = (entry: UndoEntry) => {
    if (entry.kind === 'restore' && entry.rows.length === 0) return
    redoStackRef.current = [] // 새 작업이 생기면 '다시 실행' 이력은 무효화 (표준 undo/redo 규칙)
    const s = undoStackRef.current
    s.push(entry)
    if (s.length > UNDO_LIMIT) s.shift()
  }
  const pushRestoreUndo = (type: 'pcb' | 'cable', ids: string[], label: string) => {
    pushUndo({ kind: 'restore', table: tableOf(type), rows: snapshotRows(type, ids), label })
  }

  // 엔트리 하나를 DB에 적용하고, 그 반대 동작(다른 스택에 쌓을 엔트리)을 돌려준다.
  // 적용 직전의 현재 상태를 스냅샷해 두므로 undo↔redo가 완전히 대칭이 된다.
  const applyUndoEntry = async (entry: UndoEntry): Promise<UndoEntry | null> => {
    const supabase = createClient()
    const type: 'pcb' | 'cable' = entry.table === 'production_pcbs' ? 'pcb' : 'cable'
    if (entry.kind === 'restore') {
      const inverseRows = snapshotRows(type, entry.rows.map(r => r.id)) // 적용 전(=반대편이 되돌릴) 상태
      for (const row of entry.rows) {
        const { error } = await supabase.from(entry.table)
          .update({ ...row.data, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw error
      }
      return { kind: 'restore', table: entry.table, rows: inverseRows, label: entry.label }
    }
    if (entry.kind === 'deleteInserted') {
      // 행 추가 되돌리기 = 방금 만든 행을 완전히 제거. 재실행(redo)을 위해 전체 행을 보관.
      const list: any[] = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
      const full = list.find(i => i.id === entry.id)
      const { error } = await supabase.from(entry.table).delete().eq('id', entry.id)
      if (error) throw error
      return full ? { kind: 'reinsert', table: entry.table, row: { ...full }, label: entry.label } : null
    }
    // reinsert: 제거됐던 행을 원래 id/값 그대로 되살림
    const { error } = await supabase.from(entry.table).insert([entry.row])
    if (error) throw error
    return { kind: 'deleteInserted', table: entry.table, id: entry.row.id, label: entry.label }
  }

  const handleUndo = useStableHandler(async () => {
    if (undoingRef.current) return
    const entry = undoStackRef.current.pop()
    if (!entry) { toast('되돌릴 작업이 없습니다.'); return }
    undoingRef.current = true
    try {
      const inverse = await applyUndoEntry(entry)
      if (inverse) redoStackRef.current.push(inverse)
      await loadData()
      toast.success(`되돌렸습니다 · ${entry.label}`)
    } catch (err) {
      console.error(err)
      undoStackRef.current.push(entry) // 실패 시 항목 보존(재시도 가능)
      toast.error('되돌리기에 실패했습니다.')
    } finally {
      undoingRef.current = false
    }
  })

  const handleRedo = useStableHandler(async () => {
    if (undoingRef.current) return
    const entry = redoStackRef.current.pop()
    if (!entry) { toast('다시 실행할 작업이 없습니다.'); return }
    undoingRef.current = true
    try {
      const inverse = await applyUndoEntry(entry)
      if (inverse) undoStackRef.current.push(inverse)
      await loadData()
      toast.success(`다시 실행 · ${entry.label}`)
    } catch (err) {
      console.error(err)
      redoStackRef.current.push(entry)
      toast.error('다시 실행에 실패했습니다.')
    } finally {
      undoingRef.current = false
    }
  })

  // Ctrl/Cmd+Z 되돌리기 · Ctrl/Cmd+Shift+Z(또는 Ctrl+Y) 다시 실행
  // 편집칸(input/textarea/select)·편집모드에서는 브라우저 기본(타이핑 취소)에 양보
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.altKey) return
      const k = (e.key || '').toLowerCase()
      const isUndo = !e.shiftKey && k === 'z'
      const isRedo = (e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')
      if (!isUndo && !isRedo) return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
      if (editingCellRef.current) return
      e.preventDefault()
      if (isRedo) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 일괄 상태 변경 핸들러
  const handleBulkUpdateCellColor = async (colorAction: string | null, toggle: 'strike' | 'bold' | 'redtext' | null = null) => {
    if (selectedCells.length === 0) return

    const type = dragStartCellRef.current?.type || 'pcb'
    const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
    const list = type === 'pcb' ? filteredPcbs : filteredCables

    try {
      const supabase = createClient()
      const updatesByRow: { [rowId: string]: { [field: string]: string | null } } = {}

      // 선택된 첫 셀 기준으로 토글 목표 상태를 정해 전체에 동일하게 적용
      let targetStrike: 'strike' | 'nostrike' | null = null
      let targetBold: boolean | null = null
      let targetRedText: boolean | null = null
      if (toggle) {
        const firstCellKey = selectedCells[0]
        const [firstId, firstField] = firstCellKey.split('::')
        const firstItem = list.find(i => i.id === firstId)
        const firstCellColor = firstItem?.cell_colors?.[firstField]
        const { strike: firstStrike, bold: firstBold, redText: firstRedText } = parseColorState(firstCellColor)
        if (toggle === 'strike') {
          const { strike: rowStrike } = parseColorState(firstItem?.row_color)
          const effectiveStrike = firstStrike || rowStrike || null
          targetStrike = effectiveStrike === 'strike' ? 'nostrike' : 'strike'
        } else if (toggle === 'bold') {
          targetBold = !firstBold
        } else if (toggle === 'redtext') {
          targetRedText = !firstRedText
        }
      }

      selectedCells.forEach(key => {
        const [rowId, field] = key.split('::')
        if (!updatesByRow[rowId]) {
          updatesByRow[rowId] = {}
        }
        updatesByRow[rowId][field] = colorAction
      })

      // 되돌리기: 변경 전 상태 스냅샷
      pushRestoreUndo(type, Object.keys(updatesByRow), `${selectedCells.length}칸 색상 변경`)

      const promises = Object.entries(updatesByRow).map(async ([rowId, fields]) => {
        const rowItem = list.find(i => i.id === rowId)
        if (!rowItem) return

        const newCellColors = { ...(rowItem.cell_colors || {}) }

        Object.keys(fields).forEach(field => {
          const currentVal = newCellColors[field]
          const { color: curColor, strike: curStrike, bold: curBold, redText: curRedText } = parseColorState(currentVal)

          let nextColor: string | null = curColor
          let nextStrike: 'strike' | 'nostrike' | null = curStrike
          let nextBold = curBold
          let nextRedText = curRedText

          if (toggle === 'strike') {
            nextStrike = targetStrike
          } else if (toggle === 'bold') {
            nextBold = targetBold ?? curBold
          } else if (toggle === 'redtext') {
            nextRedText = targetRedText ?? curRedText
          } else if (colorAction === null) {
            nextColor = null
            nextStrike = null
            nextBold = false
            nextRedText = false
          } else {
            nextColor = colorAction
          }

          const serialized = serializeColorState(nextColor, nextStrike, nextBold, nextRedText)
          if (serialized === null) {
            delete newCellColors[field]
          } else {
            newCellColors[field] = serialized
          }
        })
        
        return supabase.from(table).update({ cell_colors: newCellColors }).eq('id', rowId)
      })
      
      const results = await Promise.all(promises)
      const dbError = results.find(r => r?.error)?.error
      if (dbError) throw dbError
      
      loadData()
      setSelectedCells([])
      setFloatingMenuPos(null)
      toast.success(`${selectedCells.length}개 칸의 상태가 변경되었습니다.`)
    } catch (err) {
      console.error(err)
      toast.error('일괄 상태 변경에 실패했습니다.')
    }
  }

  // 폼 필드 상태
  const [formFields, setFormFields] = useState<Record<string, any>>({
    sales_order_number: '',
    production_category: '',
    board_name: '',
    request_date: '',
    estimate_no: '',
    delivery_deadline: '',
    client_name: '',
    client_manager: '',
    hansl_manager: '',
    creator: '',
    revision_count: 1,
    quantity: 0,
    // PCB 전용
    artwork_status: '',
    metal_mask: '',
    pcb_vendor: '',
    delivery_schedule: '',
    stock_count: 0,
    changes_memo: '',
    // 케이블 전용
    spec_details: ''
  })

  // 데이터 로드
  // 동시에 여러 loadData가 날아갈 때, 늦게 도착한 이전 요청 응답이 최신 데이터를 덮어쓰는 것을 방지
  const loadSeqRef = useRef(0)

  const loadData = async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)

    // 전체 로드 — 년/월은 클라이언트 표시 필터(matchDateFilter)로 처리한다.
    // 날짜범위를 서버에서 자르면 request_date가 NULL인 행이 영영 안 보이는 문제도 있었음.
    try {
      const pcbData = await productionService.getProductionPcbs()
      const cableData = await productionService.getProductionCables()
      if (seq !== loadSeqRef.current) return // 더 최신 요청이 있으면 이 응답은 버림
      setPcbs(pcbData)
      setCables(cableData)
    } catch (error) {
      if (seq !== loadSeqRef.current) return
      console.error('Failed to load production status data', error)
      toast.error('데이터 조회에 실패했습니다.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  // 직원 목록 로드
  useEffect(() => {
    const loadEmployees = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('employees').select('id, name, email').order('name')
      if (data) {
        // name에서 직함(공백 뒤의 텍스트) 제거 (예: "홍길동 사원" → "홍길동")
        const cleaned = data.map((emp: any) => ({
          ...emp,
          name: emp.name.split(/\s+/)[0] // 첫 번째 공백까지만 추출
        }))
        setEmployees(cleaned)
      }
    }
    loadEmployees()
  }, [])

  // 업체 목록 로드
  useEffect(() => {
    const loadVendors = async () => {
      const result = await vendorService.getVendors()
      if (result.success && result.data) {
        setVendors(result.data)
      }
    }
    loadVendors()
  }, [])

  // 최초 로드 (검색은 클라이언트에서 처리 — 날짜 패턴 검색 포함)
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실시간 구독 설정
  useEffect(() => {
    const supabase = createClient()
    
    const pcbChannel = supabase
      .channel('realtime-production-pcbs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_pcbs' }, () => {
        loadData()
      })
      .subscribe()

    const cableChannel = supabase
      .channel('realtime-production-cables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_cables' }, () => {
        loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(pcbChannel)
      supabase.removeChannel(cableChannel)
    }
  }, [])

  // 행 색상 피커 바깥 영역 클릭 시 닫기
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.color-picker-trigger') || target.closest('.color-picker-popover')) {
        return
      }
      setActiveColorPicker(null)
    }
    window.addEventListener('click', handleOutsideClick)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
    }
  }, [])

  // 카테고리 필터 토글 (테이블별)
  const toggleCategory = (type: 'pcb' | 'cable', cat: string) => {
    const cur = filterFor(type).categories
    setFilterFor(type, {
      categories: cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat],
    })
  }

  // 행 추가 인라인 모드로 전환
  const handleAddClick = async (type: 'pcb' | 'cable') => {
    // 날짜 생성은 무조건 한국시간(KST) 기준 — UTC(toISOString)를 쓰면 KST 0~9시에 채번/요청일이 하루 밀린다
    const today = getKstTodayISO()
    setLoading(true)
    try {
      const nextNo = await productionService.generateNextSalesOrderNumber(today)
      const currentUserStr = currentUserName || employee?.name || ''
      if (type === 'pcb') {
        setAddingPcbRow({
          sales_order_number: nextNo,
          production_category: 'LG_PCB',
          board_name: '',
          reference: '',
          request_date: today,
          estimate_no: '',
          delivery_deadline: '',
          client_name: '',
          client_manager: '',
          hansl_manager: '',
          creator: currentUserStr,
          revision_count: 1,
          quantity: 0,
          artwork_status: '',
          metal_mask: '',
          pcb_vendor: '',
          delivery_schedule: '',
          stock_count: 0,
          changes_memo: ''
        })
        setAddingCableRow(null) // 하나만 추가 가능하게
      } else {
        setAddingCableRow({
          sales_order_number: nextNo,
          production_category: 'LG_Cable',
          board_name: '',
          reference: '',
          request_date: today,
          estimate_no: '',
          delivery_deadline: '',
          client_name: '',
          client_manager: '',
          hansl_manager: '',
          creator: currentUserStr,
          revision_count: 1,
          quantity: 0,
          spec_details: ''
        })
        setAddingPcbRow(null)
      }
    } catch (err) {
      console.error(err)
      toast.error('수주번호 자동 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSavePcbInline = async () => {
    if (!addingPcbRow) return
    if (!addingPcbRow.board_name) {
      toast.error('보드명을 입력해 주세요.')
      return
    }
    try {
      // 빈 문자열을 null로 변환하여 데이트/데시멀 컬럼 에러 방지
      const sanitized = { ...addingPcbRow } as any
      Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === '') {
          sanitized[key] = null
        }
      })
      if (sanitized.hansl_manager) {
        sanitized.hansl_manager = stripEmployeeTitle(sanitized.hansl_manager)
      }
      const created = await productionService.createProductionPcb(sanitized)
      if (created?.id) pushUndo({ kind: 'deleteInserted', table: 'production_pcbs', id: created.id, label: '행 추가(PCB)' })
      toast.success('신규 PCB 항목이 저장되었습니다.')
      setAddingPcbRow(null)
      // 저장된 행의 요청일이 현재 월/연도 필터 밖이면(예: 6월을 보는데 오늘=7월로 저장),
      // 저장은 됐지만 목록에 안 보여 "저장이 안 된 것처럼" 보이므로 필터를 해당 행 기준으로 이동시켜 노출
      focusFilterOnRow('pcb', created?.request_date)
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 저장된 행이 현재 날짜 규칙에 걸러져 안 보일 경우, 요청일 date_in 규칙을 행의 년/월로 옮겨 노출한다.
  // (전체 로드 구조라 데이터 갱신은 loadData 한 번이면 충분)
  const focusFilterOnRow = (type: 'pcb' | 'cable', requestDate?: string | null) => {
    loadData()
    if (!requestDate) return
    const f = filterFor(type)
    const [y, m] = requestDate.split('-').map(Number)
    const outside = f.rules.some(r =>
      r.op === 'date_in' && r.field === 'request_date' &&
      ((r.year != null && r.year !== y) || (r.month != null && r.month !== m))
    )
    if (outside) {
      setFilterFor(type, {
        rules: f.rules.map(r =>
          r.op === 'date_in' && r.field === 'request_date' ? { ...r, year: y, month: m } : r
        ),
      })
    }
  }

  const handleSaveCableInline = async () => {
    if (!addingCableRow) return
    if (!addingCableRow.board_name) {
      toast.error('품명을 입력해 주세요.')
      return
    }
    try {
      // 빈 문자열을 null로 변환하여 데이트/데시멀 컬럼 에러 방지
      const sanitized = { ...addingCableRow } as any
      Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === '') {
          sanitized[key] = null
        }
      })
      if (sanitized.hansl_manager) {
        sanitized.hansl_manager = stripEmployeeTitle(sanitized.hansl_manager)
      }
      const created = await productionService.createProductionCable(sanitized)
      if (created?.id) pushUndo({ kind: 'deleteInserted', table: 'production_cables', id: created.id, label: '행 추가(Cable)' })
      toast.success('신규 Cable/Case 항목이 저장되었습니다.')
      setAddingCableRow(null)
      focusFilterOnRow('cable', created?.request_date)
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 인라인 셀 수정 클릭 핸들러: 첫 클릭은 셀 선택만, 이미 선택된 셀을 한 번 더 클릭하면 편집 모드로 진입
  const handleCellClick = useStableHandler((id: string, type: 'pcb' | 'cable', field: string, currentValue: any) => {
    if (modifierSelectRef.current) return // Shift/Ctrl+클릭 선택은 mousedown에서 처리됨 — 편집 진입 금지
    if (selectedCells.length > 1) {
      const cellKey = `${id}::${field}`
      if (selectedCells.includes(cellKey)) {
        // 다중 선택 범위 "안"을 클릭 → 일괄 입력 메뉴 열기 (드래그 종료 때와 동일한 동작)
        const td = document.querySelector(`td[data-cell="${CSS.escape(cellKey)}"]`) as HTMLElement | null
        const r = td?.getBoundingClientRect()
        setFloatingMenuPos(r ? { x: r.right, y: r.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 })
        setBulkEditValue(computeBulkPrefill(selectedCells, type))
        return
      }
      // 범위 "밖"을 클릭 = 그 셀만 선택으로 전환 (엑셀과 동일)
      setSelectedCells([cellKey])
      setFloatingMenuPos(null)
      return
    }
    const cellKey = `${id}::${field}`
    const isAlreadySelected = selectedCells.length === 1 && selectedCells[0] === cellKey
    if (isAlreadySelected) {
      setEditingCell({ id, type, field })
      setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue))
    } else {
      setSelectedCells([cellKey])
    }
  })

  // 셀 값 정규화: 필드별 저장 형식(날짜/하이브리드/숫자/담당자)으로 변환.
  // 단일 저장(handleCellSave)과 일괄 저장(handleBulkUpdateCellValue)이 동일 규칙을 쓰도록 공유한다.
  const normalizeCellValueForSave = (type: 'pcb' | 'cable', field: string, val: string, id: string): any => {
    // 날짜 입력의 기본 월 = 해당 테이블 필터에 월이 지정돼 있으면 그 월
    const defaultMonth = defaultMonthFor(type)
    let valueToSave: any = val
    if (['request_date', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'].includes(field)) {
      if (val) {
        const parsed = parseAndFormatInputDate(val, defaultMonth)
        let dbDate = formatDisplayDateToDb(parsed)
        // 입력에 명시적 연도(4자리)가 없으면 formatDisplayDateToDb가 '올해'를 찍는다.
        // 이 경우 기존 값의 연도를 보존하여 연도가 임의로 바뀌는 것을 막는다.
        if (dbDate && !/\d{4}/.test(val)) {
          const list = type === 'pcb' ? filteredPcbs : filteredCables
          const prev = (list.find(i => i.id === id) as any)?.[field]
          const prevYear = typeof prev === 'string' ? prev.match(/^(\d{4})-/)?.[1] : null
          if (prevYear) dbDate = `${prevYear}${dbDate.slice(4)}`
        }
        valueToSave = dbDate || null
      } else {
        valueToSave = null
      }
    } else if (['assy_hanwha', 'assy_evertech', 'delivery_deadline', 'final_product_stock', 'pcb_stock_completed', 'delivery_completed'].includes(field)) {
      // 날짜 또는 메모 하이브리드: 날짜면 YYYY-MM-DD, 아니면 메모 원문
      valueToSave = toDateOrMemo(val, defaultMonth)
    } else if (['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'].includes(field)) {
      valueToSave = val === '' ? null : Number(val)
    } else if (field === 'hansl_manager') {
      valueToSave = val === '' ? null : stripEmployeeTitle(val)
    } else if (val === '') {
      valueToSave = null
    }
    return valueToSave
  }

  // 인라인 셀 수정 저장 핸들러
  const handleCellSave = useStableHandler(async (currentCell: { id: string, type: 'pcb' | 'cable', field: string }, val: string, captureUndo = true) => {
    const { id, type, field } = currentCell
    const valueToSave = normalizeCellValueForSave(type, field, val, id)

    // 납품 분할 그룹의 병합된 앞 칼럼 수정 → 그룹 전체 행에 같은 값 저장 (값이 어긋나면 병합이 풀림)
    const targetIds = type === 'pcb' && !HEADER_SPAN_GROUPS.pcbDelivery.includes(field)
      ? pcbGroupSiblings(id) : [id]

    // 되돌리기: 실제 값이 바뀔 때만 변경 전 행을 스냅샷 (색상 핸들러 경유 호출은 captureUndo=false)
    if (captureUndo) {
      const liveList: any[] = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
      const before = liveList.find(i => i.id === id)?.[field]
      if ((before ?? null) !== (valueToSave ?? null)) {
        pushRestoreUndo(type, targetIds, `${getColumnTitle(field, type)} 수정`)
      }
    }

    try {
      if (type === 'pcb') {
        await Promise.all(targetIds.map(tid => productionService.updateProductionPcb(tid, { [field]: valueToSave })))
      } else {
        await productionService.updateProductionCable(id, { [field]: valueToSave })
      }
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('수정에 실패했습니다.')
    }
  })

  // 여러 셀이 모두 같은 칼럼일 때, 단일 편집과 동일한 규칙으로 값을 일괄 저장한다.
  // (색상/스타일 일괄 변경 handleBulkUpdateCellColor 와 짝을 이루는 '값' 일괄 변경)
  const handleBulkUpdateCellValue = async (field: string, rawVal: string) => {
    if (selectedCells.length === 0) return
    const type = dragStartCellRef.current?.type || 'pcb'
    // 안전장치: 선택된 셀 중 해당 필드인 것만 대상으로 삼는다(같은 칼럼 다중선택 전제).
    const rowIds = Array.from(new Set(
      selectedCells.filter(k => k.split('::')[1] === field).map(k => k.split('::')[0])
        // 납품 분할 그룹의 병합된 앞 칼럼이면 그룹 전체 행으로 확장 (값이 어긋나면 병합이 풀림)
        .flatMap(rid => type === 'pcb' && !HEADER_SPAN_GROUPS.pcbDelivery.includes(field) ? pcbGroupSiblings(rid) : [rid])
    ))
    if (rowIds.length === 0) return

    // 되돌리기: 변경 전 상태 스냅샷
    pushRestoreUndo(type, rowIds, `${getColumnTitle(field, type)} ${rowIds.length}칸 일괄수정`)
    try {
      const promises = rowIds.map(id => {
        const valueToSave = normalizeCellValueForSave(type, field, rawVal, id)
        return type === 'pcb'
          ? productionService.updateProductionPcb(id, { [field]: valueToSave })
          : productionService.updateProductionCable(id, { [field]: valueToSave })
      })
      await Promise.all(promises)
      loadData()
      setSelectedCells([])
      setFloatingMenuPos(null)
      toast.success(`${rowIds.length}개 칸이 수정되었습니다.`)
    } catch (err) {
      console.error(err)
      toast.error('일괄 수정에 실패했습니다.')
    }
  }

  // 같은 칼럼 다중선택 시, 단일 클릭 편집기와 동일한 입력 UI를 플로팅 메뉴 안에 렌더한다.
  const renderBulkValueEditor = (type: 'pcb' | 'cable', field: string) => {
    const label = getColumnTitle(field, type)
    const commit = () => handleBulkUpdateCellValue(field, bulkEditValue)
    const close = () => { setSelectedCells([]); setFloatingMenuPos(null) }
    const applyBtn = (extra = '') => (
      <button
        type="button"
        onClick={commit}
        className={`text-[10px] font-medium text-white bg-[#1777CB] hover:bg-[#1265A8] rounded px-2 shrink-0 ${extra}`}
      >
        적용
      </button>
    )
    const wrap = (inner: React.ReactNode) => (
      <div className="flex flex-col gap-1 pb-1.5 border-b border-gray-100" onMouseDown={(e) => e.stopPropagation()}>
        <span className="text-[9px] font-semibold text-gray-500 select-none">{label} · {selectedCells.length}칸 일괄 입력</span>
        {inner}
      </div>
    )

    if (field === 'artwork_status') {
      return wrap(<ArtworkStatusEditor value={bulkEditValue} onChange={setBulkEditValue} autoFocusMemo onCommit={commit} onCancel={close} />)
    }
    if (field === 'parts_organization') {
      return wrap(<PartsStatusEditor value={bulkEditValue} onChange={setBulkEditValue} autoFocusMemo onCommit={commit} onCancel={close} />)
    }

    const opts = bulkSelectOptions(type, field)
    if (opts) {
      return wrap(
        <div className="flex items-center gap-1">
          <select
            autoFocus
            value={bulkEditValue}
            onChange={(e) => setBulkEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') close() }}
            className="h-6 bg-white border border-gray-300 rounded px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#1777CB] min-w-[120px]"
          >
            <option value="">-- 선택 --</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {applyBtn('py-0.5')}
        </div>
      )
    }

    const isMemo = MEMO_TEXT_FIELDS.includes(field)
    const isNumber = ['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'].includes(field)
    return wrap(
      <div className="flex items-start gap-1">
        {isMemo ? (
          <textarea
            autoFocus
            value={bulkEditValue}
            onChange={(e) => setBulkEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); if (e.key === 'Escape') close() }}
            rows={2}
            placeholder="입력 후 적용 (Ctrl+Enter)"
            className="bg-white border border-gray-300 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#1777CB] w-[220px] resize-y"
          />
        ) : (
          <input
            autoFocus
            type={isNumber ? 'number' : 'text'}
            value={bulkEditValue}
            onChange={(e) => setBulkEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') close() }}
            placeholder="입력 후 Enter"
            className="h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#1777CB] w-[160px]"
          />
        )}
        {applyBtn('py-1')}
      </div>
    )
  }

  // 수량 단위(ea/set) 변경 핸들러
  const handleUpdateQuantityUnit = useStableHandler(async (id: string, type: 'pcb' | 'cable', unit: string) => {
    pushRestoreUndo(type, [id], '수량 단위 변경')
    try {
      if (type === 'pcb') {
        await productionService.updateProductionPcb(id, { quantity_unit: unit })
      } else {
        await productionService.updateProductionCable(id, { quantity_unit: unit })
      }
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('단위 변경에 실패했습니다.')
    }
  })

  // 완제품 입고: '입고대기' 버튼 클릭 → 날짜 선택 팝오버 열기 (직접 입력 또는 달력 클릭)
  const handleStockInPress = useStableHandler((id: string, type: 'pcb' | 'cable', field: string = 'final_product_stock') => {
    if (modifierSelectRef.current) return // Shift/Ctrl+클릭 선택 중에는 팝오버를 열지 않음
    setStockInInput('')
    setStockInPicker({ id, type, field })
  })

  // 팝오버에서 확정한 입고일 저장 — 달력 선택은 ISO(YYYY-MM-DD)로 스탬프되어 날짜가 곧 입고 기록이자
  // 입고 여부 판단 기준. 화면에는 formatStockInDisplay가 'MM월 DD일'로 표시한다.
  // 직접 입력은 handleCellSave가 날짜(예: 7/6)면 날짜로, 아니면 메모 원문으로 해석한다.
  const commitStockIn = useStableHandler((val: string) => {
    const target = stockInPicker
    setStockInPicker(null)
    if (!target || !val.trim()) return
    handleCellSave(target, val.trim())
  })

  // 입고일 팝오버 밖을 클릭하면 닫기
  useEffect(() => {
    if (!stockInPicker) return
    const onDown = (e: MouseEvent) => {
      if (stockInPopoverRef.current?.contains(e.target as Node)) return
      setStockInPicker(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [stockInPicker])

  // 제작번호 팝오버에서 기존 번호 선택 → 해당 행의 제작번호 변경
  // handleCellSave 경유라 되돌리기 스냅샷 + 납품 분할 그룹 전체 동일 적용이 그대로 동작한다
  const commitOrderNo = useStableHandler((val: string) => {
    const target = orderNoPicker
    setOrderNoPicker(null)
    if (!target || !val.trim()) return
    handleCellSave({ id: target.id, type: target.type, field: 'sales_order_number' }, val.trim())
  })

  // 제작번호 팝오버 밖을 클릭하면 닫기
  useEffect(() => {
    if (!orderNoPicker) return
    const onDown = (e: MouseEvent) => {
      if (orderNoPopoverRef.current?.contains(e.target as Node)) return
      setOrderNoPicker(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [orderNoPicker])

  // 색상/스타일 문자열 파싱 (예: 'yellow::strike::bold::redtext' -> { color, strike, bold, redText })
  // 각 토큰은 '::'로 구분되며 배경색 / 취소선 / 볼드 / 빨간글자를 중복 지정할 수 있음 (하위호환 유지)
  const COLOR_NAMES = ['yellow', 'blue', 'red', 'green'];
  const parseColorState = (value: string | null | undefined): { color: string | null, strike: 'strike' | 'nostrike' | null, bold: boolean, redText: boolean } => {
    const empty = { color: null as string | null, strike: null as 'strike' | 'nostrike' | null, bold: false, redText: false };
    if (!value) return empty;
    const result = { ...empty };
    for (const token of value.split('::')) {
      if (!token) continue;
      if (COLOR_NAMES.includes(token)) result.color = token;
      else if (token === 'strike' || token === 'nostrike') result.strike = token;
      else if (token === 'bold') result.bold = true;
      else if (token === 'redtext') result.redText = true;
    }
    return result;
  };

  // 색상/스타일 상태 직렬화 (지정된 항목만 '::'로 이어붙임)
  const serializeColorState = (color: string | null, strike: 'strike' | 'nostrike' | null, bold = false, redText = false) => {
    const parts: string[] = [];
    if (color) parts.push(color);
    if (strike) parts.push(strike);
    if (bold) parts.push('bold');
    if (redText) parts.push('redtext');
    return parts.length ? parts.join('::') : null;
  };

  // 행 배경색 업데이트 핸들러
  const handleUpdateRowColor = useStableHandler(async (type: 'pcb' | 'cable', id: string, colorAction: string | null, isToggleStrike = false) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
      const list = type === 'pcb' ? filteredPcbs : filteredCables
      const currentItem = list.find(i => i.id === id)
      if (!currentItem) return
      // 납품 분할 그룹이면 그룹 전체 행의 색을 함께 변경 (색이 어긋나면 병합이 풀림)
      const targetIds = type === 'pcb' ? pcbGroupSiblings(id) : [id]
      pushRestoreUndo(type, targetIds, '행 색상 변경')

      const { color: curColor, strike: curStrike } = parseColorState(currentItem.row_color)
      
      let nextColor: string | null = curColor
      let nextStrike: 'strike' | 'nostrike' | null = curStrike
      
      if (isToggleStrike) {
        nextStrike = curStrike === 'strike' ? null : 'strike'
      } else if (colorAction === null) {
        nextColor = null
        nextStrike = null
      } else {
        nextColor = colorAction
      }
      
      const serialized = serializeColorState(nextColor, nextStrike)
      const { error } = await supabase.from(table).update({ row_color: serialized }).in('id', targetIds)
      if (error) throw error

      loadData()
      setActiveColorPicker(null)
      toast.success('행 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  })

  // 개별 셀 배경색 업데이트 핸들러
  const handleUpdateCellColor = useStableHandler(async (type: 'pcb' | 'cable', id: string, field: string, colorAction: string | null, currentCellColors: any, toggle: 'strike' | 'bold' | 'redtext' | null = null) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
      // 납품 분할 그룹의 병합된 앞 칼럼이면 그룹 전체 행의 칸 색을 함께 변경 (색이 어긋나면 병합이 풀림)
      const targetIds = type === 'pcb' && !HEADER_SPAN_GROUPS.pcbDelivery.includes(field)
        ? pcbGroupSiblings(id) : [id]
      // 되돌리기: 색상+편집중 텍스트를 한 번에 복원하도록 변경 전 행 전체 스냅샷
      pushRestoreUndo(type, targetIds, '칸 색상 변경')
      const newCellColors = { ...(currentCellColors || {}) }

      const currentVal = newCellColors[field]
      const { color: curColor, strike: curStrike, bold: curBold, redText: curRedText } = parseColorState(currentVal)

      let nextColor: string | null = curColor
      let nextStrike: 'strike' | 'nostrike' | null = curStrike
      let nextBold = curBold
      let nextRedText = curRedText

      if (toggle === 'strike') {
        const list = type === 'pcb' ? filteredPcbs : filteredCables
        const currentItem = list.find(i => i.id === id)
        const { strike: rowStrike } = parseColorState(currentItem?.row_color)

        const effectiveStrike = curStrike || rowStrike || null
        nextStrike = effectiveStrike === 'strike' ? 'nostrike' : 'strike'
      } else if (toggle === 'bold') {
        nextBold = !curBold
      } else if (toggle === 'redtext') {
        nextRedText = !curRedText
      } else if (colorAction === null) {
        nextColor = null
        nextStrike = null
        nextBold = false
        nextRedText = false
      } else {
        nextColor = colorAction
      }

      const serialized = serializeColorState(nextColor, nextStrike, nextBold, nextRedText)
      if (serialized === null) {
        delete newCellColors[field]
      } else {
        newCellColors[field] = serialized
      }
      
      // 형제 행은 각자의 cell_colors에 같은 필드 값만 반영 (납품 칸 색상 등 행별 차이는 보존)
      const results = await Promise.all(targetIds.map(tid => {
        if (tid === id) return supabase.from(table).update({ cell_colors: newCellColors }).eq('id', tid)
        const sibling = (type === 'pcb' ? filteredPcbs : filteredCables).find(i => i.id === tid)
        const siblingColors = { ...((sibling as any)?.cell_colors || {}) }
        if (serialized === null) { delete siblingColors[field] } else { siblingColors[field] = serialized }
        return supabase.from(table).update({ cell_colors: siblingColors }).eq('id', tid)
      }))
      const failed = results.find(r => r.error)
      if (failed?.error) throw failed.error
      
      // 색상 선택 시, 입력칸에 수정 중이던 텍스트도 자동으로 함께 저장하고 수정을 완료합니다.
      // (되돌리기 스냅샷은 위에서 이미 잡았으므로 중복 캡처 방지: captureUndo=false)
      await handleCellSave({ id, type, field }, editValue, false)
      setEditingCell(null)
      toast.success('칸 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  })

  // 셀 색상에 따른 배경색 클래스 매퍼
  const getCellBgClass = (color: string | null | undefined) => {
    if (color === 'red') return 'bg-red-200'
    if (color === 'green') return 'bg-emerald-100'
    if (color === 'yellow') return 'bg-amber-100'
    if (color === 'blue') return 'bg-blue-100'
    return ''
  }

  // 행 색상에 따른 sticky 셀 배경색 클래스 매퍼
  const getStickyBgClass = (rowColor: string | null | undefined) => {
    if (!rowColor) return 'bg-white group-hover:bg-[#fafafa]'
    if (rowColor === 'red') return 'bg-red-200'
    if (rowColor === 'green') return 'bg-emerald-100'
    if (rowColor === 'yellow') return 'bg-amber-100'
    if (rowColor === 'blue') return 'bg-blue-100'
    return 'bg-white group-hover:bg-[#fafafa]'
  }

  // 제작구분 그룹 순서 인덱스 (없는 카테고리는 맨 뒤로)
  const categoryRank = (cat: string): number => {
    const i = categoryOrder.indexOf(cat)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }

  // 카테고리 + 필터 규칙(AND) 적용 + 드래그한 제작구분 순서대로 그룹핑 (그룹 내부는 기존 정렬(제작번호 내림차순) 유지 — Array.sort는 안정 정렬)
  // 제작구분(카테고리)이 항상 1차 정렬(그룹 유지), 사용자 정렬 규칙은 같은 그룹 안에서의 2차 정렬
  const filteredPcbs = useMemo(() => pcbs
    .filter(item => pcbFilter.categories.includes(item.production_category))
    .filter(item => matchesSearch(item, pcbSearch))
    .filter(item => pcbFilter.rules.every(rule => applyFilterRule(item, rule)))
    .sort((a, b) => {
      const c = categoryRank(a.production_category) - categoryRank(b.production_category)
      return c !== 0 || pcbSort.length === 0 ? c : compareBySortRules(a, b, pcbSort)
    }),
    [pcbs, pcbFilter, categoryOrder, pcbSearch, pcbSort])
  const filteredCables = useMemo(() => cables
    .filter(item => cableFilter.categories.includes(item.production_category))
    .filter(item => matchesSearch(item, cableSearch))
    .filter(item => cableFilter.rules.every(rule => applyFilterRule(item, rule)))
    .sort((a, b) => {
      const c = categoryRank(a.production_category) - categoryRank(b.production_category)
      return c !== 0 || cableSort.length === 0 ? c : compareBySortRules(a, b, cableSort)
    }),
    [cables, cableFilter, categoryOrder, cableSearch, cableSort])

  // ─── 납품 분할 그룹: 납품 3칸(수량/일자/배송처) 외 모든 값이 같은 '연속' 행을 한 묶음으로 본다 ───
  // 분할 행은 앞 칼럼이 전부 동일 복제이므로, 렌더 시 첫 행의 앞 칼럼을 rowSpan으로 병합해
  // 앞부분은 한 행처럼 보이고 납품 칸만 행 단위로 나뉘게 한다. (정렬로 떨어져 있으면 병합하지 않음)
  const pcbGroupInfo = useMemo(() => {
    const keyOf = (item: any) => {
      const { id, created_at, updated_at, delivery_quantity, delivery_date, delivery_destination, cell_colors, ...rest } = item
      // 납품 칸의 셀 색상은 행마다 달라도 병합 판정에 영향 없도록 키에서 제외
      let cc = cell_colors
      if (cc && typeof cc === 'object') {
        const { delivery_quantity: _a, delivery_date: _b, delivery_destination: _c, ...ccRest } = cc
        cc = ccRest
      }
      return JSON.stringify({ ...rest, cell_colors: cc ?? null })
    }
    const map = new Map<string, { pos: number; size: number; ids: string[] }>()
    const keys = filteredPcbs.map(keyOf)
    let i = 0
    while (i < filteredPcbs.length) {
      let j = i + 1
      while (j < filteredPcbs.length && keys[j] === keys[i]) j++
      if (j - i >= 2) {
        const ids = filteredPcbs.slice(i, j).map((r: any) => r.id)
        ids.forEach((rid, pos) => map.set(rid, { pos, size: ids.length, ids }))
      }
      i = j
    }
    return map
  }, [filteredPcbs])
  // 분할 그룹 형제 행 id 목록 — 병합된 앞 칼럼 수정 시 그룹 전체에 같은 값을 저장해 병합이 깨지지 않게 한다
  const pcbGroupSiblings = (id: string): string[] => pcbGroupInfo.get(id)?.ids ?? [id]

  // 년도 드롭다운 옵션 = 로드된 데이터에서 해당 날짜 칼럼에 실제 존재하는 년도만 (내림차순)
  const yearsFor = (type: 'pcb' | 'cable', dateField: string): number[] => {
    const list: any[] = type === 'pcb' ? pcbs : cables
    const set = new Set<number>()
    for (const item of list) {
      const raw = item[dateField]
      const m = typeof raw === 'string' ? raw.match(/^(\d{4})-/) : null
      if (m) set.add(Number(m[1]))
    }
    return Array.from(set).sort((a, b) => b - a)
  }

  // 날짜 입력의 기본 월: 해당 테이블 필터에 월이 지정된 date_in 규칙이 있으면 그 월
  const defaultMonthFor = (type: 'pcb' | 'cable'): number | null => {
    const r = filterFor(type).rules.find(r => r.op === 'date_in' && r.month != null)
    return r?.month ?? null
  }

  // ─── 행 가상화(windowing): 스크롤 위치 기준 보이는 행만 렌더 ───────────
  // Excel/스프레드시트와 같은 원리 — 행이 얼마나 쌓여도 렌더 비용은 "화면에 보이는 분량"으로 고정.
  // 각 테이블을 세로 스크롤 컨테이너로 감싸고, tbody에 스페이서 <tr>로 전체 높이를 유지한다.
  const VIRTUAL_ROW_H = 27      // 행 높이 기본값(px) — 마운트 후 실제 행으로 실측 보정
  const VIRTUAL_BUFFER = 12     // 화면 밖 위/아래로 미리 렌더할 행 수
  const pcbScrollRef = useRef<HTMLDivElement>(null)
  const cableScrollRef = useRef<HTMLDivElement>(null)
  const [pcbWin, setPcbWin] = useState({ start: 0, end: 80 })
  const [cableWin, setCableWin] = useState({ start: 0, end: 80 })
  const rowHeightRef = useRef<{ pcb: number; cable: number }>({ pcb: VIRTUAL_ROW_H, cable: VIRTUAL_ROW_H })

  const recalcWindow = (type: 'pcb' | 'cable') => {
    const el = (type === 'pcb' ? pcbScrollRef : cableScrollRef).current
    if (!el) return
    const rowH = rowHeightRef.current[type]
    const start = Math.max(0, Math.floor(el.scrollTop / rowH) - VIRTUAL_BUFFER)
    const count = Math.ceil(el.clientHeight / rowH) + VIRTUAL_BUFFER * 2
    const setter = type === 'pcb' ? setPcbWin : setCableWin
    setter(w => (w.start === start && w.end === start + count) ? w : { start, end: start + count })
  }
  // 스크롤마다 직접 재계산 — setState는 값이 같으면 재렌더를 건너뛰고(레퍼런스 유지),
  // rAF 스로틀은 백그라운드 탭에서 콜백이 보류되는 함정이 있어 쓰지 않는다.
  const handleVirtualScroll = (type: 'pcb' | 'cable') => {
    recalcWindow(type)
  }
  // 데이터 변경 시 윈도우 재계산 + 실제 행 높이 실측(스페이서 정확도)
  useEffect(() => {
    for (const type of ['pcb', 'cable'] as const) {
      const el = (type === 'pcb' ? pcbScrollRef : cableScrollRef).current
      const tr = el?.querySelector('tbody tr[data-vrow]') as HTMLElement | null
      if (tr && tr.offsetHeight > 10) rowHeightRef.current[type] = tr.offsetHeight
      recalcWindow(type)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPcbs.length, filteredCables.length])

  // 렌더용 슬라이스/스페이서 (스페이서는 tbody 안 <tr>로 전체 스크롤 높이 유지)
  // 납품 분할 그룹이 창 경계에서 잘리면 rowSpan 병합의 첫 행이 빠져 레이아웃이 깨지므로 그룹 경계까지 확장
  let pcbWinStart = pcbWin.start
  while (pcbWinStart > 0 && (pcbGroupInfo.get(filteredPcbs[pcbWinStart]?.id)?.pos ?? 0) > 0) pcbWinStart--
  let pcbWinEnd = Math.min(pcbWin.end, filteredPcbs.length)
  while (pcbWinEnd < filteredPcbs.length && (pcbGroupInfo.get(filteredPcbs[pcbWinEnd]?.id)?.pos ?? 0) > 0) pcbWinEnd++
  const pcbVisibleRows = filteredPcbs.slice(pcbWinStart, pcbWinEnd)
  const pcbTopPad = Math.round(pcbWinStart * rowHeightRef.current.pcb)
  const pcbBottomPad = Math.round((filteredPcbs.length - pcbWinEnd) * rowHeightRef.current.pcb)
  const cableWinEnd = Math.min(cableWin.end, filteredCables.length)
  const cableVisibleRows = filteredCables.slice(cableWin.start, cableWinEnd)
  const cableTopPad = Math.round(cableWin.start * rowHeightRef.current.cable)
  const cableBottomPad = Math.round((filteredCables.length - cableWinEnd) * rowHeightRef.current.cable)

  // 셀에 표시되는 폰트 굵기: 실제 렌더링 클래스(font-semibold/medium/bold)와 동일하게 맞춰야 실측이 정확함
  const getFieldFontWeight = (field: string, value: unknown): number => {
    if (field === 'reference' || field === 'sales_order_number') return 600
    if (field === 'board_name') return 500
    // 납품기한은 D-1 경고 시에만 볼드, 나머지 날짜 칼럼은 일반 굵기
    if (field === 'delivery_deadline' && isDeadlineUrgent(value as string | null | undefined)) return 700
    return 400
  }

  const getColumnTitle = (field: string, type: 'pcb' | 'cable' = 'pcb'): string => {
    switch (field) {
      // 고정(sticky) 칼럼: 헤더가 하드코딩되어 있어 여기서도 실제 헤더 문구와 일치시켜야
      // 데이터가 없을 때(본문 실측값이 없을 때) 칼럼 폭이 헤더 제목에 딱 맞게 계산됨
      case 'production_category': return '제작구분'
      case 'board_name': return type === 'cable' ? '품명' : '보드명'
      case 'request_date': return '요청일'
      case 'estimate_no': return '견적NO.'
      case 'delivery_deadline': return '납품기한'
      case 'client_name': return '업체'
      case 'client_manager': return '업체 담당자'
      case 'hansl_manager': return 'HANSL'
      case 'creator': return '작성자'
      case 'revision_count': return '횟수'
      case 'quantity': return '수량'
      case 'artwork_status': return 'ARTWORK'
      case 'metal_mask': return 'MetalMask'
      case 'pcb_vendor': return 'PCB업체'
      case 'delivery_schedule': return '입고(일정)'
      case 'stock_count': return '재고'
      case 'changes_memo': return '수정 또는 변경사항'
      case 'pcb_lead_time': return '제작 기간(PCB)'
      case 'received_quantity': return '입고(수량)'
      case 'received_destination': return '입고처'
      case 'pcb_stock_completed': return '입고완료'
      case 'production_type': return '구분'
      case 'parts_organization': return '부품정리'
      case 'assy_hanwha': return '환화'
      case 'assy_evertech': return '에버텍'
      case 'assy_requested_date': return '입고요청일'
      case 'final_product_stock': return '완제품 입고'
      case 'qa_passed': return '양품'
      case 'qa_failed': return '불량'
      case 'qa_notes': return '비고'
      case 'design_review': return '디자인리뷰'
      case 'delivery_quantity': return '수량'
      case 'delivery_date': return '일자'
      case 'delivery_destination': return '배송처'
      case 'delivery_completed': return '배송완료'
      case 'spec_details': return '사양'
      case 'cable_vendor': return '업체'
      case 'cable_requested_date': return '입고 요청일'
      case 'cable_actual_date': return '실제 입고일'
      case 'delivery_notes': return '납품/비고'
      case 'reference': return '참고'
      case 'sales_order_number': return '제작 번호'
      default: return '내용'
    }
  }

  const getDisplayValueForField = (type: 'pcb' | 'cable', field: string, item: any): string => {
    if (!item) return '-'
    const val = item[field]
    
    // Date fields
    const dateFields = [
      'request_date', 'delivery_deadline', 'delivery_schedule',
      'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'
    ]
    if (dateFields.includes(field)) {
      return formatDbDateToDisplay(val)
    }
    
    if (val === null || val === undefined || val === '') return '-'
    // 완제품입고는 ISO로 저장되고 'MM월 DD일'로 표시되므로 실측도 표시값 기준
    if (field === 'final_product_stock') return formatStockInDisplay(val.toString())
    // 입고완료/배송완료는 ISO로 저장되고 'M/D 완료'로 표시되므로 실측도 표시값 기준
    if (field === 'pcb_stock_completed' || field === 'delivery_completed') return formatCompletedDisplay(val.toString())
    // URL은 화면에 '링크'로 축약 표시되므로 폭 실측도 동일 기준으로
    return collapseUrlsForMeasure(val.toString())
  }

  // ─── 다운로드/인쇄용: 필터 적용된 화면 그대로 내보내기 ──────────────────
  // 내보낼 칼럼 = 각 표의 본문 칼럼 목록(제작 번호 포함) (화면에서 숨긴 칼럼은 좌측 고정 칼럼 포함 모두 내보내기에서도 제외)
  const exportColumnsFor = (type: 'pcb' | 'cable'): string[] =>
    (type === 'pcb' ? pcbColumns : cableColumns).filter(f => !isColHidden(type, f))

  // 내보내기용 셀 값: 화면 표시와 동일하되 URL은 링크로 축약하지 않고 원문 유지, 빈 값은 공백
  const getExportValue = (type: 'pcb' | 'cable', field: string, item: any): string => {
    const val = item?.[field]
    const dateFields = [
      'request_date', 'delivery_deadline', 'delivery_schedule',
      'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'
    ]
    if (dateFields.includes(field)) {
      const d = formatDbDateToDisplay(val)
      return d === '-' ? '' : d
    }
    if (val === null || val === undefined || val === '') return ''
    if (field === 'final_product_stock') return formatStockInDisplay(val.toString())
    if (field === 'pcb_stock_completed' || field === 'delivery_completed') return formatCompletedDisplay(val.toString())
    return val.toString()
  }

  const exportRowsFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? filteredPcbs : filteredCables)
  const exportTitleFor = (type: 'pcb' | 'cable') =>
    type === 'pcb' ? 'PCB & Socket Board 제작 현황' : 'Cable & Case 제작 현황'

  // 한국시간 기준 YYYYMMDD (파일명/인쇄 헤더용)
  const kstDateStamp = (): string => {
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const y = kst.getFullYear()
    const m = String(kst.getMonth() + 1).padStart(2, '0')
    const d = String(kst.getDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }

  // 엑셀(.xlsx) 다운로드 — 필터 적용된 현재 표를 그대로 시트로 저장
  const handleExportExcel = async (type: 'pcb' | 'cable') => {
    try {
      const rows = exportRowsFor(type)
      if (rows.length === 0) {
        toast.error('내보낼 데이터가 없습니다.')
        return
      }
      const cols = exportColumnsFor(type)
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(type === 'pcb' ? 'PCB' : 'Cable')

      // 헤더: NO. + 각 칼럼 제목
      const headers = ['NO.', ...cols.map(f => getColumnTitle(f, type))]
      const headerRow = ws.addRow(headers)
      headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        }
      })

      // 본문
      rows.forEach((item, i) => {
        const values = [i + 1, ...cols.map(f => getExportValue(type, f, item))]
        const r = ws.addRow(values)
        r.eachCell(cell => {
          cell.font = { size: 10 }
          cell.alignment = { vertical: 'top', wrapText: true }
          cell.border = {
            top: { style: 'hair', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
            left: { style: 'hair', color: { argb: 'FFE5E7EB' } },
            right: { style: 'hair', color: { argb: 'FFE5E7EB' } },
          }
        })
      })

      // 칼럼 폭: 헤더/본문 최장 길이 기준으로 대략 맞춤 (한글 가중치 고려)
      ws.columns.forEach((col, idx) => {
        const field = idx === 0 ? 'NO.' : cols[idx - 1]
        let max = idx === 0 ? 4 : getColumnTitle(field, type).length * 1.8
        rows.forEach(item => {
          if (idx === 0) return
          const s = getExportValue(type, field, item)
          const firstLine = s.split('\n').reduce((a, b) => (b.length > a.length ? b : a), '')
          const w = [...firstLine].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 127 ? 1.8 : 1), 0)
          if (w > max) max = w
        })
        col.width = Math.min(Math.max(max + 2, 6), 50)
      })
      ws.views = [{ state: 'frozen', ySplit: 1 }]

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `제작현황_${type === 'pcb' ? 'PCB' : 'Cable'}_${kstDateStamp()}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('엑셀 파일을 다운로드했습니다.')
    } catch (err) {
      console.error(err)
      toast.error('엑셀 다운로드에 실패했습니다.')
    }
  }

  // 인쇄 — 필터 적용된 현재 표를 인쇄용 레이아웃(가로, 작은 글씨)으로 새 창에 그려 인쇄창 호출
  const handlePrint = (type: 'pcb' | 'cable') => {
    const rows = exportRowsFor(type)
    if (rows.length === 0) {
      toast.error('인쇄할 데이터가 없습니다.')
      return
    }
    const cols = exportColumnsFor(type)
    const esc = (s: string) => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br/>')

    const headCells = ['NO.', ...cols.map(f => getColumnTitle(f, type))]
      .map(h => `<th>${esc(h)}</th>`).join('')
    const bodyRows = rows.map((item, i) => {
      const tds = [`<td class="c">${i + 1}</td>`, ...cols.map(f =>
        `<td>${esc(getExportValue(type, f, item))}</td>`)].join('')
      return `<tr>${tds}</tr>`
    }).join('')

    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const stamp = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`
    const title = `${exportTitleFor(type)} (${rows.length}건)`

    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; margin: 0; color: #111; }
  h1 { font-size: 13px; margin: 0 0 2px; }
  .meta { font-size: 9px; color: #666; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; table-layout: auto; }
  th, td { border: 0.5px solid #cbd1d8; padding: 2px 4px; font-size: 8px; line-height: 1.25;
           text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #f3f4f6; font-weight: 700; text-align: center; }
  td.c { text-align: center; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">출력일: ${stamp} · 필터 적용된 화면 기준</div>
  <table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`

    const w = window.open('', '_blank')
    if (!w) {
      toast.error('팝업이 차단되어 인쇄창을 열 수 없습니다. 팝업 허용 후 다시 시도해주세요.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    // 렌더 완료 후 인쇄창 호출
    setTimeout(() => { w.print() }, 300)
  }

  // 칼럼 너비 = Max(헤더 실측, 가장 긴 본문 실측) + 좌우 여백(5px씩) [+ 비고정 칼럼은 우측 보더 1px]
  const computeColumnWidth = (type: 'pcb' | 'cable', field: string): number => {
    // 1. 헤더 실측 (table-header-text: 600 굵기, letter-spacing 0.02em)
    const title = getColumnTitle(field, type)
    const titleWidth = measureText(title, 600, HEADER_LETTER_SPACING)

    // 2. 모든 행(입력 중인 신규 행 포함)의 표시값 실측 — 표시 굵기 그대로 반영
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    const addingRow = type === 'pcb' ? addingPcbRow : addingCableRow
    const rows: any[] = addingRow ? [...list, addingRow] : list

    let maxValWidth = 0
    for (const item of rows) {
      let valStr = getDisplayValueForField(type, field, item)
      // 줄바꿈 셀은 접힘 상태(첫 줄 + `(+N)🔽` 배지) 기준으로 폭을 잡아 가로로 길어지지 않게 한다.
      let multilineExtra = 0
      if (valStr.includes('\n')) { valStr = valStr.split('\n')[0]; multilineExtra = 34 }
      // 취소선 셀은 font-normal(400)로 렌더되므로 같은 굵기로 측정 (renderEditableCell의 isStruck 로직과 동일)
      const cState = parseColorState(item.cell_colors?.[field])
      const rState = parseColorState(item.row_color)
      const isStruck = cState.strike === 'strike' ? true : cState.strike === 'nostrike' ? false : (rState.strike === 'strike')
      const isBold = cState.bold || rState.bold
      const weight = isBold ? 700 : (isStruck ? 400 : getFieldFontWeight(field, item[field]))
      const w = measureText(valStr, weight) + multilineExtra
      if (w > maxValWidth) maxValWidth = w
    }

    // 3. 좌우 여백 5px씩 + (border-r을 쓰는 비고정 칼럼은 border-box라 1px 보정)
    const borderAllowance = STICKY_FIELDS.includes(field) ? 0 : 1
    const contentWidth = Math.max(titleWidth, maxValWidth) + COLUMN_PADDING_SIDE * 2 + borderAllowance
    // 평균 데이터 기반 최소 폭(바닥값)은 "표에 데이터가 하나도 없을 때"만 적용해 입력 여유 공간을 확보한다.
    // 표에 데이터가 있으면 각 칼럼을 헤더/실제 데이터 폭에 맞춰 핏하게 축소 (빈 칼럼은 헤더 크기로 줄어듦).
    const floor = list.length === 0 ? (MIN_COLUMN_WIDTH[type][field] ?? 0) : 0
    return Math.ceil(Math.max(contentWidth, floor))
  }

  // 칼럼폭 캐시: 렌더마다 (호출 지점 수 × 전체 행) canvas 실측이 돌던 것을
  // 데이터가 바뀔 때 한 번만 전 칼럼 일괄 계산하도록 메모화 (전체 보기 1,000행+ 성능의 핵심)
  const pcbColumnWidths = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of Object.keys(MIN_COLUMN_WIDTH.pcb)) out[f] = computeColumnWidth('pcb', f)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPcbs, addingPcbRow, fontsLoaded])
  const cableColumnWidths = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of Object.keys(MIN_COLUMN_WIDTH.cable)) out[f] = computeColumnWidth('cable', f)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredCables, addingCableRow, fontsLoaded])

  const getColumnWidth = (type: 'pcb' | 'cable', field: string, _defaultWidth: number): number => {
    const cached = (type === 'pcb' ? pcbColumnWidths : cableColumnWidths)[field]
    return cached !== undefined ? cached : computeColumnWidth(type, field)
  }

  const getHeaderStyle = (type: 'pcb' | 'cable', field: string, defaultWidth: number): React.CSSProperties => {
    if (isColHidden(type, field)) return { display: 'none' } // 숨긴 칼럼: 헤더 셀을 레이아웃에서 제거
    const w = getColumnWidth(type, field, defaultWidth)
    return {
      width: `${w}px`,
      minWidth: `${w}px`,
      maxWidth: `${w}px`
    }
  }

  const salesOrderPcbWidth = getColumnWidth('pcb', 'sales_order_number', 96)
  const salesOrderCableWidth = getColumnWidth('cable', 'sales_order_number', 96)
  const productionCategoryPcbWidth = getColumnWidth('pcb', 'production_category', 80)
  const productionCategoryCableWidth = getColumnWidth('cable', 'production_category', 80)
  const pcbBoardWidth = getColumnWidth('pcb', 'board_name', 150)
  const cableBoardWidth = getColumnWidth('cable', 'board_name', 150)
  const referencePcbWidth = getColumnWidth('pcb', 'reference', 50)
  const referenceCableWidth = getColumnWidth('cable', 'reference', 50)
  const requestDatePcbWidth = getColumnWidth('pcb', 'request_date', 80)
  const requestDateCableWidth = getColumnWidth('cable', 'request_date', 80)

  // 숨겨진 칼럼을 고려한 sticky 칼럼의 좌측 위치 동적 계산
  // NO.(40px 고정) 다음부터 STICKY_FIELDS 순서대로, 앞의 sticky 칼럼 중 '표시 중인' 것만 폭을 누적한다.
  const stickyLeftFor = (type: 'pcb' | 'cable', field: string): number => {
    const NO_WIDTH = 40 // 좌측 NO. 칼럼 고정 폭
    let left = NO_WIDTH
    const widths: Record<string, number> = type === 'pcb'
      ? { sales_order_number: salesOrderPcbWidth, production_category: productionCategoryPcbWidth, board_name: pcbBoardWidth, reference: referencePcbWidth, request_date: requestDatePcbWidth }
      : { sales_order_number: salesOrderCableWidth, production_category: productionCategoryCableWidth, board_name: cableBoardWidth, reference: referenceCableWidth, request_date: requestDateCableWidth }

    for (const f of STICKY_FIELDS) {
      if (f === field) return left
      if (!isColHidden(type, f)) left += widths[f] || 0
    }
    return left
  }

  // sticky 헤더(th) 전용 스타일: 숨김이면 레이아웃에서 제거, 아니면 동적 left + 칼럼 폭
  const getStickyHeaderStyle = (type: 'pcb' | 'cable', field: string): React.CSSProperties => {
    if (isColHidden(type, field)) return { display: 'none' }
    const w = getColumnWidth(type, field, 0)
    return {
      zIndex: 40,
      left: `${stickyLeftFor(type, field)}px`,
      width: `${w}px`,
      minWidth: `${w}px`,
      maxWidth: `${w}px`,
    }
  }

  // 인라인 수정용 공통 렌더러 함수
  // 줄바꿈이 있는 셀: 첫 줄만 + `(+N)` 배지 + 이모티콘 토글. 펼치면 그 셀만 세로로 확장돼 전체 표시.
  const renderCellDisplayValue = (id: string, field: string, displayValue: any): React.ReactNode => {
    const onLinkClick = () => setSelectedCells([`${id}::${field}`])
    if (typeof displayValue !== 'string' || !displayValue.includes('\n')) {
      return renderCellValueWithLinks(displayValue, onLinkClick)
    }
    const lines = displayValue.split('\n')
    const hidden = lines.length - 1
    const expanded = expandedCells.has(`${id}::${field}`)
    const toggleBtn = (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggleCellExpand(id, field) }}
        className="shrink-0 leading-none text-[10px] hover:opacity-70 transition-opacity"
        title={expanded ? '접기' : '펼치기'}
      >
        {expanded ? '🔼' : '🔽'}
      </button>
    )
    if (!expanded) {
      return (
        <span className="flex items-center gap-1 whitespace-nowrap min-w-0">
          <span className="shrink-0 text-[10px] text-gray-400 font-semibold">(+{hidden})</span>
          {toggleBtn}
          <span className="truncate min-w-0">{renderCellValueWithLinks(lines[0], onLinkClick)}</span>
        </span>
      )
    }
    return (
      <span className="flex items-start gap-2">
        {toggleBtn}
        <span className="whitespace-pre-line break-words">{renderCellValueWithLinks(displayValue, onLinkClick)}</span>
      </span>
    )
  }

  const renderEditableCell = (
    id: string,
    type: 'pcb' | 'cable',
    field: string,
    item: any,
    displayValue: any,
    cellClassName = '',
    inputType: 'text' | 'number' | 'select' = 'text',
    selectOptions: string[] = []
  ) => {
    if (isColHidden(type, field)) return null // 숨긴 칼럼은 셀 자체를 렌더하지 않음 (헤더 display:none과 짝)
    const isEditing = editingCell?.id === id && editingCell?.type === type && editingCell?.field === field
    const cellStyle: React.CSSProperties = {}

    if (STICKY_FIELDS.includes(field)) {
      // sticky 칼럼: 숨겨진 칼럼을 고려한 left 위치 + 해당 칼럼 폭
      const w = getColumnWidth(type, field, 0)
      cellStyle.left = `${stickyLeftFor(type, field)}px`
      cellStyle.width = `${w}px`
      cellStyle.minWidth = `${w}px`
      cellStyle.maxWidth = `${w}px`
    } else {
      // 본문 칼럼
      const activeWidth = getColumnWidth(type, field, 0)
      cellStyle.width = `${activeWidth}px`
      cellStyle.minWidth = `${activeWidth}px`
      cellStyle.maxWidth = `${activeWidth}px`
    }

    // inline=true면 팝오버 안(입력창 아래)에 흐름대로 넣고, false면 셀 위에 absolute로 띄운다.
    const renderCellColorPicker = (inline = false) => {
      const cellVal = item.cell_colors?.[field];
      const { color: activeColor, strike: isCellStruck, bold: isCellBold, redText: isCellRedText } = parseColorState(cellVal);

      const pickerBody = (
        <div
          className={inline
            ? "mt-1.5 pt-1.5 border-t border-gray-200 flex flex-col gap-1"
            : "bg-white border border-gray-200 rounded-md shadow-lg p-1 flex flex-col gap-1"}
          style={inline ? undefined : { width: 'max-content' }}
        >
          {/* 1행: 배경색 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, 'yellow', item.cell_colors);
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border transition-colors text-[9px] text-amber-700 font-medium shrink-0 ${activeColor === 'yellow' ? 'border-amber-500 ring-1 ring-amber-400 font-bold bg-amber-100' : 'border-amber-200 hover:bg-amber-100'}`}
              title="신규"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>신규</span>
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, 'blue', item.cell_colors);
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border transition-colors text-[9px] text-blue-700 font-medium shrink-0 ${activeColor === 'blue' ? 'border-blue-500 ring-1 ring-blue-400 font-bold bg-blue-100' : 'border-blue-200 hover:bg-blue-100'}`}
              title="재발주"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span>재발주</span>
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, 'red', item.cell_colors);
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border transition-colors text-[9px] text-red-700 font-medium shrink-0 ${activeColor === 'red' ? 'border-red-500 ring-1 ring-red-400 font-bold bg-red-100' : 'border-red-200 hover:bg-red-100'}`}
              title="취소"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>취소</span>
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, null, item.cell_colors);
              }}
              className="text-[9px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1 py-0 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
              title="색상 초기화"
            >
              초기화
            </button>
          </div>
          {/* 2행: 글자 스타일 (볼드 / 빨간 글자 / 취소선) — 배경색과 중복 지정 가능 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, null, item.cell_colors, 'bold');
              }}
              className={`flex items-center justify-center px-2 py-0.5 rounded-full border transition-colors text-[10px] font-bold shrink-0 ${isCellBold ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-900' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'}`}
              title="볼드"
            >
              B
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, null, item.cell_colors, 'redtext');
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-colors text-[9px] shrink-0 ${isCellRedText ? 'bg-red-50 border-red-500 ring-1 ring-red-400' : 'bg-white border-gray-300 hover:bg-red-50'}`}
              title="글자 빨간색"
            >
              <span className="text-red-600 font-bold">빨강</span>
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdateCellColor(type, id, field, null, item.cell_colors, 'strike');
              }}
              className={`flex items-center justify-center px-2 py-0.5 rounded-full border transition-colors text-[10px] font-bold shrink-0 ${isCellStruck ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
              title="취소선"
            >
              <span className="line-through">가</span>
            </button>
          </div>
        </div>
      );
      // 셀 위에 띄우는 단독 색상피커는 테이블 박스에 잘리지 않게 최상위 레이어로 (기본은 셀 위쪽)
      return inline ? pickerBody : <CellPopoverPortal prefer="above">{pickerBody}</CellPopoverPortal>;
    };

    if (isEditing) {
      const editCellStyle = { ...cellStyle, overflow: 'visible', zIndex: 50 }
      if (field === 'artwork_status') {
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <span className="text-[10px] text-gray-400 truncate block px-1">
              {formatArtworkDisplay(editValue) || ' '}
            </span>
            <CellPopoverPortal
              className="bg-white border border-gray-300 rounded-md shadow-lg p-1.5"
              style={{ width: 'max-content', minWidth: '150px' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ArtworkStatusEditor
                value={editValue}
                onChange={setEditValue}
                autoFocusMemo
                onCommit={() => {
                  handleCellSave({ id, type, field }, editValue)
                  setEditingCell(null)
                }}
                onCancel={() => setEditingCell(null)}
              />
              {/* 색상 피커도 함께 표시 (다른 편집 셀과 동일) */}
              {renderCellColorPicker(true)}
            </CellPopoverPortal>
          </td>
        )
      }
      if (field === 'parts_organization') {
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <span className="text-[10px] text-gray-400 truncate block px-1">
              {formatPartsDisplay(editValue) || ' '}
            </span>
            <CellPopoverPortal
              className="bg-white border border-gray-300 rounded-md shadow-lg p-1.5"
              style={{ width: 'max-content', minWidth: '150px' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <PartsStatusEditor
                value={editValue}
                onChange={setEditValue}
                autoFocusMemo
                onCommit={() => {
                  handleCellSave({ id, type, field }, editValue)
                  setEditingCell(null)
                }}
                onCancel={() => setEditingCell(null)}
              />
              {/* 색상 피커도 함께 표시 (다른 편집 셀과 동일) */}
              {renderCellColorPicker(true)}
            </CellPopoverPortal>
          </td>
        )
      }
      if (inputType === 'select') {
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <select
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                handleCellSave({ id, type, field }, editValue)
                setEditingCell(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCellSave({ id, type, field }, editValue)
                  setEditingCell(null)
                  moveSelectionDown(id, type, field)
                }
                if (e.key === 'Escape') setEditingCell(null)
              }}
              className="w-full h-5 bg-white border border-gray-300 rounded px-1 py-0 text-[11px] focus:outline-none"
              style={{ appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234b5563' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 3px center', backgroundSize: '8px 8px', paddingRight: '12px' }}
            >
              {selectOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {renderCellColorPicker()}
          </td>
        )
      }
      
      let listId: string | undefined = undefined
      let datalistNode: React.ReactNode = null
      
      if (field === 'client_name' || field === 'pcb_vendor') {
        listId = 'vendors-list'
      } else if (field === 'client_manager') {
        listId = `contacts-list-${id}`
        const parentVendorName = item.client_name || ''
        const contacts = vendors.find(v => v.vendor_name === parentVendorName)?.vendor_contacts || []
        datalistNode = (
          <datalist id={listId}>
            {contacts.map((c: any, i: number) => (
              <option key={i} value={c.contact_name} />
            ))}
          </datalist>
        )
      } else if (field === 'hansl_manager') {
        listId = 'employees-list'
      }

      // 좁은 칼럼이거나 메모성 칼럼은 셀 아래에 말풍선(팝오버)으로 넉넉한 입력창을 띄운다.
      // 메모성은 여러 줄 textarea, 나머지는 넓은 input.
      const colW = getColumnWidth(type, field, 0)
      const isMemoField = MEMO_TEXT_FIELDS.includes(field)
      const usePopover = isMemoField || colW < 140
      const commit = () => { handleCellSave({ id, type, field }, editValue); setEditingCell(null) }

      if (usePopover) {
        // 메모 입력폭: 가장 긴 줄이 접히지 않고 다 보이도록 300px에서 150px 단위로 계단식 확장 (최대 750px).
        // 폭이 글자에 딱 맞춰 실시간으로 늘지 않아, 화면상 줄바꿈 = 실제 Enter 줄바꿈으로 구분된다.
        // 기존 저장된 메모도 편집 열자마자 같은 규칙으로 넓게 열린다.
        const memoLines = String(editValue ?? '').split('\n')
        const longestLinePx = Math.max(0, ...memoLines.map(l => measureText(l, 400))) * 1.1 + 28
        let memoWidth = 300
        while (memoWidth < longestLinePx && memoWidth < 750) memoWidth += 150
        // 세로도 줄 수만큼 다 보이게 (최소 3줄) — 화면을 벗어날 만큼 길 때만 maxHeight로 잘리고 스크롤
        const memoRows = Math.max(3, memoLines.length)
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <span className="block text-[10px] text-gray-400 truncate px-1">{String(editValue || ' ')}</span>
            {/* 메모는 폭을 컨테이너에 직접 지정 — textarea 인라인 width만 바꾸면 컨테이너의
                shrink-to-fit 재계산이 안 일어나는(Chromium) 문제가 있어 컨테이너 폭으로 제어한다. */}
            <CellPopoverPortal
              className="bg-white border border-gray-300 rounded-md shadow-lg p-1.5"
              style={isMemoField
                ? { width: `${memoWidth + 14}px`, maxWidth: '780px' }
                : { minWidth: '220px', maxWidth: '360px' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {field === 'delivery_quantity' && type === 'pcb' ? (
                // 납품 수량: 제목 좌측 끝에 개수 입력 + 분할 버튼 — N개 행으로 분할 (앞 칼럼 복제, 납품 3칸은 빈 상태)
                <div className="flex items-center justify-between gap-2 mb-1 px-0.5" data-split-ui>
                  <span className="flex items-center text-[9px] text-gray-500 shrink-0">
                    <input
                      ref={splitInputRef}
                      type="number"
                      min={2}
                      max={50}
                      defaultValue={2}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleSplitDelivery(id, parseInt(splitInputRef.current?.value || '', 10))
                        }
                        if (e.key === 'Escape') setEditingCell(null)
                      }}
                      className="w-7 h-4 border border-gray-300 rounded px-0.5 text-[9px] text-center focus:outline-none focus:border-[#1777CB]"
                      title="분할 개수"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSplitDelivery(id, parseInt(splitInputRef.current?.value || '', 10))
                      }}
                      className="ml-0.5 px-1.5 py-0 rounded border border-[#1777CB]/40 bg-blue-50 text-[#1777CB] text-[9px] font-semibold hover:bg-blue-100 transition-colors"
                      title="이 제작 항목을 N개 납품 행으로 분할"
                    >
                      분할
                    </button>
                  </span>
                  <span className="text-[9px] font-semibold text-gray-400">{getColumnTitle(field, type)}</span>
                </div>
              ) : (
                <div className="text-[9px] font-semibold text-gray-400 mb-1 px-0.5">{getColumnTitle(field, type)}</div>
              )}
              {isMemoField ? (
                <textarea
                  autoFocus
                  rows={memoRows}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    // Enter=저장(후 아래 셀로 이동), Shift+Enter=줄바꿈
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); moveSelectionDown(id, type, field) }
                    if (e.key === 'Escape') setEditingCell(null)
                  }}
                  placeholder={`${getColumnTitle(field, type)} 입력 (Enter 저장 · Shift+Enter 줄바꿈)`}
                  className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-[11px] leading-snug focus:outline-none focus:border-[#1777CB] resize-y"
                  style={{ maxHeight: '55vh' }}
                />
              ) : (
                <input
                  autoFocus
                  type={inputType}
                  list={listId}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={(e) => {
                    // 분할 입력칸으로 포커스가 이동한 경우엔 저장/닫기하지 않는다 (팝오버 유지)
                    const to = e.relatedTarget as HTMLElement | null
                    if (to && to.closest?.('[data-split-ui]')) return
                    commit()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { commit(); moveSelectionDown(id, type, field) }
                    if (e.key === 'Escape') setEditingCell(null)
                  }}
                  placeholder={`${getColumnTitle(field, type)} 입력`}
                  className="w-full h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:border-[#1777CB]"
                  style={{ width: '220px' }}
                />
              )}
              {/* 색상 피커를 입력창 바로 아래에 함께 표시 */}
              {renderCellColorPicker(true)}
            </CellPopoverPortal>
            {datalistNode}
          </td>
        )
      }

      return (
        <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
          <input
            autoFocus
            type={inputType}
            list={listId}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commit(); moveSelectionDown(id, type, field) }
              if (e.key === 'Escape') setEditingCell(null)
            }}
            className={`w-full h-5 bg-white border border-gray-300 rounded px-1.5 py-0 text-[10px] focus:outline-none ${field === 'reference' ? 'text-red-500 font-semibold align-left' : ''}${field === 'board_name' ? ' align-left' : ''}`}
          />
          {datalistNode}
          {renderCellColorPicker()}
        </td>
      )
    }

    let computedClassName = cellClassName
    const isDateField = field.endsWith('_date') || field.endsWith('_deadline') || field.endsWith('_schedule') || field === 'final_product_stock' || field === 'pcb_stock_completed' || field === 'delivery_completed';
    const hasValue = item[field] !== null && item[field] !== undefined && item[field] !== '';
    if (isDateField && hasValue) {
      if (field === 'delivery_deadline' && isDeadlineUrgent(item[field])) {
        // 납품기한: 한국시간 기준 D-1이 된 순간부터 빨간색 볼드 + 밑줄로 경고
        computedClassName = computedClassName.replace('text-gray-500', '') + ' font-bold text-red-600 underline'
      } else {
        // 그 외 날짜 칼럼은 볼드 없이 검정 텍스트
        computedClassName += ' text-gray-900'
      }
    }

    const cState = parseColorState(item.cell_colors?.[field]);
    const rState = parseColorState(item.row_color);
    
    // 이 셀 자체의 명시적인 하이픈(취소선) 설정이 최우선이고, 없을 시 행 전체 하이픈 설정을 상속받음
    const isStruck = cState.strike === 'strike' ? true :
                     cState.strike === 'nostrike' ? false :
                     (rState.strike === 'strike');

    // 볼드 / 빨간 글자: 셀 우선, 없으면 행 설정 상속 (취소선과 중복 적용 가능)
    const isBold = cState.bold || rState.bold;
    const isRedText = cState.redText || rState.redText;

    if (isStruck) {
      computedClassName = computedClassName
        .replace('text-gray-900', '')
        .replace('text-gray-500', '')
        .replace('text-red-500', '')
        .replace('text-red-600', '')
        .replace('font-semibold', '')
        .replace('font-bold', '')
        .replace('underline', '')
        + ' line-through text-gray-400 font-normal'
    }

    // 볼드: 취소선의 font-normal 및 기본 굵기를 덮어씀
    if (isBold) {
      computedClassName = computedClassName
        .replace('font-normal', '')
        .replace('font-semibold', '')
        + ' font-bold'
    }

    // 빨간 글자: 취소선의 회색 텍스트 및 기본 텍스트 색을 덮어씀
    if (isRedText) {
      computedClassName = computedClassName
        .replace('text-gray-900', '')
        .replace('text-gray-500', '')
        .replace('text-gray-400', '')
        .replace('text-red-500', '')
        + ' text-red-600'
    }

    if (cellClassName.includes('sticky')) {
      computedClassName = computedClassName
        .replace('bg-white', '')
        .replace('group-hover:bg-[#fafafa]', '')
        + ' ' + (cState.color ? getStickyBgClass(cState.color) : getStickyBgClass(rState.color))
    } else {
      const activeColor = cState.color || rState.color;
      if (activeColor) {
        computedClassName = computedClassName
          .replace('bg-white', '')
          .replace('group-hover:bg-gray-50/50', '')
        if (cState.color) {
          computedClassName += ' ' + getCellBgClass(cState.color)
        }
      }
    }

    const isSelected = selectedCellsSet.has(`${id}::${field}`);
    const isStickyCell = cellClassName.includes('sticky');
    const selectStyle: React.CSSProperties = isSelected ? {
      outline: '1.5px solid #3b82f6',
      outlineOffset: '-1.5px',
      // 고정 칼럼은 반투명 배경을 주면 가로 스크롤 시 뒤의 비고정 칼럼이 비쳐 보이므로,
      // 원래의 불투명 배경(흰색/셀 색상)을 유지한 채 테두리만 표시한다.
      ...(isStickyCell ? {} : { backgroundColor: 'rgba(59, 130, 246, 0.1)' }),
      ...cellStyle
    } : cellStyle;

    // 완제품 입고/입고완료/배송완료: 값이 비어 있으면 대기 버튼 표시 (클릭 시 날짜 선택 팝오버)
    const isStockWaiting = (field === 'final_product_stock' || field === 'cable_actual_date' || field === 'pcb_stock_completed' || field === 'delivery_completed') &&
      (item[field] == null ||
       String(item[field]).trim() === '' ||
       String(item[field]).trim() === '-')
    const isStockPickerOpen = isStockWaiting && !!stockInPicker &&
      stockInPicker.id === id && stockInPicker.type === type && stockInPicker.field === field

    // 선택된 셀은 transition-colors를 제거해 하이라이트가 150ms 페이드 없이 즉시 나타나게 한다
    const tdClassName = `${computedClassName} cursor-pointer ${item.row_color || item.cell_colors?.[field] ? '' : 'hover:bg-gray-100/50'} transition-colors select-none${isStockPickerOpen ? ' relative' : ''}`
    return (
      <td
        data-cell={`${id}::${field}`}
        className={isSelected ? tdClassName.replace(/\btransition-colors\b/g, '') : tdClassName}
        style={isStockPickerOpen ? { ...selectStyle, overflow: 'visible', zIndex: 50 } : selectStyle}
        onMouseDown={(e) => handleCellMouseDown(e, id, field, type)}
        onMouseEnter={(e) => handleCellMouseEnter(e, id, field, type)}
        onClick={isStockWaiting
          ? (e) => { e.stopPropagation(); handleStockInPress(id, type, field) }
          : () => handleCellClick(id, type, field, item[field])}
        title={field === 'board_name' ? item.board_name : undefined}
      >
        {isStockWaiting ? (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleStockInPress(id, type, field) }}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
            >
              {STOCK_WAITING_LABEL[field] || '입고대기'}
            </button>
            {isStockPickerOpen && (
              <CellPopoverPortal
                innerRef={stockInPopoverRef}
                className="bg-white border border-gray-300 rounded-md shadow-lg p-1.5 cursor-default text-left"
                style={{ width: 'max-content' }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-[9px] font-semibold text-gray-400 mb-1 px-0.5">{stockPickerLabel(field)} — 직접 입력 또는 달력에서 선택</div>
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={stockInInput}
                    onChange={(e) => setStockInInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitStockIn(stockInInput)
                      if (e.key === 'Escape') setStockInPicker(null)
                    }}
                    placeholder="예: 7/6"
                    className="h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:border-[#1777CB]"
                    style={{ width: '150px' }}
                  />
                  <button
                    type="button"
                    onClick={() => commitStockIn(stockInInput)}
                    className="inline-flex items-center justify-center h-[15px] box-border px-1.5 rounded border border-[#1777CB] bg-[#1777CB] text-white text-[10px] leading-none font-medium hover:bg-[#1265A8] hover:border-[#1265A8] transition-colors shrink-0"
                  >
                    저장
                  </button>
                </div>
                <Calendar
                  mode="single"
                  selected={undefined}
                  onSelect={(date) => {
                    if (!date) return
                    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                    commitStockIn(iso)
                  }}
                  className="compact-calendar"
                  defaultMonth={new Date()}
                  modifiers={{ today: new Date() }}
                  modifiersClassNames={{ today: 'bg-[#1777CB] text-white font-semibold rounded-md' }}
                />
              </CellPopoverPortal>
            )}
          </>
        ) : renderCellDisplayValue(id, field, displayValue)}
      </td>
    )
  }

  // 수량 셀: 숫자(인라인 편집) + 단위(ea/set) 드롭다운. 배경색은 tr에서 상속됨
  // 드래그/키보드 셀 선택에 참여하도록 일반 셀과 동일한 선택 표시·핸들러를 붙인다 (ea/set 드롭다운 조작은 선택과 분리)
  const renderQuantityCell = (id: string, type: 'pcb' | 'cable', item: any) => {
    if (isColHidden(type, 'quantity')) return null
    const isEditing = editingCell?.id === id && editingCell?.type === type && editingCell?.field === 'quantity'
    const unit = item.quantity_unit || 'ea'
    const isSelected = selectedCellsSet.has(`${id}::quantity`)
    return (
      <td
        data-cell={`${id}::quantity`}
        className="px-2 py-1.5 text-gray-500 border border-gray-200 cursor-pointer select-none"
        style={isSelected ? { outline: '1.5px solid #3b82f6', outlineOffset: '-1.5px', backgroundColor: 'rgba(59, 130, 246, 0.1)' } : undefined}
        onMouseDown={(e) => handleCellMouseDown(e, id, 'quantity', type)}
        onMouseEnter={(e) => handleCellMouseEnter(e, id, 'quantity', type)}
        onClick={() => handleCellClick(id, type, 'quantity', item.quantity)}
      >
        <div className="flex items-center justify-center gap-1">
          {isEditing ? (
            <input
              autoFocus
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => { handleCellSave({ id, type, field: 'quantity' }, editValue); setEditingCell(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { handleCellSave({ id, type, field: 'quantity' }, editValue); setEditingCell(null); moveSelectionDown(id, type, 'quantity') }
                if (e.key === 'Escape') setEditingCell(null)
              }}
              className="w-10 h-5 bg-white border border-gray-300 rounded px-1 py-0 text-[10px] text-center focus:outline-none"
            />
          ) : (
            <span className="min-w-[14px] text-center text-gray-400">
              {item.quantity ?? '-'}
            </span>
          )}
          <select
            value={unit}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleUpdateQuantityUnit(id, type, e.target.value)}
            className="h-4 bg-transparent text-[9px] text-gray-400 border border-gray-200 rounded px-0.5 py-0 cursor-pointer focus:outline-none"
          >
            <option value="ea">ea</option>
            <option value="set">set</option>
          </select>
        </div>
      </td>
    )
  }

  // 제작번호 셀: 자동 채번된 번호를 표시하되, 클릭하면 제작번호를 변경할 수 있다.
  // - 기존 번호 목록에서 클릭 선택 (동일 제작번호 재발주 케이스, 타이핑 = 필터)
  // - 원하는 번호를 직접 타이핑 후 Enter → 입력한 번호 그대로 변경
  //   (기존 번호와 대소문자만 다르게 일치하면 기존 표기를 그대로 사용해 채번 표기를 통일한다)
  const renderSalesOrderCell = (type: 'pcb' | 'cable', item: any, width: number, rColor: string | null, rStrike: 'strike' | 'nostrike' | null) => {
    const isOpen = orderNoPicker?.id === item.id && orderNoPicker?.type === type
    let options: string[] = []
    if (isOpen) {
      const q = orderNoInput.trim().toLowerCase()
      // 제작번호는 PCB/Cable 공용 채번이라 두 테이블의 번호를 모두 후보로 제시한다
      const set = new Set<string>()
      for (const r of [...pcbs, ...cables] as any[]) {
        if (r.sales_order_number && r.sales_order_number !== item.sales_order_number) set.add(r.sales_order_number)
      }
      options = Array.from(set)
        .filter(no => !q || no.toLowerCase().includes(q))
        .sort((a, b) => b.localeCompare(a))
    }
    // 일반 셀과 동일한 2단계 조작: 첫 클릭 = 셀 선택(복사/범위선택용), 선택된 상태에서 다시 클릭 = 변경 팝오버.
    // 고정(sticky) 칼럼이라 반투명 배경 대신 테두리만 표시한다 (가로 스크롤 시 뒤 칼럼 비침 방지).
    const cellKey = `${item.id}::sales_order_number`
    const isSelected = selectedCellsSet.has(cellKey)
    return (
      <td
        data-cell={cellKey}
        className={`px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] z-10 truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer select-none${isSelected ? '' : ' transition-colors'} ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
        style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px`, ...(isSelected ? { outline: '1.5px solid #3b82f6', outlineOffset: '-1.5px' } : {}) }}
        title="클릭: 셀 선택 · 다시 클릭: 제작번호 변경 — 기존 번호 선택 또는 직접 입력 후 Enter"
        onMouseDown={(e) => handleCellMouseDown(e, item.id, 'sales_order_number', type)}
        onMouseEnter={(e) => handleCellMouseEnter(e, item.id, 'sales_order_number', type)}
        onClick={(e) => {
          e.stopPropagation()
          if (modifierSelectRef.current) return // Shift/Ctrl+클릭 선택은 mousedown에서 처리됨
          if (selectedCells.length === 1 && selectedCells[0] === cellKey) {
            setOrderNoInput('')
            setOrderNoPicker({ id: item.id, type })
          } else {
            setSelectedCells([cellKey])
            setOrderNoPicker(null)
            if (floatingMenuPos) setFloatingMenuPos(null)
          }
        }}
      >
        {item.sales_order_number}
        {isOpen && (
          <CellPopoverPortal
            innerRef={orderNoPopoverRef}
            className="bg-white border border-gray-300 rounded-md shadow-lg p-1.5 cursor-default text-left"
            style={{ width: '200px' }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[9px] font-semibold text-gray-400 mb-1 px-0.5">제작번호 변경 — 목록 클릭 또는 직접 입력 후 Enter</div>
            <input
              autoFocus
              type="text"
              value={orderNoInput}
              onChange={(e) => setOrderNoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const typed = orderNoInput.trim()
                  if (!typed) return
                  // 대소문자만 다른 기존 번호가 있으면 그 표기를 사용, 없으면 입력값 그대로 변경
                  const exact = options.find(no => no.toLowerCase() === typed.toLowerCase())
                  commitOrderNo(exact ?? typed)
                }
                if (e.key === 'Escape') setOrderNoPicker(null)
              }}
              placeholder={item.sales_order_number}
              className="w-full h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:border-[#1777CB]"
            />
            <div className="mt-1 max-h-[220px] overflow-y-auto flex flex-col">
              {orderNoInput.trim() && !options.some(no => no.toLowerCase() === orderNoInput.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => commitOrderNo(orderNoInput.trim())}
                  className="text-left text-[11px] font-semibold text-[#1777CB] px-1.5 py-[3px] rounded bg-blue-50/60 hover:bg-blue-50 transition-colors"
                >
                  '{orderNoInput.trim()}'(으)로 직접 변경 — Enter
                </button>
              )}
              {options.length === 0 ? (
                !orderNoInput.trim() && <span className="text-[10px] text-gray-400 px-1 py-1">일치하는 제작번호 없음</span>
              ) : options.slice(0, 100).map(no => (
                <button
                  key={no}
                  type="button"
                  onClick={() => commitOrderNo(no)}
                  className="text-left text-[11px] font-medium text-gray-800 px-1.5 py-[3px] rounded hover:bg-blue-50 hover:text-[#1777CB] transition-colors"
                >
                  {no}
                </button>
              ))}
              {options.length > 100 && (
                <span className="text-[9px] text-gray-400 px-1 py-0.5">… 외 {options.length - 100}개 — 타이핑으로 좁혀주세요</span>
              )}
            </div>
          </CellPopoverPortal>
        )}
      </td>
    )
  }

  // 행 수정 모달 열기
  const handleEditClick = (type: 'pcb' | 'cable', item: any) => {
    setFormFields({
      sales_order_number: item.sales_order_number,
      production_category: item.production_category,
      board_name: item.board_name,
      request_date: item.request_date || '',
      estimate_no: item.estimate_no || '',
      delivery_deadline: item.delivery_deadline || '',
      client_name: item.client_name || '',
      client_manager: item.client_manager || '',
      hansl_manager: item.hansl_manager || '',
      creator: item.creator || '',
      revision_count: item.revision_count ?? 1,
      quantity: item.quantity ?? 0,
      artwork_status: item.artwork_status || '',
      metal_mask: item.metal_mask || '',
      pcb_vendor: item.pcb_vendor || '',
      delivery_schedule: item.delivery_schedule || '',
      stock_count: item.stock_count ?? 0,
      changes_memo: item.changes_memo || '',
      spec_details: item.spec_details || ''
    })
    setModalType(type)
    setModalAction('edit')
    setSelectedId(item.id)
    setIsModalOpen(true)
  }

  // NO. 셀 클릭: 첫 클릭 = 행 전체 선택, 이미 행이 선택된 상태에서 다시 클릭 = 행 색상 피커
  const handleRowNoClick = useStableHandler((type: 'pcb' | 'cable', id: string) => {
    const cols = type === 'pcb' ? pcbColumns : cableColumns
    const rowCells = cols.map(f => `${id}::${f}`)
    const isRowSelected =
      selectedCells.length === rowCells.length && rowCells.every(k => selectedCells.includes(k))
    if (isRowSelected) {
      setActiveColorPicker(prev => (prev?.id === id && prev.type === type ? null : { id, type }))
    } else {
      setSelectedCells(rowCells)
      setActiveColorPicker(null)
      if (editingCell) setEditingCell(null)
      // 키보드 내비게이션 기준점: 행의 처음(앵커)~끝(포커스) 보이는 칼럼으로 설정
      const visible = cols.filter(f => !isColHidden(type, f))
      if (visible.length > 0) {
        selAnchorRef.current = { id, field: visible[0], type }
        selFocusRef.current = { id, field: visible[visible.length - 1], type }
        dragStartCellRef.current = { id, field: visible[0], type }
      }
    }
  })

  // Delete/Backspace 키: 선택이 "행 전체"면 행 삭제(확인 모달), 일부 셀이면 그 셀 값만 비움 (엑셀과 동일한 감각)
  // 제작번호/제작구분은 행 식별용이라 셀 값 삭제에서 보호된다.
  const DELETE_PROTECTED_FIELDS = ['sales_order_number', 'production_category']
  const handleDeleteKey = useStableHandler(async (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (editingCell || selectedCells.length === 0) return

    // 선택 셀을 행별로 그룹 (드래그 선택은 한 테이블 안에서만 만들어짐)
    const byRow = new Map<string, string[]>()
    for (const key of selectedCells) {
      const sep = key.indexOf('::')
      const id = key.slice(0, sep)
      const field = key.slice(sep + 2)
      if (!byRow.has(id)) byRow.set(id, [])
      byRow.get(id)!.push(field)
    }
    const firstId = byRow.keys().next().value as string
    const type: 'pcb' | 'cable' = pcbs.some(p => p.id === firstId) ? 'pcb' : 'cable'
    const cols = type === 'pcb' ? pcbColumns : cableColumns

    e.preventDefault()
    // 모든 선택 행이 '행 전체 선택'이면 행 삭제로 간주 → 확인 모달
    const isFullRows = [...byRow.values()].every(fields => fields.length >= cols.length)
    if (isFullRows) {
      setDeleteConfirm({ type, ids: [...byRow.keys()] })
      return
    }
    // 일부 셀 선택 → 해당 셀 값 삭제 (행별로 묶어 한 번에 업데이트)
    try {
      // 되돌리기: 값 삭제 전 대상 행들을 미리 스냅샷 (실제 삭제가 있었을 때만 스택에 반영)
      const undoRows = snapshotRows(type, [...byRow.keys()])
      let cleared = 0
      for (const [id, fields] of byRow) {
        const patch: Record<string, null> = {}
        for (const f of fields) {
          if (DELETE_PROTECTED_FIELDS.includes(f)) continue
          patch[f] = null
          cleared++
        }
        if (Object.keys(patch).length === 0) continue
        if (type === 'pcb') await productionService.updateProductionPcb(id, patch)
        else await productionService.updateProductionCable(id, patch)
      }
      if (cleared > 0) {
        pushUndo({ kind: 'restore', table: tableOf(type), rows: undoRows, label: `${cleared}칸 값 삭제` })
        toast.success(`선택한 셀 ${cleared}개의 값이 삭제되었습니다.`)
        setSelectedCells([])
        loadData()
      }
    } catch (err) {
      console.error(err)
      toast.error('셀 값 삭제에 실패했습니다.')
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { handleDeleteKey(e) }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 엑셀식 복사/붙여넣기 ─────────────────────────────────────────
  // 복사(Ctrl/Cmd+C): 선택 셀들을 TSV로 시스템 클립보드에 복사 — 엑셀에 그대로 붙는다.
  //   편집칸(input) 안에서 텍스트 선택 없이 누르면 칸 전체 값을 복사한다.
  // 붙여넣기(Ctrl/Cmd+V): 엑셀에서 복사한 N×M 범위를 선택 셀(좌상단 기준)부터 펼쳐서 저장.
  //   1×1 값을 여러 셀 선택 후 붙여넣으면 선택 전체를 같은 값으로 채운다 (엑셀과 동일).
  //   편집칸에 붙여넣을 때는 브라우저 기본 동작(복사 내용 전체가 그 칸에 입력)에 양보한다.

  // 현재 선택 셀들의 직사각형 범위(표시 순서 기준). 드래그 선택과 동일하게 숨긴 칼럼은 제외.
  const getSelectionRect = () => {
    if (selectedCells.length === 0) return null
    const firstId = selectedCells[0].slice(0, selectedCells[0].indexOf('::'))
    const type: 'pcb' | 'cable' = liveDataRef.current.pcbs.some(p => p.id === firstId) ? 'pcb' : 'cable'
    const cols = (type === 'pcb' ? pcbColumns : cableColumns).filter(f => !isColHidden(type, f))
    const list: any[] = type === 'pcb' ? filteredPcbs : filteredCables
    let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1
    for (const key of selectedCells) {
      const sep = key.indexOf('::')
      const r = list.findIndex(i => i.id === key.slice(0, sep))
      const c = cols.indexOf(key.slice(sep + 2))
      if (r === -1 || c === -1) continue // 필터로 사라진 행·숨긴 칼럼은 범위에서 제외
      if (r < minRow) minRow = r
      if (r > maxRow) maxRow = r
      if (c < minCol) minCol = c
      if (c > maxCol) maxCol = c
    }
    if (maxRow === -1 || maxCol === -1) return null
    return { type, cols, list, minRow, maxRow, minCol, maxCol }
  }

  // 선택 셀들을 (행,열) 좌표로 해석 (필터로 사라진 행·숨긴 칼럼 제외).
  // 반환 개수가 사각 범위 넓이와 같으면 온전한 직사각형 선택, 다르면 Ctrl+클릭 비연속 선택.
  const resolveSelectedCoords = (list: any[], cols: string[]) => {
    const idxById = new Map<string, number>()
    list.forEach((item, i) => idxById.set(item.id, i))
    const coords: Array<{ r: number; c: number }> = []
    for (const key of selectedCells) {
      const sep = key.indexOf('::')
      const r = idxById.get(key.slice(0, sep)) ?? -1
      const c = cols.indexOf(key.slice(sep + 2))
      if (r !== -1 && c !== -1) coords.push({ r, c })
    }
    return coords
  }

  const handleCopyKey = useStableHandler((e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    if ((e.key || '').toLowerCase() !== 'c') return
    const ae = document.activeElement as HTMLElement | null
    // 드래그 선택 직후 뜨는 '일괄 입력' 편집기는 autoFocus라서, 포커스만 있고 텍스트 선택이 없으면
    // 사용자 의도(선택한 셀 범위 복사)를 우선한다. 텍스트를 선택했다면 그 텍스트 복사에 양보.
    const inBulkPicker = !!ae?.closest?.('.floating-bulk-picker')
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      const el = ae as unknown as HTMLInputElement | HTMLTextAreaElement
      if ((el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)) return // 텍스트 선택 복사는 브라우저 기본에 양보
      if (!inBulkPicker) {
        // 편집칸: 선택 없이 누르면 칸 전체 값 복사
        const v = el.value || ''
        if (!v) return
        e.preventDefault()
        navigator.clipboard?.writeText(v).then(() => toast.success('셀 내용이 복사되었습니다.')).catch(() => {})
        return
      }
      // 일괄 입력칸에 포커스만 있는 상태 → 아래의 셀 범위 복사로 진행
    }
    if (ae && !inBulkPicker && (ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (editingCellRef.current) return
    // 화면 텍스트를 드래그로 선택해 뒀으면 브라우저 기본 복사에 양보
    const domSel = window.getSelection()
    if (domSel && !domSel.isCollapsed && String(domSel).trim() !== '') return
    const rect = getSelectionRect()
    if (!rect) return
    const { cols, list, minRow, maxRow, minCol, maxCol } = rect
    // Ctrl+클릭 비연속 선택이 직사각형을 이루지 않으면 복사 불가 (엑셀과 동일한 제약)
    const area = (maxRow - minRow + 1) * (maxCol - minCol + 1)
    if (resolveSelectedCoords(list, cols).length !== area) {
      e.preventDefault()
      toast.error('떨어져 있는 다중 선택 범위는 복사할 수 없습니다.')
      return
    }
    const lines: string[] = []
    for (let r = minRow; r <= maxRow; r++) {
      const cells: string[] = []
      for (let c = minCol; c <= maxCol; c++) cells.push(toTsvCell((list[r] as any)[cols[c]]))
      lines.push(cells.join('\t'))
    }
    e.preventDefault()
    const count = (maxRow - minRow + 1) * (maxCol - minCol + 1)
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => toast.success(count > 1 ? `${count}칸이 복사되었습니다.` : '셀 내용이 복사되었습니다.'))
      .catch(() => toast.error('클립보드 복사에 실패했습니다.'))
  })

  const handlePasteEvent = useStableHandler(async (e: ClipboardEvent) => {
    const ae = document.activeElement as HTMLElement | null
    // 편집칸에 붙여넣을 때는 브라우저 기본 동작에 양보 (복사한 내용 전체가 그 칸에 들어감).
    // 단, 드래그 선택 직후 autoFocus로 뜨는 '일괄 입력' 편집기는 예외 —
    // 엑셀처럼 선택한 셀 범위에 붙여넣는 것이 사용자 의도이므로 셀 붙여넣기로 처리한다.
    const inBulkPicker = !!ae?.closest?.('.floating-bulk-picker')
    if (ae && !inBulkPicker && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (editingCellRef.current) return
    if (selectedCells.length === 0) return
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text) return
    const grid = parseTsvGrid(text)
    if (grid.length === 0 || grid[0].length === 0) return
    const rect = getSelectionRect()
    if (!rect) return
    e.preventDefault()
    const { type, cols, list, minRow, maxRow, minCol, maxCol } = rect

    // 대상 셀 좌표: 1×1 값 + 다중 선택 = 선택된 셀 전체 채움(Ctrl+클릭 비연속 선택 포함),
    // 그 외 = 좌상단부터 N×M 펼침 (비연속 선택에는 범위 붙여넣기 불가 — 엑셀과 동일)
    const targets: Array<{ r: number; c: number; val: string }> = []
    const coords = resolveSelectedCoords(list, cols)
    const isRectSelection = coords.length === (maxRow - minRow + 1) * (maxCol - minCol + 1)
    if (grid.length === 1 && grid[0].length === 1 && selectedCells.length > 1) {
      for (const { r, c } of coords) targets.push({ r, c, val: grid[0][0] })
    } else if (!isRectSelection) {
      toast.error('떨어져 있는 다중 선택 범위에는 붙여넣을 수 없습니다.')
      return
    } else {
      grid.forEach((rowVals, dr) => rowVals.forEach((val, dc) => {
        const r = minRow + dr
        const c = minCol + dc
        if (r < list.length && c < cols.length) targets.push({ r, c, val }) // 표 밖으로 넘치는 부분은 버림
      }))
    }

    const numericFields = ['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity']
    let skipped = 0
    const patchByRow = new Map<string, Record<string, any>>()
    const pastedKeys: string[] = []
    for (const t of targets) {
      const field = cols[t.c]
      if (DELETE_PROTECTED_FIELDS.includes(field)) { skipped++; continue } // 제작번호/제작구분은 행 식별용이라 보호
      const rowId = list[t.r].id
      // 엑셀 숫자엔 천단위 콤마가 붙어올 수 있어 숫자칸은 콤마 제거 후 변환
      const rawVal = numericFields.includes(field) ? t.val.replace(/,/g, '').trim() : t.val
      const valueToSave = normalizeCellValueForSave(type, field, rawVal, rowId)
      if (typeof valueToSave === 'number' && Number.isNaN(valueToSave)) { skipped++; continue } // 숫자칸에 문자 등 형식 불일치
      // 납품 분할 그룹의 병합된 앞 칼럼은 그룹 전체 행에 같은 값 저장 (병합 유지 규칙)
      const targetIds = type === 'pcb' && !HEADER_SPAN_GROUPS.pcbDelivery.includes(field) ? pcbGroupSiblings(rowId) : [rowId]
      for (const tid of targetIds) {
        if (!patchByRow.has(tid)) patchByRow.set(tid, {})
        patchByRow.get(tid)![field] = valueToSave
      }
      pastedKeys.push(`${rowId}::${field}`)
    }
    if (patchByRow.size === 0) {
      if (skipped > 0) toast.error('제작번호/제작구분 칸에는 붙여넣을 수 없습니다.')
      return
    }

    pushRestoreUndo(type, [...patchByRow.keys()], `${pastedKeys.length}칸 붙여넣기`)
    try {
      await Promise.all([...patchByRow].map(([id, patch]) =>
        type === 'pcb' ? productionService.updateProductionPcb(id, patch) : productionService.updateProductionCable(id, patch)
      ))
      setSelectedCells(pastedKeys) // 엑셀처럼 붙여넣은 범위가 선택된 상태로 남는다
      setFloatingMenuPos(null)
      toast.success(`${pastedKeys.length}칸에 붙여넣었습니다.${skipped > 0 ? ` (${skipped}칸은 보호/형식 문제로 제외)` : ''}`)
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('붙여넣기에 실패했습니다.')
    }
  })

  useEffect(() => {
    const onCopyKey = (e: KeyboardEvent) => { handleCopyKey(e) }
    const onPaste = (e: ClipboardEvent) => { handlePasteEvent(e) }
    window.addEventListener('keydown', onCopyKey)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onCopyKey)
      document.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 엑셀식 키보드 내비게이션/선택 ─────────────────────────────────
  // 방향키: 셀 이동 · Shift+방향키: 범위 확장 · Ctrl/Cmd+방향키: 데이터 끝 점프
  // Ctrl/Cmd+Shift+방향키: 데이터 끝까지 선택 · Shift+Space: 행 전체
  // Ctrl/Cmd+(Shift+)Space: 열 전체 — macOS는 Ctrl+Space(입력소스)/Cmd+Space(Spotlight)가
  //   시스템 단축키라 Cmd+Shift+Space를 대안으로 지원
  // Enter/F2: 편집 시작(선택 셀 재클릭과 동일) · Tab/Shift+Tab: 좌우 이동 · Escape: 선택 해제

  const isEmptyCellVal = (v: any) => v === null || v === undefined || String(v).trim() === ''

  // 엑셀 Ctrl+방향키 규칙: 현재·다음 칸에 값이 이어지면 연속 구간의 끝으로,
  // 다음 칸이 비었으면 빈 칸들을 건너뛰고 다음 값 있는 칸으로 (없으면 표 가장자리)
  const dataEdgeFrom = (list: any[], cols: string[], r: number, c: number, dr: number, dc: number) => {
    const lastR = list.length - 1
    const lastC = cols.length - 1
    const inBounds = (rr: number, cc: number) => rr >= 0 && rr <= lastR && cc >= 0 && cc <= lastC
    const get = (rr: number, cc: number) => (list[rr] as any)?.[cols[cc]]
    let nr = r + dr, nc = c + dc
    if (!inBounds(nr, nc)) return { r, c }
    if (!isEmptyCellVal(get(r, c)) && !isEmptyCellVal(get(nr, nc))) {
      while (inBounds(nr + dr, nc + dc) && !isEmptyCellVal(get(nr + dr, nc + dc))) { nr += dr; nc += dc }
      return { r: nr, c: nc }
    }
    while (isEmptyCellVal(get(nr, nc))) {
      if (!inBounds(nr + dr, nc + dc)) return { r: nr, c: nc }
      nr += dr; nc += dc
    }
    return { r: nr, c: nc }
  }

  // 이동한 셀이 화면에 보이도록 스크롤. 행 가상화 때문에 창 밖 행은 DOM에 없으므로
  // 행 인덱스×행높이로 세로 스크롤을 먼저 맞추고, 렌더된 다음 프레임에 셀 기준으로 가로/미세 보정한다.
  const scrollCellIntoView = (type: 'pcb' | 'cable', rowIdx: number, cellKey: string) => {
    const el = (type === 'pcb' ? pcbScrollRef : cableScrollRef).current
    if (el) {
      const rowH = rowHeightRef.current[type]
      const headerH = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight ?? 0
      const rowTop = headerH + rowIdx * rowH // 스크롤 콘텐츠 안에서 행의 세로 위치 (thead는 sticky지만 흐름 높이를 차지)
      if (rowTop < el.scrollTop + headerH) el.scrollTop = rowTop - headerH
      else if (rowTop + rowH > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + rowH - el.clientHeight
      // 프로그램적 scrollTop 변경은 환경에 따라 scroll 이벤트가 오지 않을 수 있어 가상창을 직접 재계산
      recalcWindow(type)
    }
    requestAnimationFrame(() => {
      const td = document.querySelector(`td[data-cell="${CSS.escape(cellKey)}"]`)
      td?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      recalcWindow(type)
    })
  }

  // 현재 선택의 앵커/포커스를 (행/열 인덱스로) 해석. ref가 무효(정렬·필터 변경 등)면 선택 사각형 모서리로 보정.
  const resolveSelContext = () => {
    const rect = getSelectionRect()
    if (!rect) return null
    const { type, cols, list } = rect
    const toRC = (cell: { id: string; field: string; type: 'pcb' | 'cable' } | null) => {
      if (!cell || cell.type !== type) return null
      const r = list.findIndex(i => i.id === cell.id)
      const c = cols.indexOf(cell.field)
      return r === -1 || c === -1 ? null : { r, c }
    }
    const anchor = toRC(selAnchorRef.current) ?? { r: rect.minRow, c: rect.minCol }
    const focus = toRC(selFocusRef.current) ?? { r: rect.maxRow, c: rect.maxCol }
    return { ...rect, anchor, focus }
  }

  // 엑셀처럼 Enter 저장 직후 같은 칼럼의 아래 행으로 활성 셀 이동 (마지막 행이면 제자리)
  const moveSelectionDown = useStableHandler((id: string, type: 'pcb' | 'cable', field: string) => {
    const list: any[] = type === 'pcb' ? filteredPcbs : filteredCables
    const idx = list.findIndex(i => i.id === id)
    if (idx === -1) return
    const nextIdx = Math.min(idx + 1, list.length - 1)
    const cell = { id: list[nextIdx].id, field, type }
    selAnchorRef.current = cell
    selFocusRef.current = cell
    dragStartCellRef.current = cell
    setSelectedCells([`${cell.id}::${field}`])
    scrollCellIntoView(type, nextIdx, `${cell.id}::${field}`)
  })

  const handleNavKey = useStableHandler((e: KeyboardEvent) => {
    if (e.altKey) return
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (editingCellRef.current) return
    if (selectedCells.length === 0) return
    // 모달/팝오버(입고일·제작번호 선택 등)가 열려 있으면 그쪽 UI에 양보
    if (isModalOpen || deleteConfirm || stockInPicker || orderNoPicker) return

    const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const mod = e.ctrlKey || e.metaKey
    const isSpace = e.key === ' '
    const isTab = e.key === 'Tab'
    if (!(e.key in ARROWS) && !isSpace && !isTab && e.key !== 'Enter' && e.key !== 'F2' && e.key !== 'Escape') return

    if (e.key === 'Escape') {
      e.preventDefault()
      setSelectedCells([])
      setFloatingMenuPos(null)
      return
    }

    const ctx = resolveSelContext()
    if (!ctx) return
    const { type, cols, list, anchor, focus } = ctx
    const lastR = list.length - 1
    const lastC = cols.length - 1

    if (isSpace) {
      if (e.shiftKey && !mod) {
        // Shift+Space: 선택 범위에 걸친 행 전체 선택 — NO. 클릭과 동일 (이후 Delete = 행 삭제 확인)
        e.preventDefault()
        const allCols = type === 'pcb' ? pcbColumns : cableColumns
        const minR = Math.min(anchor.r, focus.r), maxR = Math.max(anchor.r, focus.r)
        const sel: string[] = []
        for (let r = minR; r <= maxR; r++) for (const f of allCols) sel.push(`${list[r].id}::${f}`)
        setSelectedCells(sel)
        setFloatingMenuPos(null)
      } else if (mod) {
        // Ctrl/Cmd+Space: 선택 범위에 걸친 열 전체 선택.
        // Shift 동반(Cmd+Shift+Space)도 허용 — macOS에서 Ctrl+Space는 입력 소스 전환,
        // Cmd+Space는 Spotlight가 가로채므로 시스템에 안 잡히는 대안 조합이 필요하다.
        e.preventDefault()
        const minC = Math.min(anchor.c, focus.c), maxC = Math.max(anchor.c, focus.c)
        const sel: string[] = []
        for (const row of list) for (let c = minC; c <= maxC; c++) sel.push(`${row.id}::${cols[c]}`)
        setSelectedCells(sel)
        setFloatingMenuPos(null)
      }
      return
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      if (mod || e.shiftKey) return
      e.preventDefault()
      if (selectedCells.length > 1) {
        // 키보드로 잡은 다중 선택에서 Enter → 일괄 입력 메뉴 열기 (드래그 종료 때와 동일)
        const f = selFocusRef.current
        const td = (f && document.querySelector(`td[data-cell="${CSS.escape(`${f.id}::${f.field}`)}"]`)
          || document.querySelector(`td[data-cell="${CSS.escape(selectedCells[0])}"]`)) as HTMLElement | null
        const r = td?.getBoundingClientRect()
        setFloatingMenuPos(r ? { x: r.right, y: r.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 })
        setBulkEditValue(computeBulkPrefill(selectedCells, type))
        return
      }
      // 선택된 셀을 한 번 더 클릭한 것과 동일하게 처리 → 셀별 편집기/팝오버(입고대기 등)가 그대로 열린다
      const td = document.querySelector(`td[data-cell="${CSS.escape(selectedCells[0])}"]`) as HTMLElement | null
      td?.click()
      return
    }

    // Tab: 우측 이동(Shift+Tab: 좌측, 항상 단일 선택) · 방향키: 이동/Shift=확장/Ctrl=끝 점프/Ctrl+Shift=끝까지 선택
    e.preventDefault()
    const [dr, dc] = isTab ? [0, e.shiftKey ? -1 : 1] : ARROWS[e.key]
    const extend = !isTab && e.shiftKey
    const target = (!isTab && mod)
      ? dataEdgeFrom(list, cols, focus.r, focus.c, dr, dc)
      : { r: Math.max(0, Math.min(lastR, focus.r + dr)), c: Math.max(0, Math.min(lastC, focus.c + dc)) }

    const focusCell = { id: list[target.r].id, field: cols[target.c], type }
    selFocusRef.current = focusCell
    dragStartCellRef.current = focusCell // 일괄 편집기 등 type 파생 로직과 일관성 유지
    if (extend) {
      const minR = Math.min(anchor.r, target.r), maxR = Math.max(anchor.r, target.r)
      const minC = Math.min(anchor.c, target.c), maxC = Math.max(anchor.c, target.c)
      const sel: string[] = []
      for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) sel.push(`${list[r].id}::${cols[c]}`)
      setSelectedCells(sel)
    } else {
      selAnchorRef.current = focusCell
      setSelectedCells([`${focusCell.id}::${focusCell.field}`])
    }
    setFloatingMenuPos(null)
    scrollCellIntoView(type, target.r, `${focusCell.id}::${focusCell.field}`)
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => { handleNavKey(e) }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 삭제 처리 (행 여러 개 동시 삭제 지원 — Delete 키 행 삭제에서 사용)
  const handleDeleteClick = useStableHandler((type: 'pcb' | 'cable', id: string) => {
    setDeleteConfirm({ type, ids: [id] })
  })

  const handleExecuteDelete = async () => {
    if (!deleteConfirm) return
    const { type, ids } = deleteConfirm
    setDeleteConfirm(null)
    // 되돌리기: 삭제 전 대상 행 스냅샷 (복원 시 deleted_at=null 로 되돌아가 다시 보임)
    pushRestoreUndo(type, ids, ids.length > 1 ? `${ids.length}건 삭제` : '삭제')
    try {
      for (const id of ids) {
        if (type === 'pcb') {
          await productionService.deleteProductionPcb(id)
        } else {
          await productionService.deleteProductionCable(id)
        }
      }
      toast.success(ids.length > 1 ? `${ids.length}건이 삭제되었습니다.` : '성공적으로 삭제되었습니다.')
      setSelectedCells([])
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('삭제에 실패했습니다.')
    }
  }

  // 모달 등록/수정 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formFields.board_name) {
      toast.error('보드명(품명)을 입력해 주세요.')
      return
    }

    try {
      if (modalType === 'pcb') {
        const payload: Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'> = {
          sales_order_number: formFields.sales_order_number,
          production_category: formFields.production_category || 'PCB',
          board_name: formFields.board_name,
          request_date: formFields.request_date,
          estimate_no: formFields.estimate_no || null,
          delivery_deadline: formFields.delivery_deadline || null,
          client_name: formFields.client_name || null,
          client_manager: formFields.client_manager || null,
          hansl_manager: formFields.hansl_manager || null,
          creator: formFields.creator || null,
          revision_count: Number(formFields.revision_count),
          quantity: Number(formFields.quantity),
          artwork_status: formFields.artwork_status || null,
          metal_mask: formFields.metal_mask || null,
          pcb_vendor: formFields.pcb_vendor || null,
          delivery_schedule: formFields.delivery_schedule || null,
          stock_count: Number(formFields.stock_count),
          changes_memo: formFields.changes_memo || null
        }

        if (modalAction === 'add') {
          const created = await productionService.createProductionPcb(payload)
          if (created?.id) pushUndo({ kind: 'deleteInserted', table: 'production_pcbs', id: created.id, label: '행 추가(PCB)' })
          toast.success('신규 PCB 항목이 추가되었습니다.')
        } else if (selectedId) {
          pushRestoreUndo('pcb', [selectedId], 'PCB 항목 수정')
          await productionService.updateProductionPcb(selectedId, payload)
          toast.success('PCB 항목이 수정되었습니다.')
        }
      } else {
        const payload: Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'> = {
          sales_order_number: formFields.sales_order_number,
          production_category: formFields.production_category || 'Cable',
          board_name: formFields.board_name,
          request_date: formFields.request_date,
          estimate_no: formFields.estimate_no || null,
          delivery_deadline: formFields.delivery_deadline || null,
          client_name: formFields.client_name || null,
          client_manager: formFields.client_manager || null,
          hansl_manager: formFields.hansl_manager || null,
          creator: formFields.creator || null,
          revision_count: Number(formFields.revision_count),
          quantity: Number(formFields.quantity),
          spec_details: formFields.spec_details || null
        }

        if (modalAction === 'add') {
          const created = await productionService.createProductionCable(payload)
          if (created?.id) pushUndo({ kind: 'deleteInserted', table: 'production_cables', id: created.id, label: '행 추가(Cable)' })
          toast.success('신규 케이블/케이스 항목이 추가되었습니다.')
        } else if (selectedId) {
          pushRestoreUndo('cable', [selectedId], '케이블/케이스 항목 수정')
          await productionService.updateProductionCable(selectedId, payload)
          toast.success('케이블/케이스 항목이 수정되었습니다.')
        }
      }
      setIsModalOpen(false)
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 테이블 표시 조건
  // 행 하나의 렌더에 영향을 주는 '그 행 관련' UI 상태 요약 — 이 값이 바뀐 행만 다시 그린다
  const rowSig = (type: 'pcb' | 'cable', item: any): string => {
    const sel = selectedCells.length ? selectedCells.filter(k => k.startsWith(item.id + '::')).join(',') : ''
    const editing = editingCell && editingCell.type === type && editingCell.id === item.id
      ? `E:${editingCell.field}:${editValue}` : ''
    const picker = activeColorPicker && activeColorPicker.type === type && activeColorPicker.id === item.id ? 'P' : ''
    // 입고일 선택 팝오버가 열린 행은 입력값이 바뀔 때마다 다시 그린다
    const stockIn = stockInPicker && stockInPicker.type === type && stockInPicker.id === item.id
      ? `S:${stockInPicker.field}:${stockInInput}` : ''
    // 제작번호 선택 팝오버가 열린 행도 필터 입력값이 바뀔 때마다 다시 그린다
    const orderNo = orderNoPicker && orderNoPicker.type === type && orderNoPicker.id === item.id
      ? `N:${orderNoInput}` : ''
    // 숨긴 칼럼 구성(행 추가 중엔 전 칼럼 표시)이 바뀌면 모든 행을 다시 그려야 한다
    const adding = type === 'pcb' ? !!addingPcbRow : !!addingCableRow
    const cols = adding ? 'ALL' : hiddenCols[type].join(',')
    // 이 행에서 펼쳐진 줄바꿈 셀 목록 — 펼침/접힘 토글 시 행을 다시 그리기 위해 시그니처에 포함
    const expanded = expandedCells.size
      ? [...expandedCells].filter(k => k.startsWith(item.id + '::')).join(',') : ''
    // 납품 분할 그룹 내 위치/크기 — 그룹 구성이 바뀌면(분할/삭제/정렬) rowSpan 병합을 다시 그린다
    const g = type === 'pcb' ? pcbGroupInfo.get(item.id) : undefined
    const grp = g ? `G${g.pos}/${g.size}` : ''
    return sel + '|' + editing + '|' + picker + '|' + stockIn + '|' + orderNo + '|' + cols + '|' + expanded + '|' + grp
  }

  // PCB 행 렌더 본문 — MemoRow가 (item, index)로 호출. 내부 커스텀 핸들러는 모두 useStableHandler로 안정화됨.
  const renderPcbRow = (item: any, index: number) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-200' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      // 납품 분할 그룹: 첫 행은 앞 칼럼을 rowSpan으로 병합해 그룹 전체 높이를 차지하고,
                      // 이어지는 행(pos>0)은 앞 칼럼 없이 납품 3칸+삭제만 렌더한다.
                      const grp = pcbGroupInfo.get(item.id)
                      const isGroupCont = !!grp && grp.pos > 0
                      const groupSpan = grp && grp.pos === 0 ? grp.size : undefined

                      // 앞 칼럼(납품 3칸 이전 전부) — 분할 그룹 첫 행이면 각 셀에 rowSpan 주입
                      const frontCellsRaw = isGroupCont ? null : (
                        <>
                          <td
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            title="클릭: 행 전체 선택 · 다시 클릭: 행 색상"
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              handleRowNoClick('pcb', item.id)
                            }}
                          >
                            {index + 1}
                            {activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' && (
                              <div className="absolute left-[38px] top-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-md shadow-lg p-1.5 z-50 flex items-center gap-1.5 color-picker-popover">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'yellow'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[10px] text-amber-700 font-medium shrink-0"
                                  title="신규"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>신규</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'blue'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[10px] text-blue-700 font-medium shrink-0"
                                  title="재발주"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  <span>재발주</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'red'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[10px] text-red-700 font-medium shrink-0"
                                  title="취소"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  <span>취소</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, null, true); }}
                                  className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[10px] text-gray-600 font-bold shrink-0 bg-white"
                                  title="취소선"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, null); }}
                                  className="text-[10px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
                                  title="색상 초기화"
                                >
                                  초기화
                                </button>
                              </div>
                            )}
                          </td>
                          {!isColHidden('pcb', 'sales_order_number') &&
                            renderSalesOrderCell('pcb', item, salesOrderPcbWidth, rColor, rStrike)}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'production_category',
                          item,
                          item.production_category,
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]',
                          'select',
                          ['LG_PCB', 'LG_Socket Board', 'PCB']
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'board_name',
                          item,
                          item.board_name,
                          'px-2 py-1.5 font-medium text-gray-900 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'reference',
                          item,
                          item.reference || '-',
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-red-500 font-semibold align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'request_date',
                          item,
                          formatDbDateToDisplay(item.request_date),
                          'px-2 py-1.5 text-gray-500 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'estimate_no',
                          item,
                          item.estimate_no || '-',
                          'px-2 py-1.5 text-gray-500 border-y border-r border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_deadline',
                          item,
                          formatDateOrMemo(item.delivery_deadline),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'client_name',
                          item,
                          item.client_name || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'client_manager',
                          item,
                          item.client_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'hansl_manager',
                          item,
                          item.hansl_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {!isColHidden('pcb', 'creator') && (
                          <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'revision_count',
                          item,
                          item.revision_count,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderQuantityCell(item.id, 'pcb', item)}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'artwork_status',
                          item,
                          formatArtworkDisplay(item.artwork_status) || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'metal_mask',
                          item,
                          item.metal_mask || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'changes_memo',
                          item,
                          item.changes_memo || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'stock_count',
                          item,
                          item.stock_count,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'pcb_vendor',
                          item,
                          item.pcb_vendor || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_schedule',
                          item,
                          formatDbDateToDisplay(item.delivery_schedule),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'pcb_lead_time',
                          item,
                          item.pcb_lead_time || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'received_quantity',
                          item,
                          item.received_quantity || 0,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'received_destination',
                          item,
                          item.received_destination || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'pcb_stock_completed',
                          item,
                          formatCompletedDisplay(item.pcb_stock_completed),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'parts_organization',
                          item,
                          formatPartsDisplay(item.parts_organization) || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_hanwha',
                          item,
                          formatDateOrMemo(item.assy_hanwha),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_evertech',
                          item,
                          formatDateOrMemo(item.assy_evertech),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_requested_date',
                          item,
                          formatDbDateToDisplay(item.assy_requested_date),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'final_product_stock',
                          item,
                          formatStockInDisplay(item.final_product_stock),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_passed',
                          item,
                          item.qa_passed || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_failed',
                          item,
                          item.qa_failed || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_notes',
                          item,
                          item.qa_notes || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'design_review',
                          item,
                          item.design_review || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        </>
                      )
                      const frontCells = frontCellsRaw == null ? null : (groupSpan
                        ? React.Children.map(frontCellsRaw.props.children, (el: any) =>
                            React.isValidElement(el) ? React.cloneElement(el as React.ReactElement<any>, { rowSpan: groupSpan }) : el)
                        : frontCellsRaw)

                      return (
                        <tr key={item.id} data-vrow className={`group transition-colors ${rowBgClass}`}>
                          {frontCells}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_quantity',
                          item,
                          item.delivery_quantity || 0,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_date',
                          item,
                          formatDbDateToDisplay(item.delivery_date),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_destination',
                          item,
                          item.delivery_destination || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_completed',
                          item,
                          formatCompletedDisplay(item.delivery_completed),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        <td className="px-2 py-1 border border-gray-200">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteClick('pcb', item.id)
                            }}
                            className="text-red-500 hover:text-red-700 transition-colors font-medium"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
  }

  // CABLE 행 렌더 본문 — MemoRow가 (item, index)로 호출. 내부 커스텀 핸들러는 모두 useStableHandler로 안정화됨.
  const renderCableRow = (item: any, index: number) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-200' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      return (
                        <tr key={item.id} data-vrow className={`group transition-colors ${rowBgClass}`}>
                          <td 
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            title="클릭: 행 전체 선택 · 다시 클릭: 행 색상"
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              handleRowNoClick('cable', item.id)
                            }}
                          >
                            {index + 1}
                            {activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' && (
                              <div className="absolute left-[38px] top-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-md shadow-lg p-1.5 z-50 flex items-center gap-1.5 color-picker-popover">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'yellow'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[10px] text-amber-700 font-medium shrink-0"
                                  title="신규"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>신규</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'blue'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[10px] text-blue-700 font-medium shrink-0"
                                  title="재발주"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  <span>재발주</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'red'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[10px] text-red-700 font-medium shrink-0"
                                  title="취소"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  <span>취소</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, null, true); }}
                                  className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[10px] text-gray-600 font-bold shrink-0 bg-white"
                                  title="취소선"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, null); }}
                                  className="text-[10px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
                                  title="색상 초기화"
                                >
                                  초기화
                                </button>
                              </div>
                            )}
                          </td>
                          {!isColHidden('cable', 'sales_order_number') &&
                            renderSalesOrderCell('cable', item, salesOrderCableWidth, rColor, rStrike)}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'production_category',
                          item,
                          item.production_category,
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]',
                          'select',
                          ['LG_Cable', 'LG_Case', 'Cable', 'Case']
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'board_name',
                          item,
                          item.board_name,
                          'px-2 py-1.5 font-medium text-gray-900 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'reference',
                          item,
                          item.reference || '-',
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-red-500 font-semibold align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'request_date',
                          item,
                          formatDbDateToDisplay(item.request_date),
                          'px-2 py-1.5 text-gray-500 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'estimate_no',
                          item,
                          item.estimate_no || '-',
                          'px-2 py-1.5 text-gray-500 border-y border-r border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'delivery_deadline',
                          item,
                          formatDateOrMemo(item.delivery_deadline),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'client_name',
                          item,
                          item.client_name || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'client_manager',
                          item,
                          item.client_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'hansl_manager',
                          item,
                          item.hansl_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {!isColHidden('cable', 'creator') && (
                          <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'revision_count',
                          item,
                          item.revision_count,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderQuantityCell(item.id, 'cable', item)}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'spec_details',
                          item,
                          item.spec_details || '-',
                          'px-2 py-1.5 text-gray-600 font-normal max-w-sm truncate whitespace-pre-line border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_vendor',
                          item,
                          item.cable_vendor || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_requested_date',
                          item,
                          formatDbDateToDisplay(item.cable_requested_date),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_actual_date',
                          item,
                          formatDbDateToDisplay(item.cable_actual_date),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'delivery_notes',
                          item,
                          item.delivery_notes || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'delivery_completed',
                          item,
                          formatCompletedDisplay(item.delivery_completed),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        <td className="px-2 py-1 border border-gray-200">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteClick('cable', item.id)
                            }}
                            className="text-red-500 hover:text-red-700 transition-colors font-medium"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
  }

  // 정렬 컨트롤 (노션식) — 제목 옆 행수 배지 바로 우측. 클릭 시 팝오버로 정렬 규칙을 추가/변경/제거.
  // 규칙은 우선순위 순(위=1차)이며, 제작구분 그룹 안에서의 행 순서를 결정한다. 변경 즉시 자동 저장.
  const renderSortControl = (type: 'pcb' | 'cable') => {
    const rules = sortFor(type)
    const fields = type === 'pcb' ? PCB_SORT_FIELDS : CABLE_SORT_FIELDS
    const open = sortMenuFor === type
    const active = rules.length > 0
    return (
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { setMenuAnchorEl(e.currentTarget as HTMLElement); setSortMenuFor(prev => (prev === type ? null : type)) }}
          title={active ? `정렬 ${rules.length}개 적용됨` : '정렬 추가'}
          className={`badge-stats cursor-pointer border flex items-center gap-1 transition-colors ${
            active
              ? 'bg-[#1777CB] border-[#1777CB] text-white font-bold hover:bg-[#1265A8]'
              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-[#1777CB] hover:border-[#1777CB]'
          }`}
        >
          <ArrowUpDown className="w-3 h-3" />
          정렬{active ? ` ${rules.length}` : ''}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => setSortMenuFor(null)} />
            {/* 패널 폭은 내용에 맞춤(w-max) — 고정 폭(w-[320px])이면 짧은 규칙에도 넓게 남아 어색. 최소/최대만 제한.
                body 포털로 띄워 카드 overflow-hidden에 잘리지 않게 한다. */}
            <AnchoredPortal anchorEl={menuAnchorEl} gap={4}>
            <div className="bg-white border border-gray-200 rounded-md shadow-lg w-max min-w-[200px] max-w-[340px]">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">정렬</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => clearSort(type)}
                    className="text-[10px] text-gray-500 hover:text-red-600 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 font-medium transition-colors flex items-center gap-1"
                    title="정렬 모두 제거"
                  >
                    <RotateCcw className="w-2.5 h-2.5" /> 초기화
                  </button>
                )}
              </div>
              <div className="px-2 py-2 space-y-1.5 max-h-[50vh] overflow-y-auto">
                {rules.length === 0 && (
                  <div className="px-1 py-2 text-[10px] text-gray-400 whitespace-nowrap">
                    정렬할 칼럼을 추가하세요.
                  </div>
                )}
                {rules.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-3 shrink-0 text-center">{i + 1}</span>
                    {/* 박스 규격은 툴바 버튼(행 추가 등 button-base) 실측과 동일: 높이 22px · radius 토큰.
                        텍스트는 칼럼 표시 설정 팝오버 항목과 동일한 앱 표준 타이포(11px/400/gray-700, body 자간 상속).
                        폭은 선택된 칼럼명에 핏(좌10+텍스트+우24 화살표자리). measureText는 10px 기준이라 11px 폰트는 1.1배 보정.
                        appearance-none + backgroundImage none으로 @tailwindcss/forms 배경 화살표를 없애 커스텀 ChevronDown과 중복 제거.
                        세로 패딩 0은 인라인 강제(forms의 0.5rem 세로패딩이 @layer 밖이라 py-0로 못 이김) → 텍스트 세로 중앙 유지. */}
                    <div className="relative shrink-0">
                      <select
                        value={r.field}
                        onChange={(e) => updateSortRule(type, r.id, { field: e.target.value })}
                        // lineHeight 20px = 박스 22px − 보더 2px. 전역에서 24px가 상속돼 텍스트가 아래로 밀리는 것을 인라인으로 강제 보정
                        style={{ padding: '0 15px 0 7px', lineHeight: '20px', backgroundImage: 'none', width: `${Math.ceil(measureText(getColumnTitle(r.field, type), 400) * 1.1) + 24}px` }}
                        className="appearance-none h-[22px] text-[11px] text-gray-700 border border-gray-300 business-radius-input bg-white focus:border-[#1777CB] focus:outline-none"
                      >
                        {fields.map(f => (
                          <option key={f} value={f}>{getColumnTitle(f, type)}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-gray-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {/* 방향: 박스 없이 화살표 아이콘만 — 회색, 선택된 방향은 파랑. 호버 시 title 말풍선 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateSortRule(type, r.id, { dir: 'asc' })}
                        title="오름차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'asc' ? 'text-[#1777CB]' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSortRule(type, r.id, { dir: 'desc' })}
                        title="내림차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'desc' ? 'text-[#1777CB]' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSortRule(type, r.id)}
                      title="이 정렬 제거"
                      className="p-0.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors shrink-0 ml-auto"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-2 pb-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => addSortRule(type)}
                  disabled={rules.length >= fields.length}
                  className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-gray-300 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-[#1777CB] hover:border-[#1777CB] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:hover:border-gray-300"
                >
                  <Plus className="w-3 h-3" /> 정렬 추가
                </button>
              </div>
            </div>
            </AnchoredPortal>
          </>
        )}
      </div>
    )
  }

  // 칼럼 표시 설정 드롭다운 — 발주 목록의 '칼럼 설정'과 같은 개념이되, 적용 버튼 없이 클릭 즉시 반영 + 자동 저장.
  // PCB는 업무 단계 섹션 3개(구분선)로 나뉘고, 섹션 제목 옆 버튼으로 섹션 전체를 한번에 숨기기/표시할 수 있다.
  const renderColumnMenu = (type: 'pcb' | 'cable') => {
    const sections = HIDEABLE_SECTIONS[type]
    const total = hideableFieldsFor(type).length
    const hiddenCount = hiddenCols[type].length
    const open = columnMenuFor === type
    const adding = type === 'pcb' ? !!addingPcbRow : !!addingCableRow
    return (
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { setMenuAnchorEl(e.currentTarget as HTMLElement); setColumnMenuFor(prev => (prev === type ? null : type)) }}
          title="표시할 칼럼 선택"
          className="button-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center gap-1.5 h-8 px-3 business-radius-button"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="button-text">칼럼</span>
          {hiddenCount > 0 && (
            <span className="text-[10px] font-bold text-[#1777CB]">{total - hiddenCount}/{total}</span>
          )}
        </button>
        {open && (
          <>
            {/* 바깥 클릭 시 닫힘 */}
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => setColumnMenuFor(null)} />
            {/* body 포털로 띄워 카드 overflow-hidden에 잘리지 않게 한다 (버튼 우측 정렬) */}
            <AnchoredPortal anchorEl={menuAnchorEl} align="right" gap={4}>
            <div className="bg-white border border-gray-200 rounded-md shadow-lg pb-2 w-[380px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">
                  칼럼 표시 설정 <span className="text-gray-400 font-normal">({total - hiddenCount}/{total})</span>
                </span>
                <button
                  type="button"
                  onClick={() => resetHiddenCols(type)}
                  className="text-[10px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 font-medium transition-colors flex items-center gap-1"
                  title="숨긴 칼럼을 모두 다시 표시"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  전체 표시
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto px-3 pt-2">
                {sections.map((sec, si) => {
                  const secFields = sec.groups.flatMap(g => g.fields)
                  const allHidden = secFields.every(f => hiddenCols[type].includes(f))
                  return (
                    <div key={si} className={si > 0 ? 'border-t-2 border-gray-200 mt-2.5 pt-2' : ''}>
                      {sec.title && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-gray-600">{sec.title}</span>
                          <button
                            type="button"
                            onClick={() => setSectionHidden(type, secFields, !allHidden)}
                            className={`text-[9px] font-medium border rounded px-1.5 py-0.5 transition-colors flex items-center gap-1 ${
                              allHidden
                                ? 'text-[#1777CB] border-blue-200 bg-blue-50 hover:bg-blue-100'
                                : 'text-gray-500 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:text-gray-800'
                            }`}
                            title={allHidden ? '이 구간의 칼럼을 모두 표시' : '이 구간의 칼럼을 모두 숨기기'}
                          >
                            {allHidden ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                            {allHidden ? '모두 표시' : '모두 숨기기'}
                          </button>
                        </div>
                      )}
                      <div className="space-y-2">
                        {sec.groups.map(g => (
                          <div key={g.title}>
                            <div className="text-[9px] font-bold text-gray-400 mb-0.5">{g.title}</div>
                            <div className="grid grid-cols-2 gap-x-2">
                              {g.fields.map(f => {
                                const hidden = hiddenCols[type].includes(f)
                                return (
                                  <button
                                    key={f}
                                    type="button"
                                    onClick={() => toggleHiddenCol(type, f)}
                                    className={`flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-gray-50 transition-colors ${hidden ? 'text-gray-400' : 'text-gray-700'}`}
                                  >
                                    {hidden
                                      ? <EyeOff className="w-3 h-3 text-gray-300 shrink-0" />
                                      : <Eye className="w-3 h-3 text-[#1777CB] shrink-0" />}
                                    <span className="text-[11px] truncate">{getColumnTitle(f, type)}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {adding && (
                <div className="px-3 pt-2 mt-1.5 text-[9px] text-amber-600 border-t border-gray-100">
                  행 추가 중에는 입력 누락 방지를 위해 모든 칼럼이 임시로 표시됩니다.
                </div>
              )}
            </div>
            </AnchoredPortal>
          </>
        )}
      </div>
    )
  }

  const showPcbTable = (tableView === 'all' || tableView === 'pcb') && pcbFilter.categories.length > 0
  const showCableTable = (tableView === 'all' || tableView === 'cable') && cableFilter.categories.length > 0

  // 테이블별 필터 툴바 (노션식 규칙 필터 + 제작구분 칩) — PCB/Cable 동일 마크업
  // 규칙 = [칼럼 ▾][조건 ▾][값 | 년 ▾ 월 ▾][×] 이며 노션처럼 추가/수정/제거 가능.
  // 기본 규칙(입고대기 + 요청일 현재년도)도 일반 규칙이라 X로 제거할 수 있다.
  const renderFilterToolbar = (type: 'pcb' | 'cable') => {
    const f = filterFor(type)
    const tableCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
    const orderedCats = categoryOrder.filter(c => tableCats.includes(c))
    // 조건(규칙)/제작구분 섹션별 '저장됨' 상태 — 서로 독립
    const rulesSaved = filterHasSaved[type].rules && !filterDirty[type].rules
    const catsSaved = filterHasSaved[type].cats && !filterDirty[type].cats
    // 이 표의 저장 필터 목록 + 시작 기본값 설정 여부
    const savedViewsForType = filterViewsConfig.views.filter(v => v.scope === type)
    const hasDefaultForType = !!filterViewsConfig.defaults[type]
    // 필터를 걸 수 있는 칼럼 = 그 테이블의 모든 칼럼
    const filterableFields = Object.keys(MIN_COLUMN_WIDTH[type])
    // 브라우저 기본 select 외형(테두리/패딩/화살표/포커스링)을 완전히 제거 — 알약 안에서 텍스트처럼 보이게
    const selectClass = 'cursor-pointer bg-transparent border-0 p-0 m-0 appearance-none text-[10px] leading-none text-gray-700 focus:outline-none focus:ring-0'
    const selectStyle: React.CSSProperties = {
      WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
      border: 'none', padding: 0, margin: 0, background: 'none', outline: 'none',
    }
    // 네이티브 select는 '가장 긴 옵션' 폭으로 벌어지므로, 현재 선택된 라벨 실측 폭으로 고정한다
    const fitSelect = (label: string, weight = 400): React.CSSProperties => ({
      ...selectStyle,
      width: `${Math.ceil(measureText(label, weight)) + 6}px`,
    })

    // 칼럼 변경 시 새 칼럼이 지원하는 조건으로 보정 (date_in이면 년/월 초기화)
    // op별 기본 value 계산 (status_is면 해당 칼럼의 첫 상태코드, 포함류면 기존/빈 문자열)
    const valueForOp = (field: string, op: FilterOp, prev?: string): string | undefined => {
      if (op === 'status_is') {
        const opts = filterStatusOptionsFor(field)
        return prev && opts.some(o => o.code === prev) ? prev : opts[0].code
      }
      if (op === 'contains' || op === 'not_contains') return prev ?? ''
      return undefined
    }
    const changeRuleField = (rule: FilterRule, field: string) => {
      const ops = opsForField(field)
      // ARTWORK/부품정리로 바꾸면 기본은 상태 선택, 그 외엔 호환되는 기존 조건 유지
      const op = STATUS_FIELDS.includes(field) ? 'status_is' : (ops.includes(rule.op) ? rule.op : ops[0])
      updateRule(type, rule.id, {
        field,
        op,
        value: valueForOp(field, op, rule.value),
        year: op === 'date_in' ? new Date().getFullYear() : null,
        month: op === 'date_in' ? null : null,
      })
    }
    const changeRuleOp = (rule: FilterRule, op: FilterOp) => {
      updateRule(type, rule.id, {
        op,
        value: valueForOp(rule.field, op, rule.value),
        year: op === 'date_in' ? (rule.year ?? new Date().getFullYear()) : null,
        month: op === 'date_in' ? (rule.month ?? null) : null,
      })
    }

    return (
      <>
        {/* Row A: 필터 규칙 (노션식 추가/수정/제거) */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1 flex items-center gap-1 h-[22px] leading-none">
            <SlidersHorizontal className="w-3.5 h-3.5" /> 조건:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {f.rules.map(rule => {
              const ops = opsForField(rule.field)
              const dataYears = yearsFor(type, rule.field)
              const years = rule.year != null && !dataYears.includes(rule.year)
                ? [rule.year, ...dataYears].sort((a, b) => b - a)
                : dataYears
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-1 border border-gray-200 bg-gray-50 rounded-full pl-2 pr-1 h-[22px]"
                >
                  {/* 칼럼 선택 — 미선택 시 '칼럼 선택' 안내 문구를 보여주고, 고르기 전엔 조건/값 입력을 숨긴다 */}
                  <select
                    value={rule.field}
                    onChange={(e) => changeRuleField(rule, e.target.value)}
                    style={fitSelect(rule.field ? getColumnTitle(rule.field, type) : '칼럼 선택', 600)}
                    className={`${selectClass} font-semibold ${rule.field ? '' : 'text-[#1777CB]'}`}
                  >
                    {!rule.field && <option value="" disabled>칼럼 선택</option>}
                    {filterableFields.map(k => (
                      <option key={k} value={k}>{getColumnTitle(k, type)}</option>
                    ))}
                  </select>
                  {rule.field && (<>
                  <span className="text-gray-300">·</span>
                  {/* 조건 선택 */}
                  <select
                    value={rule.op}
                    onChange={(e) => changeRuleOp(rule, e.target.value as FilterOp)}
                    style={fitSelect(opLabelFor(rule.field, rule.op))}
                    className={selectClass}
                  >
                    {ops.map(op => (
                      <option key={op} value={op}>{opLabelFor(rule.field, op)}</option>
                    ))}
                  </select>
                  {/* 조건별 값 입력: 상태 드롭다운(ARTWORK/부품정리) / 년/월 드롭다운 / 텍스트 */}
                  {rule.op === 'status_is' && (
                    <select
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(type, rule.id, { value: e.target.value })}
                      style={fitSelect(filterStatusOptionsFor(rule.field).find(o => o.code === rule.value)?.label ?? '진행중', 700)}
                      className={`${selectClass} text-[#1777CB] font-bold`}
                    >
                      {filterStatusOptionsFor(rule.field).map(o => (
                        <option key={o.code} value={o.code}>{o.label}</option>
                      ))}
                    </select>
                  )}
                  {rule.op === 'date_in' && (
                    <>
                      <select
                        value={rule.year ?? ''}
                        onChange={(e) => updateRule(type, rule.id, { year: e.target.value === '' ? null : Number(e.target.value) })}
                        style={fitSelect(rule.year != null ? `${rule.year}년` : '전체년도', 700)}
                        className={`${selectClass} text-[#1777CB] font-bold`}
                      >
                        <option value="">전체년도</option>
                        {years.map(y => (
                          <option key={y} value={y}>{y}년</option>
                        ))}
                      </select>
                      <select
                        value={rule.month ?? ''}
                        onChange={(e) => updateRule(type, rule.id, { month: e.target.value === '' ? null : Number(e.target.value) })}
                        style={fitSelect(rule.month != null ? `${rule.month}월` : '전체월', 700)}
                        className={`${selectClass} text-[#1777CB] font-bold`}
                      >
                        <option value="">전체월</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                          <option key={m} value={m}>{m}월</option>
                        ))}
                      </select>
                    </>
                  )}
                  {(rule.op === 'contains' || rule.op === 'not_contains') && (
                    <input
                      type="text"
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(type, rule.id, { value: e.target.value })}
                      placeholder="값"
                      // 전역 input 기본 스타일(테두리 박스/포커스 아웃라인) 무력화 — 알약 안에서 밑줄 입력처럼 보이게
                      className="w-20 h-[14px] bg-transparent text-[10px] text-gray-700 border-0 border-b border-gray-300 rounded-none focus:border-[#1777CB] focus:outline-none focus:ring-0 px-0.5 py-0"
                      style={{ border: 'none', borderBottom: '1px solid #d1d5db', boxShadow: 'none', background: 'none', outline: 'none' }}
                    />
                  )}
                  </>)}
                  {/* 규칙 제거 */}
                  <button
                    type="button"
                    onClick={() => removeRule(type, rule.id)}
                    title="이 필터 제거"
                    className="p-0.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
            {/* 규칙 추가 */}
            <button
              type="button"
              onClick={() => addRule(type)}
              className="badge-stats cursor-pointer border border-dashed border-gray-300 bg-white text-gray-500 hover:bg-gray-50 hover:text-[#1777CB] hover:border-[#1777CB] transition-all flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> 필터
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 저장된 필터(사용자별·장치 간 동기화) — 불러오기·저장·기본값 설정 */}
            <button
              type="button"
              onClick={(e) => {
                setNamingViewFor(null); setNewViewName('')
                if (viewsMenuFor === type) { setViewsMenuFor(null); setViewsAnchor(null) }
                else { setViewsMenuFor(type); setViewsAnchor(e.currentTarget) }
              }}
              className={`flex items-center gap-0.5 px-1.5 h-[22px] rounded-full border text-[10px] transition-colors ${
                viewsMenuFor === type
                  ? 'border-[#1777CB] text-[#1777CB] bg-blue-50'
                  : 'border-gray-200 text-gray-500 hover:text-[#1777CB] hover:border-[#1777CB] bg-white'
              }`}
              title="저장된 필터 불러오기·저장"
            >
              <Bookmark className="w-3 h-3" />
              저장된 필터
              {savedViewsForType.length > 0 && (
                <span className="text-[9px] text-gray-400">({savedViewsForType.length})</span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={() => saveRulesFilter(type)}
              className={`p-1 rounded-md transition-colors ${
                rulesSaved
                  ? 'text-[#1777CB] hover:bg-blue-50'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-blue-600'
              }`}
              title={rulesSaved ? '조건 필터 저장됨' : '조건 필터 저장'}
            >
              <FilterSaveIcon saved={rulesSaved} />
            </button>
            <button
              type="button"
              onClick={() => handleResetRules(type)}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="기본 필터로 초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row B: 제작구분 칩 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1 flex items-center gap-1 h-[22px] leading-none">
            <Filter className="w-3.5 h-3.5" /> 제작구분:
          </span>
          <div
            ref={chipRefFor(type)}
            className="flex flex-wrap items-center gap-2 select-none"
          >
            {orderedCats.map((cat, i) => {
              const isSelected = f.categories.includes(cat)
              const showLeftBar = dropIndex?.type === type && dropIndex.index === i
              const showRightBar = dropIndex?.type === type && dropIndex.index === orderedCats.length && i === orderedCats.length - 1
              return (
                <button
                  key={cat}
                  data-cat={cat}
                  type="button"
                  onPointerDown={(e) => handleChipPointerDown(e, cat, type)}
                  title="드래그하여 그룹 순서 변경 · 클릭하여 표시 여부 전환"
                  style={{
                    touchAction: 'none',
                    ...(showLeftBar ? { boxShadow: '-3px 0 0 0 #2563eb' }
                      : showRightBar ? { boxShadow: '3px 0 0 0 #2563eb' }
                      : {})
                  }}
                  className={`badge-stats cursor-grab active:cursor-grabbing border transition-all ${
                    dragCat === cat ? 'opacity-40' : ''
                  } ${
                    isSelected
                      ? 'bg-[#1777CB] border-[#1777CB] text-white font-bold shadow-sm hover:bg-[#1265A8]'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {cat}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={() => saveCategoryFilter(type)}
              className={`p-1 rounded-md transition-colors ${
                catsSaved
                  ? 'text-[#1777CB] hover:bg-blue-50'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-blue-600'
              }`}
              title={catsSaved ? '제작구분 필터 저장됨' : '제작구분 필터 저장'}
            >
              <FilterSaveIcon saved={catsSaved} />
            </button>
            <button
              type="button"
              onClick={() => handleResetCategoryFilter(type)}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 저장된 필터 드롭다운 — document.body로 포털해 카드 overflow에 잘리지 않게 띄운다 */}
        {viewsMenuFor === type && viewsAnchor && (
          <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => { setViewsMenuFor(null); setViewsAnchor(null); setNamingViewFor(null) }} />
            <AnchoredPortal anchorEl={viewsAnchor} align="right" zIndex={9999}>
              <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-[260px] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
                {/* 액션: 현재 필터 저장 / 기본값으로 저장 */}
                {namingViewFor === type ? (
                  // 인라인 이름 입력 — 클릭 즉시 모달 대신 이 입력창에서 이름을 정한다
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitSaveView(type) }
                        else if (e.key === 'Escape') { setNamingViewFor(null); setNewViewName('') }
                      }}
                      placeholder="필터 이름 입력 후 Enter"
                      className="flex-1 min-w-0 h-[24px] px-2 text-[11px] border border-gray-300 rounded focus:outline-none focus:border-[#1777CB]"
                    />
                    <button
                      type="button"
                      onClick={() => commitSaveView(type)}
                      disabled={!newViewName.trim()}
                      className="shrink-0 px-2 h-[24px] rounded text-[11px] text-white bg-[#1777CB] hover:bg-[#1265A8] disabled:bg-gray-300 transition-colors"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNamingViewFor(null); setNewViewName('') }}
                      className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600"
                      title="취소"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNamingViewFor(type); setNewViewName('') }}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-[#1777CB]" /> 현재 필터를 이름 붙여 저장
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { handleSetDefault(type); setViewsMenuFor(null); setViewsAnchor(null) }}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Star className="w-3.5 h-3.5 text-amber-500" /> 현재 필터를 시작 기본값으로
                </button>
                {hasDefaultForType && (
                  <button
                    type="button"
                    onClick={() => { handleClearDefault(type); setViewsMenuFor(null); setViewsAnchor(null) }}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> 시작 기본값 해제
                  </button>
                )}

                <div className="my-1 border-t border-gray-100" />
                <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase">
                  저장된 필터 {savedViewsForType.length > 0 && `(${savedViewsForType.length})`}
                </div>
                {savedViewsForType.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-gray-400">저장된 필터가 없습니다.</div>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto">
                    {savedViewsForType.map(v => (
                      <div key={v.id} className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 transition-colors">
                        <button
                          type="button"
                          onClick={() => handleApplyView(v.id)}
                          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-gray-700"
                          title="이 필터 적용"
                        >
                          <Check className="w-3 h-3 text-gray-300 shrink-0" />
                          <span className="truncate">{v.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenameView(v.id, v.name)}
                          className="p-0.5 rounded text-gray-400 hover:text-[#1777CB] opacity-0 group-hover:opacity-100 transition-opacity"
                          title="이름 변경"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteView(v.id, v.name)}
                          className="p-0.5 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="삭제"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </AnchoredPortal>
          </>
        )}
      </>
    )
  }


  return (
    <div className="p-4 sm:p-5 bg-gray-50 min-h-screen">
      {/* 테이블 뷰 선택 — 보고 싶은 표만 골라 보기. '행 추가' 버튼과 동일한 크기 (페이지 좌측 상단) */}
      <div className="mb-3 flex items-center gap-2">
        {([
          { key: 'all', label: '전체' },
          { key: 'pcb', label: 'PCB' },
          { key: 'cable', label: 'Cable & Case' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTableView(key)}
            className={`button-base flex items-center h-8 px-3 business-radius-button border ${
              tableView === key
                ? 'bg-[#1777CB] hover:bg-[#1265A8] border-[#1777CB]'
                : 'bg-white hover:bg-gray-50 border-gray-300'
            }`}
          >
            <span className={`button-text ${tableView === key ? 'text-white' : 'text-gray-700'}`}>{label}</span>
          </button>
        ))}
      </div>

      {/* 필터 툴바(PCB 전용) — PCB 뷰(전체/PCB)일 때만 표시. Cable만 볼 때는 Cable 표 자체 필터만 남긴다.
          아래 표와 붙이고(rounded-b-none/border-b-0), 헤더로 접기/펴기 */}
      {(tableView === 'all' || tableView === 'pcb') && (
      <div className="card-professional rounded-b-none border-b-0 overflow-hidden">
        {/* 헤더: 좌측 사이드바처럼 접기/펴기 토글 */}
        <button
          type="button"
          onClick={toggleFilterCollapsed}
          className="w-full flex items-center gap-1 px-3 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
          title={filterCollapsed ? '필터 펼치기' : '필터 접기'}
        >
          <Filter className="w-3 h-3" />
          <span>필터</span>
          <ChevronDown className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${filterCollapsed ? '-rotate-90' : ''}`} />
        </button>
        {!filterCollapsed && (
        <div className="px-3 pb-3 pt-3 space-y-3 border-t border-gray-100">
        {/* Row 1: PCB 표 검색창 (이 표에만 적용) */}
        <div className="flex items-center">
          <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
            <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="제작번호, 보드명, 업체명, 날짜(4월 6일) 검색..."
              value={pcbSearch}
              onChange={(e) => setPcbSearch(e.target.value)}
              style={{ paddingLeft: '26px', height: '20px' }}
              className="w-full block business-radius-input border border-gray-300 bg-white text-gray-700 pr-6 text-[11px]"
            />
            {pcbSearch && (
              <button
                type="button"
                onClick={() => setPcbSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                title="검색어 지우기"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {renderFilterToolbar('pcb')}
        </div>
        )}
      </div>
      )}

      {/* 테이블 영역 (필터와 붙임) */}
      <div className="space-y-6">
        
        {/* 테이블 1: PCB & 소켓보드 제작현황 (필터 바로 아래 = 상단 평평) */}
        {showPcbTable && (
          <div className="card-professional overflow-hidden rounded-t-none">
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="modal-section-title">PCB & Socket Board 제작 현황</span>
                <span className="badge-stats bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  {filteredPcbs.length}건
                </span>
                {renderSortControl('pcb')}
              </div>
              <div className="flex items-center gap-2">
                {renderColumnMenu('pcb')}
                <button
                  type="button"
                  onClick={() => handleExportExcel('pcb')}
                  title="필터 적용된 화면을 엑셀로 다운로드"
                  className="button-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="button-text">다운로드</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrint('pcb')}
                  title="필터 적용된 화면을 인쇄"
                  className="button-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="button-text">인쇄</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddClick('pcb')}
                  className="button-base bg-[#1777CB] hover:bg-[#1265A8] text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="button-text text-white">행 추가</span>
                </button>
              </div>
            </div>

            <div ref={pcbScrollRef} onScroll={() => handleVirtualScroll('pcb')} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ zIndex: 40, width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('pcb', 'sales_order_number')}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('pcb', 'production_category')}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={getStickyHeaderStyle('pcb', 'board_name')}>보드명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={getStickyHeaderStyle('pcb', 'reference')}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('pcb', 'request_date')}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('pcb', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_deadline', 80)}>납품기한</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.pjt) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.pjt)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'creator', 80)}>작성자</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.makeQty) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.makeQty)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'artwork_status', 80)}>ARTWORK</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.pcbMake) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.pcbMake)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">PCB 제작</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold" style={getHeaderStyle('pcb', 'parts_organization', 96)}>부품정리</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.assy) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.assy)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold">ASS'Y</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 font-bold" style={getHeaderStyle('pcb', 'final_product_stock', 80)}>완제품 입고</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.inHouse) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.inHouse)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">IN-House Checking</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'design_review', 80)}>디자인리뷰</th>
                    {visibleSpan('pcb', HEADER_SPAN_GROUPS.pcbDelivery) > 0 && (
                      <th colSpan={visibleSpan('pcb', HEADER_SPAN_GROUPS.pcbDelivery)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">납품</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}>작업</th>
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'client_name', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'client_manager', 80)}>업체 담당자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'hansl_manager', 80)}>HANSL</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'revision_count', 50)}>횟수</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'metal_mask', 80)}>MetalMask</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'changes_memo', 160)}>수정 또는 변경사항</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'stock_count', 60)}>재고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'pcb_vendor', 80)}>PCB업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_schedule', 80)}>입고(일정)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'pcb_lead_time', 80)}>제작 기간(PCB)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'received_quantity', 60)}>입고(수량)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'received_destination', 80)}>입고처</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'pcb_stock_completed', 80)}>입고완료</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_hanwha', 80)}>환화</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_evertech', 80)}>에버텍</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_requested_date', 80)}>입고요청일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_passed', 60)}>양품</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_failed', 60)}>불량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_notes', 120)}>비고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'delivery_quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_date', 80)}>일자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_destination', 100)}>배송처</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_completed', 80)}>배송완료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-[10px] text-gray-500 whitespace-nowrap">
                  {addingPcbRow && (
                    <tr 
                      className="bg-[#f8fbff] adding-row"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSavePcbInline()
                        }
                      }}
                    >
                      <td className="px-2 py-1.5 text-center font-bold text-blue-600 sticky left-0 bg-[#f8fbff] z-10 w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">+</td>
                      <td className="px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] bg-[#f8fbff] z-10 truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${salesOrderPcbWidth}px`, minWidth: `${salesOrderPcbWidth}px`, maxWidth: `${salesOrderPcbWidth}px` }}>{addingPcbRow.sales_order_number}</td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth}px`, width: `${productionCategoryPcbWidth}px`, minWidth: `${productionCategoryPcbWidth}px`, maxWidth: `${productionCategoryPcbWidth}px` }}>
                        <select
                          value={addingPcbRow.production_category}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, production_category: e.target.value })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        >
                          <option value="LG_PCB">LG_PCB</option>
                          <option value="LG_Socket Board">LG_Socket Board</option>
                          <option value="PCB">PCB</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth}px`, width: `${pcbBoardWidth}px`, minWidth: `${pcbBoardWidth}px`, maxWidth: `${pcbBoardWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.board_name}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, board_name: e.target.value })}
                          placeholder="보드명 입력"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none align-left"
                        >
                        </input>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth + pcbBoardWidth}px`, width: `${referencePcbWidth}px`, minWidth: `${referencePcbWidth}px`, maxWidth: `${referencePcbWidth}px` }}>
                        <AddPopoverInput
                          value={addingPcbRow.reference || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, reference: v })}
                          placeholder="참고"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth + pcbBoardWidth + referencePcbWidth}px`, width: `${requestDatePcbWidth}px`, minWidth: `${requestDatePcbWidth}px`, maxWidth: `${requestDatePcbWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.request_date ? formatDbDateToDisplay(addingPcbRow.request_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('pcb'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.estimate_no || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, estimate_no: v })}
                          placeholder="견적NO"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_deadline ? formatDateOrMemo(addingPcbRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: toDateOrMemo(e.target.value, defaultMonthFor('pcb')) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="vendors-list"
                          value={addingPcbRow.client_name || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, client_name: v })}
                          placeholder="업체"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="contacts-list-adding-pcb"
                          value={addingPcbRow.client_manager || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, client_manager: v })}
                          placeholder="업체 담당자"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-pcb">
                          {(vendors.find(v => v.vendor_name === addingPcbRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="employees-list"
                          value={addingPcbRow.hansl_manager || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, hansl_manager: v })}
                          placeholder="HANSL 담당"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 text-gray-500 text-center select-none font-semibold">
                        {addingPcbRow.creator || '-'}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.revision_count}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, revision_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="1"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.quantity}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 align-top">
                        <ArtworkAddInput
                          value={addingPcbRow.artwork_status || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, artwork_status: v })}
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.metal_mask || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, metal_mask: v })}
                          placeholder="MetalMask"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.changes_memo || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, changes_memo: v })}
                          placeholder="변경사항"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.stock_count}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, stock_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="vendors-list"
                          value={addingPcbRow.pcb_vendor || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, pcb_vendor: v })}
                          placeholder="PCB업체"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_schedule ? formatDbDateToDisplay(addingPcbRow.delivery_schedule) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('pcb'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.pcb_lead_time || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, pcb_lead_time: v })}
                          placeholder="제작기간"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.received_quantity || 0}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, received_quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.received_destination || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, received_destination: v })}
                          placeholder="입고처"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.pcb_stock_completed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, pcb_stock_completed: e.target.value })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 align-top">
                        <PartsAddInput
                          value={addingPcbRow.parts_organization || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, parts_organization: v })}
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_hanwha ? formatDateOrMemo(addingPcbRow.assy_hanwha) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_hanwha: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_hanwha: toDateOrMemo(e.target.value, defaultMonthFor('pcb')) || '' })}
                          placeholder="환화 (날짜/메모)"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_evertech ? formatDateOrMemo(addingPcbRow.assy_evertech) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_evertech: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_evertech: toDateOrMemo(e.target.value, defaultMonthFor('pcb')) || '' })}
                          placeholder="에버텍 (날짜/메모)"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_requested_date ? formatDbDateToDisplay(addingPcbRow.assy_requested_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('pcb'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.final_product_stock || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, final_product_stock: e.target.value })}
                          placeholder="완제품 입고"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.qa_passed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_passed: e.target.value })}
                          placeholder="양품"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.qa_failed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_failed: e.target.value })}
                          placeholder="불량"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.qa_notes || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, qa_notes: v })}
                          placeholder="비고"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.design_review || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, design_review: v })}
                          placeholder="디자인리뷰"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.delivery_quantity || 0}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_date ? formatDbDateToDisplay(addingPcbRow.delivery_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('pcb'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingPcbRow.delivery_destination || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, delivery_destination: v })}
                          placeholder="배송처"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_completed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_completed: e.target.value })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 text-center border border-gray-200">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={handleSavePcbInline}
                            className="p-1 hover:bg-blue-50 rounded text-blue-600"
                            title="저장"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingPcbRow(null)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="취소"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredPcbs.length === 0 && !addingPcbRow ? (
                    <tr>
                      <td colSpan={38} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    <>
                    {pcbTopPad > 0 && (
                      <tr aria-hidden="true"><td colSpan={38} style={{ height: pcbTopPad, padding: 0, border: 'none' }} /></tr>
                    )}
                    {pcbVisibleRows.map((item, vIdx) => (
                      <MemoRow key={item.id} item={item} index={pcbWinStart + vIdx} sig={rowSig('pcb', item)} widths={pcbColumnWidths} renderRow={renderPcbRow} />
                    ))}
                    {pcbBottomPad > 0 && (
                      <tr aria-hidden="true"><td colSpan={38} style={{ height: pcbBottomPad, padding: 0, border: 'none' }} /></tr>
                    )}
                    </>
                    )
                }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 테이블 2: 케이블 & 케이스 제작현황 (PCB 표가 없으면 이 표가 필터에 붙어 상단 평평) */}
        {showCableTable && (
          <div className={`card-professional overflow-hidden ${!showPcbTable ? 'rounded-t-none' : ''}`}>
            {/* Cable 테이블 전용 필터 — 자체 접기 토글 (상단 패널과 독립) */}
            <button
              type="button"
              onClick={toggleCableFilterCollapsed}
              className="w-full flex items-center gap-1 px-3 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors border-b border-gray-100"
              title={cableFilterCollapsed ? '필터 펼치기' : '필터 접기'}
            >
              <Filter className="w-3 h-3" />
              <span>필터</span>
              <ChevronDown className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${cableFilterCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!cableFilterCollapsed && (
              <div className="px-3 pb-3 pt-3 space-y-3 border-b border-gray-200">
                {/* Row 1: Cable 표 검색창 (이 표에만 적용) */}
                <div className="flex items-center">
                  <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
                    <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="제작번호, 품명, 업체명, 날짜(4월 6일) 검색..."
                      value={cableSearch}
                      onChange={(e) => setCableSearch(e.target.value)}
                      style={{ paddingLeft: '26px', height: '20px' }}
                      className="w-full block business-radius-input border border-gray-300 bg-white text-gray-700 pr-6 text-[11px]"
                    />
                    {cableSearch && (
                      <button
                        type="button"
                        onClick={() => setCableSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                        title="검색어 지우기"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {renderFilterToolbar('cable')}
              </div>
            )}

            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="modal-section-title">Cable & Case 제작 현황</span>
                <span className="badge-stats bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  {filteredCables.length}건
                </span>
                {renderSortControl('cable')}
              </div>
              <div className="flex items-center gap-2">
                {renderColumnMenu('cable')}
                <button
                  type="button"
                  onClick={() => handleExportExcel('cable')}
                  title="필터 적용된 화면을 엑셀로 다운로드"
                  className="button-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="button-text">다운로드</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrint('cable')}
                  title="필터 적용된 화면을 인쇄"
                  className="button-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="button-text">인쇄</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddClick('cable')}
                  className="button-base bg-[#1777CB] hover:bg-[#1265A8] text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="button-text text-white">행 추가</span>
                </button>
              </div>
            </div>

            <div ref={cableScrollRef} onScroll={() => handleVirtualScroll('cable')} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ zIndex: 40, width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('cable', 'sales_order_number')}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('cable', 'production_category')}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={getStickyHeaderStyle('cable', 'board_name')}>품명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={getStickyHeaderStyle('cable', 'reference')}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={getStickyHeaderStyle('cable', 'request_date')}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('cable', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'delivery_deadline', 80)}>납품기한</th>
                    {visibleSpan('cable', HEADER_SPAN_GROUPS.pjt) > 0 && (
                      <th colSpan={visibleSpan('cable', HEADER_SPAN_GROUPS.pjt)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'creator', 80)}>작성자</th>
                    {visibleSpan('cable', HEADER_SPAN_GROUPS.makeQty) > 0 && (
                      <th colSpan={visibleSpan('cable', HEADER_SPAN_GROUPS.makeQty)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'spec_details', 250)}>사양</th>
                    {visibleSpan('cable', HEADER_SPAN_GROUPS.cableStockIn) > 0 && (
                      <th colSpan={visibleSpan('cable', HEADER_SPAN_GROUPS.cableStockIn)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">CASE/CABLE 입고</th>
                    )}
                    {visibleSpan('cable', HEADER_SPAN_GROUPS.cableDelivery) > 0 && (
                      <th colSpan={visibleSpan('cable', HEADER_SPAN_GROUPS.cableDelivery)} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold">납품</th>
                    )}
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}>작업</th>
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'client_name', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'client_manager', 80)}>업체 담당자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'hansl_manager', 80)}>HANSL</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('cable', 'revision_count', 50)}>횟수</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('cable', 'quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_vendor', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_requested_date', 80)}>입고 요청일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_actual_date', 80)}>실제 입고일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'delivery_notes', 150)}>납품/비고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'delivery_completed', 80)}>배송완료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-[10px] text-gray-700 whitespace-nowrap">
                  {addingCableRow && (
                    <tr 
                      className="bg-[#f8fbff] adding-row"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveCableInline()
                        }
                      }}
                    >
                      <td className="px-2 py-1.5 text-center font-bold text-blue-600 sticky left-0 bg-[#f8fbff] z-10 w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">+</td>
                      <td className="px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] bg-[#f8fbff] z-10 truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${salesOrderCableWidth}px`, minWidth: `${salesOrderCableWidth}px`, maxWidth: `${salesOrderCableWidth}px` }}>{addingCableRow.sales_order_number}</td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth}px`, width: `${productionCategoryCableWidth}px`, minWidth: `${productionCategoryCableWidth}px`, maxWidth: `${productionCategoryCableWidth}px` }}>
                        <select
                          value={addingCableRow.production_category}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, production_category: e.target.value })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        >
                          <option value="LG_Cable">LG_Cable</option>
                          <option value="LG_Case">LG_Case</option>
                          <option value="Cable">Cable</option>
                          <option value="Case">Case</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth}px`, width: `${cableBoardWidth}px`, minWidth: `${cableBoardWidth}px`, maxWidth: `${cableBoardWidth}px` }}>
                        <input
                          type="text"
                          value={addingCableRow.board_name}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, board_name: e.target.value })}
                          placeholder="품명 입력"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none align-left"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth + cableBoardWidth}px`, width: `${referenceCableWidth}px`, minWidth: `${referenceCableWidth}px`, maxWidth: `${referenceCableWidth}px` }}>
                        <AddPopoverInput
                          value={addingCableRow.reference || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, reference: v })}
                          placeholder="참고"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth + cableBoardWidth + referenceCableWidth}px`, width: `${requestDateCableWidth}px`, minWidth: `${requestDateCableWidth}px`, maxWidth: `${requestDateCableWidth}px` }}>
                        <input
                          type="text"
                          value={addingCableRow.request_date ? formatDbDateToDisplay(addingCableRow.request_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('cable'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <AddPopoverInput
                          value={addingCableRow.estimate_no || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, estimate_no: v })}
                          placeholder="견적NO"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_deadline ? formatDateOrMemo(addingCableRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: toDateOrMemo(e.target.value, defaultMonthFor('cable')) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="vendors-list"
                          value={addingCableRow.client_name || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, client_name: v })}
                          placeholder="업체명"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="contacts-list-adding-cable"
                          value={addingCableRow.client_manager || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, client_manager: v })}
                          placeholder="업체 담당자"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-cable">
                          {(vendors.find(v => v.vendor_name === addingCableRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          listId="employees-list"
                          value={addingCableRow.hansl_manager || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, hansl_manager: v })}
                          placeholder="HANSL 담당"
                          memo={false}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 text-gray-500 text-center select-none font-semibold">
                        {addingCableRow.creator || '-'}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingCableRow.revision_count}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, revision_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="1"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingCableRow.quantity}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingCableRow.spec_details || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, spec_details: v })}
                          placeholder="상세 사양"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_vendor || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_vendor: e.target.value })}
                          placeholder="업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_requested_date ? formatDbDateToDisplay(addingCableRow.cable_requested_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_requested_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('cable'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_actual_date ? formatDbDateToDisplay(addingCableRow.cable_actual_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor('cable'))) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <AddPopoverInput
                          value={addingCableRow.delivery_notes || ''}
                          onChange={(v) => setAddingCableRow({ ...addingCableRow, delivery_notes: v })}
                          placeholder="납품/비고"
                          memo={true}
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_completed || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_completed: e.target.value })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 text-center border border-gray-200">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={handleSaveCableInline}
                            className="p-1 hover:bg-blue-50 rounded text-blue-600"
                            title="저장"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingCableRow(null)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="취소"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredCables.length === 0 && !addingCableRow ? (
                    <tr>
                      <td colSpan={21} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    <>
                    {cableTopPad > 0 && (
                      <tr aria-hidden="true"><td colSpan={21} style={{ height: cableTopPad, padding: 0, border: 'none' }} /></tr>
                    )}
                    {cableVisibleRows.map((item, vIdx) => (
                      <MemoRow key={item.id} item={item} index={cableWin.start + vIdx} sig={rowSig('cable', item)} widths={cableColumnWidths} renderRow={renderCableRow} />
                    ))}
                    {cableBottomPad > 0 && (
                      <tr aria-hidden="true"><td colSpan={21} style={{ height: cableBottomPad, padding: 0, border: 'none' }} /></tr>
                    )}
                    </>
                    )
                }
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 등록 및 수정 모달 다이얼로그 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 아웃사이드 백드롭 */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          {/* 모달 박스 */}
          <div className="bg-white rounded-lg shadow-2xl border border-gray-200 w-full max-w-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200 compact-modal">
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <span className="modal-title">
                {modalAction === 'add' ? '신규 수주 행 추가' : '수주 정보 수정'} ({modalType === 'pcb' ? 'PCB/소켓' : '케이블/케이스'})
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                {/* 수주제작번호 (자동 생성) */}
                <div>
                  <label className="modal-label mb-1 block">제작 번호 (자동 채번)</label>
                  <input
                    type="text"
                    value={formFields.sales_order_number}
                    readOnly
                    className="h-8 bg-gray-100 border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full text-gray-500 font-semibold focus:outline-none"
                  />
                </div>

                {/* 제작 구분 */}
                <div>
                  <label className="modal-label mb-1 block">제작 구분 *</label>
                  <select
                    value={formFields.production_category}
                    onChange={(e) => setFormFields({ ...formFields, production_category: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {modalType === 'pcb' ? (
                      <>
                        <option value="PCB">PCB</option>
                        <option value="LG_PCB">LG_PCB</option>
                        <option value="LG_Socket Board">LG_Socket Board</option>
                      </>
                    ) : (
                      <>
                        <option value="Cable">Cable</option>
                        <option value="LG_Cable">LG_Cable</option>
                        <option value="Case">Case</option>
                        <option value="LG_Case">LG_Case</option>
                      </>
                    )}
                  </select>
                </div>

                {/* 보드명 / 품명 */}
                <div className="col-span-2">
                  <label className="modal-label mb-1 block">보드명 / 품목 이름 *</label>
                  <input
                    type="text"
                    value={formFields.board_name}
                    onChange={(e) => setFormFields({ ...formFields, board_name: e.target.value })}
                    placeholder="예: Inkjet Trigger Board V1.0"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 요청일 */}
                <div>
                  <label className="modal-label mb-1 block">요청일 *</label>
                  <input
                    type="text"
                    value={formFields.request_date ? formatDbDateToDisplay(formFields.request_date) : ''}
                    onChange={(e) => setFormFields({ ...formFields, request_date: e.target.value })}
                    onBlur={(e) => setFormFields({ ...formFields, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor(modalType))) || '' })}
                    placeholder="예: 7/6"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 견적NO */}
                <div>
                  <label className="modal-label mb-1 block">견적 번호 (견적NO.)</label>
                  <input
                    type="text"
                    value={formFields.estimate_no}
                    onChange={(e) => setFormFields({ ...formFields, estimate_no: e.target.value })}
                    placeholder="입력"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 납품기한 */}
                <div>
                  <label className="modal-label mb-1 block">납품 기한</label>
                  <input
                    type="text"
                    value={formFields.delivery_deadline ? formatDateOrMemo(formFields.delivery_deadline) : ''}
                    onChange={(e) => setFormFields({ ...formFields, delivery_deadline: e.target.value })}
                    onBlur={(e) => setFormFields({ ...formFields, delivery_deadline: toDateOrMemo(e.target.value, defaultMonthFor(modalType)) || '' })}
                    placeholder="예: 7/6"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 수량 */}
                <div>
                  <label className="modal-label mb-1 block">제작 수량 *</label>
                  <input
                    type="number"
                    value={formFields.quantity}
                    onChange={(e) => setFormFields({ ...formFields, quantity: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="0"
                    required
                  />
                </div>

                {/* 업체명 */}
                <div>
                  <label className="modal-label mb-1 block">발주 업체명</label>
                  <input
                    type="text"
                    value={formFields.client_name}
                    onChange={(e) => setFormFields({ ...formFields, client_name: e.target.value })}
                    placeholder="예: LG생기원, 삼성전자"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 업체 담당자 */}
                <div>
                  <label className="modal-label mb-1 block">업체 담당자 성함</label>
                  <input
                    type="text"
                    value={formFields.client_manager}
                    onChange={(e) => setFormFields({ ...formFields, client_manager: e.target.value })}
                    placeholder="예: 김선범 책임"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* HANSL 담당자 */}
                <div>
                  <label className="modal-label mb-1 block">HANSL 담당자</label>
                  <select
                    value={formFields.hansl_manager}
                    onChange={(e) => setFormFields({ ...formFields, hansl_manager: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- 선택 --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.name}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                {/* 작성자 */}
                <div>
                  <label className="modal-label mb-1 block">작성자</label>
                  <select
                    value={formFields.creator}
                    onChange={(e) => setFormFields({ ...formFields, creator: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- 선택 --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.name}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                {/* PCB / 소켓 전용 필드들 */}
                {modalType === 'pcb' && (
                  <>
                    <div className="border-t border-gray-200 col-span-2 pt-3 mt-1.5">
                      <span className="modal-section-title">PCB 제작 관련 상세 공정 정보</span>
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">ARTWORK 상태</label>
                      <div className="border border-[#d2d2d7] rounded-md p-2 bg-white">
                        <ArtworkStatusEditor
                          value={formFields.artwork_status || ''}
                          onChange={(v) => setFormFields({ ...formFields, artwork_status: v })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">MetalMask 상태</label>
                      <input
                        type="text"
                        value={formFields.metal_mask}
                        onChange={(e) => setFormFields({ ...formFields, metal_mask: e.target.value })}
                        placeholder="입력"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">PCB 제작 업체</label>
                      <input
                        type="text"
                        list="vendors-list"
                        value={formFields.pcb_vendor}
                        onChange={(e) => setFormFields({ ...formFields, pcb_vendor: e.target.value })}
                        placeholder="예: 우리기술"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">입고 일정 (일정)</label>
                      <input
                        type="text"
                        value={formFields.delivery_schedule ? formatDbDateToDisplay(formFields.delivery_schedule) : ''}
                        onChange={(e) => setFormFields({ ...formFields, delivery_schedule: e.target.value })}
                        onBlur={(e) => setFormFields({ ...formFields, delivery_schedule: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, defaultMonthFor(modalType))) || '' })}
                        placeholder="예: 7/6"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">재고 수량</label>
                      <input
                        type="number"
                        value={formFields.stock_count}
                        onChange={(e) => setFormFields({ ...formFields, stock_count: e.target.value })}
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min="0"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="modal-label mb-1 block">수정 또는 변경사항 (비고)</label>
                      <textarea
                        value={formFields.changes_memo}
                        onChange={(e) => setFormFields({ ...formFields, changes_memo: e.target.value })}
                        placeholder="입력"
                        rows={2}
                        className="bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </>
                )}

                {/* 케이블 / 케이스 전용 필드들 */}
                {modalType === 'cable' && (
                  <div className="col-span-2 border-t border-gray-200 pt-3 mt-1.5">
                    <label className="modal-label mb-1 block">사양 (상세 스펙 / 구성품 정보)</label>
                    <textarea
                      value={formFields.spec_details}
                      onChange={(e) => setFormFields({ ...formFields, spec_details: e.target.value })}
                      placeholder="예) TOP, BOTTOM 조립 구성품 목록 또는 핀 정보 기입"
                      rows={5}
                      className="bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500 whitespace-pre-wrap"
                    />
                  </div>
                )}
              </div>

              {/* 하단 버튼 그룹 */}
              <div className="border-t border-gray-200 pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 h-8 px-4 rounded-md"
                >
                  <span className="button-text">취소</span>
                </button>
                <button
                  type="submit"
                  className="button-base bg-blue-500 hover:bg-blue-600 text-white h-8 px-4 rounded-md"
                >
                  <span className="button-text text-white">
                    {modalAction === 'add' ? '저장 및 추가' : '수정 완료'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 아웃사이드 백드롭 */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          
          {/* 모달 박스 */}
          <div className="bg-white rounded-lg shadow-2xl border border-gray-200 w-full max-w-sm z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <span className="modal-title font-bold text-red-600">수주 항목 삭제</span>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[11px] text-gray-600 leading-relaxed text-center py-2">
                {deleteConfirm.ids.length > 1
                  ? <>선택한 <b className="text-red-600">{deleteConfirm.ids.length}개 행</b>을 삭제하시겠습니까?</>
                  : <>정말로 이 수주 항목을 삭제하시겠습니까?</>}<br />
                삭제하면 목록에서 사라집니다. (삭제 이력은 시스템 로그에 보존됩니다)
              </p>
              <div className="border-t border-gray-200 pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 h-8 px-4 rounded-md"
                >
                  <span className="button-text">취소</span>
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDelete}
                  className="button-base bg-red-500 hover:bg-red-600 text-white h-8 px-4 rounded-md"
                >
                  <span className="button-text text-white">삭제 실행</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 글로벌 검색/연동을 위한 datalist 정의 */}
      <datalist id="vendors-list">
        {vendors.map(v => (
          <option key={v.id} value={v.vendor_name} />
        ))}
      </datalist>
      <datalist id="employees-list">
        {employees.map(emp => (
          <option key={emp.id} value={emp.name} />
        ))}
      </datalist>

      {/* 드래그 선택 시 나타나는 일괄 상태 변경 플로팅 툴바 */}
      {floatingMenuPos && selectedCells.length > 1 && (() => {
        const bulkType = dragStartCellRef.current?.type || 'pcb'
        const bulkFields = Array.from(new Set(selectedCells.map(k => k.split('::')[1])))
        const bulkField = bulkFields.length === 1 ? bulkFields[0] : null
        const canBulkValue = !!bulkField && BULK_VALUE_EDITABLE.has(bulkField)
        return (
        <div
          className="fixed bg-white border border-gray-200 rounded-md shadow-2xl p-1.5 z-[999] flex flex-col gap-1.5 floating-bulk-picker animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{
            left: `${floatingMenuPos.x}px`,
            top: `${floatingMenuPos.y - (canBulkValue ? 100 : 42)}px`
          }}
        >
          {canBulkValue && renderBulkValueEditor(bulkType, bulkField!)}
          <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-gray-500 px-1 border-r border-gray-100 mr-0.5 select-none">
            {selectedCells.length}개 선택됨:
          </span>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('yellow')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[9px] text-amber-700 font-medium shrink-0"
            title="신규"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>신규</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('blue')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[9px] text-blue-700 font-medium shrink-0"
            title="재발주"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span>재발주</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('red')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[9px] text-red-700 font-medium shrink-0"
            title="취소"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span>취소</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null, 'strike')}
            className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[9px] text-gray-600 font-bold shrink-0 bg-white"
            title="취소선 토글"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null, 'bold')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[9px] text-gray-700 shrink-0 bg-white"
            title="볼드 토글"
          >
            <span className="font-bold">가</span>
            <span>볼드</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null, 'redtext')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-gray-300 hover:bg-red-50 transition-colors text-[9px] text-gray-700 shrink-0 bg-white"
            title="글자 빨간색 토글"
          >
            <span className="text-red-600 font-bold">가</span>
            <span>빨강</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null)}
            className="text-[9px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
            title="색상 및 상태 초기화"
          >
            초기화
          </button>
          <div className="h-4 w-px bg-gray-200 mx-0.5" />
          <button
            type="button"
            onClick={() => { setSelectedCells([]); setFloatingMenuPos(null); }}
            className="text-[9px] text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded transition-colors"
            title="선택 해제"
          >
            닫기
          </button>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
