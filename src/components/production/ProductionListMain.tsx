import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { productionService, ProductionPcb, ProductionCable } from '@/services/productionService'
import { Plus, Search, Edit2, X, Filter, Save, RotateCcw, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { vendorService } from '@/services/vendorService'


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
    return clean;
  }
  const numbers = clean.match(/\d+/g);
  if (!numbers || numbers.length === 0) return val;

  let month = defaultMonth || (new Date().getMonth() + 1);
  let day = 1;

  if (numbers.length >= 3) {
    if (numbers[0].length === 4) {
      month = parseInt(numbers[1], 10);
      day = parseInt(numbers[2], 10);
    } else {
      month = parseInt(numbers[0], 10);
      day = parseInt(numbers[1], 10);
    }
  } else if (numbers.length === 2) {
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

// 완제품 입고: 오늘(한국시간) 날짜로 'MM월 DD일 입고' 라벨 생성
const buildStockInLabel = (): string => {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${mm}월 ${dd}일 입고`;
};

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

type ArtworkParts = { status: string; date: string; memo: string }

// 한국시간(KST) 기준 오늘 날짜 'YYYY-MM-DD'
const getKstTodayISO = (): string => {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const d = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

export default function ProductionListMain() {
  const [pcbs, setPcbs] = useState<ProductionPcb[]>([])
  const [cables, setCables] = useState<ProductionCable[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [addingPcbRow, setAddingPcbRow] = useState<Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'> | null>(null)
  const [addingCableRow, setAddingCableRow] = useState<Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'> | null>(null)

  // 필터 및 검색 상태
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMonth, setSelectedMonth] = useState<number | null>(() => {
    // 저장된 필터가 있으면 처음부터 반영 (마운트 직후 기본값→저장값 교체로 인한 이중 fetch 방지)
    const savedMonth = localStorage.getItem('hansl_prod_filter_month')
    if (savedMonth !== null && savedMonth !== undefined && savedMonth !== '') {
      return savedMonth === 'null' ? null : Number(savedMonth)
    }
    return new Date().getMonth() + 1
  })
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const savedYear = localStorage.getItem('hansl_prod_filter_year')
    return savedYear ? Number(savedYear) : new Date().getFullYear()
  })
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([...DEFAULT_CATEGORY_ORDER])

  // 필터 패널 접기/펴기 (좌측 사이드바처럼) — 기본값은 '닫힘', 사용자가 명시적으로 '0'(펼침) 저장 시에만 펼침
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => localStorage.getItem('hansl_prod_filter_collapsed') !== '0')
  const toggleFilterCollapsed = () => setFilterCollapsed(prev => {
    const next = !prev
    localStorage.setItem('hansl_prod_filter_collapsed', next ? '1' : '0')
    return next
  })

  // 제작구분 그룹 순서 — 저장된 순서가 있으면 반영하고, 누락된 기본 카테고리는 뒤에 보강
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('hansl_prod_filter_category_order')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[]
        const merged = parsed.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
        for (const c of DEFAULT_CATEGORY_ORDER) if (!merged.includes(c)) merged.push(c)
        return merged
      } catch { /* fall through to default */ }
    }
    return [...DEFAULT_CATEGORY_ORDER]
  })
  // 드래그 중인 칩 (ref: 드롭 핸들러의 최신값 보장 / state: 시각 표시용)
  const dragCatRef = useRef<string | null>(null)
  const [dragCat, setDragCat] = useState<string | null>(null)
  // 삽입 지점 인덱스 (0 = 맨 앞, N = 맨 뒤). 칩 사이에 세로 표시선으로 보여줌
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const chipContainerRef = useRef<HTMLDivElement>(null)

  // 커서 X좌표 기준으로 "칩과 칩 사이" 어느 지점에 꽂힐지 인덱스 계산 (빈 간격에 놔도 인식됨)
  const computeDropIndex = (clientX: number): number => {
    const container = chipContainerRef.current
    if (!container) return 0
    const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-cat]'))
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return chips.length
  }

  // 드래그한 칩을 계산된 삽입 지점으로 이동 (제거로 인한 인덱스 밀림 보정)
  const dropCategoryAt = (index: number) => {
    const from = dragCatRef.current
    if (!from) return
    setCategoryOrder(prev => {
      const fromIdx = prev.indexOf(from)
      if (fromIdx < 0) return prev
      const arr = [...prev]
      arr.splice(fromIdx, 1)
      let target = index
      if (fromIdx < index) target -= 1
      target = Math.max(0, Math.min(arr.length, target))
      arr.splice(target, 0, from)
      return arr
    })
  }

  // 포인터 기반 드래그 — 네이티브 HTML5 DnD 대신 pointermove/up으로 직접 처리 (실사용/검증 모두 안정적)
  const dragStartXRef = useRef(0)
  const dragMovedRef = useRef(false)
  const DRAG_THRESHOLD = 4 // px 이상 움직이면 드래그, 아니면 클릭(선택 토글)로 간주

  const handleChipPointerDown = (e: React.PointerEvent<HTMLButtonElement>, cat: string) => {
    if (e.button !== 0) return
    dragCatRef.current = cat
    dragStartXRef.current = e.clientX
    dragMovedRef.current = false
    setDragCat(cat)

    const onMove = (ev: PointerEvent) => {
      if (!dragCatRef.current) return
      if (!dragMovedRef.current && Math.abs(ev.clientX - dragStartXRef.current) < DRAG_THRESHOLD) return
      dragMovedRef.current = true
      setDropIndex(computeDropIndex(ev.clientX))
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragMovedRef.current) {
        dropCategoryAt(computeDropIndex(ev.clientX)) // 놓은 자리에 삽입
      } else if (dragCatRef.current) {
        toggleCategory(dragCatRef.current)            // 안 움직였으면 클릭 = 표시 토글
      }
      dragCatRef.current = null
      dragMovedRef.current = false
      setDragCat(null)
      setDropIndex(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 로컬스토리지에서 저장된 필터 불러오기
  useEffect(() => {
    const savedMonth = localStorage.getItem('hansl_prod_filter_month')
    const savedYear = localStorage.getItem('hansl_prod_filter_year')
    const savedCats = localStorage.getItem('hansl_prod_filter_categories')
    if (savedMonth !== null && savedMonth !== undefined && savedMonth !== '') {
      setSelectedMonth(savedMonth === 'null' ? null : Number(savedMonth))
    }
    if (savedYear !== null && savedYear !== undefined && savedYear !== '') {
      setSelectedYear(Number(savedYear))
    }
    if (savedCats) {
      try {
        const parsed = JSON.parse(savedCats) as string[]
        // 레거시 카테고리 명칭 (suffix _LG)이 있으면 prefix LG_ 형식으로 마이그레이션
        const migrated = parsed.map(cat => {
          if (cat === 'PCB_LG') return 'LG_PCB'
          if (cat === 'Socket Board_LG') return 'LG_Socket Board'
          if (cat === 'Cable_LG') return 'LG_Cable'
          if (cat === 'Case_LG') return 'LG_Case'
          return cat
        })
        setSelectedCategories(migrated)
      } catch (e) {
        console.error(e)
      }
    }
  }, [])

  const handleSaveFilters = () => {
    localStorage.setItem('hansl_prod_filter_month', String(selectedMonth))
    localStorage.setItem('hansl_prod_filter_year', String(selectedYear))
    localStorage.setItem('hansl_prod_filter_categories', JSON.stringify(selectedCategories))
    localStorage.setItem('hansl_prod_filter_category_order', JSON.stringify(categoryOrder))
    toast.success('현재 필터 설정이 저장되었습니다.')
  }

  const handleResetMonthFilter = () => {
    // 기본 세팅 = 현재 월/연도로 복귀 (전체가 아니라 이번 달)
    const now = new Date()
    setSelectedMonth(now.getMonth() + 1)
    setSelectedYear(now.getFullYear())
    toast.info('현재 월로 초기화되었습니다.')
  }

  const handleResetCategoryFilter = () => {
    setSelectedCategories([...DEFAULT_CATEGORY_ORDER])
    setCategoryOrder([...DEFAULT_CATEGORY_ORDER])
    toast.info('제작구분 필터가 초기화되었습니다.')
  }

  // 컬럼 좌우 여백 (각각 5px, 총 10px) — globals.css의 .production-compact-table th/td 패딩과 반드시 동일하게 유지
  const COLUMN_PADDING_SIDE = 5

  // 웹폰트(Pretendard) 로드 완료 후 한 번 재렌더 → 캔버스 실측 폭을 실제 렌더 폰트와 일치시킴
  const [, setFontsReady] = useState(false)
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'pcb' | 'cable', id: string } | null>(null)

  // 인라인 셀 수정 상태
  const [editingCell, setEditingCell] = useState<{ id: string, type: 'pcb' | 'cable', field: string } | null>(null)
  const [editValue, setEditValue] = useState<string>('')

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
  const [isDragging, setIsDragging] = useState(false)
  const dragStartCellRef = useRef<{ id: string; field: string; type: 'pcb' | 'cable' } | null>(null)
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null)

  const pcbColumns = [
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
    'delivery_destination'
  ]

  const cableColumns = [
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
    'delivery_notes'
  ]

  const getRowIndex = (type: 'pcb' | 'cable', id: string) => {
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    return list.findIndex(item => item.id === id)
  }

  const handleCellMouseDown = (e: React.MouseEvent, id: string, field: string, type: 'pcb' | 'cable') => {
    if (e.button !== 0) return // 마우스 왼쪽 클릭만 지원
    // 실제 드래그로 판명되기 전까지는 ref에만 기록한다.
    // 여기서 곧바로 setSelectedCells를 호출하면 뒤이은 click 핸들러가 "이미 선택된 셀"로 오판해
    // 첫 클릭에 곧장 편집 모드로 들어가버린다 (선택→편집 2단계 클릭이 깨짐).
    dragStartCellRef.current = { id, field, type }
    if (editingCell) setEditingCell(null)
    if (floatingMenuPos) setFloatingMenuPos(null)
  }

  const handleCellMouseEnter = (e: React.MouseEvent, id: string, field: string, type: 'pcb' | 'cable') => {
    const dragStartCell = dragStartCellRef.current
    if (!dragStartCell || dragStartCell.type !== type) return
    if ((e.buttons & 1) === 0) return // 왼쪽 버튼이 눌린 상태에서 이동할 때만 드래그로 인정
    if (!isDragging) setIsDragging(true)

    const cols = type === 'pcb' ? pcbColumns : cableColumns
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
  }

  // 드래그 종료 마우스 리스너 및 아웃사이드 클릭 해제 처리
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDragging) {
        setIsDragging(false)
        if (selectedCells.length > 1) {
          setFloatingMenuPos({ x: e.clientX, y: e.clientY })
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

    // 월별 필터에 기반한 날짜 자동 계산
    let calculatedStartDate = ''
    let calculatedEndDate = ''
    const pad = (n: number) => String(n).padStart(2, '0')
    if (selectedMonth !== null) {
      calculatedStartDate = `${selectedYear}-${pad(selectedMonth)}-01`
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
      calculatedEndDate = `${selectedYear}-${pad(selectedMonth)}-${pad(lastDay)}`
    } else {
      calculatedStartDate = `${selectedYear}-01-01`
      calculatedEndDate = `${selectedYear}-12-31`
    }

    try {
      const pcbData = await productionService.getProductionPcbs({
        query: searchQuery,
        startDate: calculatedStartDate,
        endDate: calculatedEndDate
      })
      const cableData = await productionService.getProductionCables({
        query: searchQuery,
        startDate: calculatedStartDate,
        endDate: calculatedEndDate
      })
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

  // 검색/필터 변경 시 로드
  useEffect(() => {
    loadData()
  }, [searchQuery, selectedMonth, selectedYear])

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
  }, [searchQuery, selectedMonth, selectedYear])

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

  // 카테고리 필터 토글
  const toggleCategory = (cat: string) => {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories(selectedCategories.filter(c => c !== cat))
    } else {
      setSelectedCategories([...selectedCategories, cat])
    }
  }

  // 행 추가 인라인 모드로 전환
  const handleAddClick = async (type: 'pcb' | 'cable') => {
    const today = new Date().toISOString().split('T')[0]
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
      toast.success('신규 PCB 항목이 저장되었습니다.')
      setAddingPcbRow(null)
      // 저장된 행의 요청일이 현재 월/연도 필터 밖이면(예: 6월을 보는데 오늘=7월로 저장),
      // 저장은 됐지만 목록에 안 보여 "저장이 안 된 것처럼" 보이므로 필터를 해당 행 기준으로 이동시켜 노출
      focusFilterOnRow(created?.request_date)
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 저장된 행이 현재 필터에 보이지 않을 경우, 그 행의 요청일 기준으로 월/연도 필터를 옮겨 노출한다.
  // (필터가 바뀌면 useEffect가 loadData를 호출하고, 바뀌지 않으면 여기서 직접 loadData 호출)
  const focusFilterOnRow = (requestDate?: string | null) => {
    if (!requestDate) { loadData(); return }
    const [y, m] = requestDate.split('-').map(Number)
    const inCurrentFilter = y === selectedYear && (selectedMonth === null || selectedMonth === m)
    if (inCurrentFilter) {
      loadData()
    } else {
      setSelectedYear(y)
      setSelectedMonth(m)
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
      toast.success('신규 Cable/Case 항목이 저장되었습니다.')
      setAddingCableRow(null)
      focusFilterOnRow(created?.request_date)
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 인라인 셀 수정 클릭 핸들러: 첫 클릭은 셀 선택만, 이미 선택된 셀을 한 번 더 클릭하면 편집 모드로 진입
  const handleCellClick = (id: string, type: 'pcb' | 'cable', field: string, currentValue: any) => {
    if (selectedCells.length > 1) return
    const cellKey = `${id}::${field}`
    const isAlreadySelected = selectedCells.length === 1 && selectedCells[0] === cellKey
    if (isAlreadySelected) {
      setEditingCell({ id, type, field })
      setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue))
    } else {
      setSelectedCells([cellKey])
    }
  }

  // 인라인 셀 수정 저장 핸들러
  const handleCellSave = async (currentCell: { id: string, type: 'pcb' | 'cable', field: string }, val: string) => {
    const { id, type, field } = currentCell
    
    // 날짜 컬럼 보정
    let valueToSave: any = val
    if (['request_date', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'].includes(field)) {
      if (val) {
        const parsed = parseAndFormatInputDate(val, selectedMonth)
        const dbDate = formatDisplayDateToDb(parsed)
        valueToSave = dbDate || null
      } else {
        valueToSave = null
      }
    } else if (['assy_hanwha', 'assy_evertech', 'delivery_deadline'].includes(field)) {
      // 날짜 또는 메모 하이브리드: 날짜면 YYYY-MM-DD, 아니면 메모 원문
      valueToSave = toDateOrMemo(val, selectedMonth)
    } else if (['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'].includes(field)) {
      valueToSave = val === '' ? null : Number(val)
    } else if (field === 'hansl_manager') {
      valueToSave = val === '' ? null : stripEmployeeTitle(val)
    } else if (val === '') {
      valueToSave = null
    }

    try {
      if (type === 'pcb') {
        await productionService.updateProductionPcb(id, { [field]: valueToSave })
      } else {
        await productionService.updateProductionCable(id, { [field]: valueToSave })
      }
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('수정에 실패했습니다.')
    }
  }

  // 수량 단위(ea/set) 변경 핸들러
  const handleUpdateQuantityUnit = async (id: string, type: 'pcb' | 'cable', unit: string) => {
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
  }

  // 완제품 입고: '입고대기' 버튼 클릭 → 오늘(한국시간) 날짜로 'MM월 DD일 입고' 기록
  const handleStockInPress = (id: string, type: 'pcb' | 'cable') => {
    handleCellSave({ id, type, field: 'final_product_stock' }, buildStockInLabel())
  }

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
  const handleUpdateRowColor = async (type: 'pcb' | 'cable', id: string, colorAction: string | null, isToggleStrike = false) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
      const list = type === 'pcb' ? filteredPcbs : filteredCables
      const currentItem = list.find(i => i.id === id)
      if (!currentItem) return
      
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
      const { error } = await supabase.from(table).update({ row_color: serialized }).eq('id', id)
      if (error) throw error
      
      loadData()
      setActiveColorPicker(null)
      toast.success('행 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  }

  // 개별 셀 배경색 업데이트 핸들러
  const handleUpdateCellColor = async (type: 'pcb' | 'cable', id: string, field: string, colorAction: string | null, currentCellColors: any, toggle: 'strike' | 'bold' | 'redtext' | null = null) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
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
      
      const { error } = await supabase.from(table).update({ cell_colors: newCellColors }).eq('id', id)
      if (error) throw error
      
      // 색상 선택 시, 입력칸에 수정 중이던 텍스트도 자동으로 함께 저장하고 수정을 완료합니다.
      await handleCellSave({ id, type, field }, editValue)
      setEditingCell(null)
      toast.success('칸 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  }

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

  // 카테고리 필터 매칭 + 드래그한 제작구분 순서대로 그룹핑 (그룹 내부는 기존 정렬(제작번호 내림차순) 유지 — Array.sort는 안정 정렬)
  const filteredPcbs = pcbs
    .filter(item => selectedCategories.includes(item.production_category))
    .sort((a, b) => categoryRank(a.production_category) - categoryRank(b.production_category))
  const filteredCables = cables
    .filter(item => selectedCategories.includes(item.production_category))
    .sort((a, b) => categoryRank(a.production_category) - categoryRank(b.production_category))

  // 셀에 표시되는 폰트 굵기: 실제 렌더링 클래스(font-semibold/medium)와 동일하게 맞춰야 실측이 정확함
  const getFieldFontWeight = (field: string, hasValue: boolean): number => {
    if (field === 'reference' || field === 'sales_order_number') return 600
    if (field === 'board_name') return 500
    const isDateField = field.endsWith('_date') || field.endsWith('_deadline') || field.endsWith('_schedule')
    if (isDateField && hasValue) return 600 // 날짜값 있으면 font-semibold로 표시됨
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
    return val.toString()
  }

  // 칼럼 너비 = Max(헤더 실측, 가장 긴 본문 실측) + 좌우 여백(5px씩) [+ 비고정 칼럼은 우측 보더 1px]
  const getColumnWidth = (type: 'pcb' | 'cable', field: string, defaultWidth: number): number => {
    // 1. 헤더 실측 (table-header-text: 600 굵기, letter-spacing 0.02em)
    const title = getColumnTitle(field, type)
    const titleWidth = measureText(title, 600, HEADER_LETTER_SPACING)

    // 2. 모든 행(입력 중인 신규 행 포함)의 표시값 실측 — 표시 굵기 그대로 반영
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    const addingRow = type === 'pcb' ? addingPcbRow : addingCableRow
    const rows: any[] = addingRow ? [...list, addingRow] : list

    let maxValWidth = 0
    for (const item of rows) {
      const valStr = getDisplayValueForField(type, field, item)
      const hasValue = item[field] !== null && item[field] !== undefined && item[field] !== ''
      // 취소선 셀은 font-normal(400)로 렌더되므로 같은 굵기로 측정 (renderEditableCell의 isStruck 로직과 동일)
      const cState = parseColorState(item.cell_colors?.[field])
      const rState = parseColorState(item.row_color)
      const isStruck = cState.strike === 'strike' ? true : cState.strike === 'nostrike' ? false : (rState.strike === 'strike')
      const isBold = cState.bold || rState.bold
      const weight = isBold ? 700 : (isStruck ? 400 : getFieldFontWeight(field, hasValue))
      const w = measureText(valStr, weight)
      if (w > maxValWidth) maxValWidth = w
    }

    // 3. 좌우 여백 5px씩 + (border-r을 쓰는 비고정 칼럼은 border-box라 1px 보정)
    const borderAllowance = STICKY_FIELDS.includes(field) ? 0 : 1
    const contentWidth = Math.max(titleWidth, maxValWidth) + COLUMN_PADDING_SIDE * 2 + borderAllowance
    // 표별(PCB/Cable) 데이터 평균 기반 최소 폭을 바닥값으로 적용 (빈 표에서도 입력 여유 공간 확보)
    return Math.ceil(Math.max(contentWidth, MIN_COLUMN_WIDTH[type][field] ?? 0))
  }

  const getHeaderStyle = (type: 'pcb' | 'cable', field: string, defaultWidth: number): React.CSSProperties => {
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

  // 인라인 수정용 공통 렌더러 함수
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
    const isEditing = editingCell?.id === id && editingCell?.type === type && editingCell?.field === field
    const cellStyle: React.CSSProperties = {}

    const activeSalesWidth = type === 'pcb' ? salesOrderPcbWidth : salesOrderCableWidth
    const activeProdCatWidth = type === 'pcb' ? productionCategoryPcbWidth : productionCategoryCableWidth
    const activeBoardWidth = type === 'pcb' ? pcbBoardWidth : cableBoardWidth
    const activeRefWidth = type === 'pcb' ? referencePcbWidth : referenceCableWidth
    const activeReqDateWidth = type === 'pcb' ? requestDatePcbWidth : requestDateCableWidth
    const stickyBase = 40 + activeSalesWidth // NO.(40px 고정) + 제작 번호(동적)

    if (field === 'production_category') {
      cellStyle.left = `${stickyBase}px`
      cellStyle.width = `${activeProdCatWidth}px`
      cellStyle.minWidth = `${activeProdCatWidth}px`
      cellStyle.maxWidth = `${activeProdCatWidth}px`
    } else if (field === 'board_name') {
      cellStyle.left = `${stickyBase + activeProdCatWidth}px`
      cellStyle.width = `${activeBoardWidth}px`
      cellStyle.minWidth = `${activeBoardWidth}px`
      cellStyle.maxWidth = `${activeBoardWidth}px`
    } else if (field === 'reference') {
      cellStyle.left = `${stickyBase + activeProdCatWidth + activeBoardWidth}px`
      cellStyle.width = `${activeRefWidth}px`
      cellStyle.minWidth = `${activeRefWidth}px`
      cellStyle.maxWidth = `${activeRefWidth}px`
    } else if (field === 'request_date') {
      cellStyle.left = `${stickyBase + activeProdCatWidth + activeBoardWidth + activeRefWidth}px`
      cellStyle.width = `${activeReqDateWidth}px`
      cellStyle.minWidth = `${activeReqDateWidth}px`
      cellStyle.maxWidth = `${activeReqDateWidth}px`
    } else {
      const activeWidth = getColumnWidth(type, field, 0)
      cellStyle.width = `${activeWidth}px`
      cellStyle.minWidth = `${activeWidth}px`
      cellStyle.maxWidth = `${activeWidth}px`
    }

    const renderCellColorPicker = () => {
      const cellVal = item.cell_colors?.[field];
      const { color: activeColor, strike: isCellStruck, bold: isCellBold, redText: isCellRedText } = parseColorState(cellVal);

      return (
        <div
          className="absolute left-0 bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg p-1 z-50 flex flex-col gap-1"
          style={{ width: 'max-content' }}
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
    };

    if (isEditing) {
      const editCellStyle = { ...cellStyle, overflow: 'visible', zIndex: 50 }
      if (field === 'artwork_status') {
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <span className="text-[10px] text-gray-400 truncate block px-1">
              {formatArtworkDisplay(editValue) || ' '}
            </span>
            <div
              className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-gray-300 rounded-md shadow-lg p-1.5"
              style={{ width: '150px' }}
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
            </div>
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

      return (
        <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
          <input
            autoFocus
            type={inputType}
            list={listId}
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
              }
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
    const isDateField = field.endsWith('_date') || field.endsWith('_deadline') || field.endsWith('_schedule');
    const hasValue = item[field] !== null && item[field] !== undefined && item[field] !== '';
    if (isDateField && hasValue) {
      computedClassName += ' font-semibold text-gray-900'
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
        .replace('font-semibold', '')
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

    const isSelected = selectedCells.includes(`${id}::${field}`);
    const isStickyCell = cellClassName.includes('sticky');
    const selectStyle: React.CSSProperties = isSelected ? {
      outline: '1.5px solid #3b82f6',
      outlineOffset: '-1.5px',
      // 고정 칼럼은 반투명 배경을 주면 가로 스크롤 시 뒤의 비고정 칼럼이 비쳐 보이므로,
      // 원래의 불투명 배경(흰색/셀 색상)을 유지한 채 테두리만 표시한다.
      ...(isStickyCell ? {} : { backgroundColor: 'rgba(59, 130, 246, 0.1)' }),
      ...cellStyle
    } : cellStyle;

    // 완제품 입고: 값이 비어 있으면 '입고대기' 버튼 표시 (클릭 시 오늘 날짜 기록)
    const isStockWaiting = field === 'final_product_stock' &&
      (item.final_product_stock == null ||
       String(item.final_product_stock).trim() === '' ||
       String(item.final_product_stock).trim() === '-')

    // 선택된 셀은 transition-colors를 제거해 하이라이트가 150ms 페이드 없이 즉시 나타나게 한다
    const tdClassName = `${computedClassName} cursor-pointer ${item.row_color || item.cell_colors?.[field] ? '' : 'hover:bg-gray-100/50'} transition-colors select-none`
    return (
      <td
        className={isSelected ? tdClassName.replace(/\btransition-colors\b/g, '') : tdClassName}
        style={selectStyle}
        onMouseDown={(e) => handleCellMouseDown(e, id, field, type)}
        onMouseEnter={(e) => handleCellMouseEnter(e, id, field, type)}
        onClick={isStockWaiting
          ? (e) => { e.stopPropagation(); handleStockInPress(id, type) }
          : () => handleCellClick(id, type, field, item[field])}
        title={field === 'board_name' ? item.board_name : undefined}
      >
        {isStockWaiting ? (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); handleStockInPress(id, type) }}
            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            입고대기
          </button>
        ) : displayValue}
      </td>
    )
  }

  // 수량 셀: 숫자(인라인 편집) + 단위(ea/set) 드롭다운. 배경색은 tr에서 상속됨
  const renderQuantityCell = (id: string, type: 'pcb' | 'cable', item: any) => {
    const isEditing = editingCell?.id === id && editingCell?.type === type && editingCell?.field === 'quantity'
    const unit = item.quantity_unit || 'ea'
    return (
      <td className="px-2 py-1.5 text-gray-500 border border-gray-200">
        <div className="flex items-center justify-center gap-1">
          {isEditing ? (
            <input
              autoFocus
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => { handleCellSave({ id, type, field: 'quantity' }, editValue); setEditingCell(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { handleCellSave({ id, type, field: 'quantity' }, editValue); setEditingCell(null) }
                if (e.key === 'Escape') setEditingCell(null)
              }}
              className="w-10 h-5 bg-white border border-gray-300 rounded px-1 py-0 text-[10px] text-center focus:outline-none"
            />
          ) : (
            <span
              className="cursor-pointer min-w-[14px] text-center"
              onClick={() => handleCellClick(id, type, 'quantity', item.quantity)}
            >
              {item.quantity ?? ''}
            </span>
          )}
          <select
            value={unit}
            onMouseDown={(e) => e.stopPropagation()}
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

  // 삭제 처리
  const handleDeleteClick = (type: 'pcb' | 'cable', id: string) => {
    setDeleteConfirm({ type, id })
  }

  const handleExecuteDelete = async () => {
    if (!deleteConfirm) return
    const { type, id } = deleteConfirm
    setDeleteConfirm(null)
    try {
      if (type === 'pcb') {
        await productionService.deleteProductionPcb(id)
      } else {
        await productionService.deleteProductionCable(id)
      }
      toast.success('성공적으로 삭제되었습니다.')
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
          await productionService.createProductionPcb(payload)
          toast.success('신규 PCB 항목이 추가되었습니다.')
        } else if (selectedId) {
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
          await productionService.createProductionCable(payload)
          toast.success('신규 케이블/케이스 항목이 추가되었습니다.')
        } else if (selectedId) {
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
  const showPcbTable = selectedCategories.includes('PCB') || selectedCategories.includes('LG_PCB') || selectedCategories.includes('LG_Socket Board')
  const showCableTable = selectedCategories.includes('Cable') || selectedCategories.includes('LG_Cable') || selectedCategories.includes('Case') || selectedCategories.includes('LG_Case')


  return (
    <div className="p-4 sm:p-5 bg-gray-50 min-h-screen">
      {/* 필터 툴바 — 아래 표와 붙이고(rounded-b-none/border-b-0), 헤더로 접기/펴기 */}
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
        {/* Row 1: 통합 검색창 */}
        <div className="flex items-center">
          <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
            <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="제작번호, 보드명, 업체명 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '26px', height: '20px' }}
              className="w-full block business-radius-input border border-gray-300 bg-white text-gray-700 pr-3 text-[11px]"
            />
          </div>
        </div>

        {/* Row 2: 요청월 필터 버튼 그룹 */}
        {/* Row 2: 요청월 필터 버튼 그룹 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1">
            요청월:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{ 
                width: '56px', 
                textAlign: 'center',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                appearance: 'none',
                background: 'none'
              }}
              className="badge-stats cursor-pointer border bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 transition-all justify-center text-center px-1"
            >
              {years.map(y => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSelectedMonth(null)}
              className={`badge-stats cursor-pointer border transition-all ${
                selectedMonth === null
                  ? 'bg-[#1777CB] border-[#1777CB] text-white font-bold shadow-sm hover:bg-[#1265A8]'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              전체
            </button>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={`badge-stats cursor-pointer border transition-all ${
                  selectedMonth === m
                    ? 'bg-[#1777CB] border-[#1777CB] text-white font-bold shadow-sm hover:bg-[#1265A8]'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {m}월
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={handleSaveFilters}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
              title="필터 저장"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetMonthFilter}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 3: 카테고리 필터 토글 버튼 그룹 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> 제작구분:
          </span>
          <div
            ref={chipContainerRef}
            className="flex flex-wrap items-center gap-2 select-none"
          >
            {categoryOrder.map((cat, i) => {
              const isSelected = selectedCategories.includes(cat)
              const showLeftBar = dropIndex === i
              const showRightBar = dropIndex === categoryOrder.length && i === categoryOrder.length - 1
              return (
                <button
                  key={cat}
                  data-cat={cat}
                  type="button"
                  onPointerDown={(e) => handleChipPointerDown(e, cat)}
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
              onClick={handleSaveFilters}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
              title="필터 저장"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetCategoryFilter}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        </div>
        )}
      </div>

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
              </div>
              <button
                type="button"
                onClick={() => handleAddClick('pcb')}
                className="button-base bg-[#1777CB] hover:bg-[#1265A8] text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="button-text text-white">행 추가</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[40px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${salesOrderPcbWidth}px`, minWidth: `${salesOrderPcbWidth}px`, maxWidth: `${salesOrderPcbWidth}px` }}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth}px`, width: `${productionCategoryPcbWidth}px`, minWidth: `${productionCategoryPcbWidth}px`, maxWidth: `${productionCategoryPcbWidth}px` }}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth}px`, width: `${pcbBoardWidth}px`, minWidth: `${pcbBoardWidth}px`, maxWidth: `${pcbBoardWidth}px` }}>보드명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth + pcbBoardWidth}px`, width: `${referencePcbWidth}px`, minWidth: `${referencePcbWidth}px`, maxWidth: `${referencePcbWidth}px` }}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth + pcbBoardWidth + referencePcbWidth}px`, width: `${requestDatePcbWidth}px`, minWidth: `${requestDatePcbWidth}px`, maxWidth: `${requestDatePcbWidth}px` }}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('pcb', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_deadline', 80)}>납품기한</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'creator', 80)}>작성자</th>
                    <th colSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'artwork_status', 80)}>ARTWORK</th>
                    <th colSpan={8} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">PCB 제작</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold" style={getHeaderStyle('pcb', 'parts_organization', 96)}>부품정리</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold">ASS'Y</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 font-bold" style={getHeaderStyle('pcb', 'final_product_stock', 80)}>완제품 입고</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">IN-House Checking</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'design_review', 80)}>디자인리뷰</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">납품</th>
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
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_hanwha', 80)}>환화</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_evertech', 80)}>에버텍</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_requested_date', 80)}>입고요청일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_passed', 60)}>양품</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_failed', 60)}>불량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_notes', 120)}>비고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'delivery_quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_date', 80)}>일자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_destination', 100)}>배송처</th>
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
                        <input
                          type="text"
                          value={addingPcbRow.reference || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, reference: e.target.value })}
                          placeholder="참고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none text-red-500 font-semibold align-left"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderPcbWidth + productionCategoryPcbWidth + pcbBoardWidth + referencePcbWidth}px`, width: `${requestDatePcbWidth}px`, minWidth: `${requestDatePcbWidth}px`, maxWidth: `${requestDatePcbWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.request_date ? formatDbDateToDisplay(addingPcbRow.request_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.estimate_no || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, estimate_no: e.target.value })}
                          placeholder="견적NO"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_deadline ? formatDateOrMemo(addingPcbRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: toDateOrMemo(e.target.value, selectedMonth) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="vendors-list"
                          value={addingPcbRow.client_name || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, client_name: e.target.value })}
                          placeholder="업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="contacts-list-adding-pcb"
                          value={addingPcbRow.client_manager || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, client_manager: e.target.value })}
                          placeholder="업체 담당자"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-pcb">
                          {(vendors.find(v => v.vendor_name === addingPcbRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="employees-list"
                          value={addingPcbRow.hansl_manager || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, hansl_manager: e.target.value })}
                          placeholder="HANSL 담당"
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
                        <ArtworkStatusEditor
                          value={addingPcbRow.artwork_status || ''}
                          onChange={(v) => setAddingPcbRow({ ...addingPcbRow, artwork_status: v })}
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.metal_mask || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, metal_mask: e.target.value })}
                          placeholder="MetalMask"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.changes_memo || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, changes_memo: e.target.value })}
                          placeholder="변경사항"
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
                        <input
                          type="text"
                          list="vendors-list"
                          value={addingPcbRow.pcb_vendor || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, pcb_vendor: e.target.value })}
                          placeholder="PCB업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_schedule ? formatDbDateToDisplay(addingPcbRow.delivery_schedule) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.pcb_lead_time || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, pcb_lead_time: e.target.value })}
                          placeholder="제작기간"
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
                        <input
                          type="text"
                          value={addingPcbRow.received_destination || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, received_destination: e.target.value })}
                          placeholder="입고처"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.parts_organization || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, parts_organization: e.target.value })}
                          placeholder="부품정리"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_hanwha ? formatDateOrMemo(addingPcbRow.assy_hanwha) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_hanwha: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_hanwha: toDateOrMemo(e.target.value, selectedMonth) || '' })}
                          placeholder="환화 (날짜/메모)"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_evertech ? formatDateOrMemo(addingPcbRow.assy_evertech) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_evertech: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_evertech: toDateOrMemo(e.target.value, selectedMonth) || '' })}
                          placeholder="에버텍 (날짜/메모)"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_requested_date ? formatDbDateToDisplay(addingPcbRow.assy_requested_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
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
                        <input
                          type="text"
                          value={addingPcbRow.qa_notes || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_notes: e.target.value })}
                          placeholder="비고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.design_review || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, design_review: e.target.value })}
                          placeholder="디자인리뷰"
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
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_destination || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_destination: e.target.value })}
                          placeholder="배송처"
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
                      <td colSpan={36} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredPcbs.map((item, index) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-200' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      return (
                        <tr key={item.id} className={`group transition-colors ${rowBgClass}`}>
                          <td 
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              setActiveColorPicker(activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' ? null : { id: item.id, type: 'pcb' })
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
                          <td className={`px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] transition-colors z-10 truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`} style={{ width: `${salesOrderPcbWidth}px`, minWidth: `${salesOrderPcbWidth}px`, maxWidth: `${salesOrderPcbWidth}px` }}>{item.sales_order_number}</td>
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
                        <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
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
                          'parts_organization',
                          item,
                          item.parts_organization || '-',
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
                          item.final_product_stock || '-',
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
                  }))
                }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 테이블 2: 케이블 & 케이스 제작현황 (PCB 표가 없으면 이 표가 필터에 붙어 상단 평평) */}
        {showCableTable && (
          <div className={`card-professional overflow-hidden ${!showPcbTable ? 'rounded-t-none' : ''}`}>
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="modal-section-title">Cable & Case 제작 현황</span>
                <span className="badge-stats bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  {filteredCables.length}건
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleAddClick('cable')}
                className="button-base bg-[#1777CB] hover:bg-[#1265A8] text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="button-text text-white">행 추가</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[40px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${salesOrderCableWidth}px`, minWidth: `${salesOrderCableWidth}px`, maxWidth: `${salesOrderCableWidth}px` }}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth}px`, width: `${productionCategoryCableWidth}px`, minWidth: `${productionCategoryCableWidth}px`, maxWidth: `${productionCategoryCableWidth}px` }}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth}px`, width: `${cableBoardWidth}px`, minWidth: `${cableBoardWidth}px`, maxWidth: `${cableBoardWidth}px` }}>품명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-center" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth + cableBoardWidth}px`, width: `${referenceCableWidth}px`, minWidth: `${referenceCableWidth}px`, maxWidth: `${referenceCableWidth}px` }}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth + cableBoardWidth + referenceCableWidth}px`, width: `${requestDateCableWidth}px`, minWidth: `${requestDateCableWidth}px`, maxWidth: `${requestDateCableWidth}px` }}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('cable', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'delivery_deadline', 80)}>납품기한</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'creator', 80)}>작성자</th>
                    <th colSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'spec_details', 250)}>사양</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">CASE/CABLE 입고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 font-bold" style={getHeaderStyle('cable', 'delivery_notes', 150)}>납품/비고</th>
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
                        <input
                          type="text"
                          value={addingCableRow.reference || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, reference: e.target.value })}
                          placeholder="참고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none text-red-500 font-semibold align-left"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${40 + salesOrderCableWidth + productionCategoryCableWidth + cableBoardWidth + referenceCableWidth}px`, width: `${requestDateCableWidth}px`, minWidth: `${requestDateCableWidth}px`, maxWidth: `${requestDateCableWidth}px` }}>
                        <input
                          type="text"
                          value={addingCableRow.request_date ? formatDbDateToDisplay(addingCableRow.request_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.estimate_no || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, estimate_no: e.target.value })}
                          placeholder="견적NO"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_deadline ? formatDateOrMemo(addingCableRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: toDateOrMemo(e.target.value, selectedMonth) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="vendors-list"
                          value={addingCableRow.client_name || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, client_name: e.target.value })}
                          placeholder="업체명"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="contacts-list-adding-cable"
                          value={addingCableRow.client_manager || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, client_manager: e.target.value })}
                          placeholder="업체 담당자"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-cable">
                          {(vendors.find(v => v.vendor_name === addingCableRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="employees-list"
                          value={addingCableRow.hansl_manager || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, hansl_manager: e.target.value })}
                          placeholder="HANSL 담당"
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
                        <input
                          type="text"
                          value={addingCableRow.spec_details || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, spec_details: e.target.value })}
                          placeholder="상세 사양"
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
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_actual_date ? formatDbDateToDisplay(addingCableRow.cable_actual_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_notes || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_notes: e.target.value })}
                          placeholder="납품/비고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
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
                      <td colSpan={20} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredCables.map((item, index) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-200' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      return (
                        <tr key={item.id} className={`group transition-colors ${rowBgClass}`}>
                          <td 
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              setActiveColorPicker(activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' ? null : { id: item.id, type: 'cable' })
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
                          <td className={`px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] transition-colors z-10 truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`} style={{ width: `${salesOrderCableWidth}px`, minWidth: `${salesOrderCableWidth}px`, maxWidth: `${salesOrderCableWidth}px` }}>{item.sales_order_number}</td>
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
                        <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
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
                  }))
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
                    onBlur={(e) => setFormFields({ ...formFields, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
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
                    onBlur={(e) => setFormFields({ ...formFields, delivery_deadline: toDateOrMemo(e.target.value, selectedMonth) || '' })}
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
                        onBlur={(e) => setFormFields({ ...formFields, delivery_schedule: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
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
                정말로 이 수주 항목을 삭제하시겠습니까?<br />
                삭제된 데이터는 완전히 유실되며 복구할 수 없습니다.
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
      {floatingMenuPos && selectedCells.length > 1 && (
        <div 
          className="fixed bg-white border border-gray-200 rounded-md shadow-2xl p-1.5 z-[999] flex items-center gap-1.5 floating-bulk-picker animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ 
            left: `${floatingMenuPos.x}px`, 
            top: `${floatingMenuPos.y - 42}px` 
          }}
        >
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
      )}
    </div>
  )
}
