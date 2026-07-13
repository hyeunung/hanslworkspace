import React from 'react'
import { Bookmark, Check, ChevronDown, Edit2, Plus, RotateCcw, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import {
  RECEIPT_FILTER_FIELDS, ReceiptFilterRule, ReceiptFilterOp, ReceiptOptionsKey,
  receiptFieldDefFor, receiptFieldLabel, receiptOpLabel, opsForReceiptField,
  receiptSelectOptions, defaultReceiptRuleForField,
} from '@/utils/receiptTable'
import { ReceiptFilterConfig } from '@/hooks/useReceiptFilterViews'
import { measureText } from '@/utils/productionColumns'
import { AnchoredPortal } from '@/components/ui/AnchoredPortal'

interface ReceiptFilterToolbarProps {
  rules: ReceiptFilterRule[]
  dynamicOptions: Partial<Record<ReceiptOptionsKey, string[]>>
  years: number[]
  addRule: () => void
  updateRule: (id: string, patch: Partial<ReceiptFilterRule>) => void
  changeRuleField: (id: string, field: string) => void
  removeRule: (id: string) => void
  resetRules: () => void
  // 저장뷰 (useReceiptTableFilters에서 주입)
  filterViewsConfig: ReceiptFilterConfig
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

// 영수증 필터 툴바 (노션식 규칙 필터) — BomBoardFilterToolbar를 영수증 필드로 주입한 버전.
// 규칙 = [칼럼 ▾][조건 ▾][값 입력][×], 저장된 필터/기본값 메뉴 포함. 디자인·동작 동일.
export default function ReceiptFilterToolbar({
  rules, dynamicOptions, years: dataYears,
  addRule, updateRule, changeRuleField, removeRule, resetRules,
  filterViewsConfig, viewsMenuOpen, setViewsMenuOpen, viewsAnchor, setViewsAnchor,
  namingView, setNamingView, newViewName, setNewViewName, closeViewsMenu,
  commitSaveView, handleApplyView, handleRenameView, handleDeleteView,
  handleSetDefault, handleClearDefault,
}: ReceiptFilterToolbarProps) {
  const savedViews = filterViewsConfig.views
  const hasDefault = !!filterViewsConfig.default
  const selectClass = 'hansl-pill-select'
  const selectStyle: React.CSSProperties = {
    WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
    border: 'none', padding: 0, margin: 0, background: 'none', outline: 'none',
  }
  const fitSelect = (label: string, weight = 400): React.CSSProperties => ({
    ...selectStyle,
    width: `${Math.ceil(measureText(label, weight)) + 6}px`,
  })
  const pillInputStyle: React.CSSProperties = {
    border: 'none', borderBottom: '1px solid #d1d5db', boxShadow: 'none', background: 'none', outline: 'none',
  }

  // 조건 변경 시 새 조건에 맞는 값 필드로 보정
  const changeRuleOp = (rule: ReceiptFilterRule, op: ReceiptFilterOp) => {
    if (op === 'month_in') {
      updateRule(rule.id, { op, value: undefined, value2: undefined, year: rule.year ?? new Date().getFullYear(), month: rule.month ?? null })
      return
    }
    const def = receiptFieldDefFor(rule.field)
    const keepValue = def?.type === 'select' ? (rule.value ?? defaultReceiptRuleForField(rule.field, dynamicOptions).value) : ''
    updateRule(rule.id, { op, value: keepValue, value2: undefined, year: null, month: null })
  }

  return (
    <>
      <div className="grid grid-cols-[75px_minmax(0,1fr)] items-center gap-2 pt-2 border-t border-gray-100">
        <span className="hansl-filter-row-label">
          <SlidersHorizontal className="w-3.5 h-3.5" /> 조건:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {rules.map(rule => {
            const def = receiptFieldDefFor(rule.field)
            const ops = opsForReceiptField(rule.field)
            const years = rule.year != null && !dataYears.includes(rule.year)
              ? [rule.year, ...dataYears].sort((a, b) => b - a)
              : dataYears
            const selectOpts = def?.type === 'select' ? receiptSelectOptions(def, dynamicOptions) : []
            return (
              <div key={rule.id} className="hansl-filter-pill">
                <select
                  value={rule.field}
                  onChange={(e) => changeRuleField(rule.id, e.target.value)}
                  style={fitSelect(rule.field ? receiptFieldLabel(rule.field) : '칼럼 선택', 600)}
                  className={`${selectClass} font-semibold ${rule.field ? '' : 'text-hansl-500'}`}
                >
                  {!rule.field && <option value="" disabled>칼럼 선택</option>}
                  {RECEIPT_FILTER_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                {rule.field && (<>
                <span className="text-gray-300">·</span>
                <select
                  value={rule.op}
                  onChange={(e) => changeRuleOp(rule, e.target.value as ReceiptFilterOp)}
                  style={fitSelect(receiptOpLabel(rule.op))}
                  className={selectClass}
                >
                  {ops.map(op => (
                    <option key={op} value={op}>{receiptOpLabel(op)}</option>
                  ))}
                </select>
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
                {def?.type === 'text' && (rule.op === 'contains' || rule.op === 'equals' || rule.op === 'not_equals' || rule.op === 'starts_with' || rule.op === 'ends_with') && (
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
          <button type="button" onClick={addRule} className="hansl-chip-add">
            <Plus className="w-3 h-3" /> 필터
          </button>

          <div className="flex items-center gap-1.5 ml-4">
          <button
            type="button"
            onClick={(e) => {
              setNamingView(false); setNewViewName('')
              if (viewsMenuOpen) { setViewsMenuOpen(false); setViewsAnchor(null) }
              else { setViewsMenuOpen(true); setViewsAnchor(e.currentTarget) }
            }}
            className={`hansl-ctl-chip ${viewsMenuOpen ? 'hansl-toggle-on' : 'hansl-toggle-off'}`}
            title="저장된 필터 불러오기·저장"
          >
            <Bookmark className="w-3 h-3" />
            저장된 필터
            {savedViews.length > 0 && (
              <span className="hansl-ctl-count">({savedViews.length})</span>
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
      </div>

      {/* 저장된 필터 드롭다운 (body 포털) */}
      {viewsMenuOpen && viewsAnchor && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={closeViewsMenu} />
          <AnchoredPortal anchorEl={viewsAnchor} align="right" zIndex={9999}>
            <div className="hansl-popover rounded-lg py-1 w-[260px] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
              {namingView ? (
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
