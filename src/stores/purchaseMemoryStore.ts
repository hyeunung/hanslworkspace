/**
 * 메모리 기반 구매 데이터 관리 시스템
 * 초기 로딩 시 모든 데이터를 메모리에 저장하고 클라이언트에서 필터링
 */

import type { Purchase } from '@/types/purchase'
import type { Employee } from '@/types/schema'

// 전역 메모리 캐시
export interface PurchaseMemoryCache {
  // 핵심 데이터
  allPurchases: Purchase[] | null      // 전체 구매 데이터 (2000개 + 품목)
  currentUser: Employee | null         // 현재 로그인 사용자
  
  // 메타데이터
  lastFetch: number                    // 마지막 데이터 로드 시간
  isLoading: boolean                   // 로딩 상태
  error: string | null                 // 에러 메시지
  
  // 통계 정보 (옵션)
  stats: {
    totalCount: number
    loadedCount: number
    memoryUsage: number               // MB 단위
  } | null
}

// 글로벌 캐시 인스턴스
export const purchaseMemoryCache: PurchaseMemoryCache = {
  allPurchases: null,
  currentUser: null,
  lastFetch: 0,
  isLoading: false,
  error: null,
  stats: null
}

// 캐시 유효 시간 (30분)
export const CACHE_DURATION = 30 * 60 * 1000

// 캐시 초기화
export const clearPurchaseMemoryCache = () => {
  purchaseMemoryCache.allPurchases = null
  purchaseMemoryCache.currentUser = null
  purchaseMemoryCache.lastFetch = 0
  purchaseMemoryCache.isLoading = false
  purchaseMemoryCache.error = null
  purchaseMemoryCache.stats = null
}

// 캐시 유효성 검사
export const isCacheValid = () => {
  const now = Date.now()
  return purchaseMemoryCache.allPurchases && 
         (now - purchaseMemoryCache.lastFetch) < CACHE_DURATION
}

// 메모리 사용량 계산 (대략적)
export const calculateMemoryUsage = (purchases: Purchase[]): number => {
  // 간단한 추정: 한 구매당 약 5KB
  const purchaseSize = 5 * 1024 // 5KB in bytes
  const totalBytes = purchases.length * purchaseSize
  return totalBytes / (1024 * 1024) // Convert to MB
}
