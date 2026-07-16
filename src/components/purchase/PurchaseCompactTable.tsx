import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import MobilePurchaseCard from '@/components/purchase/MobilePurchaseCard'
import { usePurchaseTableActions } from '@/hooks/usePurchaseTableActions'
import { purchaseColumnsForTab, PurchaseColumnDef, PurchaseCellCtx } from '@/components/purchase/purchaseTableColumns'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'
import { Purchase } from '@/types/purchase'
import { ColumnVisibility, DoneTabColumnId } from '@/types/columnSettings'
import { RESTRICTED_COLUMNS, AUTHORIZED_ROLES, UTK_AUTHORIZED_ROLES } from '@/constants/columnSettings'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ─── 발주/구매 컴팩트 테이블 (칼럼 정의 주입식, 제작현황 표 형식) ───────────
// 단일 제네릭 테이블 — 탭별 칼럼 구성은 purchaseTableColumns에서 주입받는다.
// 스타일은 제작현황 표준(.production-compact-table + .hansl-th) 그대로 재사용.
// 행 클릭 → PurchaseDetailModal(승인/편집/삭제) 흐름은 기존 FastPurchaseTable과 동일.

interface PurchaseCompactTableProps {
  purchases: Purchase[]
  activeTab: string
  currentUserRoles: string[]
  columnVisibility?: ColumnVisibility
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void
}

// 행 가상화 파라미터 — 컴팩트 행 높이 고정(스페이서 계산 기준)
const ROW_HEIGHT = 24
const OVERSCAN = 15

const tdAlignClass = (align?: 'left' | 'right') =>
  align === 'left' ? 'align-left' : align === 'right' ? 'align-right' : ''

// 행 컴포넌트 — 주입된 칼럼 정의로 셀을 렌더 (메모화)
const PurchaseCompactRow = memo(({ purchase, columns, widths, ctx, onClick }: {
  purchase: Purchase
  columns: PurchaseColumnDef[]
  widths: Record<string, number>
  ctx: PurchaseCellCtx
  onClick: (p: Purchase) => void
}) => {
  return (
    <tr
      onClick={() => onClick(purchase)}
      style={{ height: ROW_HEIGHT }}
      className="cursor-pointer"
    >
      {columns.map(col => {
        const w = widths[col.id] ?? col.width
        return (
          <td
            key={col.id}
            className={`border-b border-r border-gray-100 ${tdAlignClass(col.align)}`}
            style={{ width: w, minWidth: w, maxWidth: w }}
          >
            {col.render(purchase, ctx)}
          </td>
        )
      })}
    </tr>
  )
})
PurchaseCompactRow.displayName = 'PurchaseCompactRow'

const PurchaseCompactTable = ({
  purchases, activeTab, currentUserRoles, columnVisibility, onRefresh, onOptimisticUpdate,
}: PurchaseCompactTableProps) => {
  const actions = usePurchaseTableActions({ currentUserRoles, onRefresh })

  const canUtkCheck = useMemo(
    () => currentUserRoles.some(role => UTK_AUTHORIZED_ROLES.includes(role)),
    [currentUserRoles]
  )

  // 칼럼 표시 여부 — 기존 FastPurchaseTable.isColumnVisible과 동일 규칙
  // (권한 제한 칼럼은 전체항목 탭에서만 권한 검사, 그 외 탭은 가시성 맵만 적용)
  const isColumnVisible = useCallback((columnId?: DoneTabColumnId) => {
    if (!columnId) return true
    if (!columnVisibility) return true
    if (activeTab === 'done' && RESTRICTED_COLUMNS.includes(columnId)) {
      const hasPermission = columnId === 'utk_status'
        ? currentUserRoles.some(role => UTK_AUTHORIZED_ROLES.includes(role))
        : currentUserRoles.some(role => AUTHORIZED_ROLES.includes(role))
      if (!hasPermission) return false
    }
    return columnVisibility[columnId] !== false
  }, [columnVisibility, activeTab, currentUserRoles])

  const columns = useMemo(
    () => purchaseColumnsForTab(activeTab).filter(col => isColumnVisible(col.visibilityKey)),
    [activeTab, isColumnVisible]
  )

  const ctx: PurchaseCellCtx = useMemo(() => ({
    activeTab,
    canUtkCheck,
    onExcelDownload: actions.handleExcelDownload,
    onToggleUtkCheck: actions.handleToggleUtkCheck,
  }), [activeTab, canUtkCheck, actions.handleExcelDownload, actions.handleToggleUtkCheck])

  // ── 칼럼폭 실측 핏 (제작현황 지침과 동일) ────────────────────────────────
  // 폭 = Max(헤더 실측 600, 가장 긴 본문 실측 400) + 좌우 여백 5px씩 + 보더 1px.
  // 텍스트가 아닌 칼럼(배지/진행바)은 고정 폭, 빈 표일 때는 기본 폭을 바닥값으로 사용.
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
      for (const p of purchases) {
        const w = measureText(col.fitText(p), 400) + (col.fitExtra ? col.fitExtra(p) : 0)
        if (w > maxValW) maxValW = w
      }
      const floor = purchases.length === 0 ? col.width : 0
      let width = Math.max(Math.max(headerW, maxValW) + 11, floor)
      // 상한 초과분은 말줄임 처리 (헤더는 항상 온전히 보이게 하한 보장)
      if (col.fitMax != null) width = Math.max(headerW + 11, Math.min(width, col.fitMax))
      out[col.id] = Math.ceil(width)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, purchases, fontsLoaded])

  // ── 행 가상화 (스크롤 윈도잉 + 스페이서) — 제작현황 패턴 ────────────────
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

  // 탭 전환 시 스크롤을 맨 위로 (데이터 갱신만으로는 리셋하지 않음 — realtime 반영 중 스크롤 유지)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [activeTab])

  const total = purchases.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)
  const windowRows = purchases.slice(start, end)
  const topSpacer = start * ROW_HEIGHT
  const bottomSpacer = (total - end) * ROW_HEIGHT

  return (
    <>
      {/* 데스크톱/태블릿 컴팩트 테이블 */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="hidden sm:block overflow-auto"
        style={{ maxHeight: 'calc(100vh - 260px)' }}
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
            {windowRows.map(purchase => (
              <PurchaseCompactRow
                key={`${purchase.id}-${purchase.purchase_request_items?.[0]?.id ?? 'all'}`}
                purchase={purchase}
                columns={columns}
                widths={columnWidths}
                ctx={ctx}
                onClick={actions.handleRowClick}
              />
            ))}
            {bottomSpacer > 0 && (
              <tr style={{ height: bottomSpacer }} aria-hidden="true"><td colSpan={columns.length} /></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일 카드 뷰 */}
      <div className="sm:hidden space-y-3 p-3">
        {purchases.map(purchase => (
          <MobilePurchaseCard
            key={`${purchase.id}-${purchase.purchase_request_items?.[0]?.id ?? 'all'}`}
            purchase={purchase}
            onClick={() => actions.handleRowClick(purchase)}
          />
        ))}
      </div>

      {/* 통합 상세/편집 모달 (승인·반려·편집·삭제 진입점) */}
      <PurchaseDetailModal
        purchaseId={actions.selectedPurchaseId}
        isOpen={actions.isModalOpen}
        onClose={actions.handleCloseModal}
        currentUserRoles={currentUserRoles}
        activeTab={activeTab}
        onRefresh={onRefresh}
        onOptimisticUpdate={onOptimisticUpdate}
        onDelete={(purchase) => actions.requestDelete(purchase as unknown as Purchase)}
      />

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={actions.deleteConfirmOpen} onOpenChange={(open) => {
        actions.setDeleteConfirmOpen(open)
        if (!open) actions.setPurchaseToDelete(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>발주요청 내역 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              발주요청번호 <strong>{actions.purchaseToDelete?.purchase_order_number || '알 수 없음'}</strong>를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => actions.handleConfirmDelete()}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default PurchaseCompactTable
