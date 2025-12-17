/**
 * 메모리 기반 구매 데이터 Hook
 * 캐시된 데이터를 즉시 필터링하여 반환
 * 
 * 🚀 Realtime 이벤트 기반으로 전환 (기존 10ms 폴링 제거)
 * - CPU 사용량 대폭 감소
 * - DB 변경 시 자동 업데이트
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { purchaseMemoryCache, addCacheListener } from '@/stores/purchaseMemoryStore'
import { applyAllFilters, calculateTabCounts, type FilterOptions, type TabType } from '@/utils/purchaseFilters'
import type { Purchase } from '@/types/purchase'

export function usePurchaseMemory() {
  const initialPurchases = purchaseMemoryCache.allPurchases
    ? [...purchaseMemoryCache.allPurchases]
    : []
  const initialLoading = !purchaseMemoryCache.allPurchases && purchaseMemoryCache.isLoading

  // 로컬 상태
  const [purchases, setPurchases] = useState<Purchase[]>(initialPurchases)
  const [loading, setLoading] = useState(initialLoading)
  const [error, setError] = useState<string | null>(purchaseMemoryCache.error)
  
  // 변경 감지용 ref
  const lastFetchRef = useRef(purchaseMemoryCache.lastFetch)
  
  // 현재 사용자 정보
  const currentUser = purchaseMemoryCache.currentUser
  
  // 🚀 Realtime 이벤트 기반 캐시 구독 (폴링 없음!)
  // DB 변화가 있을 때만 purchaseRealtimeService가 notifyCacheListeners 호출
  useEffect(() => {
    // 캐시 변경 시 상태 업데이트
    const handleCacheUpdate = () => {
      if (purchaseMemoryCache.allPurchases) {
        setPurchases([...purchaseMemoryCache.allPurchases])
        setLoading(false)
      } else {
        setLoading(purchaseMemoryCache.isLoading)
      }
      setError(purchaseMemoryCache.error)
      lastFetchRef.current = purchaseMemoryCache.lastFetch
    }
    
    // 캐시 리스너 등록 - DB 변경 시에만 호출됨
    const unsubscribe = addCacheListener(handleCacheUpdate)

    // 초기 동기화 (첫 마운트 시, 이미 캐시가 있는 경우)
    if (purchaseMemoryCache.allPurchases && purchases.length === 0) {
      setPurchases([...purchaseMemoryCache.allPurchases])
      setLoading(false)
      lastFetchRef.current = purchaseMemoryCache.lastFetch
    }

    return () => {
      unsubscribe()
    }
  }, []) // 빈 의존성 배열 - 마운트 시에만 실행
  
  // 필터링된 데이터 반환 함수
  const getFilteredPurchases = useCallback((options: FilterOptions): Purchase[] => {
    if (!purchaseMemoryCache.allPurchases) return []
    
    return applyAllFilters(
      purchaseMemoryCache.allPurchases,
      options,
      currentUser
    )
  }, [currentUser])
  
  // 탭별 카운트 계산 - purchases 상태가 업데이트되면 자동으로 재계산
  const tabCounts = useMemo(() => {
    if (!purchases || purchases.length === 0) {
      return {
        pending: 0,
        purchase: 0,
        receipt: 0,
        done: 0
      }
    }
    
    return calculateTabCounts(purchases, currentUser)
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
