import React, { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Plus, RotateCcw, X } from 'lucide-react'
import { PurchaseSortRule, PURCHASE_SORT_FIELDS, purchaseSortLabel } from '@/utils/purchaseTableSort'
import { measureText } from '@/utils/productionColumns'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

interface PurchaseSortControlProps {
  sortRules: PurchaseSortRule[]
  addSortRule: () => void
  updateSortRule: (id: string, patch: Partial<PurchaseSortRule>) => void
  removeSortRule: (id: string) => void
  clearSort: () => void
}

// 정렬 컨트롤 (노션식) — 표 제목 옆 배지 버튼. 클릭 시 팝오버로 정렬 규칙을 추가/변경/제거.
// 규칙은 우선순위 순(위=1차)이며 변경 즉시 자동 저장(localStorage).
// 제작현황 ProductionSortControl을 발주 단일 표 기준으로 주입한 버전 — JSX/동작 동일.
export default function PurchaseSortControl({
  sortRules, addSortRule, updateSortRule, removeSortRule, clearSort,
}: PurchaseSortControlProps) {
  const [open, setOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const active = sortRules.length > 0
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { setAnchorEl(e.currentTarget as HTMLElement); setOpen(prev => !prev) }}
        title={active ? `정렬 ${sortRules.length}개 적용됨` : '정렬 추가'}
        className={`badge-stats cursor-pointer border flex items-center gap-1 transition-colors ${
          active ? 'hansl-toggle-on' : 'hansl-toggle-off'
        }`}
      >
        <ArrowUpDown className="w-3 h-3" />
        정렬{active ? ` ${sortRules.length}` : ''}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setOpen(false)} />
          {/* 패널 폭은 내용에 맞춤(w-max). body 포털로 띄워 카드 overflow-hidden에 잘리지 않게 한다. */}
          <AnchoredPortal anchorEl={anchorEl} gap={4}>
            <div className="hansl-popover w-max min-w-[200px] max-w-[340px]">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">정렬</span>
                {active && (
                  <button
                    type="button"
                    onClick={clearSort}
                    className="hansl-mini-btn hover:text-red-600"
                    title="정렬 모두 제거"
                  >
                    <RotateCcw className="w-2.5 h-2.5" /> 초기화
                  </button>
                )}
              </div>
              <div className="px-2 py-2 space-y-1.5 max-h-[50vh] overflow-y-auto">
                {sortRules.length === 0 && (
                  <div className="px-1 py-2 text-[10px] text-gray-400 whitespace-nowrap">
                    정렬할 칼럼을 추가하세요.
                  </div>
                )}
                {sortRules.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-3 shrink-0 text-center">{i + 1}</span>
                    {/* 박스 규격/타이포는 제작현황 정렬 팝오버와 동일 (hansl-select-box 표준) */}
                    <div className="relative shrink-0">
                      <select
                        value={r.field}
                        onChange={(e) => updateSortRule(r.id, { field: e.target.value })}
                        style={{ padding: '0 15px 0 7px', lineHeight: '20px', backgroundImage: 'none', width: `${Math.ceil(measureText(purchaseSortLabel(r.field), 400) * 1.1) + 24}px` }}
                        className="hansl-select-box"
                      >
                        {PURCHASE_SORT_FIELDS.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-gray-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {/* 방향: 화살표 아이콘만 — 선택된 방향은 파랑 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateSortRule(r.id, { dir: 'asc' })}
                        title="오름차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'asc' ? 'text-hansl-500' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSortRule(r.id, { dir: 'desc' })}
                        title="내림차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'desc' ? 'text-hansl-500' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSortRule(r.id)}
                      title="이 정렬 제거"
                      className="hansl-close-btn shrink-0 ml-auto"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-2 pb-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={addSortRule}
                  disabled={sortRules.length >= PURCHASE_SORT_FIELDS.length}
                  className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-gray-300 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-hansl-500 hover:border-hansl-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:hover:border-gray-300"
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
