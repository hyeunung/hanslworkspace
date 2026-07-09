import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useProductionFilterViews, FilterDefaultSnapshot } from '@/hooks/useProductionFilterViews'
import {
  TableFilter, FilterRule, loadTableFilter, filterStorageKey, CATEGORY_ORDER_STORAGE_KEY,
  categoryOrderIsDefault, restoreCategoryOrder, rulesEqualDefault, catsEqualDefault,
  toStoredRules, fromStoredRules, PCB_CATEGORIES, CABLE_CATEGORIES, DEFAULT_CATEGORY_ORDER,
  defaultRules, newRuleId,
} from '@/utils/productionFilters'

// ─── 제작현황 필터 상태 훅 ────────────────────────────────────────────
// PCB/Cable 테이블별 독립 필터(노션식 규칙 + 제작구분 칩) + 통합 검색어 +
// 저장 필터(사용자별 DB 동기화) + 제작구분 칩 드래그 순서 + 패널 접기 상태.
// ProductionListMain.tsx에서 분리 — 동작 동일.

// 필터 "저장됨" 상태 — 조건(규칙) 필터와 제작구분 필터는 서로 독립적으로 저장/초기화된다.
// 표(pcb/cable) × 섹션(rules/cats)별로 저장 이력(hasSaved)과 변경 여부(dirty)를 따로 추적한다.
// 저장됨 = 저장 이력 있음 && 저장 이후 그 섹션을 건드리지 않음.
type FilterSectionFlags = { pcb: { rules: boolean; cats: boolean }; cable: { rules: boolean; cats: boolean } }

export function useProductionTableFilters() {
  // 필터 및 검색 상태 — PCB/Cable 테이블별 독립 필터 (저장된 필터가 있으면 처음부터 반영)
  // 검색어도 필터·정렬·칼럼 설정과 마찬가지로 테이블별 독립 (PCB표 검색은 PCB표에만 적용)
  const [pcbSearch, setPcbSearch] = useState('')
  const [cableSearch, setCableSearch] = useState('')
  const [pcbFilter, setPcbFilter] = useState<TableFilter>(() => loadTableFilter('pcb'))
  const [cableFilter, setCableFilter] = useState<TableFilter>(() => loadTableFilter('cable'))

  const [filterHasSaved, setFilterHasSaved] = useState<FilterSectionFlags>(() => {
    // 파랑(저장됨) = 기본값과 "다른" 내용이 저장돼 있을 때만. 키가 있어도 내용이 기본값이면 흰색.
    const calc = (type: 'pcb' | 'cable') => {
      if (localStorage.getItem(filterStorageKey(type)) === null) return { rules: false, cats: false }
      const f = loadTableFilter(type)
      const orderCustom = !categoryOrderIsDefault(restoreCategoryOrder())
      return {
        rules: !rulesEqualDefault(type, f.rules),
        cats: !catsEqualDefault(type, f.categories) || orderCustom,
      }
    }
    return { pcb: calc('pcb'), cable: calc('cable') }
  })
  const [filterDirty, setFilterDirty] = useState<FilterSectionFlags>(() => ({
    pcb: { rules: false, cats: false }, cable: { rules: false, cats: false },
  }))
  const markFilterDirty = (type: 'pcb' | 'cable', section: 'rules' | 'cats') =>
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], [section]: true } }))

  const filterFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbFilter : cableFilter)
  const setFilterFor = (type: 'pcb' | 'cable', patch: Partial<TableFilter>) => {
    if (type === 'pcb') setPcbFilter(prev => ({ ...prev, ...patch }))
    else setCableFilter(prev => ({ ...prev, ...patch }))
    // 패치 내용에 따라 해당 섹션만 dirty 처리 (규칙 vs 제작구분)
    if ('rules' in patch) markFilterDirty(type, 'rules')
    if ('categories' in patch) markFilterDirty(type, 'cats')
  }

  // 카테고리 필터 토글 (테이블별)
  const toggleCategory = (type: 'pcb' | 'cable', cat: string) => {
    const cur = filterFor(type).categories
    setFilterFor(type, {
      categories: cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat],
    })
  }

  // 제작구분 그룹 순서 — 저장된 순서가 있으면 반영하고, 누락된 기본 카테고리는 뒤에 보강
  const [categoryOrder, setCategoryOrder] = useState<string[]>(restoreCategoryOrder)

  // ─── 저장 필터(사용자별·DB 동기화) ───────────────────────────────────
  // user_ui_settings에 저장된 "이름 붙인 필터 목록"과 "표별 시작 기본값"을 관리한다.
  // 로컬스토리지 초기화로 즉시 렌더한 뒤, DB 설정이 로드되면 기본값을 한 번 적용해 장치 간 동기화한다.
  const { config: filterViewsConfig, loaded: filterViewsLoaded, saveView, deleteView, renameView, setDefault } = useProductionFilterViews()
  const defaultsAppliedRef = useRef(false)
  const [viewsMenuFor, setViewsMenuFor] = useState<'pcb' | 'cable' | null>(null)
  const [viewsAnchor, setViewsAnchor] = useState<HTMLElement | null>(null)
  // 저장 필터 이름 인라인 입력 모드 — window.prompt 대신 드롭다운 안 입력창으로 이름을 정한다
  const [namingViewFor, setNamingViewFor] = useState<'pcb' | 'cable' | null>(null)
  const [newViewName, setNewViewName] = useState('')

  // 표별 스냅샷(현재 조건+제작구분+그룹순서)을 만든다 — 저장 필터/기본값 공통 payload
  const snapshotFilter = (type: 'pcb' | 'cable'): FilterDefaultSnapshot => {
    const cur = filterFor(type)
    return { rules: toStoredRules(cur.rules), categories: [...cur.categories], categoryOrder: [...categoryOrder] }
  }

  // 스냅샷을 화면/로컬스토리지에 적용한다 (저장 필터 불러오기·기본값 적용 공통 경로)
  const applySnapshot = (type: 'pcb' | 'cable', snap: FilterDefaultSnapshot) => {
    const rules = fromStoredRules(snap.rules)
    const validCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
    const categories = Array.isArray(snap.categories) ? snap.categories.filter(c => validCats.includes(c)) : validCats
    setFilterFor(type, { rules, categories })
    if (Array.isArray(snap.categoryOrder) && snap.categoryOrder.length) {
      const merged = snap.categoryOrder.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
      for (const c of DEFAULT_CATEGORY_ORDER) if (!merged.includes(c)) merged.push(c)
      setCategoryOrder(merged)
      try { localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(merged)) } catch { /* ignore */ }
    }
    // 로컬스토리지에도 반영해 새로고침·아이콘 상태를 일관되게 유지
    try {
      localStorage.setItem(filterStorageKey(type), JSON.stringify({ categories, rules }))
    } catch { /* ignore quota */ }
  }

  // DB에 저장된 시작 기본값을 최초 1회 적용 (로컬 초기 렌더 이후 동기화)
  useEffect(() => {
    if (!filterViewsLoaded || defaultsAppliedRef.current) return
    defaultsAppliedRef.current = true
    ;(['pcb', 'cable'] as const).forEach(type => {
      const snap = filterViewsConfig.defaults[type]
      if (!snap) return
      applySnapshot(type, snap)
      // 지금 화면이 곧 '시작 기본값'(기준값)이므로 변경 안 함 + 저장됨(파랑) 표시 안 함
      // — 사용자가 정한 기본값 자체는 '저장 표시' 대상이 아니다
      setFilterHasSaved(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterViewsLoaded, filterViewsConfig])

  // 현재 필터를 이름 붙여 저장 (무제한) — 인라인 입력창에서 확정된 이름으로 저장
  const commitSaveView = async (type: 'pcb' | 'cable') => {
    const name = newViewName.trim()
    if (!name) return
    const view = { id: `v${Date.now()}`, name, scope: type, ...snapshotFilter(type) }
    const ok = await saveView(view)
    toast[ok ? 'success' : 'error'](ok ? `필터 "${name}" 저장됨` : '필터 저장에 실패했습니다.')
    if (ok) {
      setNamingViewFor(null)
      setNewViewName('')
      setViewsMenuFor(null)
      setViewsAnchor(null)
    }
  }

  // 저장 필터 불러오기
  const handleApplyView = (viewId: string) => {
    const v = filterViewsConfig.views.find(x => x.id === viewId)
    if (!v) return
    applySnapshot(v.scope, { rules: v.rules, categories: v.categories, categoryOrder: v.categoryOrder })
    setViewsMenuFor(null)
    toast.success(`필터 "${v.name}" 적용됨`)
  }

  const handleDeleteView = async (viewId: string, name: string) => {
    const ok = await deleteView(viewId)
    toast[ok ? 'success' : 'error'](ok ? `필터 "${name}" 삭제됨` : '삭제에 실패했습니다.')
  }

  const handleRenameView = async (viewId: string, prevName: string) => {
    const name = window.prompt('필터 이름 변경', prevName)?.trim()
    if (!name || name === prevName) return
    const ok = await renameView(viewId, name)
    toast[ok ? 'success' : 'error'](ok ? '이름이 변경되었습니다.' : '이름 변경에 실패했습니다.')
  }

  // 현재 필터를 시작 기본값으로 저장 (다음 접속 시 이 필터로 시작 — 장치 간 동기화)
  const handleSetDefault = async (type: 'pcb' | 'cable') => {
    const ok = await setDefault(type, snapshotFilter(type))
    if (ok) {
      // 로컬스토리지 기본값도 갱신. 현재 필터가 곧 '기준값'이 됐으므로
      // 저장됨(파랑)·변경 표시 모두 끈다 — 기본값 자체는 '저장 표시' 대상이 아니다
      applySnapshot(type, snapshotFilter(type))
      setFilterHasSaved(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { rules: false, cats: false } }))
    }
    toast[ok ? 'success' : 'error'](ok ? '현재 필터를 기본값으로 저장했습니다.' : '기본값 저장에 실패했습니다.')
  }

  const handleClearDefault = async (type: 'pcb' | 'cable') => {
    const ok = await setDefault(type, null)
    toast[ok ? 'info' : 'error'](ok ? '시작 기본값을 해제했습니다.' : '해제에 실패했습니다.')
  }

  // 필터 패널 접기/펴기 (좌측 사이드바처럼) — 기본값은 '닫힘', 사용자가 명시적으로 '0'(펼침) 저장 시에만 펼침
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => localStorage.getItem('hansl_prod_filter_collapsed') !== '0')
  // Cable 테이블 필터 자체 접기 (상단 패널과 독립)
  const [cableFilterCollapsed, setCableFilterCollapsed] = useState<boolean>(() => localStorage.getItem('hansl_prod_filter_collapsed_cable') !== '0')
  const toggleCableFilterCollapsed = () => setCableFilterCollapsed(prev => {
    const next = !prev
    localStorage.setItem('hansl_prod_filter_collapsed_cable', next ? '1' : '0')
    return next
  })
  const toggleFilterCollapsed = () => setFilterCollapsed(prev => {
    const next = !prev
    localStorage.setItem('hansl_prod_filter_collapsed', next ? '1' : '0')
    return next
  })

  // 드래그 중인 칩 (ref: 드롭 핸들러의 최신값 보장 / state: 시각 표시용)
  const dragCatRef = useRef<string | null>(null)
  const [dragCat, setDragCat] = useState<string | null>(null)
  // 삽입 지점 (0 = 맨 앞, N = 맨 뒤) + 어느 테이블 툴바인지. 칩 사이에 세로 표시선으로 보여줌
  const [dropIndex, setDropIndex] = useState<{ type: 'pcb' | 'cable'; index: number } | null>(null)
  // 툴바가 PCB/Cable 두 벌이라 칩 컨테이너 ref도 테이블별로 관리
  const pcbChipContainerRef = useRef<HTMLDivElement>(null)
  const cableChipContainerRef = useRef<HTMLDivElement>(null)
  const chipRefFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbChipContainerRef : cableChipContainerRef)

  // 커서 X좌표 기준으로 "칩과 칩 사이" 어느 지점에 꽂힐지 인덱스 계산 (빈 간격에 놔도 인식됨)
  const computeDropIndex = (type: 'pcb' | 'cable', clientX: number): number => {
    const container = chipRefFor(type).current
    if (!container) return 0
    const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-cat]'))
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return chips.length
  }

  // 드래그한 칩을 계산된 삽입 지점으로 이동 (제거로 인한 인덱스 밀림 보정)
  // index는 "해당 테이블 칩 목록 내" 인덱스 — 전역 categoryOrder에서 그 테이블 슬롯만 새 순서로 치환
  const dropCategoryAt = (type: 'pcb' | 'cable', index: number) => {
    const from = dragCatRef.current
    if (!from) return
    setCategoryOrder(prev => {
      const cats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
      const sub = prev.filter(c => cats.includes(c))
      const fromIdx = sub.indexOf(from)
      if (fromIdx < 0) return prev
      const arr = [...sub]
      arr.splice(fromIdx, 1)
      let target = index
      if (fromIdx < index) target -= 1
      target = Math.max(0, Math.min(arr.length, target))
      arr.splice(target, 0, from)
      let k = 0
      return prev.map(c => (cats.includes(c) ? arr[k++] : c))
    })
    markFilterDirty(type, 'cats')
  }

  // 포인터 기반 드래그 — 네이티브 HTML5 DnD 대신 pointermove/up으로 직접 처리 (실사용/검증 모두 안정적)
  const dragStartXRef = useRef(0)
  const dragMovedRef = useRef(false)
  const DRAG_THRESHOLD = 4 // px 이상 움직이면 드래그, 아니면 클릭(선택 토글)로 간주

  const handleChipPointerDown = (e: React.PointerEvent<HTMLButtonElement>, cat: string, type: 'pcb' | 'cable') => {
    if (e.button !== 0) return
    dragCatRef.current = cat
    dragStartXRef.current = e.clientX
    dragMovedRef.current = false
    setDragCat(cat)

    const onMove = (ev: PointerEvent) => {
      if (!dragCatRef.current) return
      if (!dragMovedRef.current && Math.abs(ev.clientX - dragStartXRef.current) < DRAG_THRESHOLD) return
      dragMovedRef.current = true
      setDropIndex({ type, index: computeDropIndex(type, ev.clientX) })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragMovedRef.current) {
        dropCategoryAt(type, computeDropIndex(type, ev.clientX)) // 놓은 자리에 삽입
      } else if (dragCatRef.current) {
        toggleCategory(type, dragCatRef.current)                  // 안 움직였으면 클릭 = 표시 토글
      }
      dragCatRef.current = null
      dragMovedRef.current = false
      setDragCat(null)
      setDropIndex(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 저장된 필터 JSON을 읽어 오되 형식이 깨졌으면 빈 객체
  const readStoredFilter = (type: 'pcb' | 'cable'): any => {
    try { return JSON.parse(localStorage.getItem(filterStorageKey(type)) || '{}') } catch { return {} }
  }

  // 조건(규칙) 필터만 저장 — 같은 키의 제작구분(categories)은 기존 저장값 보존
  const saveRulesFilter = (type: 'pcb' | 'cable') => {
    const cur = filterFor(type)
    const stored = readStoredFilter(type)
    localStorage.setItem(filterStorageKey(type), JSON.stringify({
      categories: Array.isArray(stored.categories) ? stored.categories : cur.categories,
      rules: cur.rules,
    }))
    // 기본값 그대로 저장한 경우엔 파랑 표시 안 함 (파랑 = 기본값에서 바꿔 저장한 상태)
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: !rulesEqualDefault(type, cur.rules) } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    toast.success('조건 필터가 저장되었습니다.')
  }

  // 제작구분 필터만 저장 — 같은 키의 규칙(rules)은 기존 저장값 보존 + 그룹 순서 저장
  const saveCategoryFilter = (type: 'pcb' | 'cable') => {
    const cur = filterFor(type)
    const stored = readStoredFilter(type)
    localStorage.setItem(filterStorageKey(type), JSON.stringify({
      categories: cur.categories,
      rules: Array.isArray(stored.rules) ? stored.rules : cur.rules,
    }))
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(categoryOrder))
    // 기본값 그대로(전체 선택 + 기본 순서) 저장한 경우엔 파랑 표시 안 함
    const catsCustom = !catsEqualDefault(type, cur.categories) || !categoryOrderIsDefault(categoryOrder)
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: catsCustom } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    toast.success('제작구분 필터가 저장되었습니다.')
  }

  const handleResetRules = (type: 'pcb' | 'cable') => {
    // 시작 기본값을 저장해 뒀으면 코드 기본값이 아니라 그 저장된 기본값으로 되돌린다
    const savedDefault = filterViewsConfig.defaults[type]
    if (savedDefault) {
      const rules = fromStoredRules(savedDefault.rules)
      setFilterFor(type, { rules })
      const stored = readStoredFilter(type)
      const cats = Array.isArray(stored.categories) ? stored.categories : (type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES])
      localStorage.setItem(filterStorageKey(type), JSON.stringify({ categories: cats, rules }))
      // 시작 기본값으로 되돌렸으니 현재 = 기준값 → 저장됨(파랑) 표시 안 함
      setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
      toast.info('저장된 시작 기본값으로 초기화되었습니다.')
      return
    }
    // 기본 세팅 = 입고대기 + 요청일 현재 년도(월 전체)
    setFilterFor(type, { rules: defaultRules(type) })
    // 저장본의 규칙도 기본값으로 되돌림 — 안 그러면 새로고침 시 이전 저장 규칙이 되살아나고 아이콘도 다시 파랑이 됨
    const stored = readStoredFilter(type)
    const catsStillCustom = Array.isArray(stored.categories) && !catsEqualDefault(type, stored.categories)
    if (catsStillCustom) {
      localStorage.setItem(filterStorageKey(type), JSON.stringify({ categories: stored.categories, rules: defaultRules(type) }))
    } else {
      localStorage.removeItem(filterStorageKey(type))
    }
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], rules: false } }))
    toast.info('필터가 기본값으로 초기화되었습니다.')
  }

  const handleResetCategoryFilter = (type: 'pcb' | 'cable') => {
    // 시작 기본값을 저장해 뒀으면 그 저장된 제작구분/그룹순서로 되돌린다
    const savedDefault = filterViewsConfig.defaults[type]
    if (savedDefault) {
      const validCats = type === 'pcb' ? PCB_CATEGORIES : CABLE_CATEGORIES
      const cats = Array.isArray(savedDefault.categories) ? savedDefault.categories.filter(c => validCats.includes(c)) : [...validCats]
      setFilterFor(type, { categories: cats })
      let order = categoryOrder
      if (Array.isArray(savedDefault.categoryOrder) && savedDefault.categoryOrder.length) {
        order = savedDefault.categoryOrder.filter(c => DEFAULT_CATEGORY_ORDER.includes(c))
        for (const c of DEFAULT_CATEGORY_ORDER) if (!order.includes(c)) order.push(c)
        setCategoryOrder(order)
        localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(order))
      }
      const stored = readStoredFilter(type)
      const rules = Array.isArray(stored.rules) ? stored.rules : filterFor(type).rules
      localStorage.setItem(filterStorageKey(type), JSON.stringify({ categories: cats, rules }))
      // 시작 기본값으로 되돌렸으니 현재 = 기준값 → 저장됨(파랑) 표시 안 함
      setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
      setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
      toast.info('저장된 시작 기본값으로 초기화되었습니다.')
      return
    }
    setFilterFor(type, { categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES] })
    setCategoryOrder([...DEFAULT_CATEGORY_ORDER])
    // 저장본의 제작구분/그룹순서도 기본값으로 되돌림 (규칙이 커스텀이면 규칙만 보존)
    localStorage.removeItem(CATEGORY_ORDER_STORAGE_KEY)
    const stored = readStoredFilter(type)
    const rulesStillCustom = Array.isArray(stored.rules) && !rulesEqualDefault(type, stored.rules)
    if (rulesStillCustom) {
      localStorage.setItem(filterStorageKey(type), JSON.stringify({
        categories: type === 'pcb' ? [...PCB_CATEGORIES] : [...CABLE_CATEGORIES],
        rules: stored.rules,
      }))
    } else {
      localStorage.removeItem(filterStorageKey(type))
    }
    setFilterHasSaved(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    setFilterDirty(prev => ({ ...prev, [type]: { ...prev[type], cats: false } }))
    toast.info('제작구분 필터가 초기화되었습니다.')
  }

  // 필터 규칙 조작 (노션식 추가/수정/제거)
  const addRule = (type: 'pcb' | 'cable') => {
    const f = filterFor(type)
    // 칼럼 미선택 상태로 시작 — 사용자가 '칼럼 선택'에서 직접 고르게 한다 (임의로 보드명이 잡히지 않도록)
    setFilterFor(type, { rules: [...f.rules, { id: newRuleId(), field: '', op: 'contains', value: '' }] })
  }
  const updateRule = (type: 'pcb' | 'cable', id: string, patch: Partial<FilterRule>) => {
    const f = filterFor(type)
    setFilterFor(type, { rules: f.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) })
  }
  const removeRule = (type: 'pcb' | 'cable', id: string) => {
    const f = filterFor(type)
    setFilterFor(type, { rules: f.rules.filter(r => r.id !== id) })
  }

  return {
    pcbSearch, setPcbSearch, cableSearch, setCableSearch,
    pcbFilter, cableFilter, filterHasSaved, filterDirty, markFilterDirty, filterFor, setFilterFor,
    toggleCategory, categoryOrder,
    filterViewsConfig, viewsMenuFor, setViewsMenuFor, viewsAnchor, setViewsAnchor,
    namingViewFor, setNamingViewFor, newViewName, setNewViewName,
    snapshotFilter, applySnapshot, commitSaveView, handleApplyView, handleDeleteView, handleRenameView, handleSetDefault, handleClearDefault,
    filterCollapsed, toggleFilterCollapsed, cableFilterCollapsed, toggleCableFilterCollapsed,
    dragCat, dropIndex, chipRefFor, handleChipPointerDown,
    saveRulesFilter, saveCategoryFilter, handleResetRules, handleResetCategoryFilter,
    addRule, updateRule, removeRule,
  }
}
