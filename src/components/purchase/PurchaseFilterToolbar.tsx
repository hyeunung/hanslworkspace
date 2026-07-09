import React from 'react'
import { Bookmark, Check, ChevronDown, Edit2, Plus, RotateCcw, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import {
  PURCHASE_FILTER_FIELDS, PurchaseFilterRule, PurchaseFilterOp, PurchaseOptionsKey,
  purchaseFieldDefFor, purchaseFieldLabel, purchaseOpLabel, opsForPurchaseField,
  purchaseSelectOptions, defaultRuleForField,
} from '@/utils/purchaseTableFilters'
import { PurchaseFilterConfig } from '@/hooks/usePurchaseFilterViews'
import { measureText } from '@/utils/productionColumns'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

interface PurchaseFilterToolbarProps {
  rules: PurchaseFilterRule[]
  dynamicOptions: Partial<Record<PurchaseOptionsKey, string[]>>
  yearsFor: (dateField: string) => number[]
  addRule: () => void
  updateRule: (id: string, patch: Partial<PurchaseFilterRule>) => void
  changeRuleField: (id: string, field: string) => void
  removeRule: (id: string) => void
  resetRules: () => void
  // 저장뷰 (usePurchaseTableFilters에서 주입)
  filterViewsConfig: PurchaseFilterConfig
  viewsMenuOpen: boolean
  setViewsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  viewsAnchor: HTMLElement | null
  setViewsAnchor: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  namingView: boolean
  setNamingView: React.Dispatch<React.SetStateAction<boolean>>
  newViewName: string
  setNewViewName: React.Dispatch<React.SetStateAction<string>>
  closeViewsMenu: () => void
  commitSaveView: () => void
  handleApplyView: (viewId: string) => void
  handleRenameView: (viewId: string, prevName: string) => void
  handleDeleteView: (viewId: string, name: string) => void
  handleSetDefault: () => void
  handleClearDefault: () => void
}

// 발주/구매 필터 툴바 (노션식 규칙 필터) — 제작현황 ProductionFilterToolbar의 조건 Row를
// 발주 필드로 주입한 버전. 제작구분 칩 행은 발주에 없으므로 미구현(스펙 확정).
// 규칙 = [칼럼 ▾][조건 ▾][값 입력][×] 이며 노션처럼 추가/수정/제거 가능.
export default function PurchaseFilterToolbar({
  rules, dynamicOptions, yearsFor,
  addRule, updateRule, changeRuleField, removeRule, resetRules,
  filterViewsConfig, viewsMenuOpen, setViewsMenuOpen, viewsAnchor, setViewsAnchor,
  namingView, setNamingView, newViewName, setNewViewName, closeViewsMenu,
  commitSaveView, handleApplyView, handleRenameView, handleDeleteView,
  handleSetDefault, handleClearDefault,
}: PurchaseFilterToolbarProps) {
  const savedViews = filterViewsConfig.views
  const hasDefault = !!filterViewsConfig.default
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
  // 알약 안 밑줄형 입력 공통 스타일 (전역 input 박스 스타일 무력화)
  const pillInputStyle: React.CSSProperties = {
    border: 'none', borderBottom: '1px solid #d1d5db', boxShadow: 'none', background: 'none', outline: 'none',
  }

  // 조건 변경 시 새 조건에 맞는 값 필드로 보정
  const changeRuleOp = (rule: PurchaseFilterRule, op: PurchaseFilterOp) => {
    if (op === 'month_in') {
      updateRule(rule.id, { op, value: undefined, value2: undefined, year: rule.year ?? new Date().getFullYear(), month: rule.month ?? null })
      return
    }
    const def = purchaseFieldDefFor(rule.field)
    const keepValue = def?.type === 'select' ? (rule.value ?? defaultRuleForField(rule.field, dynamicOptions).value) : ''
    updateRule(rule.id, { op, value: keepValue, value2: undefined, year: null, month: null })
  }

  return (
    <>
      {/* 필터 규칙 행 (노션식 추가/수정/제거) */}
      <div className="grid grid-cols-[75px_minmax(0,1fr)_auto] items-center gap-2 pt-2 border-t border-gray-100">
        <span className="hansl-filter-row-label">
          <SlidersHorizontal className="w-3.5 h-3.5" /> 조건:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {rules.map(rule => {
            const def = purchaseFieldDefFor(rule.field)
            const ops = opsForPurchaseField(rule.field)
            const dataYears = yearsFor(rule.field)
            const years = rule.year != null && !dataYears.includes(rule.year)
              ? [rule.year, ...dataYears].sort((a, b) => b - a)
              : dataYears
            const selectOpts = def?.type === 'select' ? purchaseSelectOptions(def, dynamicOptions) : []
            return (
              <div key={rule.id} className="hansl-filter-pill">
                {/* 칼럼 선택 — 미선택 시 '칼럼 선택' 안내 문구, 고르기 전엔 조건/값 입력을 숨긴다 */}
                <select
                  value={rule.field}
                  onChange={(e) => changeRuleField(rule.id, e.target.value)}
                  style={fitSelect(rule.field ? purchaseFieldLabel(rule.field) : '칼럼 선택', 600)}
                  className={`${selectClass} font-semibold ${rule.field ? '' : 'text-hansl-500'}`}
                >
                  {!rule.field && <option value="" disabled>칼럼 선택</option>}
                  {PURCHASE_FILTER_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                {rule.field && (<>
                <span className="text-gray-300">·</span>
                {/* 조건 선택 */}
                <select
                  value={rule.op}
                  onChange={(e) => changeRuleOp(rule, e.target.value as PurchaseFilterOp)}
                  style={fitSelect(purchaseOpLabel(rule.op))}
                  className={selectClass}
                >
                  {ops.map(op => (
                    <option key={op} value={op}>{purchaseOpLabel(op)}</option>
                  ))}
                </select>
                {/* 조건별 값 입력: 셀렉트 / 년·월 / 기간 / 날짜 / 텍스트·숫자 */}
                {def?.type === 'select' && (rule.op === 'equals' || rule.op === 'not_equals') && (
                  <select
                    value={rule.value ?? ''}
                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    style={fitSelect(rule.value || '값 선택', 700)}
                    className={`${selectClass} text-hansl-500 font-bold`}
                  >
                    {!rule.value && <option value="" disabled>값 선택</option>}
                    {selectOpts.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                )}
                {rule.op === 'month_in' && (
                  <>
                    <select
                      value={rule.year ?? ''}
                      onChange={(e) => updateRule(rule.id, { year: e.target.value === '' ? null : Number(e.target.value) })}
                      style={fitSelect(rule.year != null ? `${rule.year}년` : '연도 선택', 700)}
                      className={`${selectClass} text-hansl-500 font-bold`}
                    >
                      {rule.year == null && <option value="" disabled>연도 선택</option>}
                      {years.map(y => (
                        <option key={y} value={y}>{y}년</option>
                      ))}
                    </select>
                    <select
                      value={rule.month ?? ''}
                      onChange={(e) => updateRule(rule.id, { month: e.target.value === '' ? null : Number(e.target.value) })}
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
                {rule.op === 'date_range' && (
                  <>
                    <input
                      type="date"
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                      className="hansl-pill-input"
                      style={{ ...pillInputStyle, width: '92px' }}
                    />
                    <span className="text-gray-400">~</span>
                    <input
                      type="date"
                      value={rule.value2 ?? ''}
                      onChange={(e) => updateRule(rule.id, { value2: e.target.value })}
                      className="hansl-pill-input"
                      style={{ ...pillInputStyle, width: '92px' }}
                    />
                  </>
                )}
                {(rule.op === 'after' || rule.op === 'before') && (
                  <input
                    type="date"
                    value={rule.value ?? ''}
                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    className="hansl-pill-input"
                    style={{ ...pillInputStyle, width: '92px' }}
                  />
                )}
                {def?.type === 'number' && (rule.op === 'equals' || rule.op === 'greater_than' || rule.op === 'less_than') && (
                  <input
                    type="number"
                    value={rule.value ?? ''}
                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    placeholder="값"
                    className="hansl-pill-input"
                    style={{ ...pillInputStyle, width: '72px' }}
                  />
                )}
                {def?.type === 'text' && (rule.op === 'contains' || rule.op === 'equals' || rule.op === 'starts_with' || rule.op === 'ends_with') && (
                  <input
                    type="text"
                    value={rule.value ?? ''}
                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    placeholder="값"
                    className="hansl-pill-input"
                    style={pillInputStyle}
                  />
                )}
                </>)}
                {/* 규칙 제거 */}
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  title="이 필터 제거"
                  className="hansl-close-btn"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          {/* 규칙 추가 */}
          <button type="button" onClick={addRule} className="hansl-chip-add">
            <Plus className="w-3 h-3" /> 필터
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* 저장된 필터(사용자별·장치 간 동기화) — 불러오기·저장·기본값 설정 */}
          <button
            type="button"
            onClick={(e) => {
              setNamingView(false); setNewViewName('')
              if (viewsMenuOpen) { setViewsMenuOpen(false); setViewsAnchor(null) }
              else { setViewsMenuOpen(true); setViewsAnchor(e.currentTarget) }
            }}
            className={`hansl-pill-btn ${viewsMenuOpen ? 'hansl-pill-btn-on' : 'hansl-pill-btn-off'}`}
            title="저장된 필터 불러오기·저장"
          >
            <Bookmark className="w-3 h-3" />
            저장된 필터
            {savedViews.length > 0 && (
              <span className="text-[9px] text-gray-400">({savedViews.length})</span>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          <div className="h-4 w-px bg-gray-300 mx-1.5" />
          <button
            type="button"
            onClick={resetRules}
            className="hansl-icon-btn hover:bg-gray-100 hover:text-red-600"
            title="필터 모두 제거"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 저장된 필터 드롭다운 — document.body로 포털해 카드 overflow에 잘리지 않게 띄운다 */}
      {viewsMenuOpen && viewsAnchor && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={closeViewsMenu} />
          <AnchoredPortal anchorEl={viewsAnchor} align="right" zIndex={9999}>
            <div className="hansl-popover rounded-lg py-1 w-[260px] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
              {/* 액션: 현재 필터 저장 / 기본값으로 저장 */}
              {namingView ? (
                // 인라인 이름 입력 — 클릭 즉시 모달 대신 이 입력창에서 이름을 정한다
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitSaveView() }
                      else if (e.key === 'Escape') { setNamingView(false); setNewViewName('') }
                    }}
                    placeholder="필터 이름 입력 후 Enter"
                    className="flex-1 min-w-0 h-[24px] px-2 text-[11px] border border-gray-300 rounded focus:outline-none focus:border-hansl-500"
                  />
                  <button
                    type="button"
                    onClick={commitSaveView}
                    disabled={!newViewName.trim()}
                    className="shrink-0 px-2 h-[24px] rounded text-[11px] text-white bg-hansl-500 hover:bg-hansl-600 disabled:bg-gray-300 transition-colors"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNamingView(false); setNewViewName('') }}
                    className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600"
                    title="취소"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setNamingView(true); setNewViewName('') }}
                  className="hansl-menu-item"
                >
                  <Bookmark className="w-3.5 h-3.5 text-hansl-500" /> 현재 필터를 이름 붙여 저장
                </button>
              )}
              <button
                type="button"
                onClick={() => { handleSetDefault(); closeViewsMenu() }}
                className="hansl-menu-item"
              >
                <Star className="w-3.5 h-3.5 text-amber-500" /> 현재 필터를 시작 기본값으로
              </button>
              {hasDefault && (
                <button
                  type="button"
                  onClick={() => { handleClearDefault(); closeViewsMenu() }}
                  className="hansl-menu-item text-gray-500"
                >
                  <X className="w-3.5 h-3.5" /> 시작 기본값 해제
                </button>
              )}

              <div className="my-1 border-t border-gray-100" />
              <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase">
                저장된 필터 {savedViews.length > 0 && `(${savedViews.length})`}
              </div>
              {savedViews.length === 0 ? (
                <div className="px-3 py-2 text-[10px] text-gray-400">저장된 필터가 없습니다.</div>
              ) : (
                <div className="max-h-[240px] overflow-y-auto">
                  {savedViews.map(v => (
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
