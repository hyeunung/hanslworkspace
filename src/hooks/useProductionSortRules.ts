import { useState } from 'react'
import {
  SortRule, loadTableSort, sortStorageKey, newSortId, PCB_SORT_FIELDS, CABLE_SORT_FIELDS,
} from '@/utils/productionSort'

// ─── 제작현황 정렬 상태 훅 ────────────────────────────────────────────
// 정렬 상태 — PCB/Cable 독립. 저장된 정렬이 있으면 처음부터 반영하고, 변경 시 즉시 localStorage에 보존.
// ProductionListMain.tsx에서 분리 — 동작 동일.
export function useProductionSortRules() {
  const [pcbSort, setPcbSort] = useState<SortRule[]>(() => loadTableSort('pcb'))
  const [cableSort, setCableSort] = useState<SortRule[]>(() => loadTableSort('cable'))
  const [sortMenuFor, setSortMenuFor] = useState<'pcb' | 'cable' | null>(null)
  const sortFor = (type: 'pcb' | 'cable') => (type === 'pcb' ? pcbSort : cableSort)
  // 정렬 규칙 갱신 + 즉시 저장 (updater로 이전값 기반 안전 갱신)
  const commitSort = (type: 'pcb' | 'cable', updater: (prev: SortRule[]) => SortRule[]) => {
    const setter = type === 'pcb' ? setPcbSort : setCableSort
    setter(prev => {
      const next = updater(prev)
      try {
        localStorage.setItem(sortStorageKey(type), JSON.stringify(next.map(r => ({ field: r.field, dir: r.dir }))))
      } catch { /* ignore quota */ }
      return next
    })
  }
  const addSortRule = (type: 'pcb' | 'cable') => {
    const fields = type === 'pcb' ? PCB_SORT_FIELDS : CABLE_SORT_FIELDS
    commitSort(type, prev => {
      const used = new Set(prev.map(r => r.field))
      const field = fields.find(f => !used.has(f)) ?? fields[0]
      return [...prev, { id: newSortId(), field, dir: 'asc' }]
    })
  }
  const updateSortRule = (type: 'pcb' | 'cable', id: string, patch: Partial<SortRule>) =>
    commitSort(type, prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const removeSortRule = (type: 'pcb' | 'cable', id: string) =>
    commitSort(type, prev => prev.filter(r => r.id !== id))
  const clearSort = (type: 'pcb' | 'cable') => commitSort(type, () => [])

  return {
    pcbSort, cableSort, sortMenuFor, setSortMenuFor, sortFor,
    commitSort, addSortRule, updateSortRule, removeSortRule, clearSort,
  }
}
