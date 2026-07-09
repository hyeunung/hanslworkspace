import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  PurchaseFilterRule, StoredPurchaseFilterRule, PurchaseAdvancedFilter,
  newPurchaseRuleId, toAdvancedFilters, defaultRuleForField, PurchaseOptionsKey,
} from '@/utils/purchaseTableFilters'
import { usePurchaseFilterViews, SavedPurchaseFilterView } from '@/hooks/usePurchaseFilterViews'

// 발주/구매 노션식 필터 상태 훅 — 규칙 CRUD + 저장뷰(DB) 오케스트레이션.
// 현재 규칙은 세션 전용(기존 발주 목록과 동일), 이름 붙인 저장 필터와 시작 기본값만 DB에 동기화된다.
// (제작현황 useProductionTableFilters의 규칙/저장뷰 부분을 발주 단일 표 기준으로 단순화)

const withNewIds = (rules: StoredPurchaseFilterRule[]): PurchaseFilterRule[] =>
  rules.map(r => ({ ...r, id: newPurchaseRuleId() }))

export function usePurchaseTableFilters(
  dynamicOptions: Partial<Record<PurchaseOptionsKey, string[]>>
) {
  const [rules, setRules] = useState<PurchaseFilterRule[]>([])
  const filterViews = usePurchaseFilterViews()

  // DB 로드 완료 시 시작 기본값 1회 적용 (없으면 빈 규칙 유지)
  const defaultAppliedRef = useRef(false)
  useEffect(() => {
    if (!filterViews.loaded || defaultAppliedRef.current) return
    defaultAppliedRef.current = true
    const def = filterViews.config.default
    if (def?.rules?.length) setRules(withNewIds(def.rules))
  }, [filterViews.loaded, filterViews.config.default])

  // 규칙 CRUD — 새 규칙은 '칼럼 선택' 상태(field='')로 추가되어 사용자가 칼럼부터 고른다
  const addRule = useCallback(() => {
    setRules(prev => [...prev, { id: newPurchaseRuleId(), field: '', op: 'contains', value: '' }])
  }, [])

  const updateRule = useCallback((id: string, patch: Partial<PurchaseFilterRule>) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  // 칼럼 변경 시 그 칼럼의 기본 조건/값으로 재설정
  const changeRuleField = useCallback((id: string, field: string) => {
    setRules(prev => prev.map(r =>
      r.id === id ? { id: r.id, ...defaultRuleForField(field, dynamicOptions) } : r))
  }, [dynamicOptions])

  const removeRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  const resetRules = useCallback(() => setRules([]), [])

  // 백엔드(applyAdvancedFilters)로 넘길 변환 결과 — 미완성 규칙은 자동 제외
  const advancedFilters: PurchaseAdvancedFilter[] = useMemo(() => toAdvancedFilters(rules), [rules])

  // ── 저장뷰 드롭다운 UI 상태 ──────────────────────────────────────────
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false)
  const [viewsAnchor, setViewsAnchor] = useState<HTMLElement | null>(null)
  const [namingView, setNamingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  const closeViewsMenu = useCallback(() => {
    setViewsMenuOpen(false)
    setViewsAnchor(null)
    setNamingView(false)
    setNewViewName('')
  }, [])

  const snapshotRules = useCallback((): StoredPurchaseFilterRule[] =>
    rules.filter(r => r.field).map(({ id: _id, ...rest }) => rest), [rules])

  const commitSaveView = useCallback(async () => {
    const name = newViewName.trim()
    if (!name) return
    const view: SavedPurchaseFilterView = { id: `v${Date.now()}`, name, rules: snapshotRules() }
    const ok = await filterViews.saveView(view)
    if (ok) toast.success(`필터 '${name}'을(를) 저장했습니다.`)
    else toast.error('필터 저장에 실패했습니다.')
    closeViewsMenu()
  }, [newViewName, snapshotRules, filterViews, closeViewsMenu])

  const handleApplyView = useCallback((viewId: string) => {
    const view = filterViews.config.views.find(v => v.id === viewId)
    if (!view) return
    setRules(withNewIds(view.rules))
    closeViewsMenu()
  }, [filterViews.config.views, closeViewsMenu])

  const handleRenameView = useCallback(async (viewId: string, prevName: string) => {
    const name = window.prompt('필터 이름 변경', prevName)?.trim()
    if (!name || name === prevName) return
    const ok = await filterViews.renameView(viewId, name)
    if (!ok) toast.error('이름 변경에 실패했습니다.')
  }, [filterViews])

  const handleDeleteView = useCallback(async (viewId: string, name: string) => {
    if (!window.confirm(`저장된 필터 '${name}'을(를) 삭제하시겠습니까?`)) return
    const ok = await filterViews.deleteView(viewId)
    if (ok) toast.success('저장된 필터를 삭제했습니다.')
    else toast.error('삭제에 실패했습니다.')
  }, [filterViews])

  const handleSetDefault = useCallback(async () => {
    const ok = await filterViews.setDefault({ rules: snapshotRules() })
    if (ok) toast.success('현재 필터를 시작 기본값으로 저장했습니다.')
    else toast.error('기본값 저장에 실패했습니다.')
  }, [filterViews, snapshotRules])

  const handleClearDefault = useCallback(async () => {
    const ok = await filterViews.setDefault(null)
    if (ok) toast.success('시작 기본값을 해제했습니다.')
    else toast.error('기본값 해제에 실패했습니다.')
  }, [filterViews])

  return {
    rules,
    setRules,
    advancedFilters,
    addRule,
    updateRule,
    changeRuleField,
    removeRule,
    resetRules,
    // 저장뷰
    filterViewsConfig: filterViews.config,
    viewsMenuOpen, setViewsMenuOpen,
    viewsAnchor, setViewsAnchor,
    namingView, setNamingView,
    newViewName, setNewViewName,
    closeViewsMenu,
    commitSaveView,
    handleApplyView,
    handleRenameView,
    handleDeleteView,
    handleSetDefault,
    handleClearDefault,
  }
}
