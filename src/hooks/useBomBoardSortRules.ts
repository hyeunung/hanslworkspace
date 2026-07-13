import { useState, useCallback } from 'react'
import {
  BomBoardSortRule, BOM_BOARD_SORT_FIELDS, BOM_BOARD_SORT_STORAGE_KEY,
  loadBomBoardSortRules, newBomBoardSortId,
} from '@/utils/bomBoardTable'

// 보드별 정리 다중 정렬 상태 훅 — 변경 즉시 localStorage 자동 저장 (usePurchaseSortRules 패턴)

const persist = (rules: BomBoardSortRule[]) => {
  try {
    localStorage.setItem(
      BOM_BOARD_SORT_STORAGE_KEY,
      JSON.stringify(rules.map(r => ({ field: r.field, dir: r.dir })))
    )
  } catch { /* 저장 실패는 무시 */ }
}

export function useBomBoardSortRules() {
  const [sortRules, setSortRules] = useState<BomBoardSortRule[]>(() => loadBomBoardSortRules())

  const apply = useCallback((updater: (prev: BomBoardSortRule[]) => BomBoardSortRule[]) => {
    setSortRules(prev => {
      const next = updater(prev)
      persist(next)
      return next
    })
  }, [])

  const addSortRule = useCallback(() => {
    apply(prev => {
      const used = new Set(prev.map(r => r.field))
      const nextField = BOM_BOARD_SORT_FIELDS.find(f => !used.has(f.key))
      if (!nextField) return prev
      return [...prev, { id: newBomBoardSortId(), field: nextField.key, dir: 'asc' }]
    })
  }, [apply])

  const updateSortRule = useCallback((id: string, patch: Partial<BomBoardSortRule>) => {
    apply(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [apply])

  const removeSortRule = useCallback((id: string) => {
    apply(prev => prev.filter(r => r.id !== id))
  }, [apply])

  const clearSort = useCallback(() => {
    apply(() => [])
  }, [apply])

  return { sortRules, addSortRule, updateSortRule, removeSortRule, clearSort }
}
