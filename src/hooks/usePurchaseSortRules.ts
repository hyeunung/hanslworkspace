import { useState, useCallback } from 'react'
import {
  PurchaseSortRule, PURCHASE_SORT_FIELDS, PURCHASE_SORT_STORAGE_KEY,
  loadPurchaseSortRules, newPurchaseSortId,
} from '@/utils/purchaseTableSort'

// 발주/구매 다중 정렬 상태 훅 — 변경 즉시 localStorage에 자동 저장 (제작현황 useProductionSortRules 패턴)

const persist = (rules: PurchaseSortRule[]) => {
  try {
    localStorage.setItem(
      PURCHASE_SORT_STORAGE_KEY,
      JSON.stringify(rules.map(r => ({ field: r.field, dir: r.dir })))
    )
  } catch { /* 저장 실패는 무시 (다음 세션에서 기본값) */ }
}

export function usePurchaseSortRules() {
  const [sortRules, setSortRules] = useState<PurchaseSortRule[]>(() => loadPurchaseSortRules())

  const apply = useCallback((updater: (prev: PurchaseSortRule[]) => PurchaseSortRule[]) => {
    setSortRules(prev => {
      const next = updater(prev)
      persist(next)
      return next
    })
  }, [])

  // 아직 사용하지 않은 칼럼 중 첫 번째로 규칙 추가
  const addSortRule = useCallback(() => {
    apply(prev => {
      const used = new Set(prev.map(r => r.field))
      const nextField = PURCHASE_SORT_FIELDS.find(f => !used.has(f.key))
      if (!nextField) return prev
      return [...prev, { id: newPurchaseSortId(), field: nextField.key, dir: 'asc' }]
    })
  }, [apply])

  const updateSortRule = useCallback((id: string, patch: Partial<PurchaseSortRule>) => {
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
