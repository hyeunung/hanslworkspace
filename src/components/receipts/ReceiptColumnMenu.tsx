import React, { useState } from 'react'
import { Eye, EyeOff, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { RECEIPT_COLUMN_LABELS, ReceiptColumnId } from '@/utils/receiptTable'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

export type ReceiptColumnVisibility = Partial<Record<ReceiptColumnId, boolean>>

interface ReceiptColumnMenuProps {
  columnVisibility: ReceiptColumnVisibility
  toggleColumn: (columnId: ReceiptColumnId) => void
  resetToDefault: () => void
  // 권한상 아예 노출되지 않는 칼럼(예: 등록인)은 메뉴에서도 제외
  excludedIds?: ReceiptColumnId[]
}

// 칼럼 표시 설정 드롭다운 — BomBoardColumnMenu 형식(클릭 즉시 반영 + 자동 저장 localStorage).
// 영수증은 칼럼이 적어 그룹 없이 단일 목록. 거래처는 필수(잠금).
export default function ReceiptColumnMenu({
  columnVisibility, toggleColumn, resetToDefault, excludedIds = [],
}: ReceiptColumnMenuProps) {
  const [open, setOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const columns = RECEIPT_COLUMN_LABELS.filter(c => !excludedIds.includes(c.id))
  const total = columns.length
  const shownCount = columns.filter(c => columnVisibility[c.id] !== false).length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { setAnchorEl(e.currentTarget as HTMLElement); setOpen(prev => !prev) }}
        title="표시할 칼럼 선택"
        className={`hansl-ctl-chip ${open ? 'hansl-toggle-on' : 'hansl-toggle-off'}`}
      >
        <SlidersHorizontal className="w-3 h-3" />
        칼럼
        {shownCount < total && (
          <span className="hansl-ctl-count-strong">{shownCount}/{total}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setOpen(false)} />
          <AnchoredPortal anchorEl={anchorEl} align="right" gap={4}>
            <div className="hansl-popover pb-2 w-[280px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">
                  칼럼 표시 설정 <span className="text-gray-400 font-normal">({shownCount}/{total})</span>
                </span>
                <button
                  type="button"
                  onClick={resetToDefault}
                  className="hansl-mini-btn hover:text-gray-800"
                  title="숨긴 칼럼을 모두 다시 표시"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  전체 표시
                </button>
              </div>
              <div className="px-3 pt-2 grid grid-cols-2 gap-x-2">
                {columns.map(({ id, label, required }) => {
                  const hidden = columnVisibility[id] === false
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={required}
                      onClick={() => toggleColumn(id)}
                      title={required ? '필수 칼럼은 숨길 수 없습니다' : undefined}
                      className={`flex items-center gap-1.5 py-1 px-1 rounded text-left transition-colors ${
                        required ? 'cursor-default' : 'hover:bg-gray-50'
                      } ${hidden ? 'text-gray-400' : 'text-gray-700'}`}
                    >
                      {required
                        ? <Lock className="w-3 h-3 text-gray-300 shrink-0" />
                        : hidden
                          ? <EyeOff className="w-3 h-3 text-gray-300 shrink-0" />
                          : <Eye className="w-3 h-3 text-hansl-500 shrink-0" />}
                      <span className="text-[11px] truncate">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </AnchoredPortal>
        </>
      )}
    </div>
  )
}
