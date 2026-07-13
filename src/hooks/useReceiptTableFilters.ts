import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  ReceiptFilterRule, StoredReceiptFilterRule, ReceiptOptionsKey,
  newReceiptRuleId, defaultReceiptRuleForField,
} from '@/utils/receiptTable'
import { useReceiptFilterViews, SavedReceiptFilterView } from '@/hooks/useReceiptFilterViews'

// 영수증 노션식 필터 상태 훅 — 규칙 CRUD + 저장뷰(DB) 오케스트레이션.
// useBomBoardTableFilters와 동일 골격 (규칙은 세션 전용, 저장 필터/기본값만 DB 동기화).

const withNewIds = (rules: StoredReceiptFilterRule[]): ReceiptFilterRule[] =>
  rules.map(r => ({ ...r, id: newReceiptRuleId() }))

export function useReceiptTableFilters(
  dynamicOptions: Partial<Record<ReceiptOptionsKey, string[]>>
) {
  const [rules, setRules] = useState<ReceiptFilterRule[]>([])
  const filterViews = useReceiptFilterViews()

  // DB 로드 완료 시 시작 기본값 1회 적용
  const defaultAppliedRef = useRef(false)
  useEffect(() => {
    if (!filterViews.loaded || defaultAppliedRef.current) return
    defaultAppliedRef.current = true
    const def = filterViews.config.default
    if (def?.rules?.length) setRules(withNewIds(def.rules))
  }, [filterViews.loaded, filterViews.config.default])

  const addRule = useCallback(() => {
    setRules(prev => [...prev, { id: newReceiptRuleId(), field: '', op: 'contains', value: '' }])
  }, [])

  const updateRule = useCallback((id: string, patch: Partial<ReceiptFilterRule>) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const changeRuleField = useCallback((id: string, field: string) => {
    setRules(prev => prev.map(r =>
      r.id === id ? { id: r.id, ...defaultReceiptRuleForField(field, dynamicOptions) } : r))
  }, [dynamicOptions])

  const removeRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  const resetRules = useCallback(() => setRules([]), [])

  // 적용 대상 규칙 (칼럼이 선택된 것만)
  const activeRules = useMemo(() => rules.filter(r => r.field), [rules])

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

  const snapshotRules = useCallback((): StoredReceiptFilterRule[] =>
    rules.filter(r => r.field).map(({ id: _id, ...rest }) => rest), [rules])

  // 저장 중 재클릭/Enter 연타로 중복 저장되는 것 가드, 같은 이름 중복 거부
  const savingViewRef = useRef(false)
  const commitSaveView = useCallback(async () => {
    const name = newViewName.trim()
    if (!name || savingViewRef.current) return
    if (filterViews.config.views.some(v => v.name === name)) {
      toast.error(`'${name}' 이름의 저장된 필터가 이미 있습니다.`)
      return
    }
    savingViewRef.current = true
    closeViewsMenu()
    try {
      const view: SavedReceiptFilterView = {
        id: `v${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, rules: snapshotRules(),
      }
      const ok = await filterViews.saveView(view)
      if (ok) toast.success(`필터 '${name}'을(를) 저장했습니다.`)
      else toast.error('필터 저장에 실패했습니다.')
    } finally {
      savingViewRef.current = false
    }
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
    activeRules,
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
