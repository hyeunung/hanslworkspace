/**
 * 메모리 기반 구매 데이터 관리 시스템
 * 초기 로딩 시 모든 데이터를 메모리에 저장하고 클라이언트에서 필터링
 * 
 * Realtime 연동:
 * - purchaseRealtimeService에서 DB 변경 감지 시 자동으로 캐시 업데이트
 * - 기존 폴링(10ms, 50ms) 방식 제거하고 이벤트 기반으로 전환
 */

import type { Purchase, Employee } from '@/types/purchase'
import { useState, useEffect, useRef } from 'react'

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

// 캐시 무효화 (데이터 재로드 필요 표시)
export const invalidatePurchaseMemoryCache = () => {
  // lastFetch를 0으로 설정하여 다음 로드 시 강제 새로고침
  purchaseMemoryCache.lastFetch = 0
}

// 품목 삭제를 위한 메모리 캐시 업데이트 함수 (다른 함수들과 동일한 패턴)
export const removeItemFromMemory = (purchaseId: number | string, itemId: number | string): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택 (다른 함수들과 동일한 로직)
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목을 제외한 배열 생성 (삭제)
    const updatedItems = currentItems.filter(item => String(item.id) !== targetItemId)
    
    // 합계 재계산
    const newTotalAmount = updatedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
    
    return {
      ...purchase,
      // 품목 데이터 업데이트 - 삭제된 항목 제외
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items,
      total_amount: newTotalAmount,
      updated_at: new Date().toISOString()
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트 (다른 함수들과 동일)
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 발주서 전체 삭제를 위한 메모리 캐시 함수 (다른 함수들과 동일한 패턴)
export const removePurchaseFromMemory = (purchaseId: number | string): boolean => {
  if (!purchaseMemoryCache.allPurchases) {
    return false
  }
  
  const id = Number(purchaseId)
  if (isNaN(id)) {
    return false
  }
  
  // 해당 발주서의 인덱스 찾기
  const index = purchaseMemoryCache.allPurchases.findIndex(purchase => purchase.id === id)
  if (index === -1) {
    return false
  }
  
  // 🚀 배열 참조를 변경하여 React가 즉시 변경을 감지하도록 함 (실시간 업데이트)
  // updatePurchaseInMemory와 동일한 패턴으로 명시적으로 새 배열 생성
  purchaseMemoryCache.allPurchases = [
    ...purchaseMemoryCache.allPurchases.slice(0, index),
    ...purchaseMemoryCache.allPurchases.slice(index + 1)
  ]
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트 (다른 함수들과 동일)
  purchaseMemoryCache.lastFetch = Date.now()
  
  return true
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
  if (!purchaseMemoryCache.allPurchases) {
    return false
  }
  
  const id = Number(purchaseId)
  if (isNaN(id)) {
    return false
  }
  
  const index = purchaseMemoryCache.allPurchases.findIndex(purchase => purchase.id === id)
  if (index === -1) {
    return false
  }
  
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
    
    // 모든 품목을 구매완료로 업데이트 (입고완료와 동일한 방식)
    const updatedItems = (purchase.items || purchase.purchase_request_items || []).map(item => ({
      ...item,
      is_payment_completed: true,
      payment_completed_at: currentTime
    }))
    
    return {
      ...purchase,
      is_payment_completed: true,
      payment_completed_at: currentTime,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
}

// 특정 품목의 구매완료 처리를 위한 헬퍼 함수
export const markItemAsPaymentCompleted = (purchaseId: number | string, itemId: number | string): boolean => {
  return updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택 (markItemAsPaymentCanceled와 동일한 로직)
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 구매완료로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { ...item, is_payment_completed: true, payment_completed_at: currentTime }
        : item
    )
    
    // 모든 품목이 구매완료되었는지 확인
    const allItemsCompleted = updatedItems.every(item => item.is_payment_completed)
    
    return {
      ...purchase,
      is_payment_completed: allItemsCompleted,
      payment_completed_at: allItemsCompleted ? currentTime : purchase.payment_completed_at,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
}

// 입고완료 처리를 위한 헬퍼 함수
export const markPurchaseAsReceived = (purchaseId: number | string): boolean => {
  return updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    
    // 모든 품목을 입고완료로 업데이트
    const updatedItems = (purchase.items || purchase.purchase_request_items || []).map(item => ({
      ...item,
      is_received: true,
      delivery_status: 'received' as const,
      received_at: currentTime
    }))
    
    return {
      ...purchase,
      is_received: true,
      received_at: currentTime,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
}

// 특정 품목의 구매완료 취소를 위한 헬퍼 함수
export const markItemAsPaymentCanceled = (purchaseId: number | string, itemId: number | string): boolean => {
  return updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 구매완료 취소로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { ...item, is_payment_completed: false, payment_completed_at: null }
        : item
    )
    
    // 모든 품목이 구매완료되었는지 확인 (취소 후)
    const allItemsCompleted = updatedItems.every(item => item.is_payment_completed)
    
    return {
      ...purchase,
      is_payment_completed: allItemsCompleted,
      payment_completed_at: allItemsCompleted ? purchase.payment_completed_at : null,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
}

// 특정 품목의 입고완료 처리를 위한 헬퍼 함수
export const markItemAsReceived = (purchaseId: number | string, itemId: number | string, selectedDate?: string, receivedQuantity?: number): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    const actualReceivedDate = selectedDate || currentTime  // 선택된 날짜 또는 현재 시간
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 입고완료로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            is_received: true, 
            delivery_status: 'received' as const, 
            received_at: currentTime,
            actual_received_date: actualReceivedDate,  // 🚀 사용자가 선택한 날짜 사용
            received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.received_quantity
          }
        : item
    )
    
    // 모든 품목이 입고완료되었는지 확인
    const allItemsReceived = updatedItems.every(item => item.is_received)
    
    return {
      ...purchase,
      is_received: allItemsReceived,
      received_at: allItemsReceived ? currentTime : purchase.received_at,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 특정 품목의 입고완료 취소 처리를 위한 헬퍼 함수
export const markItemAsReceiptCanceled = (purchaseId: number | string, itemId: number | string): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 입고완료 취소로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            is_received: false, 
            delivery_status: 'pending' as const, 
            received_at: null, 
            actual_received_date: undefined  // 🚀 실제입고일도 함께 초기화
          }
        : item
    )
    
    // 모든 품목이 입고완료되었는지 확인
    const allItemsReceived = updatedItems.every(item => item.is_received)
    
    return {
      ...purchase,
      is_received: allItemsReceived,
      received_at: allItemsReceived ? purchase.received_at : null,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 특정 품목의 거래명세서 확인 처리를 위한 헬퍼 함수
export const markItemAsStatementReceived = (purchaseId: number | string, itemId: number | string, selectedDate?: string, userName?: string): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const currentTime = new Date().toISOString()
    const statementReceivedDate = selectedDate || currentTime
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 거래명세서 확인으로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            is_statement_received: true, 
            statement_received_date: statementReceivedDate,
            statement_received_by_name: userName || null
          }
        : item
    )
    
    // 모든 품목이 거래명세서 확인되었는지 확인
    const allItemsReceived = updatedItems.every(item => item.is_statement_received)
    
    return {
      ...purchase,
      is_statement_received: allItemsReceived,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 특정 품목의 거래명세서 확인 취소 처리를 위한 헬퍼 함수
export const markItemAsStatementCanceled = (purchaseId: number | string, itemId: number | string): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 거래명세서 확인 취소로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            is_statement_received: false, 
            statement_received_date: null,
            statement_received_by_name: null
          }
        : item
    )
    
    // 모든 품목이 거래명세서 확인되었는지 확인
    const allItemsReceived = updatedItems.every(item => item.is_statement_received)
    
    return {
      ...purchase,
      is_statement_received: allItemsReceived,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// UTK 확인 처리를 위한 헬퍼 함수
export const markItemAsUtkChecked = (purchaseId: number | string, itemId: number | string, isChecked: boolean): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목의 UTK 상태만 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            is_utk_checked: isChecked
          }
        : item
    )
    
    return {
      ...purchase,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 특정 품목의 지출 정보 처리를 위한 헬퍼 함수
export const markItemAsExpenditureSet = (purchaseId: number | string, itemId: number | string, expenditureDate: string, expenditureAmount: number): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    const targetItemId = String(itemId)
    
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 해당 품목만 지출 정보로 업데이트
    const updatedItems = currentItems.map(item => 
      String(item.id) === targetItemId 
        ? { 
            ...item, 
            expenditure_date: expenditureDate,
            expenditure_amount: expenditureAmount
          }
        : item
    )
    
    // 전체 지출 금액 합계 계산
    const totalExpenditure = updatedItems.reduce((sum, item) => sum + (item.expenditure_amount || 0), 0)
    
    return {
      ...purchase,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items,
      total_expenditure_amount: totalExpenditure
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// 일괄 지출 정보 처리를 위한 헬퍼 함수
export const markBulkExpenditureSet = (purchaseId: number | string, expenditureDate: string, totalAmount: number): boolean => {
  const result = updatePurchaseInMemory(purchaseId, (purchase) => {
    // 현재 items 배열 선택
    const currentItems = (purchase.items && purchase.items.length > 0) ? purchase.items : (purchase.purchase_request_items || [])
    
    // 모든 품목을 지출 정보로 업데이트 (금액은 null)
    const updatedItems = currentItems.map(item => ({
      ...item,
      expenditure_date: expenditureDate,
      expenditure_amount: null
    }))
    
    return {
      ...purchase,
      items: purchase.items ? updatedItems : purchase.items,
      purchase_request_items: purchase.purchase_request_items ? updatedItems : purchase.purchase_request_items,
      total_expenditure_amount: totalAmount
    }
  })
  
  // 실시간 UI 반영을 위해 lastFetch 업데이트
  if (result) {
    purchaseMemoryCache.lastFetch = Date.now()
  }
  
  return result
}

// ============================================================
// 🚀 Realtime 이벤트 리스너 시스템
// 폴링 완전 제거 - DB 변화가 있을 때만 UI 업데이트
// ============================================================

// 구독자 콜백 저장소
type CacheUpdateListener = () => void
const cacheListeners = new Set<CacheUpdateListener>()

// 리스너 등록 (Realtime 서비스에서 호출)
export const addCacheListener = (listener: CacheUpdateListener): (() => void) => {
  cacheListeners.add(listener)
  return () => cacheListeners.delete(listener)
}

// 모든 리스너에게 변경 알림 (Realtime 서비스에서 호출)
export const notifyCacheListeners = () => {
  cacheListeners.forEach(listener => {
    try {
      listener()
    } catch (error) {
      console.error('[CacheListener] 에러:', error)
    }
  })
}

// React 훅: 메모리 캐시 상태를 구독하여 실시간 변경 감지
// 🚀 순수 이벤트 기반 - 폴링 없음!
export const usePurchaseMemoryStore = () => {
  const [memoryState, setMemoryState] = useState(purchaseMemoryCache)

  useEffect(() => {
    // 캐시 변경 시 상태 업데이트
    const handleCacheUpdate = () => {
      setMemoryState({ ...purchaseMemoryCache })
    }

    // 리스너 등록
    const unsubscribe = addCacheListener(handleCacheUpdate)

    return () => unsubscribe()
  }, [])

  return {
    allPurchases: memoryState.allPurchases,
    currentUser: memoryState.currentUser,
    isLoading: memoryState.isLoading,
    error: memoryState.error,
    stats: memoryState.stats,
    lastFetch: memoryState.lastFetch
  }
}

// 호환성을 위한 alias (기존 이름 유지)
export const usePurchaseMemory = usePurchaseMemoryStore
