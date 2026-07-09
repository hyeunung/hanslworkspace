import React from 'react'
import { Bookmark, Check, ChevronDown, Edit2, Filter, Plus, RotateCcw, Save, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import { STATUS_FIELDS, filterStatusOptionsFor } from '@/utils/productionStatus'
import {
  PCB_CATEGORIES, CABLE_CATEGORIES, FilterOp, FilterRule, TableFilter, opLabelFor, opsForField,
} from '@/utils/productionFilters'
import { MIN_COLUMN_WIDTH, measureText } from '@/utils/productionColumns'
import { ProductionFilterConfig } from '@/hooks/useProductionFilterViews'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

// 필터 저장 버튼 아이콘.
//  - 미저장: 기본 lucide Save(회색 아웃라인, 버튼 색 상속)
//  - 저장됨: 몸통·바깥 테두리는 진파랑(#1777CB), 안쪽 디테일 선만 흰색 (lucide는 선 색이 하나뿐이라 커스텀 SVG로 분리)
function FilterSaveIcon({ saved }: { saved: boolean }) {
  if (!saved) return <Save className="w-3.5 h-3.5" />
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" className="fill-hansl-500 stroke-hansl-500" strokeWidth="2" strokeLinejoin="round" />
      <polyline points="17 21 17 13 7 13 7 21" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 3 7 8 15 8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface ProductionFilterToolbarProps {
  type: 'pcb' | 'cable'
  filterFor: (type: 'pcb' | 'cable') => TableFilter
  categoryOrder: string[]
  filterHasSaved: Record<'pcb' | 'cable', { rules: boolean; cats: boolean }>
  filterDirty: Record<'pcb' | 'cable', { rules: boolean; cats: boolean }>
  filterViewsConfig: ProductionFilterConfig
  getColumnTitle: (field: string, type?: 'pcb' | 'cable') => string
  yearsFor: (type: 'pcb' | 'cable', dateField: string) => number[]
  addRule: (type: 'pcb' | 'cable') => void
  updateRule: (type: 'pcb' | 'cable', id: string, patch: Partial<FilterRule>) => void
  removeRule: (type: 'pcb' | 'cable', id: string) => void
  saveRulesFilter: (type: 'pcb' | 'cable') => void
  handleResetRules: (type: 'pcb' | 'cable') => void
  saveCategoryFilter: (type: 'pcb' | 'cable') => void
  handleResetCategoryFilter: (type: 'pcb' | 'cable') => void
  chipRefFor: (type: 'pcb' | 'cable') => React.RefObject<HTMLDivElement | null>
  dragCat: string | null
  dropIndex: { type: 'pcb' | 'cable'; index: number } | null
  handleChipPointerDown: (e: React.PointerEvent<HTMLButtonElement>, cat: string, type: 'pcb' | 'cable') => void
  viewsMenuFor: 'pcb' | 'cable' | null
  setViewsMenuFor: React.Dispatch<React.SetStateAction<'pcb' | 'cable' | null>>
  viewsAnchor: HTMLElement | null
  setViewsAnchor: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  namingViewFor: 'pcb' | 'cable' | null
  setNamingViewFor: React.Dispatch<React.SetStateAction<'pcb' | 'cable' | null>>
  newViewName: string
  setNewViewName: React.Dispatch<React.SetStateAction<string>>
  commitSaveView: (type: 'pcb' | 'cable') => void
  handleSetDefault: (type: 'pcb' | 'cable') => void
  handleClearDefault: (type: 'pcb' | 'cable') => void
  handleApplyView: (viewId: string) => void
  handleRenameView: (viewId: string, prevName: string) => void
  handleDeleteView: (viewId: string, name: string) => void
}

  // 테이블별 필터 툴바 (노션식 규칙 필터 + 제작구분 칩) — PCB/Cable 동일 마크업
  // 규칙 = [칼럼 ▾][조건 ▾][값 | 년 ▾ 월 ▾][×] 이며 노션처럼 추가/수정/제거 가능.
  // 기본 규칙(입고대기 + 요청일 현재년도)도 일반 규칙이라 X로 제거할 수 있다.
// ProductionListMain.tsx의 renderFilterToolbar에서 분리 — JSX/동작 동일.
export default function ProductionFilterToolbar({
  type, filterFor, categoryOrder, filterHasSaved, filterDirty, filterViewsConfig,
  getColumnTitle, yearsFor, addRule, updateRule, removeRule,
  saveRulesFilter, handleResetRules, saveCategoryFilter, handleResetCategoryFilter,
  chipRefFor, dragCat, dropIndex, handleChipPointerDown,
  viewsMenuFor, setViewsMenuFor, viewsAnchor, setViewsAnchor,
  namingViewFor, setNamingViewFor, newViewName, setNewViewName,
  commitSaveView, handleSetDefault, handleClearDefault, handleApplyView, handleRenameView, handleDeleteView,
}: ProductionFilterToolbarProps) {
    const f = filterFor(type)
    const tableCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
    const orderedCats = categoryOrder.filter(c => tableCats.includes(c))
    // 조건(규칙)/제작구분 섹션별 '저장됨' 상태 — 서로 독립
    const rulesSaved = filterHasSaved[type].rules && !filterDirty[type].rules
    const catsSaved = filterHasSaved[type].cats && !filterDirty[type].cats
    // 이 표의 저장 필터 목록 + 시작 기본값 설정 여부
    const savedViewsForType = filterViewsConfig.views.filter(v => v.scope === type)
    const hasDefaultForType = !!filterViewsConfig.defaults[type]
    // 필터를 걸 수 있는 칼럼 = 그 테이블의 모든 칼럼
    const filterableFields = Object.keys(MIN_COLUMN_WIDTH[type])
    // 브라우저 기본 select 외형(테두리/패딩/화살표/포커스링)을 완전히 제거 — 알약 안에서 텍스트처럼 보이게
    const selectClass = 'hansl-pill-select'
    const selectStyle: React.CSSProperties = {
      WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
      border: 'none', padding: 0, margin: 0, background: 'none', outline: 'none',
    }
    // 네이티브 select는 '가장 긴 옵션' 폭으로 벌어지므로, 현재 선택된 라벨 실측 폭으로 고정한다
    const fitSelect = (label: string, weight = 400): React.CSSProperties => ({
      ...selectStyle,
      width: `${Math.ceil(measureText(label, weight)) + 6}px`,
    })

    // 칼럼 변경 시 새 칼럼이 지원하는 조건으로 보정 (date_in이면 년/월 초기화)
    // op별 기본 value 계산 (status_is면 해당 칼럼의 첫 상태코드, 포함류면 기존/빈 문자열)
    const valueForOp = (field: string, op: FilterOp, prev?: string): string | undefined => {
      if (op === 'status_is') {
        const opts = filterStatusOptionsFor(field)
        return prev && opts.some(o => o.code === prev) ? prev : opts[0].code
      }
      if (op === 'contains' || op === 'not_contains') return prev ?? ''
      return undefined
    }
    const changeRuleField = (rule: FilterRule, field: string) => {
      const ops = opsForField(field)
      // ARTWORK/부품정리로 바꾸면 기본은 상태 선택, 그 외엔 호환되는 기존 조건 유지
      const op = STATUS_FIELDS.includes(field) ? 'status_is' : (ops.includes(rule.op) ? rule.op : ops[0])
      updateRule(type, rule.id, {
        field,
        op,
        value: valueForOp(field, op, rule.value),
        year: op === 'date_in' ? new Date().getFullYear() : null,
        month: op === 'date_in' ? null : null,
      })
    }
    const changeRuleOp = (rule: FilterRule, op: FilterOp) => {
      updateRule(type, rule.id, {
        op,
        value: valueForOp(rule.field, op, rule.value),
        year: op === 'date_in' ? (rule.year ?? new Date().getFullYear()) : null,
        month: op === 'date_in' ? (rule.month ?? null) : null,
      })
    }

    return (
      <>
        {/* Row A: 필터 규칙 (노션식 추가/수정/제거) */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="hansl-filter-row-label">
            <SlidersHorizontal className="w-3.5 h-3.5" /> 조건:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {f.rules.map(rule => {
              const ops = opsForField(rule.field)
              const dataYears = yearsFor(type, rule.field)
              const years = rule.year != null && !dataYears.includes(rule.year)
                ? [rule.year, ...dataYears].sort((a, b) => b - a)
                : dataYears
              return (
                <div
                  key={rule.id}
                  className="hansl-filter-pill"
                >
                  {/* 칼럼 선택 — 미선택 시 '칼럼 선택' 안내 문구를 보여주고, 고르기 전엔 조건/값 입력을 숨긴다 */}
                  <select
                    value={rule.field}
                    onChange={(e) => changeRuleField(rule, e.target.value)}
                    style={fitSelect(rule.field ? getColumnTitle(rule.field, type) : '칼럼 선택', 600)}
                    className={`${selectClass} font-semibold ${rule.field ? '' : 'text-hansl-500'}`}
                  >
                    {!rule.field && <option value="" disabled>칼럼 선택</option>}
                    {filterableFields.map(k => (
                      <option key={k} value={k}>{getColumnTitle(k, type)}</option>
                    ))}
                  </select>
                  {rule.field && (<>
                  <span className="text-gray-300">·</span>
                  {/* 조건 선택 */}
                  <select
                    value={rule.op}
                    onChange={(e) => changeRuleOp(rule, e.target.value as FilterOp)}
                    style={fitSelect(opLabelFor(rule.field, rule.op))}
                    className={selectClass}
                  >
                    {ops.map(op => (
                      <option key={op} value={op}>{opLabelFor(rule.field, op)}</option>
                    ))}
                  </select>
                  {/* 조건별 값 입력: 상태 드롭다운(ARTWORK/부품정리) / 년/월 드롭다운 / 텍스트 */}
                  {rule.op === 'status_is' && (
                    <select
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(type, rule.id, { value: e.target.value })}
                      style={fitSelect(filterStatusOptionsFor(rule.field).find(o => o.code === rule.value)?.label ?? '진행중', 700)}
                      className={`${selectClass} text-hansl-500 font-bold`}
                    >
                      {filterStatusOptionsFor(rule.field).map(o => (
                        <option key={o.code} value={o.code}>{o.label}</option>
                      ))}
                    </select>
                  )}
                  {rule.op === 'date_in' && (
                    <>
                      <select
                        value={rule.year ?? ''}
                        onChange={(e) => updateRule(type, rule.id, { year: e.target.value === '' ? null : Number(e.target.value) })}
                        style={fitSelect(rule.year != null ? `${rule.year}년` : '전체년도', 700)}
                        className={`${selectClass} text-hansl-500 font-bold`}
                      >
                        <option value="">전체년도</option>
                        {years.map(y => (
                          <option key={y} value={y}>{y}년</option>
                        ))}
                      </select>
                      <select
                        value={rule.month ?? ''}
                        onChange={(e) => updateRule(type, rule.id, { month: e.target.value === '' ? null : Number(e.target.value) })}
                        style={fitSelect(rule.month != null ? `${rule.month}월` : '전체월', 700)}
                        className={`${selectClass} text-hansl-500 font-bold`}
                      >
                        <option value="">전체월</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                          <option key={m} value={m}>{m}월</option>
                        ))}
                      </select>
                    </>
                  )}
                  {(rule.op === 'contains' || rule.op === 'not_contains') && (
                    <input
                      type="text"
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(type, rule.id, { value: e.target.value })}
                      placeholder="값"
                      // 전역 input 기본 스타일(테두리 박스/포커스 아웃라인) 무력화 — 알약 안에서 밑줄 입력처럼 보이게
                      className="hansl-pill-input"
                      style={{ border: 'none', borderBottom: '1px solid #d1d5db', boxShadow: 'none', background: 'none', outline: 'none' }}
                    />
                  )}
                  </>)}
                  {/* 규칙 제거 */}
                  <button
                    type="button"
                    onClick={() => removeRule(type, rule.id)}
                    title="이 필터 제거"
                    className="hansl-close-btn"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
            {/* 규칙 추가 */}
            <button
              type="button"
              onClick={() => addRule(type)}
              className="hansl-chip-add"
            >
              <Plus className="w-3 h-3" /> 필터
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 저장된 필터(사용자별·장치 간 동기화) — 불러오기·저장·기본값 설정 */}
            <button
              type="button"
              onClick={(e) => {
                setNamingViewFor(null); setNewViewName('')
                if (viewsMenuFor === type) { setViewsMenuFor(null); setViewsAnchor(null) }
                else { setViewsMenuFor(type); setViewsAnchor(e.currentTarget) }
              }}
              className={`hansl-pill-btn ${
                viewsMenuFor === type
                  ? 'hansl-pill-btn-on'
                  : 'hansl-pill-btn-off'
              }`}
              title="저장된 필터 불러오기·저장"
            >
              <Bookmark className="w-3 h-3" />
              저장된 필터
              {savedViewsForType.length > 0 && (
                <span className="text-[9px] text-gray-400">({savedViewsForType.length})</span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={() => saveRulesFilter(type)}
              className={`p-1 rounded-md transition-colors ${
                rulesSaved
                  ? 'text-hansl-500 hover:bg-blue-50'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-blue-600'
              }`}
              title={rulesSaved ? '조건 필터 저장됨' : '조건 필터 저장'}
            >
              <FilterSaveIcon saved={rulesSaved} />
            </button>
            <button
              type="button"
              onClick={() => handleResetRules(type)}
              className="hansl-icon-btn hover:bg-gray-100 hover:text-red-600"
              title="기본 필터로 초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row B: 제작구분 칩 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="hansl-filter-row-label">
            <Filter className="w-3.5 h-3.5" /> 제작구분:
          </span>
          <div
            ref={chipRefFor(type)}
            className="flex flex-wrap items-center gap-2 select-none"
          >
            {orderedCats.map((cat, i) => {
              const isSelected = f.categories.includes(cat)
              const showLeftBar = dropIndex?.type === type && dropIndex.index === i
              const showRightBar = dropIndex?.type === type && dropIndex.index === orderedCats.length && i === orderedCats.length - 1
              return (
                <button
                  key={cat}
                  data-cat={cat}
                  type="button"
                  onPointerDown={(e) => handleChipPointerDown(e, cat, type)}
                  title="드래그하여 그룹 순서 변경 · 클릭하여 표시 여부 전환"
                  style={{
                    touchAction: 'none',
                    ...(showLeftBar ? { boxShadow: '-3px 0 0 0 #2563eb' }
                      : showRightBar ? { boxShadow: '3px 0 0 0 #2563eb' }
                      : {})
                  }}
                  className={`badge-stats cursor-grab active:cursor-grabbing border transition-all ${
                    dragCat === cat ? 'opacity-40' : ''
                  } ${
                    isSelected
                      ? 'hansl-chip-on'
                      : 'hansl-chip-off'
                  }`}
                >
                  {cat}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={() => saveCategoryFilter(type)}
              className={`p-1 rounded-md transition-colors ${
                catsSaved
                  ? 'text-hansl-500 hover:bg-blue-50'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-blue-600'
              }`}
              title={catsSaved ? '제작구분 필터 저장됨' : '제작구분 필터 저장'}
            >
              <FilterSaveIcon saved={catsSaved} />
            </button>
            <button
              type="button"
              onClick={() => handleResetCategoryFilter(type)}
              className="hansl-icon-btn hover:bg-gray-100 hover:text-red-600"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 저장된 필터 드롭다운 — document.body로 포털해 카드 overflow에 잘리지 않게 띄운다 */}
        {viewsMenuFor === type && viewsAnchor && (
          <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={() => { setViewsMenuFor(null); setViewsAnchor(null); setNamingViewFor(null) }} />
            <AnchoredPortal anchorEl={viewsAnchor} align="right" zIndex={9999}>
              <div className="hansl-popover rounded-lg py-1 w-[260px] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
                {/* 액션: 현재 필터 저장 / 기본값으로 저장 */}
                {namingViewFor === type ? (
                  // 인라인 이름 입력 — 클릭 즉시 모달 대신 이 입력창에서 이름을 정한다
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitSaveView(type) }
                        else if (e.key === 'Escape') { setNamingViewFor(null); setNewViewName('') }
                      }}
                      placeholder="필터 이름 입력 후 Enter"
                      className="flex-1 min-w-0 h-[24px] px-2 text-[11px] border border-gray-300 rounded focus:outline-none focus:border-hansl-500"
                    />
                    <button
                      type="button"
                      onClick={() => commitSaveView(type)}
                      disabled={!newViewName.trim()}
                      className="shrink-0 px-2 h-[24px] rounded text-[11px] text-white bg-hansl-500 hover:bg-hansl-600 disabled:bg-gray-300 transition-colors"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNamingViewFor(null); setNewViewName('') }}
                      className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600"
                      title="취소"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNamingViewFor(type); setNewViewName('') }}
                    className="hansl-menu-item"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-hansl-500" /> 현재 필터를 이름 붙여 저장
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { handleSetDefault(type); setViewsMenuFor(null); setViewsAnchor(null) }}
                  className="hansl-menu-item"
                >
                  <Star className="w-3.5 h-3.5 text-amber-500" /> 현재 필터를 시작 기본값으로
                </button>
                {hasDefaultForType && (
                  <button
                    type="button"
                    onClick={() => { handleClearDefault(type); setViewsMenuFor(null); setViewsAnchor(null) }}
                    className="hansl-menu-item text-gray-500"
                  >
                    <X className="w-3.5 h-3.5" /> 시작 기본값 해제
                  </button>
                )}

                <div className="my-1 border-t border-gray-100" />
                <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase">
                  저장된 필터 {savedViewsForType.length > 0 && `(${savedViewsForType.length})`}
                </div>
                {savedViewsForType.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-gray-400">저장된 필터가 없습니다.</div>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto">
                    {savedViewsForType.map(v => (
                      <div key={v.id} className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 transition-colors">
                        <button
                          type="button"
                          onClick={() => handleApplyView(v.id)}
                          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-gray-700"
                          title="이 필터 적용"
                        >
                          <Check className="w-3 h-3 text-gray-300 shrink-0" />
                          <span className="truncate">{v.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenameView(v.id, v.name)}
                          className="p-0.5 rounded text-gray-400 hover:text-hansl-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="이름 변경"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteView(v.id, v.name)}
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
