/**
 * 메모리 기반 구매 데이터 관리 시스템
 * 초기 로딩 시 모든 데이터를 메모리에 저장하고 클라이언트에서 필터링
 */

import type { Purchase, Employee } from '@/types/purchase'

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

// 메모리에서 특정 구매 요청 찾기
export const findPurchaseInMemory = (purchaseId: number | string): Purchase | null => {
  if (!purchaseMemoryCache.allPurchases) return null
  
  const id = Number(purchaseId)
  if (isNaN(id)) return null
  
  return purchaseMemoryCache.allPurchases.find(purchase => purchase.id === id) || null
}

// 메모리 캐시에서 특정 구매 요청 업데이트
export const updatePurchaseInMemory = (purchaseId: number | string, updater: (purchase: Purchase) => Purchase): boolean => {
  if (!purchaseMemoryCache.allPurchases) return false
  
  const id = Number(purchaseId)
  if (isNaN(id)) return false
  
  const index = purchaseMemoryCache.allPurchases.findIndex(purchase => purchase.id === id)
  if (index === -1) return false
  
  // 기존 데이터 복사 후 업데이트
  const currentPurchase = purchaseMemoryCache.allPurchases[index]
  const updatedPurchase = updater({ ...currentPurchase })
  
  // 메모리 캐시 업데이트
  purchaseMemoryCache.allPurchases[index] = updatedPurchase
  
  // 🚀 React 감지를 위한 lastFetch 업데이트 (UI 즉시 반영)
  purchaseMemoryCache.lastFetch = Date.now()
  
  return true
}

// 구매완료 처리를 위한 헬퍼 함수
export const markPurchaseAsPaymentCompleted = (purchaseId: number | string): boolean => {
  return updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    
    // 모든 품목을 구매완료로 업데이트
    const updatedItems = (purchase.items || []).map(item => ({
      ...item,
      is_payment_completed: true,
      payment_completed_at: currentTime
    }))
    
    return {
      ...purchase,
      is_payment_completed: true,
      payment_completed_at: currentTime,
      items: updatedItems
    }
  })
}

// 특정 품목의 구매완료 처리를 위한 헬퍼 함수
export const markItemAsPaymentCompleted = (purchaseId: number | string, itemId: number | string): boolean => {
  return updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    const targetItemId = Number(itemId)
    
    // 해당 품목만 구매완료로 업데이트
    const updatedItems = (purchase.items || []).map(item => 
      item.id === targetItemId 
        ? { ...item, is_payment_completed: true, payment_completed_at: currentTime }
        : item
    )
    
    // 모든 품목이 구매완료되었는지 확인
    const allItemsCompleted = updatedItems.every(item => item.is_payment_completed)
    
    return {
      ...purchase,
      is_payment_completed: allItemsCompleted,
      payment_completed_at: allItemsCompleted ? currentTime : purchase.payment_completed_at,
      items: updatedItems
    }
  })
}
