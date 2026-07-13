import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Edit, Trash2 } from 'lucide-react'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'
import { VendorRow, VendorColumnId } from '@/utils/vendorTable'
import { formatDate } from '@/utils/helpers'
import type { VendorColumnVisibility } from './VendorColumnMenu'

// ─── 업체관리 컴팩트 테이블 (제작현황 표 형식) ───────────────────────────────
// 스타일은 제작현황 표준(.production-compact-table + .hansl-th) 그대로 재사용.
// 행 가상화는 BomBoardCompactTable과 동일한 slice + 상/하단 스페이서 패턴.

export interface VendorTableCtx {
  canEdit: boolean
  onRowClick: (row: VendorRow) => void
  onEdit: (row: VendorRow) => void
  onDelete: (row: VendorRow) => void
  onEditContacts: (row: VendorRow) => void
  deletingId: number | null
}

interface VendorCompactTableProps {
  rows: VendorRow[]
  columnVisibility: VendorColumnVisibility
  ctx: VendorTableCtx
}

// 행 가상화 파라미터 — 담당자 정보 2줄 표시 때문에 보드별 정리(26px)보다 높게
const ROW_HEIGHT = 38
const OVERSCAN = 15

interface ColDef {
  id: VendorColumnId | 'no'
  label: string
  width: number
  align?: 'left'
  fitText?: (r: VendorRow) => string
  fitMax?: number
}

const COLUMNS: ColDef[] = [
  { id: 'no', label: 'NO.', width: 40 },
  { id: 'vendor_name', label: '업체명', width: 110, align: 'left', fitText: r => r.vendor_name, fitMax: 260 },
  { id: 'contact_count', label: '담당자', width: 52 },
  { id: 'contacts', label: '담당자 정보', width: 420, align: 'left' },
  { id: 'vendor_phone', label: '전화번호', width: 96, fitText: r => r.vendor_phone || '-' },
  { id: 'vendor_fax', label: '팩스번호', width: 96, fitText: r => r.vendor_fax || '-' },
  { id: 'vendor_payment_schedule', label: '지출예정일', width: 76, fitText: r => r.vendor_payment_schedule || '-' },
  { id: 'note', label: '비고', width: 110, align: 'left', fitText: r => r.note || '-', fitMax: 240 },
  { id: 'created_at', label: '등록일', width: 78 },
  { id: 'actions', label: '작업', width: 90 },
]

// 행 컴포넌트 (메모화) — 셀 구성은 기존 업체 목록과 동일 (담당자 최대 2명 + 외 N명)
const VendorCompactRow = memo(({ row, index, columns, widths, ctx }: {
  row: VendorRow
  index: number
  columns: ColDef[]
  widths: Record<string, number>
  ctx: VendorTableCtx
}) => {
  const renderCell = (col: ColDef) => {
    switch (col.id) {
      case 'no':
        return <span className="text-gray-400">{index + 1}</span>
      case 'vendor_name':
        return <span className="font-medium text-gray-900">{row.vendor_name}</span>
      case 'contact_count':
        return (
          <span className="badge-stats text-[9px] px-1.5 py-0.5 border border-gray-300 bg-white text-gray-600">
            {row.contacts.length}명
          </span>
        )
      case 'contacts':
        return row.contacts.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {row.contacts.slice(0, 2).map((contact, idx) => (
              <div key={idx} className="grid grid-cols-[76px_10px_64px_10px_100px_10px_1fr] items-center leading-tight">
                <span className="font-semibold text-gray-900 truncate" title={contact.contact_name}>
                  {contact.contact_name}
                </span>
                <span className="text-gray-300 text-center">|</span>
                <span className="text-gray-500 truncate" title={contact.position || ''}>
                  {contact.position || '-'}
                </span>
                <span className="text-gray-300 text-center">|</span>
                <span className="text-gray-600 truncate" title={contact.contact_phone || ''}>
                  {contact.contact_phone || '-'}
                </span>
                <span className="text-gray-300 text-center">|</span>
                <span className="text-gray-400 truncate" title={contact.contact_email || ''}>
                  {contact.contact_email || '-'}
                  {idx === 1 && row.contacts.length > 2 && (
                    <span className="text-gray-400"> 외 {row.contacts.length - 2}명</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        )
      case 'vendor_phone':
        return <span className="text-gray-600">{row.vendor_phone || '-'}</span>
      case 'vendor_fax':
        return <span className="text-gray-600">{row.vendor_fax || '-'}</span>
      case 'vendor_payment_schedule':
        return <span className="text-gray-600">{row.vendor_payment_schedule || '-'}</span>
      case 'note':
        return (
          <span className="text-gray-600 truncate block" title={row.note || ''}>
            {row.note || '-'}
          </span>
        )
      case 'created_at':
        return <span className="text-gray-500">{formatDate(row.created_at)}</span>
      case 'actions':
        return ctx.canEdit ? (
          <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => ctx.onEdit(row)}
              disabled={ctx.deletingId === row.id}
              title="업체 정보 수정"
              className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded border text-[9px] text-hansl-500 border-hansl-500/30 hover:bg-hansl-500/5 transition-colors disabled:opacity-40"
            >
              <Edit className="w-3 h-3" />
              수정
            </button>
            <button
              type="button"
              onClick={() => ctx.onDelete(row)}
              disabled={ctx.deletingId === row.id}
              title="업체 삭제"
              className="inline-flex items-center h-[18px] px-1.5 rounded border text-[9px] text-red-500 border-red-200 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <span className="text-gray-300">-</span>
        )
    }
  }

  // 담당자 관련 셀은 클릭 시 담당자 수정 모달 (기존 동작 유지, 편집 권한 필요)
  const isContactCell = (id: ColDef['id']) => id === 'contact_count' || id === 'contacts'

  return (
    <tr onClick={() => ctx.onRowClick(row)} style={{ height: ROW_HEIGHT }} className="cursor-pointer">
      {columns.map(col => {
        const w = widths[col.id] ?? col.width
        const contactEditable = ctx.canEdit && isContactCell(col.id)
        return (
          <td
            key={col.id}
            className={`border-b border-r border-gray-100 ${col.align === 'left' ? 'align-left' : ''} ${contactEditable ? 'hover:bg-slate-50 transition-colors' : ''}`}
            style={{ width: w, minWidth: w, maxWidth: w }}
            onClick={contactEditable ? (e) => { e.stopPropagation(); ctx.onEditContacts(row) } : undefined}
            title={contactEditable ? '클릭하여 담당자 정보를 수정합니다.' : undefined}
          >
            {renderCell(col)}
          </td>
        )
      })}
    </tr>
  )
})
VendorCompactRow.displayName = 'VendorCompactRow'

const VendorCompactTable = ({ rows, columnVisibility, ctx }: VendorCompactTableProps) => {
  const columns = useMemo(
    () => COLUMNS.filter(c => c.id === 'no' || columnVisibility[c.id as VendorColumnId] !== false),
    [columnVisibility]
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
      style={{ maxHeight: 'calc(100vh - 300px)' }}
    >
      <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
        <thead className="whitespace-nowrap">
          <tr className="bg-gray-200 border-b border-gray-300">
            {columns.map(col => {
              const w = columnWidths[col.id] ?? col.width
              return (
                <th
                  key={col.id}
                  className="hansl-th border-y border-r"
                  style={{ width: w, minWidth: w, maxWidth: w, backgroundColor: '#e5e7eb' }}
                >
                  {col.label}
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
            <VendorCompactRow
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

export default VendorCompactTable
