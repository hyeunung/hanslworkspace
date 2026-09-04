import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { FormItem } from '@/types/purchase'
import { usePurchaseItemsGrid } from './usePurchaseItemsGrid'

// ─── 새발주 품목 목록 엑셀식 그리드 ────────────────────────────────────
// 제작현황 테이블과 동일한 형식: 컴팩트 셀 테두리 표(production-compact-table),
// 평소엔 텍스트 셀 → 선택된 셀 재클릭/Enter/F2 시 그 셀에만 인라인 편집기.
// 셀 선택·범위 복사/붙여넣기·Delete·일괄 입력·Ctrl+Z 로직은 usePurchaseItemsGrid 훅에 있다.

interface PurchaseItemsGridProps {
  fields: FormItem[]
  getItems: () => FormItem[]
  update: (index: number, value: FormItem) => void
  replace: (items: FormItem[]) => void
  currency: string
  paymentCategory: string
}

const FIELD_LABELS: Record<string, string> = {
  item_name: '품목',
  specification: '규격',
  quantity: '수량',
  unit_price_value: '단가',
  link: '링크',
  remark: '비고',
}

// 선택 셀 표시: 제작현황과 동일 (파란 테두리 + 반투명 파란 배경)
const SELECTED_TD_STYLE: React.CSSProperties = {
  outline: '1.5px solid #3b82f6',
  outlineOffset: '-1.5px',
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
}

// 칼럼별 정렬/최소폭 (제작현황처럼 헤더에 폭을 지정)
const COL_META: Record<string, { align: string; minWidth: number }> = {
  item_name: { align: 'text-left', minWidth: 130 },
  specification: { align: 'text-left', minWidth: 300 },
  quantity: { align: 'text-center', minWidth: 56 },
  unit_price_value: { align: 'text-right', minWidth: 100 },
  amount_value: { align: 'text-right', minWidth: 90 },
  link: { align: 'text-left', minWidth: 150 },
  remark: { align: 'text-left', minWidth: 150 },
}

export default function PurchaseItemsGrid({
  fields,
  getItems,
  update,
  replace,
  currency,
  paymentCategory,
}: PurchaseItemsGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 단가 입력 중 소수점/콤마 표시 유지용 임시 값
  const [priceDraft, setPriceDraft] = useState<string | null>(null)

  const showLink = paymentCategory === '구매 요청'
  const cols = useMemo(
    () => ['item_name', 'specification', 'quantity', 'unit_price_value', 'amount_value', ...(showLink ? ['link'] : []), 'remark'],
    [showLink]
  )

  const grid = usePurchaseItemsGrid({ getItems, replace, currency, cols, containerRef })

  const bulkField = useMemo(() => {
    if (!grid.bulkMenuPos || grid.selectedCells.length === 0) return null
    return grid.selectedCells[0].split('::')[1]
  }, [grid.bulkMenuPos, grid.selectedCells])

  const currencySymbol = currency === 'KRW' ? '₩' : '$'

  const displayValue = (item: FormItem, field: string): string => {
    if (field === 'quantity') return item.quantity ? String(item.quantity) : ''
    if (field === 'unit_price_value')
      return item.unit_price_value ? `${item.unit_price_value.toLocaleString('ko-KR')} ${currencySymbol}` : ''
    if (field === 'amount_value')
      return `${(item.amount_value || 0).toLocaleString('ko-KR')} ${currencySymbol}`
    return (item as unknown as Record<string, string>)[field] || ''
  }

  // 편집 input: 필드별 value/onChange (값은 onChange 즉시 폼에 반영되므로 커밋 단계가 따로 없다)
  const renderEditInput = (item: FormItem, idx: number, field: string) => {
    const c = cols.indexOf(field)
    const common = {
      'data-row-index': idx,
      'data-field-name': field,
      autoFocus: true,
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
      onBlur: () => { setPriceDraft(null); grid.stopEdit() },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => grid.onCellInputKeyDown(e, idx, c),
      className: `hansl-cell-input ${COL_META[field]?.align ?? ''}`,
    }
    if (field === 'quantity') {
      return (
        <input
          {...common}
          type="number"
          min={1}
          value={item.quantity || ''}
          onChange={(e) => update(idx, { ...item, quantity: parseInt(e.target.value) || 0, amount_value: (parseInt(e.target.value) || 0) * (item.unit_price_value || 0) })}
          className={`${common.className} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        />
      )
    }
    if (field === 'unit_price_value') {
      return (
        <input
          {...common}
          type="text"
          inputMode="decimal"
          value={priceDraft ?? (item.unit_price_value === 0 ? '' : item.unit_price_value?.toLocaleString('ko-KR') || '')}
          onChange={(e) => {
            // 숫자와 소수점만 허용, 소수점 중복 방지 (입력 중 표시는 draft로 유지)
            const raw = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '')
            const parts = raw.split('.')
            const finalValue = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : raw
            setPriceDraft(finalValue)
            const numVal = finalValue === '' ? 0 : parseFloat(finalValue) || 0
            update(idx, { ...item, unit_price_value: numVal, amount_value: (item.quantity || 0) * numVal })
          }}
        />
      )
    }
    const key = field as 'item_name' | 'specification' | 'link' | 'remark'
    return (
      <input
        {...common}
        type="text"
        value={(item[key] as string) || ''}
        onChange={(e) => update(idx, { ...item, [key]: e.target.value })}
      />
    )
  }

  const renderCell = (item: FormItem, idx: number, field: string) => {
    const c = cols.indexOf(field)
    const isEditing = grid.editingCell?.r === idx && grid.editingCell?.field === field
    const isSelected = grid.selectedSet.has(`${idx}::${field}`)
    const meta = COL_META[field]

    if (isEditing) {
      return (
        <td
          key={field}
          data-grid-cell={`${idx}::${field}`}
          className="border border-gray-200 p-0.5"
          onMouseDown={(e) => grid.onCellMouseDown(e, idx, c)}
        >
          {renderEditInput(item, idx, field)}
        </td>
      )
    }
    return (
      <td
        key={field}
        data-grid-cell={`${idx}::${field}`}
        className={`border border-gray-200 cursor-pointer select-none whitespace-nowrap ${meta?.align ?? ''} ${isSelected ? '' : 'hover:bg-gray-100/50'}`}
        style={isSelected ? SELECTED_TD_STYLE : undefined}
        onMouseDown={(e) => grid.onCellMouseDown(e, idx, c)}
        onMouseEnter={(e) => grid.onCellMouseEnter(e, idx, c)}
      >
        {displayValue(item, field) || ' '}
      </td>
    )
  }

  return (
    <div ref={containerRef} className="overflow-x-auto" tabIndex={0} style={{ outline: 'none' }}>
      <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
        {/* [&_td]:h-[21px]: 제작현황 실측 행 높이(21px)와 동일하게 맞춤 */}
        <table className="text-left border-separate border-spacing-0 w-full [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 [&_td]:h-[21px] production-compact-table table-auto">
          <thead className="whitespace-nowrap">
            <tr>
              <th className="hansl-th text-center" style={{ width: 34, minWidth: 34 }}>NO.</th>
              <th className="hansl-th" style={{ minWidth: COL_META.item_name.minWidth }}>
                품목<span className="text-red-500">*</span>
              </th>
              <th className="hansl-th" style={{ minWidth: COL_META.specification.minWidth }}>규격</th>
              <th className="hansl-th text-center" style={{ minWidth: COL_META.quantity.minWidth }}>
                수량<span className="text-red-500">*</span>
              </th>
              <th className="hansl-th text-right" style={{ minWidth: COL_META.unit_price_value.minWidth }}>
                단가 ({currency})
              </th>
              <th className="hansl-th text-right" style={{ minWidth: COL_META.amount_value.minWidth }}>
                합계 ({currency})
              </th>
              {showLink && <th className="hansl-th" style={{ minWidth: COL_META.link.minWidth }}>링크</th>}
              <th className="hansl-th" style={{ minWidth: COL_META.remark.minWidth }}>비고</th>
              <th className="hansl-th text-center" style={{ width: 26, minWidth: 26 }}>삭제</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {fields.map((item, idx) => (
              <tr key={idx} className="group">
                {/* NO. 셀: 클릭/드래그로 행 전체 선택 (제작현황과 동일) */}
                <td
                  className="border border-gray-200 text-center text-gray-500 select-none cursor-pointer hover:bg-gray-100"
                  style={grid.selectedFullRows.has(idx) ? SELECTED_TD_STYLE : undefined}
                  onMouseDown={(e) => grid.onRowNoMouseDown(e, idx)}
                  onMouseEnter={(e) => grid.onRowNoMouseEnter(e, idx)}
                >
                  {idx + 1}
                </td>
                {cols.map(field => renderCell(item, idx, field))}
                {/* 삭제 버튼: 선택된 행 무리에 포함돼 있으면 일괄 삭제 */}
                <td className="border border-gray-200 text-center">
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      onClick={() => {
                        const rows = grid.selectedFullRows.has(idx) && grid.selectedFullRows.size > 1
                          ? [...grid.selectedFullRows]
                          : [idx]
                        grid.deleteRows(rows)
                      }}
                      size="sm"
                      variant="ghost"
                      className="h-4 w-4 p-0 hover:bg-red-50 align-middle"
                    >
                      <X className="w-2.5 h-2.5 text-red-600" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 일괄 입력 플로팅 메뉴 (다중 선택 드래그 종료/Enter) */}
      {grid.bulkMenuPos && bulkField && (
        <div
          data-items-grid-bulk-menu
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex items-center gap-2"
          style={{
            left: Math.min(grid.bulkMenuPos.x, window.innerWidth - 280),
            top: Math.min(grid.bulkMenuPos.y + 4, window.innerHeight - 60),
          }}
        >
          <span className="text-[10px] font-semibold text-gray-500 select-none whitespace-nowrap">
            {FIELD_LABELS[bulkField] ?? bulkField} · {grid.selectedCells.filter(k => k.split('::')[1] !== 'amount_value').length}칸 일괄 입력
          </span>
          <input
            autoFocus
            value={grid.bulkValue}
            onChange={(e) => grid.setBulkValue(e.target.value)}
            onKeyDown={(e) => {
              // window 키 핸들러(Enter=메뉴 재오픈, ESC=선택 해제)로 전파되지 않게 차단
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); grid.applyBulkValue(grid.bulkValue) }
              else if (e.key === 'Escape') grid.setBulkMenuPos(null)
            }}
            className="h-6 bg-white border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-hansl-500 min-w-[120px]"
            placeholder="값 입력 후 Enter"
          />
          <button
            type="button"
            onClick={() => grid.applyBulkValue(grid.bulkValue)}
            className="text-[10px] font-medium text-white bg-hansl-500 hover:bg-hansl-600 rounded px-2 py-1 shrink-0"
          >
            적용
          </button>
          <button
            type="button"
            onClick={() => grid.setBulkMenuPos(null)}
            className="text-[10px] text-gray-400 hover:text-gray-600 px-1 shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
