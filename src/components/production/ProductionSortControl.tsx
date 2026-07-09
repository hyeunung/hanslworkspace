import React from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Plus, RotateCcw, X } from 'lucide-react'
import { SortRule, PCB_SORT_FIELDS, CABLE_SORT_FIELDS } from '@/utils/productionSort'
import { measureText } from '@/utils/productionColumns'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

interface ProductionSortControlProps {
  type: 'pcb' | 'cable'
  sortFor: (type: 'pcb' | 'cable') => SortRule[]
  sortMenuFor: 'pcb' | 'cable' | null
  setSortMenuFor: React.Dispatch<React.SetStateAction<'pcb' | 'cable' | null>>
  menuAnchorEl: HTMLElement | null
  setMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  addSortRule: (type: 'pcb' | 'cable') => void
  updateSortRule: (type: 'pcb' | 'cable', id: string, patch: Partial<SortRule>) => void
  removeSortRule: (type: 'pcb' | 'cable', id: string) => void
  clearSort: (type: 'pcb' | 'cable') => void
  getColumnTitle: (field: string, type?: 'pcb' | 'cable') => string
}

  // 정렬 컨트롤 (노션식) — 제목 옆 행수 배지 바로 우측. 클릭 시 팝오버로 정렬 규칙을 추가/변경/제거.
  // 규칙은 우선순위 순(위=1차)이며, 제작구분 그룹 안에서의 행 순서를 결정한다. 변경 즉시 자동 저장.
// ProductionListMain.tsx의 renderSortControl에서 분리 — JSX/동작 동일.
export default function ProductionSortControl({
  type, sortFor, sortMenuFor, setSortMenuFor, menuAnchorEl, setMenuAnchorEl,
  addSortRule, updateSortRule, removeSortRule, clearSort, getColumnTitle,
}: ProductionSortControlProps) {
    const rules = sortFor(type)
    const fields = type === 'pcb' ? PCB_SORT_FIELDS : CABLE_SORT_FIELDS
    const open = sortMenuFor === type
    const active = rules.length > 0
    return (
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { setMenuAnchorEl(e.currentTarget as HTMLElement); setSortMenuFor(prev => (prev === type ? null : type)) }}
          title={active ? `정렬 ${rules.length}개 적용됨` : '정렬 추가'}
          className={`badge-stats cursor-pointer border flex items-center gap-1 transition-colors ${
            active
              ? 'hansl-toggle-on'
              : 'hansl-toggle-off'
          }`}
        >
          <ArrowUpDown className="w-3 h-3" />
          정렬{active ? ` ${rules.length}` : ''}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => setSortMenuFor(null)} />
            {/* 패널 폭은 내용에 맞춤(w-max) — 고정 폭(w-[320px])이면 짧은 규칙에도 넓게 남아 어색. 최소/최대만 제한.
                body 포털로 띄워 카드 overflow-hidden에 잘리지 않게 한다. */}
            <AnchoredPortal anchorEl={menuAnchorEl} gap={4}>
            <div className="hansl-popover w-max min-w-[200px] max-w-[340px]">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-semibold text-gray-700">정렬</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => clearSort(type)}
                    className="hansl-mini-btn hover:text-red-600"
                    title="정렬 모두 제거"
                  >
                    <RotateCcw className="w-2.5 h-2.5" /> 초기화
                  </button>
                )}
              </div>
              <div className="px-2 py-2 space-y-1.5 max-h-[50vh] overflow-y-auto">
                {rules.length === 0 && (
                  <div className="px-1 py-2 text-[10px] text-gray-400 whitespace-nowrap">
                    정렬할 칼럼을 추가하세요.
                  </div>
                )}
                {rules.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-3 shrink-0 text-center">{i + 1}</span>
                    {/* 박스 규격은 툴바 버튼(행 추가 등 button-base) 실측과 동일: 높이 22px · radius 토큰.
                        텍스트는 칼럼 표시 설정 팝오버 항목과 동일한 앱 표준 타이포(11px/400/gray-700, body 자간 상속).
                        폭은 선택된 칼럼명에 핏(좌10+텍스트+우24 화살표자리). measureText는 10px 기준이라 11px 폰트는 1.1배 보정.
                        appearance-none + backgroundImage none으로 @tailwindcss/forms 배경 화살표를 없애 커스텀 ChevronDown과 중복 제거.
                        세로 패딩 0은 인라인 강제(forms의 0.5rem 세로패딩이 @layer 밖이라 py-0로 못 이김) → 텍스트 세로 중앙 유지. */}
                    <div className="relative shrink-0">
                      <select
                        value={r.field}
                        onChange={(e) => updateSortRule(type, r.id, { field: e.target.value })}
                        // lineHeight 20px = 박스 22px − 보더 2px. 전역에서 24px가 상속돼 텍스트가 아래로 밀리는 것을 인라인으로 강제 보정
                        style={{ padding: '0 15px 0 7px', lineHeight: '20px', backgroundImage: 'none', width: `${Math.ceil(measureText(getColumnTitle(r.field, type), 400) * 1.1) + 24}px` }}
                        className="hansl-select-box"
                      >
                        {fields.map(f => (
                          <option key={f} value={f}>{getColumnTitle(f, type)}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-gray-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {/* 방향: 박스 없이 화살표 아이콘만 — 회색, 선택된 방향은 파랑. 호버 시 title 말풍선 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateSortRule(type, r.id, { dir: 'asc' })}
                        title="오름차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'asc' ? 'text-hansl-500' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSortRule(type, r.id, { dir: 'desc' })}
                        title="내림차순"
                        className={`p-0.5 rounded transition-colors ${r.dir === 'desc' ? 'text-hansl-500' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSortRule(type, r.id)}
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
                  onClick={() => addSortRule(type)}
                  disabled={rules.length >= fields.length}
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
