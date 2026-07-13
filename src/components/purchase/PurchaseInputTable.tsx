import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import MobilePurchaseCard from '@/components/purchase/MobilePurchaseCard'
import { usePurchaseTableActions } from '@/hooks/usePurchaseTableActions'
import {
  purchaseColumnsForTab, PurchaseColumnDef, PurchaseCellCtx, PurchaseItemEditField,
} from '@/components/purchase/purchaseTableColumns'
import { measureText, HEADER_LETTER_SPACING } from '@/utils/productionColumns'
import { Purchase, PurchaseRequestItem } from '@/types/purchase'
import { ColumnVisibility, DoneTabColumnId } from '@/types/columnSettings'
import { RESTRICTED_COLUMNS, AUTHORIZED_ROLES, UTK_AUTHORIZED_ROLES } from '@/constants/columnSettings'
import { logger } from '@/lib/logger'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ─── 발주/구매 인풋 모드 테이블 (품목 전개 + 인라인 편집) ────────────────
// 팝업 모드(PurchaseCompactTable)와 짝: 상세 모달 대신 품목 1개=1행으로 전부 펼친다.
// - 발주 공통 칼럼(발주번호·업체·요청자 등)은 그룹 전체를 rowspan으로 세로 병합해 중앙 표기
// - 품목 칼럼(품명·규격·수량·단가·합계·비고)은 셀 클릭 → 인라인 편집 → DB 즉시 저장
// - 발주 그룹 경계는 연한 진회색(border-gray-300) 가로선으로 구분
// 칼럼 정의/폭 실측/스타일은 팝업 모드와 동일 규칙(purchaseTableColumns 주입식)을 재사용.

interface PurchaseInputTableProps {
  purchases: Purchase[]
  activeTab: string
  currentUserRoles: string[]
  columnVisibility?: ColumnVisibility
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void
}

const ROW_HEIGHT = 24
const OVERSCAN_PX = ROW_HEIGHT * 15

const tdAlignClass = (align?: 'left' | 'right') =>
  align === 'left' ? 'align-left' : align === 'right' ? 'align-right' : ''

// lead buyer는 금액/수량 계열만 인라인 편집 가능 (상세 모달 권한 규칙과 동일)
const LIMITED_EDIT_FIELDS: PurchaseItemEditField[] = ['quantity', 'unit_price_value', 'amount_value']

// 편집 input의 초기 원본값 — 숫자 필드는 콤마 없는 원시값
const rawEditValue = (item: PurchaseRequestItem, field: PurchaseItemEditField): string => {
  switch (field) {
    case 'item_name': return item.item_name || ''
    case 'specification': return item.specification || ''
    case 'quantity': return item.quantity != null ? String(item.quantity) : ''
    case 'unit_price_value': return item.unit_price_value != null ? String(item.unit_price_value) : ''
    case 'amount_value': return item.amount_value != null ? String(item.amount_value) : ''
    case 'remark': return item.remark || ''
  }
}

// ── 인라인 편집 셀 — 클릭 → input, Enter/blur 저장, Esc 취소 ─────────────
const EditableItemCell = memo(({ display, raw, type, align, onSave }: {
  display: React.ReactNode
  raw: string
  type: 'text' | 'number'
  align?: 'left' | 'right'
  onSave: (value: string) => void
}) => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const cancelledRef = useRef(false)

  const commit = () => {
    setEditing(false)
    if (cancelledRef.current) { cancelledRef.current = false; return }
    if (value !== raw) onSave(value)
  }

  if (!editing) {
    return (
      <div
        className="w-full min-h-[18px] cursor-text"
        title="클릭하여 편집"
        onClick={() => { setValue(raw); cancelledRef.current = false; setEditing(true) }}
      >
        {display}
      </div>
    )
  }
  return (
    <input
      className="hansl-cell-input"
      style={{ textAlign: align === 'right' ? 'right' : align === 'left' ? 'left' : 'center' }}
      autoFocus
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') { cancelledRef.current = true; (e.target as HTMLInputElement).blur() }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  )
})
EditableItemCell.displayName = 'EditableItemCell'

// ── 발주 1건(그룹) 렌더 — 첫 행에 공통 칼럼 rowspan, 이후 행은 품목 칼럼만 ──
const PurchaseGroupRows = memo(({ purchase, items, columns, widths, ctx, canEditField, onSaveField }: {
  purchase: Purchase
  items: PurchaseRequestItem[]
  columns: PurchaseColumnDef[]
  widths: Record<string, number>
  ctx: PurchaseCellCtx
  canEditField: (field: PurchaseItemEditField) => boolean
  onSaveField: (purchase: Purchase, item: PurchaseRequestItem, field: PurchaseItemEditField, value: string) => void
}) => {
  const rowCount = Math.max(items.length, 1)
  const lastColIdx = columns.length - 1

  // 그룹 바깥 4면 테두리(gray-300) — 좌우는 첫/끝 칼럼, 하단은 마지막 행·병합 셀.
  // 상단은 이전 그룹의 하단선(첫 그룹은 헤더 하단선)이 겸하므로 1px 두께가 유지된다.
  // 칼럼 사이 세로선은 넣지 않고, 그룹 내부 품목 구분은 연한 가로선(gray-100)만 사용.
  const sideClasses = (colIdx: number) =>
    colIdx === 0 ? 'border-l border-l-gray-300' : colIdx === lastColIdx ? 'border-r border-r-gray-300' : ''

  const renderItemCell = (col: PurchaseColumnDef, colIdx: number, item: PurchaseRequestItem | undefined, isLastRow: boolean) => {
    const w = widths[col.id] ?? col.width
    const borderB = isLastRow ? 'border-b border-b-gray-300' : 'border-b border-b-gray-100'
    let content: React.ReactNode = <span className="text-gray-400">-</span>
    if (item && col.itemRender) {
      const display = col.itemRender(item, purchase, ctx)
      content = (col.editField && canEditField(col.editField)) ? (
        <EditableItemCell
          display={display}
          raw={rawEditValue(item, col.editField)}
          type={col.editType || 'text'}
          align={col.align}
          onSave={(v) => onSaveField(purchase, item, col.editField as PurchaseItemEditField, v)}
        />
      ) : display
    }
    return (
      <td
        key={col.id}
        className={`${sideClasses(colIdx)} ${borderB} ${tdAlignClass(col.align)}`}
        style={{ width: w, minWidth: w, maxWidth: w }}
      >
        {content}
      </td>
    )
  }

  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIdx) => (
        <tr key={items[rowIdx]?.id ?? `${purchase.id}-r${rowIdx}`} style={{ height: ROW_HEIGHT }}>
          {columns.map((col, colIdx) => {
            if (!col.itemRender) {
              // 발주 공통 칼럼 — 그룹 첫 행에서만 rowspan으로 렌더 (세로 중앙 병합)
              if (rowIdx !== 0) return null
              const w = widths[col.id] ?? col.width
              return (
                <td
                  key={col.id}
                  rowSpan={rowCount}
                  className={`${sideClasses(colIdx)} border-b border-b-gray-300 ${tdAlignClass(col.align)}`}
                  style={{ width: w, minWidth: w, maxWidth: w, verticalAlign: 'middle' }}
                >
                  {col.render(purchase, ctx)}
                </td>
              )
            }
            return renderItemCell(col, colIdx, items[rowIdx], rowIdx === rowCount - 1)
          })}
        </tr>
      ))}
    </>
  )
})
PurchaseGroupRows.displayName = 'PurchaseGroupRows'

const PurchaseInputTable = ({
  purchases, activeTab, currentUserRoles, columnVisibility, onRefresh, onOptimisticUpdate,
}: PurchaseInputTableProps) => {
  const supabase = createClient()
  const actions = usePurchaseTableActions({ currentUserRoles, onRefresh })

  const canUtkCheck = useMemo(
    () => currentUserRoles.some(role => UTK_AUTHORIZED_ROLES.includes(role)),
    [currentUserRoles]
  )

  // 편집 권한 — 상세 모달과 동일 규칙 (final_approver/superadmin/ceo 전체, lead buyer 금액·수량만)
  const canEditAll = useMemo(
    () => ['final_approver', 'superadmin', 'ceo'].some(r => currentUserRoles.includes(r)),
    [currentUserRoles]
  )
  const canEditLimited = useMemo(() => currentUserRoles.includes('lead buyer'), [currentUserRoles])
  const canEditField = useCallback((field: PurchaseItemEditField) =>
    canEditAll || (canEditLimited && LIMITED_EDIT_FIELDS.includes(field)),
  [canEditAll, canEditLimited])

  // 칼럼 표시 여부 — PurchaseCompactTable.isColumnVisible과 동일 규칙
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

  // ── 그룹(발주 1건) 목록 — 품목 line_number 오름차순, 품목 0건은 빈 1행 ──
  const groups = useMemo(() => purchases.map(p => {
    const items = [...(p.purchase_request_items || [])]
      .filter(it => !it.deleted_at)
      .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
    return { purchase: p, items, height: Math.max(items.length, 1) * ROW_HEIGHT }
  }), [purchases])

  // ── 인라인 편집 저장 — 단일 품목 필드 즉시 DB 반영 + 메모리 캐시 낙관 갱신 ──
  const handleSaveField = useCallback(async (
    purchase: Purchase, item: PurchaseRequestItem, field: PurchaseItemEditField, value: string,
  ) => {
    const updates: Record<string, string | number | null> = {}
    if (field === 'item_name') {
      const name = value.trim()
      if (!name) { toast.error('품목명은 필수입니다.'); return }
      updates.item_name = name
    } else if (field === 'specification' || field === 'remark') {
      updates[field] = value.trim() || null
    } else {
      // 숫자 필드 — 콤마 허용, 음수/비정상 값 방어 (상세 모달 handleSave 규칙과 동일)
      const num = Number(String(value).replace(/,/g, '').trim())
      if (Number.isNaN(num)) { toast.error('숫자만 입력할 수 있습니다.'); return }
      if (num < 0) { toast.error('0 이상만 입력할 수 있습니다.'); return }
      if (field === 'quantity') {
        const quantity = num > 0 ? num : 1 // 0 이하는 1로 보정 (모달 저장 규칙)
        updates.quantity = quantity
        // 단가가 유효하면 합계·세액 자동 계산 (발주 카테고리는 세액 10%)
        const unitPrice = item.unit_price_value || 0
        if (unitPrice > 0) {
          const amount = quantity * unitPrice
          updates.amount_value = amount
          updates.tax_amount_value = purchase.payment_category === '발주' ? Math.round(amount * 0.1) : 0
        }
      } else if (field === 'unit_price_value') {
        updates.unit_price_value = num
        const quantity = item.quantity || 0
        if (num > 0 && quantity > 0) {
          const amount = quantity * num
          updates.amount_value = amount
          updates.tax_amount_value = purchase.payment_category === '발주' ? Math.round(amount * 0.1) : 0
        }
      } else {
        updates.amount_value = num
        updates.tax_amount_value = purchase.payment_category === '발주' ? Math.round(num * 0.1) : 0
      }
    }

    // 낙관 갱신 먼저 (셀 즉시 반영) → 실패 시 서버 값으로 되돌림
    const patchItems = (list?: PurchaseRequestItem[]) =>
      list?.map(it => (it.id === item.id ? { ...it, ...updates } as PurchaseRequestItem : it))
    onOptimisticUpdate?.(purchase.id, prev => ({
      ...prev,
      purchase_request_items: patchItems(prev.purchase_request_items),
      items: patchItems(prev.items),
    }))

    const { error } = await supabase
      .from('purchase_request_items')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', Number(item.id))
    if (error) {
      logger.error('[PurchaseInputTable] 품목 인라인 저장 실패', { error, itemId: item.id, field })
      toast.error('저장에 실패했습니다. 잠시 후 다시 시도해주세요.')
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) await refreshResult
    }
  }, [supabase, onOptimisticUpdate, onRefresh])

  // ── 칼럼폭 실측 핏 — 팝업 모드와 동일 규칙, 품목 칼럼은 전체 품목 대상 실측 ──
  const [fontsLoaded, setFontsLoaded] = useState(false)
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    fonts?.ready?.then(() => setFontsLoaded(true))
  }, [])
  const columnWidths = useMemo(() => {
    const out: Record<string, number> = {}
    for (const col of columns) {
      if (!col.fitText && !col.itemFitText) {
        out[col.id] = col.width
        continue
      }
      const headerW = measureText(col.label, 600, HEADER_LETTER_SPACING)
      let maxValW = 0
      for (const g of groups) {
        if (col.itemFitText) {
          for (const item of g.items) {
            const w = measureText(col.itemFitText(item, g.purchase), 400)
            if (w > maxValW) maxValW = w
          }
        } else if (col.fitText) {
          const w = measureText(col.fitText(g.purchase), 400) + (col.fitExtra ? col.fitExtra(g.purchase) : 0)
          if (w > maxValW) maxValW = w
        }
      }
      const floor = groups.length === 0 ? col.width : 0
      let width = Math.max(Math.max(headerW, maxValW) + 11, floor)
      if (col.fitMax != null) width = Math.max(headerW + 11, Math.min(width, col.fitMax))
      out[col.id] = Math.ceil(width)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, groups, fontsLoaded])

  // ── 그룹 단위 가상화 — rowspan 병합이 깨지지 않도록 발주 1건을 통째로 렌더 ──
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [activeTab])

  // 그룹별 시작 오프셋 prefix-sum → 화면 창과 겹치는 그룹 범위만 렌더
  const layout = useMemo(() => {
    const offsets: number[] = new Array(groups.length)
    let acc = 0
    for (let i = 0; i < groups.length; i++) { offsets[i] = acc; acc += groups[i].height }
    return { offsets, totalH: acc }
  }, [groups])

  const { start, end, topSpacer, bottomSpacer } = useMemo(() => {
    const windowTop = Math.max(0, scrollTop - OVERSCAN_PX)
    const windowBottom = scrollTop + viewportH + OVERSCAN_PX
    let s = groups.findIndex((g, i) => layout.offsets[i] + g.height > windowTop)
    if (s === -1) s = groups.length
    let e = s
    while (e < groups.length && layout.offsets[e] < windowBottom) e++
    const top = s < groups.length ? layout.offsets[s] : layout.totalH
    const renderedH = e > s ? layout.offsets[e - 1] + groups[e - 1].height - top : 0
    return { start: s, end: e, topSpacer: top, bottomSpacer: Math.max(0, layout.totalH - top - renderedH) }
  }, [groups, layout, scrollTop, viewportH])

  const windowGroups = groups.slice(start, end)

  return (
    <>
      {/* 데스크톱/태블릿 인풋 모드 테이블 */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="hidden sm:block overflow-auto"
        style={{ maxHeight: 'calc(100vh - 260px)' }}
      >
        {/* td 좌측 보더는 그룹 바깥 테두리(첫 칼럼 border-l)로 직접 제어하므로 [&_td]:border-l-0 제외 */}
        <table className="text-left border-separate border-spacing-0 w-max [&_th]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-auto">
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
            {windowGroups.map(g => (
              <PurchaseGroupRows
                key={g.purchase.id}
                purchase={g.purchase}
                items={g.items}
                columns={columns}
                widths={columnWidths}
                ctx={ctx}
                canEditField={canEditField}
                onSaveField={handleSaveField}
              />
            ))}
            {bottomSpacer > 0 && (
              <tr style={{ height: bottomSpacer }} aria-hidden="true"><td colSpan={columns.length} /></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일 카드 뷰 — 인풋 모드 표는 모바일 폭에 맞지 않아 기존 카드+모달 흐름 유지 */}
      <div className="sm:hidden space-y-3 p-3">
        {purchases.map(purchase => (
          <MobilePurchaseCard
            key={purchase.id}
            purchase={purchase}
            onClick={() => actions.handleRowClick(purchase)}
          />
        ))}
      </div>

      {/* 상세 모달 — 모바일 카드 클릭 전용 (데스크톱 인풋 모드는 행 클릭 없음) */}
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

export default PurchaseInputTable
