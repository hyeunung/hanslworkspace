import { createClient } from '@/lib/supabase/client'
import { purchaseMemoryCache, calculateMemoryUsage } from '@/stores/purchaseMemoryStore'
import { logger } from '@/lib/logger'
import type { Purchase } from '@/types/purchase'

// 초기 로드 제한
const INITIAL_LOAD_LIMIT = 2000

// 실제 금액 계산 (검수 금액 또는 기본 금액)
function calculateActualAmount(items: any[]): number {
  return items.reduce((sum, item) => {
    const baseAmount = item.amount_value || 0
    const actualAmount = item.actual_amount || baseAmount
    return sum + actualAmount
  }, 0)
}

// 실제 입고일 계산
function calculateActualReceivedDate(items: any[]): string | null {
  const receivedItems = items.filter(item => item.is_received)
  if (receivedItems.length === 0) return null
  
  const dates = receivedItems
    .map(item => item.actual_received_date)
    .filter(date => date)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  
  return dates[0] || null
}

// 승인 상태 계산
function calculateApprovalStatus(middleStatus: string, finalStatus: string): string {
  if (middleStatus === 'rejected' || finalStatus === 'rejected') {
    return 'rejected'
  }
  if (middleStatus === 'approved' && finalStatus === 'approved') {
    return 'approved'
  }
  return 'pending'
}

/**
 * 애플리케이션 시작 시 모든 구매 데이터를 메모리에 로드
 * - 최근 2000개까지만 로드 (초기 성능을 위해)
 * - 추가 데이터는 필요 시 증분 로드
 */
export async function loadAllPurchaseData(userId?: string): Promise<void> {
  try {
    const supabase = createClient()
    
    logger.info('[PurchaseDataLoader] Starting initial data load...')
    
    // 1. 사용자 정보 로드 (있다면)
    if (userId) {
      const { data: userData } = await supabase
        .from('employees')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (userData) {
        purchaseMemoryCache.currentUser = userData
      }
    }
    
    // 2. 최근 2000개 구매 데이터 + 품목 + 벤더 정보 로드
    const { data: rawData, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_items(*),
        vendors!vendor_id(vendor_payment_schedule),
        vendor_contacts!contact_id(contact_name)
      `)
      .order('request_date', { ascending: false })
      .limit(INITIAL_LOAD_LIMIT)
    
    if (error) {
      throw error
    }
    
    // 3. 데이터 처리 및 변환
    const processedData: Purchase[] = (rawData || []).map((request: any) => {
      return {
        ...request,
        purchase_request_items: request.purchase_request_items || [],
        // JOIN된 데이터 플랫하게 추가
        vendor_payment_schedule: request.vendors?.vendor_payment_schedule || null,
        contact_name: request.vendor_contacts?.contact_name || null
      }
    })
    
    // 4. 메모리 캐시에 저장
    purchaseMemoryCache.allPurchases = processedData
    purchaseMemoryCache.lastFetch = Date.now()
    purchaseMemoryCache.isLoading = false
    purchaseMemoryCache.stats = {
      totalCount: processedData.length,
      loadedCount: processedData.length,
      memoryUsage: calculateMemoryUsage(processedData)
    }
    
    logger.info(`[PurchaseDataLoader] Loaded ${processedData.length} purchase records into memory`)
    
  } catch (error) {
    logger.error('[PurchaseDataLoader] Failed to load purchase data:', error)
    purchaseMemoryCache.error = error instanceof Error ? error.message : 'Unknown error'
    purchaseMemoryCache.isLoading = false
    throw error
  }
}

/**
 * 특정 조건에 따라 추가 데이터 로드
 * (예: 날짜 범위 확장, 특정 필터 적용 시)
 */
export async function loadAdditionalData(params: {
  startDate?: string
  endDate?: string
  offset?: number
}): Promise<void> {
  // 향후 구현: 필요 시 추가 데이터 로드
  logger.info('[PurchaseDataLoader] Additional data loading not yet implemented')
}

/**
 * 단일 구매 건 업데이트 (옵티미스틱 업데이트용)
 */
export function updatePurchaseInMemory(
  purchaseId: number, 
  updater: (prev: Purchase) => Purchase
): void {
  if (!purchaseMemoryCache.allPurchases) {
    logger.warn(`[updatePurchaseInMemory] Cache is empty, purchaseId: ${purchaseId}`)
    return
  }
  
  const index = purchaseMemoryCache.allPurchases.findIndex(p => p.id === purchaseId)
  if (index !== -1) {
    const updated = updater(purchaseMemoryCache.allPurchases[index])
    
    // 배열 참조를 변경하여 React가 즉시 변경을 감지하도록 함 (실시간 업데이트)
    purchaseMemoryCache.allPurchases = [
      ...purchaseMemoryCache.allPurchases.slice(0, index),
      updated,
      ...purchaseMemoryCache.allPurchases.slice(index + 1)
    ]
    
    // 메모리 변경을 구독자들에게 알림
    purchaseMemoryCache.lastFetch = Date.now()
    logger.debug(`[updatePurchaseInMemory] Updated purchase ${purchaseId} at index ${index}`)
  } else {
    logger.warn(`[updatePurchaseInMemory] Purchase ${purchaseId} not found in cache. Total purchases: ${purchaseMemoryCache.allPurchases.length}`)
  }
}