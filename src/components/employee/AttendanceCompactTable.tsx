import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Check, X, ArrowUp, ArrowDown } from 'lucide-react'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'

// ─── 근태현황 컴팩트 테이블 (제작현황 표 형식) ───────────────────────────────
// 스타일은 제작현황 표준(.production-compact-table + .hansl-th) 그대로 재사용.
// 행 가상화는 VendorCompactTable과 동일한 slice + 상/하단 스페이서 패턴.

export interface AttendanceRecord {
  id: number
  employee_id: string
  employee_name: string | null
  date: string
  clock_in: string | null
  clock_out: string | null
  status: string | null
  remarks: string | null
  note: string | null
  user_email: string | null
  created_at: string | null
  updated_at: string | null
  department: string | null
  position: string | null
}

export interface AttendanceTableCtx {
  canManage: boolean
  editingId: number | null
  isSaving: boolean
  editClockIn: string
  setEditClockIn: (v: string) => void
  editClockOut: string
  setEditClockOut: (v: string) => void
  editStatus: string
  setEditStatus: (v: string) => void
  editRemarks: string
  setEditRemarks: (v: string) => void
  editStatusOptions: string[]
  startEdit: (record: AttendanceRecord) => void
  saveEdit: (record: AttendanceRecord) => void
  cancelEdit: () => void
}

interface AttendanceCompactTableProps {
  rows: AttendanceRecord[]
  showDate: boolean
  sortKey: string | null
  sortDirection: 'asc' | 'desc' | null
  onSort: (key: keyof AttendanceRecord) => void
  ctx: AttendanceTableCtx
}

// 행 가상화 파라미터
const ROW_HEIGHT = 26
const OVERSCAN = 15

// 상태별 배지 스타일 (Flutter 앱 AppColors 기준)
const BADGE_CLASS = 'badge-stats text-white w-[52px] text-center justify-center'

function getStatusBadge(status: string | null) {
  // 정규화: 다양한 상태값 변형을 통일
  const normalized = (() => {
    if (!status) return null
    const s = status.trim()
    if (s === '정상 출근' || s === '정상출근' || s === '정상' || s === '출근' || s === 'present') return '정상 출근'
    if (s === '출근 전') return '출근 전'
    return s
  })()

  switch (normalized) {
    case '정상 출근':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#34C759' }}>정상 출근</span>
    case '출근 전':
      return <span className={`${BADGE_CLASS} bg-gray-300`}>출근 전</span>
    case '지각':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF3B30' }}><span className="w-full flex justify-between"><span>지</span><span>각</span></span></span>
    case '퇴근':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#6B7280' }}><span className="w-full flex justify-between"><span>퇴</span><span>근</span></span></span>
    case '오전반차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF9500' }}>오전 반차</span>
    case '오후반차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF9500' }}>오후 반차</span>
    case '출장':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#1976D2' }}><span className="w-full flex justify-between"><span>출</span><span>장</span></span></span>
    case '연차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#34C759' }}><span className="w-full flex justify-between"><span>연</span><span>차</span></span></span>
    case '공가':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#8E8E93' }}><span className="w-full flex justify-between"><span>공</span><span>가</span></span></span>
    default:
      return <span className={`${BADGE_CLASS} bg-gray-300`}>{status || '-'}</span>
  }
}

// 출퇴근 시간 없이 배지로 표기할 상태들
const NO_CLOCK_STATUSES: Record<string, { label: string; color: string }> = {
  '출장': { label: '출장', color: '#1976D2' },
  '연차': { label: '연차', color: '#34C759' },
  '공가': { label: '공가', color: '#8E8E93' },
}

// 시간 포맷 (HH:MM:SS → HH:MM)
function formatTime(time: string | null) {
  if (!time) return '-'
  return time.slice(0, 5)
}

// 출퇴근 시간 셀 렌더링 (시간이 없고 특정 상태면 배지 표시)
function renderClockCell(time: string | null, status: string | null) {
  if (time) return formatTime(time)
  const badge = status ? NO_CLOCK_STATUSES[status] : null
  if (badge) {
    const chars = badge.label.split('')
    if (chars.length === 2) {
      return <span className={BADGE_CLASS} style={{ backgroundColor: badge.color }}><span className="w-full flex justify-between"><span>{chars[0]}</span><span>{chars[1]}</span></span></span>
    }
    return <span className={BADGE_CLASS} style={{ backgroundColor: badge.color }}>{badge.label}</span>
  }
  return '-'
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// 짧은 날짜 라벨 (09.01 (화))
function formatDateShort(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return `${dateStr.slice(5).replace(/-/g, '.')} (${DAY_LABELS[date.getDay()]})`
}

interface ColDef {
  id: string
  label: string
  width: number
  align?: 'left'
  sortable?: boolean
  fitText?: (r: AttendanceRecord) => string
  fitMax?: number
}

const COLUMNS: ColDef[] = [
  { id: 'no', label: 'NO.', width: 40 },
  { id: 'date', label: '날짜', width: 66, sortable: true },
  { id: 'employee_name', label: '직원명', width: 60, sortable: true, fitText: r => r.employee_name || '-', fitMax: 120 },
  { id: 'department', label: '부서', width: 60, sortable: true, fitText: r => r.department || '-', fitMax: 120 },
  { id: 'clock_in', label: '출근시간', width: 66, sortable: true },
  { id: 'clock_out', label: '퇴근시간', width: 66, sortable: true },
  { id: 'status', label: '상태', width: 72, sortable: true },
  { id: 'remarks', label: '비고', width: 110, align: 'left', fitText: r => r.remarks || r.note || '-', fitMax: 260 },
  { id: 'actions', label: '수정', width: 52 },
]

// 행 컴포넌트 (메모화)
const AttendanceCompactRow = memo(({ row, index, columns, widths, ctx }: {
  row: AttendanceRecord
  index: number
  columns: ColDef[]
  widths: Record<string, number>
  ctx: AttendanceTableCtx
}) => {
  const isEditing = ctx.canManage && ctx.editingId === row.id

  const renderCell = (col: ColDef) => {
    if (isEditing) {
      switch (col.id) {
        case 'clock_in':
          return (
            <input
              type="time"
              value={ctx.editClockIn}
              onChange={(e) => ctx.setEditClockIn(e.target.value)}
              className="hansl-cell-input"
              onClick={(e) => e.stopPropagation()}
            />
          )
        case 'clock_out':
          return (
            <input
              type="time"
              value={ctx.editClockOut}
              onChange={(e) => ctx.setEditClockOut(e.target.value)}
              className="hansl-cell-input"
              onClick={(e) => e.stopPropagation()}
            />
          )
        case 'status':
          return (
            <select
              value={ctx.editStatus}
              onChange={(e) => ctx.setEditStatus(e.target.value)}
              className="hansl-cell-input"
              onClick={(e) => e.stopPropagation()}
            >
              {!ctx.editStatusOptions.includes(ctx.editStatus) && <option value={ctx.editStatus}>{ctx.editStatus || '-'}</option>}
              {ctx.editStatusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )
        case 'remarks':
          return (
            <input
              value={ctx.editRemarks}
              onChange={(e) => ctx.setEditRemarks(e.target.value)}
              placeholder="비고"
              className="hansl-cell-input"
              onClick={(e) => e.stopPropagation()}
            />
          )
        case 'actions':
          return (
            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => ctx.saveEdit(row)}
                disabled={ctx.isSaving}
                title="저장"
                className="hansl-icon-btn !p-0.5 text-green-600 hover:text-green-700 hover:bg-green-50 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={ctx.cancelEdit}
                disabled={ctx.isSaving}
                title="취소"
                className="hansl-icon-btn !p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
      }
    }

    switch (col.id) {
      case 'no':
        return <span className="text-gray-400">{index + 1}</span>
      case 'date':
        return <span className="text-gray-500 whitespace-nowrap">{formatDateShort(row.date)}</span>
      case 'employee_name':
        return <span className="font-medium text-gray-900">{row.employee_name || '-'}</span>
      case 'department':
        return <span className="text-gray-500">{row.department || '-'}</span>
      case 'clock_in':
        return renderClockCell(row.clock_in, row.status)
      case 'clock_out':
        return renderClockCell(row.clock_out, row.status)
      case 'status':
        return getStatusBadge(row.status)
      case 'remarks':
        return (
          <span className="text-gray-500 truncate block" title={row.remarks || row.note || ''}>
            {row.remarks || row.note || '-'}
          </span>
        )
      case 'actions':
        return ctx.canManage ? <span className="text-gray-400">수정</span> : <span className="text-gray-300">-</span>
    }
  }

  return (
    <tr
      onClick={() => ctx.canManage && !isEditing && ctx.startEdit(row)}
      style={{ height: ROW_HEIGHT }}
      className={isEditing ? 'bg-hansl-50/30' : ctx.canManage ? 'cursor-pointer hover:bg-gray-50' : ''}
    >
      {columns.map(col => {
        const w = widths[col.id] ?? col.width
        return (
          <td
            key={col.id}
            className={`border-b border-r border-gray-100 ${col.align === 'left' ? 'align-left' : ''}`}
            style={{ width: w, minWidth: w, maxWidth: w }}
          >
            {renderCell(col)}
          </td>
        )
      })}
    </tr>
  )
})
AttendanceCompactRow.displayName = 'AttendanceCompactRow'

const AttendanceCompactTable = ({ rows, showDate, sortKey, sortDirection, onSort, ctx }: AttendanceCompactTableProps) => {
  const columns = useMemo(
    () => COLUMNS.filter(c => (c.id !== 'date' || showDate) && (c.id !== 'actions' || ctx.canManage)),
    [showDate, ctx.canManage]
  )

  // 칼럼폭 실측 핏 (제작현황 지침과 동일: Max(헤더 600, 본문 400) + 여백 11px)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    fonts?.ready?.then(() => setFontsLoaded(true))
  }, [])
  const columnWidths = useMemo(() => {
    const out: Record<string, number> = {}
    for (const col of columns) {
      if (!col.fitText) {
        out[col.id] = col.width
        continue
      }
      const headerW = measureText(col.label, 600, HEADER_LETTER_SPACING)
      let maxValW = 0
      for (const r of rows) {
        const w = measureText(col.fitText(r), 400)
        if (w > maxValW) maxValW = w
      }
      const floor = rows.length === 0 ? col.width : 0
      let width = Math.max(Math.max(headerW, maxValW) + 11, floor)
      if (col.fitMax != null) width = Math.max(headerW + 11, Math.min(width, col.fitMax))
      out[col.id] = Math.ceil(width)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, fontsLoaded])

  // 행 가상화 (스크롤 윈도잉 + 스페이서)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 필터/검색으로 목록이 줄면 스크롤 위치가 범위를 벗어나므로 맨 위로
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollTop > rows.length * ROW_HEIGHT) {
      el.scrollTop = 0
      setScrollTop(0)
    }
  }, [rows.length])

  const total = rows.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)
  const windowRows = rows.slice(start, end)
  const topSpacer = start * ROW_HEIGHT
  const bottomSpacer = (total - end) * ROW_HEIGHT

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="overflow-auto"
      style={{ maxHeight: 'calc(100vh - 280px)' }}
    >
      <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
        <thead className="whitespace-nowrap">
          <tr className="bg-gray-200 border-b border-gray-300">
            {columns.map(col => {
              const w = columnWidths[col.id] ?? col.width
              const isSorted = sortKey === col.id
              return (
                <th
                  key={col.id}
                  className={`hansl-th border-y border-r ${col.sortable ? 'cursor-pointer select-none hover:text-hansl-500' : ''}`}
                  style={{ width: w, minWidth: w, maxWidth: w, backgroundColor: '#e5e7eb' }}
                  onClick={col.sortable ? () => onSort(col.id as keyof AttendanceRecord) : undefined}
                  title={col.sortable ? '클릭하여 정렬' : undefined}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {isSorted && sortDirection === 'asc' && <ArrowUp className="w-2.5 h-2.5 text-hansl-500" />}
                    {isSorted && sortDirection === 'desc' && <ArrowDown className="w-2.5 h-2.5 text-hansl-500" />}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="text-[10px] text-gray-500 whitespace-nowrap">
          {topSpacer > 0 && (
            <tr style={{ height: topSpacer }} aria-hidden="true"><td colSpan={columns.length} /></tr>
          )}
          {windowRows.map((row, i) => (
            <AttendanceCompactRow
              key={row.id}
              row={row}
              index={start + i}
              columns={columns}
              widths={columnWidths}
              ctx={ctx}
            />
          ))}
          {bottomSpacer > 0 && (
            <tr style={{ height: bottomSpacer }} aria-hidden="true"><td colSpan={columns.length} /></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default AttendanceCompactTable
