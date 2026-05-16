/**
 * 메모리 기반 구매 데이터 Hook
 * 캐시된 데이터를 즉시 필터링하여 반환
 *
 * 🚀 Realtime 이벤트 기반 (기존 10ms 폴링 제거)
 *  - useSyncExternalStore로 외부 캐시를 정확히 구독 (timing race 방지)
 *  - DB 변경/loadAllPurchaseData 완료 시 notifyCacheListeners로 즉시 반영
 */

import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react'
import {
  purchaseMemoryCache,
  addCacheListener,
  getCacheVersion
} from '@/stores/purchaseMemoryStore'
import { applyAllFilters, calculateTabCounts, type FilterOptions, type TabType } from '@/utils/purchaseFilters'
import type { Purchase } from '@/types/purchase'

// useSyncExternalStore 어댑터:
// subscribe는 store의 listener 시스템에 그대로 위임,
// getSnapshot은 store의 version 번호를 반환.
// notifyCacheListeners()가 호출되면 store에서 먼저 version을 증가시킨 후
// 리스너를 호출하므로 React가 항상 새 값을 보게 됨 → 정확한 re-render.
const subscribe = (callback: () => void): (() => void) => addCacheListener(callback)
const getSnapshot = (): number => getCacheVersion()

export function usePurchaseMemory() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // 매 render마다 캐시에서 직접 읽음 → 상태 불일치 없음
  const purchases = useMemo(
    () => (purchaseMemoryCache.allPurchases ? [...purchaseMemoryCache.allPurchases] : []),
    // 캐시 버전이 바뀔 때마다 useSyncExternalStore가 re-render를 유발하므로
    // 새 배열이 만들어지면서 자동 갱신됨.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchaseMemoryCache.allPurchases, purchaseMemoryCache.lastFetch]
  )

  const loading = !purchaseMemoryCache.allPurchases && purchaseMemoryCache.isLoading
  const error = purchaseMemoryCache.error
  const currentUser = purchaseMemoryCache.currentUser

  const getFilteredPurchases = useCallback((options: FilterOptions): Purchase[] => {
    if (!purchaseMemoryCache.allPurchases) return []
    return applyAllFilters(purchaseMemoryCache.allPurchases, options, currentUser)
  }, [currentUser])

  const tabCounts = useMemo(() => {
    if (!purchases || purchases.length === 0) {
      return { pending: 0, purchase: 0, receipt: 0, done: 0 }
    }
    return calculateTabCounts(purchases, currentUser)
  }, [purchases, currentUser])

  const stats = useMemo(() => ({
    total: purchases.length,
    loaded: purchaseMemoryCache.stats?.loadedCount || 0,
    memoryUsage: purchaseMemoryCache.stats?.memoryUsage || 0,
    lastFetch: purchaseMemoryCache.lastFetch
  }), [purchases])

  return {
    allPurchases: purchases,
    getFilteredPurchases,
    loading,
    error,
    tabCounts,
    stats,
    currentUser
  }
}

/**
 * 특정 탭용 Hook
 */
export function usePurchaseTab(tab: TabType) {
  const { getFilteredPurchases, loading, error, currentUser } = usePurchaseMemory()
  const [filteredData, setFilteredData] = useState<Purchase[]>([])

  useEffect(() => {
    const data = getFilteredPurchases({ tab })
    setFilteredData(data)
  }, [tab, getFilteredPurchases])

  return {
    purchases: filteredData,
    loading,
    error,
    currentUser
  }
}
