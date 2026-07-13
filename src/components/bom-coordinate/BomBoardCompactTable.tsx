import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'
import { BomBoardRow, BomBoardColumnId } from '@/utils/bomBoardTable'
import type { BomBoardColumnVisibility } from './BomBoardColumnMenu'

// ─── 보드별 정리 컴팩트 테이블 (제작현황 표 형식) ────────────────────────────
// 스타일은 제작현황 표준(.production-compact-table + .hansl-th) 그대로 재사용.
// 행 가상화는 PurchaseCompactTable과 동일한 slice + 상/하단 스페이서 패턴.

export interface BomBoardTableCtx {
  onRowClick: (row: BomBoardRow) => void
  canDelete: (row: BomBoardRow) => boolean
  onDelete: (row: BomBoardRow) => void
  onDownload: (row: BomBoardRow) => void
}

interface BomBoardCompactTableProps {
  rows: BomBoardRow[]
  columnVisibility: BomBoardColumnVisibility
  ctx: BomBoardTableCtx
}

// 행 가상화 파라미터 — 배지가 있어 발주(24px)보다 한 단계 여유
const ROW_HEIGHT = 26
const OVERSCAN = 15

interface ColDef {
  id: BomBoardColumnId | 'no'
  label: string
  width: number
  align?: 'left'
  fitText?: (r: BomBoardRow) => string
  fitMax?: number
}

const COLUMNS: ColDef[] = [
  { id: 'no', label: 'NO.', width: 40 },
  { id: 'code_number', label: '코드번호', width: 80, fitText: r => r.code_number || '-' },
  { id: 'sales_order_number', label: '제작번호', width: 80, fitText: r => r.sales_order_number || '-' },
  { id: 'board_name', label: '보드명', width: 200, align: 'left', fitText: r => r.board_name, fitMax: 560 },
  { id: 'mismatch', label: '불일치', width: 72 },
  { id: 'artwork_manager', label: '아트웍 담당', width: 76, fitText: r => r.artwork_manager || '-' },
  { id: 'production_manager', label: '생산 담당', width: 76, fitText: r => r.production_manager || '-' },
  { id: 'status', label: '상태', width: 74 },
  { id: 'created_at', label: '생성일', width: 78 },
  { id: 'actions', label: '액션', width: 110 },
]

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })

// 행 컴포넌트 (메모화) — 셀 구성/배지 색은 기존 보드별 정리 목록과 동일
const BomBoardCompactRow = memo(({ row, index, columns, widths, ctx }: {
  row: BomBoardRow
  index: number
  columns: ColDef[]
  widths: Record<string, number>
  ctx: BomBoardTableCtx
}) => {
  const renderCell = (col: ColDef) => {
    switch (col.id) {
      case 'no':
        return <span className="text-gray-400">{index + 1}</span>
      case 'code_number':
        return <span className="font-medium text-gray-500">{row.code_number || '-'}</span>
      case 'sales_order_number':
        return <span className="font-medium text-gray-500">{row.sales_order_number || '-'}</span>
      case 'board_name':
        return <span className="font-medium text-gray-900">{row.board_name}</span>
      case 'mismatch':
        return (
          <div className="flex flex-col items-center gap-0.5">
            {row.mismatch_count > 0 && (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[9px] px-1.5 py-0">
                REF {row.mismatch_count}
              </Badge>
            )}
            {row.manual_count > 0 && (
              <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 text-[9px] px-1.5 py-0">
                수동 {row.manual_count}
              </Badge>
            )}
            {row.mismatch_count === 0 && row.manual_count === 0 && (
              <span className="text-green-600">-</span>
            )}
          </div>
        )
      case 'artwork_manager':
        return <span className="text-gray-600">{row.artwork_manager || '-'}</span>
      case 'production_manager':
        return <span className="text-gray-600">{row.production_manager || '-'}</span>
      case 'status':
        return row.status_label === '검토대기' ? (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-[9px] px-1.5 py-0.5">검토대기</Badge>
        ) : row.status_label === '이관확인전' ? (
          <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100 text-[9px] px-1.5 py-0.5">이관확인전</Badge>
        ) : (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[9px] px-1.5 py-0.5">완료</Badge>
        )
      case 'created_at':
        return <span className="text-gray-500">{formatDate(row.created_at)}</span>
      case 'actions':
        return (
          <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => ctx.onDownload(row)}
              title={row.status !== 'completed' ? '최종검토가 완료되지 않았습니다.' : 'Excel 다운로드'}
              className={`inline-flex items-center gap-1 h-[18px] px-1.5 rounded border text-[9px] transition-colors ${
                row.status !== 'completed'
                  ? 'text-green-600 border-green-200 opacity-40 cursor-not-allowed'
                  : 'text-green-600 border-green-200 hover:text-green-700 hover:bg-green-50'
              }`}
            >
              <Download className="w-3 h-3" />
              Excel
            </button>
            {ctx.canDelete(row) && (
              <button
                type="button"
                onClick={() => ctx.onDelete(row)}
                title="보드 삭제"
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
BomBoardCompactRow.displayName = 'BomBoardCompactRow'

const BomBoardCompactTable = ({ rows, columnVisibility, ctx }: BomBoardCompactTableProps) => {
  const columns = useMemo(
    () => COLUMNS.filter(c => c.id === 'no' || columnVisibility[c.id as BomBoardColumnId] !== false),
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
            <BomBoardCompactRow
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

export default BomBoardCompactTable
