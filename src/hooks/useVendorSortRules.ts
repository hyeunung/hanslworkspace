import { useState, useCallback } from 'react'
import {
  VendorSortRule, VENDOR_SORT_FIELDS, VENDOR_SORT_STORAGE_KEY,
  loadVendorSortRules, newVendorSortId,
} from '@/utils/vendorTable'

// 업체관리 다중 정렬 상태 훅 — 변경 즉시 localStorage 자동 저장 (useBomBoardSortRules 패턴)

const persist = (rules: VendorSortRule[]) => {
  try {
    localStorage.setItem(
      VENDOR_SORT_STORAGE_KEY,
      JSON.stringify(rules.map(r => ({ field: r.field, dir: r.dir })))
    )
  } catch { /* 저장 실패는 무시 */ }
}

export function useVendorSortRules() {
  const [sortRules, setSortRules] = useState<VendorSortRule[]>(() => loadVendorSortRules())

  const apply = useCallback((updater: (prev: VendorSortRule[]) => VendorSortRule[]) => {
    setSortRules(prev => {
      const next = updater(prev)
      persist(next)
      return next
    })
  }, [])

  const addSortRule = useCallback(() => {
    apply(prev => {
      const used = new Set(prev.map(r => r.field))
      const nextField = VENDOR_SORT_FIELDS.find(f => !used.has(f.key))
      if (!nextField) return prev
      return [...prev, { id: newVendorSortId(), field: nextField.key, dir: 'asc' }]
    })
  }, [apply])

  const updateSortRule = useCallback((id: string, patch: Partial<VendorSortRule>) => {
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
