/**
 * 메모리 기반 구매 데이터 Hook
 * 캐시된 데이터를 즉시 필터링하여 반환
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { purchaseMemoryCache } from '@/stores/purchaseMemoryStore'
import { applyAllFilters, calculateTabCounts, type FilterOptions, type TabType } from '@/utils/purchaseFilters'
import type { Purchase } from '@/types/purchase'

export function usePurchaseMemory() {
  // 로컬 상태
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // 현재 사용자 정보
  const currentUser = purchaseMemoryCache.currentUser
  
  // 캐시 데이터 구독
  useEffect(() => {
    // 캐시가 업데이트되면 즉시 반영
    const checkCache = () => {
      if (purchaseMemoryCache.allPurchases) {
        setPurchases(purchaseMemoryCache.allPurchases)
        setLoading(false)
      } else {
        setLoading(purchaseMemoryCache.isLoading)
      }
      setError(purchaseMemoryCache.error)
    }
    
    // 초기 체크
    checkCache()
    
    // 폴링으로 캐시 업데이트 감지 (간단한 구현)
    const interval = setInterval(checkCache, 100)
    
    return () => clearInterval(interval)
  }, [])
  
  // 필터링된 데이터 반환 함수
  const getFilteredPurchases = useCallback((options: FilterOptions): Purchase[] => {
    if (!purchaseMemoryCache.allPurchases) return []
    
    return applyAllFilters(
      purchaseMemoryCache.allPurchases,
      options,
      currentUser
    )
  }, [currentUser])
  
  // 탭별 카운트 계산
  const tabCounts = useMemo(() => {
    if (!purchaseMemoryCache.allPurchases) {
      return {
        pending: 0,
        purchase: 0,
        receipt: 0,
        done: 0
      }
    }
    
    return calculateTabCounts(purchaseMemoryCache.allPurchases, currentUser)
  }, [purchases, currentUser])
  
  // 통계 정보
  const stats = useMemo(() => {
    return {
      total: purchases.length,
      loaded: purchaseMemoryCache.stats?.loadedCount || 0,
      memoryUsage: purchaseMemoryCache.stats?.memoryUsage || 0,
      lastFetch: purchaseMemoryCache.lastFetch
    }
  }, [purchases])
  
  return {
    // 데이터
    allPurchases: purchases,
    getFilteredPurchases,
    
    // 상태
    loading,
    error,
    
    // 카운트 & 통계
    tabCounts,
    stats,
    
    // 사용자 정보
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
    // 탭 데이터 필터링
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
