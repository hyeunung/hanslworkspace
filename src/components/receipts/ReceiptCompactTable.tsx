import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Download, Printer, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'
import { ReceiptRow, ReceiptColumnId, formatReceiptDate, formatKrw } from '@/utils/receiptTable'
import type { ReceiptColumnVisibility } from './ReceiptColumnMenu'

// ─── 영수증 컴팩트 테이블 (제작현황 표 형식) ────────────────────────────────
// 스타일은 제작현황 표준(.production-compact-table + .hansl-th) 그대로 재사용.
// 행 가상화는 BomBoardCompactTable과 동일한 slice + 상/하단 스페이서 패턴.
// 영수증 1장 = 1행 (묶음 영수증은 전개, 인쇄/삭제/상세는 그룹 단위 동작).

export interface ReceiptTableCtx {
  onRowClick: (row: ReceiptRow) => void
  onPrint: (row: ReceiptRow) => void
  onDownload: (row: ReceiptRow) => void
  onDelete: (row: ReceiptRow) => void
  canDelete: boolean
  canViewUploaderInfo: boolean
}

interface ReceiptCompactTableProps {
  rows: ReceiptRow[]
  columnVisibility: ReceiptColumnVisibility
  ctx: ReceiptTableCtx
}

// 행 가상화 파라미터 — 배지·버튼이 있어 보드별 정리와 동일한 26px
const ROW_HEIGHT = 26
const OVERSCAN = 15

interface ColDef {
  id: ReceiptColumnId | 'no'
  label: string
  width: number
  align?: 'left' | 'right'
  fitText?: (r: ReceiptRow) => string
  fitMax?: number
}

const COLUMNS: ColDef[] = [
  { id: 'no', label: 'NO.', width: 40 },
  { id: 'printed', label: '인쇄완료', width: 62 },
  { id: 'uploaded_date', label: '업로드일', width: 64 },
  { id: 'payment_date', label: '결제일', width: 64 },
  { id: 'merchant', label: '거래처', width: 120, align: 'left', fitText: r => r.merchant || '-', fitMax: 240 },
  { id: 'item_name', label: '품명', width: 160, align: 'left', fitText: r => r.item_name || '-', fitMax: 320 },
  { id: 'quantity', label: '수량', width: 44, align: 'right', fitText: r => r.quantity != null ? r.quantity.toLocaleString('ko-KR') : '-' },
  { id: 'unit_price', label: '단가', width: 70, align: 'right', fitText: r => formatKrw(r.unit_price) },
  { id: 'total_amount', label: '합계', width: 76, align: 'right', fitText: r => formatKrw(r.total_amount) },
  { id: 'memo', label: '메모', width: 140, align: 'left', fitText: r => r.memo || '-', fitMax: 360 },
  { id: 'uploader', label: '등록인', width: 70, fitText: r => r.uploader || '-' },
  { id: 'actions', label: '액션', width: 96 },
]

// 행 컴포넌트 (메모화) — 셀 구성/배지 색은 기존 영수증 목록과 동일
const ReceiptCompactRow = memo(({ row, index, columns, widths, ctx }: {
  row: ReceiptRow
  index: number
  columns: ColDef[]
  widths: Record<string, number>
  ctx: ReceiptTableCtx
}) => {
  const renderCell = (col: ColDef) => {
    switch (col.id) {
      case 'no':
        return <span className="text-gray-400">{index + 1}</span>
      case 'printed':
        return row.printed ? (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-[9px] px-1.5 py-0">완료</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100 text-[9px] px-1.5 py-0">미완료</Badge>
        )
      case 'uploaded_date':
        return <span className="text-gray-500">{formatReceiptDate(row.uploaded_date)}</span>
      case 'payment_date':
        return <span className="text-gray-600">{formatReceiptDate(row.payment_date)}</span>
      case 'merchant':
        return <span className="font-medium text-gray-900">{row.merchant || '-'}</span>
      case 'item_name':
        return <span className="text-gray-700">{row.item_name || '-'}</span>
      case 'quantity':
        return <span className="text-gray-900">{row.quantity != null ? row.quantity.toLocaleString('ko-KR') : '-'}</span>
      case 'unit_price':
        return <span className="text-gray-900">{formatKrw(row.unit_price)}</span>
      case 'total_amount':
        return <span className="text-gray-900">{formatKrw(row.total_amount)}</span>
      case 'memo':
        return (
          <span className="inline-flex items-center gap-1 max-w-full">
            <span className="truncate text-gray-700">{row.memo || '-'}</span>
            {row.group_count > 1 && (
              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[9px] px-1.5 py-0 shrink-0">
                {row.group_count}장
              </Badge>
            )}
          </span>
        )
      case 'uploader':
        return <span className="text-gray-600">{row.uploader || '-'}</span>
      case 'actions':
        return (
          <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => ctx.onPrint(row)}
              title={row.group_count > 1 ? `${row.group_count}장 인쇄` : '인쇄'}
              className="inline-flex items-center h-[18px] px-1.5 rounded border text-[9px] text-gray-600 border-gray-200 hover:text-hansl-600 hover:bg-hansl-50 transition-colors"
            >
              <Printer className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => ctx.onDownload(row)}
              title="다운로드"
              className="inline-flex items-center h-[18px] px-1.5 rounded border text-[9px] text-gray-600 border-gray-200 hover:text-hansl-600 hover:bg-hansl-50 transition-colors"
            >
              <Download className="w-3 h-3" />
            </button>
            {ctx.canDelete && (
              <button
                type="button"
                onClick={() => ctx.onDelete(row)}
                title={row.group_count > 1 ? `${row.group_count}장 삭제` : '삭제'}
                className="inline-flex items-center h-[18px] px-1.5 rounded border text-[9px] text-red-500 border-red-200 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )
    }
  }

  return (
    <tr onClick={() => ctx.onRowClick(row)} style={{ height: ROW_HEIGHT }} className="cursor-pointer">
      {columns.map(col => {
        const w = widths[col.id] ?? col.width
        return (
          <td
            key={col.id}
            className={`border-b border-r border-gray-100 ${col.align === 'left' ? 'align-left' : col.align === 'right' ? 'align-right' : ''}`}
            style={{ width: w, minWidth: w, maxWidth: w }}
          >
            {renderCell(col)}
          </td>
        )
      })}
    </tr>
  )
})
ReceiptCompactRow.displayName = 'ReceiptCompactRow'

const ReceiptCompactTable = ({ rows, columnVisibility, ctx }: ReceiptCompactTableProps) => {
  const columns = useMemo(
    () => COLUMNS.filter(c => {
      if (c.id === 'no') return true
      if (c.id === 'uploader' && !ctx.canViewUploaderInfo) return false
      return columnVisibility[c.id as ReceiptColumnId] !== false
    }),
    [columnVisibility, ctx.canViewUploaderInfo]
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
      // 메모 칼럼은 묶음 배지(N장)가 추가되므로 여유 폭 확보
      if (col.id === 'memo' && rows.some(r => r.group_count > 1)) width += 34
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
            <ReceiptCompactRow
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

export default ReceiptCompactTable
