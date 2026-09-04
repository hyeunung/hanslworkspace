import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { FormItem } from '@/types/purchase'
import { usePurchaseItemsGrid } from './usePurchaseItemsGrid'

// ─── 새발주 품목 목록 엑셀식 그리드 ────────────────────────────────────
// 셀은 항상 input이 열려있고(기존 UX 유지), 그 위에 제작현황식 셀 선택·
// 범위 복사/붙여넣기·Delete 비우기/행 삭제·일괄 입력·Ctrl+Z 되돌리기를 얹는다.
// 조작 로직은 usePurchaseItemsGrid 훅에 있다.

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
  const [inputValues, setInputValues] = useState<{ [key: string]: string }>({})

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

  const tdProps = (r: number, field: string) => {
    const c = cols.indexOf(field)
    const isSelected = grid.selectedSet.has(`${r}::${field}`)
    return {
      'data-grid-cell': `${r}::${field}`,
      className: 'px-2 py-1 select-none',
      style: isSelected ? SELECTED_TD_STYLE : undefined,
      onMouseDown: (e: React.MouseEvent) => grid.onCellMouseDown(e, r, c),
      onMouseEnter: (e: React.MouseEvent) => grid.onCellMouseEnter(e, r, c),
    }
  }

  const inputClass = 'h-7 w-full bg-transparent border border-gray-200 text-xs'

  return (
    <div ref={containerRef} className="overflow-x-auto" tabIndex={0} style={{ outline: 'none' }}>
      <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="border-b border-gray-200">
              <th className="px-2 py-2 text-left font-medium text-gray-700 w-10">#</th>
              <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[100px] sm:min-w-[120px]">
                품목<span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[250px] sm:min-w-[320px]">규격</th>
              <th className="px-2 py-2 text-center font-medium text-gray-700 w-20">
                수량<span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 text-right font-medium text-gray-700 w-[140px] sm:w-[160px]">
                단가 ({currency})
              </th>
              <th className="px-2 py-2 text-right font-medium text-gray-700 min-w-[110px] sm:min-w-[140px]">
                합계 ({currency})
              </th>
              {showLink && (
                <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[120px] sm:min-w-[150px]">링크</th>
              )}
              <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[100px] sm:min-w-[150px]">비고</th>
              <th className="px-2 py-2 text-center font-medium text-gray-700 w-10"></th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {fields.map((item, idx) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                {/* NO. 셀: 클릭/드래그로 행 전체 선택 (제작현황과 동일) */}
                <td
                  className="px-2 py-1 text-center text-gray-500 select-none cursor-pointer hover:bg-gray-100"
                  style={grid.selectedFullRows.has(idx) ? SELECTED_TD_STYLE : undefined}
                  onMouseDown={(e) => grid.onRowNoMouseDown(e, idx)}
                  onMouseEnter={(e) => grid.onRowNoMouseEnter(e, idx)}
                >
                  {idx + 1}
                </td>

                {/* 품목 */}
                <td {...tdProps(idx, 'item_name')}>
                  <Input
                    data-row-index={idx}
                    data-field-name="item_name"
                    value={item.item_name}
                    onChange={(e) => update(idx, { ...item, item_name: e.target.value })}
                    onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('item_name'))}
                    className={inputClass}
                    placeholder="품목명 입력"
                  />
                </td>

                {/* 규격 */}
                <td {...tdProps(idx, 'specification')}>
                  <Input
                    data-row-index={idx}
                    data-field-name="specification"
                    value={item.specification}
                    onChange={(e) => update(idx, { ...item, specification: e.target.value })}
                    onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('specification'))}
                    className={inputClass}
                    placeholder="규격 입력"
                  />
                </td>

                {/* 수량 */}
                <td {...tdProps(idx, 'quantity')}>
                  <Input
                    data-row-index={idx}
                    data-field-name="quantity"
                    type="number"
                    min="1"
                    value={item.quantity || ''}
                    className={`${inputClass} w-20 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                    placeholder="0"
                    onChange={(e) => {
                      const newQuantity = parseInt(e.target.value) || 0
                      update(idx, { ...item, quantity: newQuantity })
                    }}
                    onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('quantity'))}
                  />
                </td>

                {/* 단가 */}
                <td {...tdProps(idx, 'unit_price_value')}>
                  <div className="flex items-center">
                    <Input
                      data-row-index={idx}
                      data-field-name="unit_price_value"
                      type="text"
                      inputMode="decimal"
                      value={inputValues[`${idx}_unit_price_value`] ?? (item.unit_price_value === 0 ? '' : item.unit_price_value?.toLocaleString('ko-KR') || '')}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, '')
                        // 숫자와 소수점만 허용, 소수점 중복 방지
                        const cleanValue = raw.replace(/[^0-9.]/g, '')
                        const parts = cleanValue.split('.')
                        const finalValue = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleanValue
                        setInputValues(prev => ({ ...prev, [`${idx}_unit_price_value`]: finalValue }))
                        const numVal = finalValue === '' ? 0 : parseFloat(finalValue) || 0
                        update(idx, { ...item, unit_price_value: numVal })
                      }}
                      onBlur={() => {
                        setInputValues(prev => {
                          const newState = { ...prev }
                          delete newState[`${idx}_unit_price_value`]
                          return newState
                        })
                      }}
                      onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('unit_price_value'))}
                      className={`${inputClass} w-32 text-right`}
                      placeholder="0"
                    />
                    <span className="ml-1 text-xs text-gray-500">{currency === 'KRW' ? '₩' : '$'}</span>
                  </div>
                </td>

                {/* 합계 (계산 필드 — 선택/복사만 가능) */}
                <td {...tdProps(idx, 'amount_value')}>
                  <div className="flex items-center justify-end">
                    <span className="text-xs text-right font-medium">
                      {(item.amount_value || 0).toLocaleString('ko-KR')}
                    </span>
                    <span className="ml-1 text-xs text-gray-500">{currency === 'KRW' ? '₩' : '$'}</span>
                  </div>
                </td>

                {/* 링크 (구매요청일 때만) */}
                {showLink && (
                  <td {...tdProps(idx, 'link')}>
                    <Input
                      data-row-index={idx}
                      data-field-name="link"
                      value={item.link || ''}
                      onChange={(e) => update(idx, { ...item, link: e.target.value })}
                      onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('link'))}
                      type="url"
                      className={inputClass}
                      placeholder="https://..."
                    />
                  </td>
                )}

                {/* 비고 */}
                <td {...tdProps(idx, 'remark')}>
                  <Input
                    data-row-index={idx}
                    data-field-name="remark"
                    value={item.remark || ''}
                    onChange={(e) => update(idx, { ...item, remark: e.target.value })}
                    onKeyDown={(e) => grid.onCellInputKeyDown(e, idx, cols.indexOf('remark'))}
                    className={inputClass}
                    placeholder="비고"
                  />
                </td>

                {/* 삭제 버튼: 선택된 행 무리에 포함돼 있으면 일괄 삭제 */}
                <td className="px-2 py-1 text-center">
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
                      className="h-6 w-6 p-0 hover:bg-red-50"
                    >
                      <X className="w-3 h-3 text-red-600" />
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
