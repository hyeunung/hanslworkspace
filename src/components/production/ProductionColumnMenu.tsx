import React from 'react'
import { Eye, EyeOff, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { HIDEABLE_SECTIONS, hideableFieldsFor } from '@/utils/productionColumns'
import { AnchoredPortal } from './AnchoredPortal'

interface ProductionColumnMenuProps {
  type: 'pcb' | 'cable'
  hiddenCols: Record<'pcb' | 'cable', string[]>
  columnMenuFor: 'pcb' | 'cable' | null
  setColumnMenuFor: React.Dispatch<React.SetStateAction<'pcb' | 'cable' | null>>
  menuAnchorEl: HTMLElement | null
  setMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  // 행 추가 중 여부 판단용 — 훅(useProductionColumnVisibility)과 동일하게 truthiness만 사용
  addingPcbRow: unknown
  addingCableRow: unknown
  toggleHiddenCol: (type: 'pcb' | 'cable', field: string) => void
  resetHiddenCols: (type: 'pcb' | 'cable') => void
  setSectionHidden: (type: 'pcb' | 'cable', fields: string[], hide: boolean) => void
  getColumnTitle: (field: string, type?: 'pcb' | 'cable') => string
}

  // 칼럼 표시 설정 드롭다운 — 발주 목록의 '칼럼 설정'과 같은 개념이되, 적용 버튼 없이 클릭 즉시 반영 + 자동 저장.
  // PCB는 업무 단계 섹션 3개(구분선)로 나뉘고, 섹션 제목 옆 버튼으로 섹션 전체를 한번에 숨기기/표시할 수 있다.
// ProductionListMain.tsx의 renderColumnMenu에서 분리 — JSX/동작 동일.
export default function ProductionColumnMenu({
  type, hiddenCols, columnMenuFor, setColumnMenuFor, menuAnchorEl, setMenuAnchorEl,
  addingPcbRow, addingCableRow, toggleHiddenCol, resetHiddenCols, setSectionHidden, getColumnTitle,
}: ProductionColumnMenuProps) {
    const sections = HIDEABLE_SECTIONS[type]
    const total = hideableFieldsFor(type).length
    const hiddenCount = hiddenCols[type].length
    const open = columnMenuFor === type
    const adding = type === 'pcb' ? !!addingPcbRow : !!addingCableRow
    return (
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { setMenuAnchorEl(e.currentTarget as HTMLElement); setColumnMenuFor(prev => (prev === type ? null : type)) }}
          title="표시할 칼럼 선택"
          className="hansl-btn"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="button-text">칼럼</span>
          {hiddenCount > 0 && (
            <span className="text-[10px] font-bold text-hansl-500">{total - hiddenCount}/{total}</span>
          )}
        </button>
        {open && (
          <>
            {/* 바깥 클릭 시 닫힘 */}
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => setColumnMenuFor(null)} />
            {/* body 포털로 띄워 카드 overflow-hidden에 잘리지 않게 한다 (버튼 우측 정렬) */}
            <AnchoredPortal anchorEl={menuAnchorEl} align="right" gap={4}>
            <div className="hansl-popover pb-2 w-[380px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">
                  칼럼 표시 설정 <span className="text-gray-400 font-normal">({total - hiddenCount}/{total})</span>
                </span>
                <button
                  type="button"
                  onClick={() => resetHiddenCols(type)}
                  className="hansl-mini-btn hover:text-gray-800"
                  title="숨긴 칼럼을 모두 다시 표시"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  전체 표시
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto px-3 pt-2">
                {sections.map((sec, si) => {
                  const secFields = sec.groups.flatMap(g => g.fields)
                  const allHidden = secFields.every(f => hiddenCols[type].includes(f))
                  return (
                    <div key={si} className={si > 0 ? 'border-t-2 border-gray-200 mt-2.5 pt-2' : ''}>
                      {sec.title && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-gray-600">{sec.title}</span>
                          <button
                            type="button"
                            onClick={() => setSectionHidden(type, secFields, !allHidden)}
                            className={`text-[9px] font-medium border rounded px-1.5 py-0.5 transition-colors flex items-center gap-1 ${
                              allHidden
                                ? 'text-hansl-500 border-blue-200 bg-blue-50 hover:bg-blue-100'
                                : 'text-gray-500 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:text-gray-800'
                            }`}
                            title={allHidden ? '이 구간의 칼럼을 모두 표시' : '이 구간의 칼럼을 모두 숨기기'}
                          >
                            {allHidden ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                            {allHidden ? '모두 표시' : '모두 숨기기'}
                          </button>
                        </div>
                      )}
                      <div className="space-y-2">
                        {sec.groups.map(g => (
                          <div key={g.title}>
                            <div className="text-[9px] font-bold text-gray-400 mb-0.5">{g.title}</div>
                            <div className="grid grid-cols-2 gap-x-2">
                              {g.fields.map(f => {
                                const hidden = hiddenCols[type].includes(f)
                                return (
                                  <button
                                    key={f}
                                    type="button"
                                    onClick={() => toggleHiddenCol(type, f)}
                                    className={`flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-gray-50 transition-colors ${hidden ? 'text-gray-400' : 'text-gray-700'}`}
                                  >
                                    {hidden
                                      ? <EyeOff className="w-3 h-3 text-gray-300 shrink-0" />
                                      : <Eye className="w-3 h-3 text-hansl-500 shrink-0" />}
                                    <span className="text-[11px] truncate">{getColumnTitle(f, type)}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {adding && (
                <div className="px-3 pt-2 mt-1.5 text-[9px] text-amber-600 border-t border-gray-100">
                  행 추가 중에는 입력 누락 방지를 위해 모든 칼럼이 임시로 표시됩니다.
                </div>
              )}
            </div>
            </AnchoredPortal>
          </>
        )}
      </div>
    )
}
