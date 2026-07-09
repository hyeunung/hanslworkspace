import React, { useState, useRef } from 'react'
import { Bookmark, Check, ChevronDown, Edit2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

interface SavedColumnViewsMenuProps {
  views: { id: string; name: string }[]
  onSaveCurrent: (name: string) => void | Promise<void>
  onApply: (viewId: string) => void
  onRename: (viewId: string, prevName: string) => void
  onDelete: (viewId: string, name: string) => void
}

// '저장된 칼럼' 드롭다운 버튼 — 저장된 필터와 동일한 UX(현재 구성 이름 저장 + 목록 적용/이름변경/삭제).
// 제작현황/발주·구매 공용. 칼럼 상태 자체는 화면별 저장소(DB/localStorage)에 자동 유지되므로
// 시작 기본값 항목은 두지 않는다(마지막 상태가 곧 시작값).
export default function SavedColumnViewsMenu({
  views, onSaveCurrent, onApply, onRename, onDelete,
}: SavedColumnViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  // 저장 await 중 Enter 연타/버튼 재클릭으로 두 번 저장되는 것 방지
  const savingRef = useRef(false)

  const close = () => { setOpen(false); setAnchorEl(null); setNaming(false); setNewName('') }
  const commitSave = async () => {
    const name = newName.trim()
    if (!name || savingRef.current) return
    if (views.some(v => v.name === name)) {
      toast.error(`'${name}' 이름의 저장된 칼럼이 이미 있습니다.`)
      return
    }
    savingRef.current = true
    close() // 입력창 즉시 닫아 중복 트리거 차단 (낙관적 갱신이라 목록엔 바로 반영)
    try {
      await onSaveCurrent(name)
    } finally {
      savingRef.current = false
    }
  }

  return (
    <>
      {/* 칼럼 버튼(hansl-btn)과 같은 규격 — 같은 행에서 높낮이/모양 통일 */}
      <button
        type="button"
        onClick={(e) => {
          setNaming(false); setNewName('')
          if (open) close()
          else { setOpen(true); setAnchorEl(e.currentTarget) }
        }}
        className="hansl-btn"
        title="저장된 칼럼 구성 불러오기·저장"
      >
        <Bookmark className="w-3.5 h-3.5" />
        <span className="button-text">저장된 칼럼</span>
        {views.length > 0 && (
          <span className="text-[10px] font-bold text-hansl-500">{views.length}</span>
        )}
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && anchorEl && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={close} />
          <AnchoredPortal anchorEl={anchorEl} align="right" zIndex={9999}>
            <div className="hansl-popover rounded-lg py-1 w-[260px] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
              {naming ? (
                // 인라인 이름 입력 — 저장된 필터와 동일 패턴
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitSave() }
                      else if (e.key === 'Escape') { setNaming(false); setNewName('') }
                    }}
                    placeholder="칼럼 구성 이름 입력 후 Enter"
                    className="flex-1 min-w-0 h-[24px] px-2 text-[11px] border border-gray-300 rounded focus:outline-none focus:border-hansl-500"
                  />
                  <button
                    type="button"
                    onClick={commitSave}
                    disabled={!newName.trim()}
                    className="shrink-0 px-2 h-[24px] rounded text-[11px] text-white bg-hansl-500 hover:bg-hansl-600 disabled:bg-gray-300 transition-colors"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNaming(false); setNewName('') }}
                    className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600"
                    title="취소"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setNaming(true); setNewName('') }}
                  className="hansl-menu-item"
                >
                  <Bookmark className="w-3.5 h-3.5 text-hansl-500" /> 현재 칼럼 구성을 이름 붙여 저장
                </button>
              )}

              <div className="my-1 border-t border-gray-100" />
              <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase">
                저장된 칼럼 {views.length > 0 && `(${views.length})`}
              </div>
              {views.length === 0 ? (
                <div className="px-3 py-2 text-[10px] text-gray-400">저장된 칼럼 구성이 없습니다.</div>
              ) : (
                <div className="max-h-[240px] overflow-y-auto">
                  {views.map(v => (
                    <div key={v.id} className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 transition-colors">
                      <button
                        type="button"
                        onClick={() => { onApply(v.id); close() }}
                        className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-gray-700"
                        title="이 칼럼 구성 적용"
                      >
                        <Check className="w-3 h-3 text-gray-300 shrink-0" />
                        <span className="truncate">{v.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRename(v.id, v.name)}
                        className="p-0.5 rounded text-gray-400 hover:text-hansl-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="이름 변경"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(v.id, v.name)}
                        className="p-0.5 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </AnchoredPortal>
        </>
      )}
    </>
  )
}
