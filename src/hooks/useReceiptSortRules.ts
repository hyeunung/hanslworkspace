import { useState, useCallback } from 'react'
import {
  ReceiptSortRule, RECEIPT_SORT_FIELDS, RECEIPT_SORT_STORAGE_KEY,
  loadReceiptSortRules, newReceiptSortId,
} from '@/utils/receiptTable'

// 영수증 다중 정렬 상태 훅 — 변경 즉시 localStorage 자동 저장 (useBomBoardSortRules 패턴)

const persist = (rules: ReceiptSortRule[]) => {
  try {
    localStorage.setItem(
      RECEIPT_SORT_STORAGE_KEY,
      JSON.stringify(rules.map(r => ({ field: r.field, dir: r.dir })))
    )
  } catch { /* 저장 실패는 무시 */ }
}

export function useReceiptSortRules() {
  const [sortRules, setSortRules] = useState<ReceiptSortRule[]>(() => loadReceiptSortRules())

  const apply = useCallback((updater: (prev: ReceiptSortRule[]) => ReceiptSortRule[]) => {
    setSortRules(prev => {
      const next = updater(prev)
      persist(next)
      return next
    })
  }, [])

  const addSortRule = useCallback(() => {
    apply(prev => {
      const used = new Set(prev.map(r => r.field))
      const nextField = RECEIPT_SORT_FIELDS.find(f => !used.has(f.key))
      if (!nextField) return prev
      return [...prev, { id: newReceiptSortId(), field: nextField.key, dir: 'asc' }]
    })
  }, [apply])

  const updateSortRule = useCallback((id: string, patch: Partial<ReceiptSortRule>) => {
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
