/**
 * 초기 구매 데이터 로더
 * 앱 시작 시 한 번만 실행되어 모든 데이터를 메모리에 로드
 */

import { createClient } from '@/lib/supabase/client'
import { purchaseMemoryCache, calculateMemoryUsage } from '@/stores/purchaseMemoryStore'
import type { Purchase } from '@/types/purchase'
import { logger } from '@/lib/logger'

// 초기 데이터 로드 상한선
const INITIAL_LOAD_LIMIT = 2000

/**
 * 모든 구매 데이터를 메모리에 로드
 * @param userId 현재 사용자 ID
 * @returns 성공 여부
 */
export const loadAllPurchaseData = async (userId?: string): Promise<boolean> => {
  try {
    // 이미 로딩 중이면 스킵
    if (purchaseMemoryCache.isLoading) {
      logger.debug('[PurchaseDataLoader] Already loading, skipping...')
      return false
    }

    purchaseMemoryCache.isLoading = true
    purchaseMemoryCache.error = null
    
    const supabase = createClient()
    const startTime = Date.now()
    
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
    
    // 2. 최근 2000개 구매 데이터 + 품목 로드
    const { data: rawData, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_items(*)
      `)
      .order('request_date', { ascending: false })
      .limit(INITIAL_LOAD_LIMIT)
    
    if (error) {
      throw error
    }
    
    // 3. 데이터 처리 및 변환
    const processedData: Purchase[] = (rawData || []).map(request => ({
      ...request,
      items: request.purchase_request_items || [],
      // 계산된 필드들
      total_price: (request.purchase_request_items || []).reduce(
        (sum: number, item: any) => sum + (item.total_price || 0), 
        0
      ),
      actual_amount: (request.purchase_request_items || []).reduce(
        (sum: number, item: any) => sum + (item.actual_amount || 0), 
        0
      ),
      is_all_received: request.purchase_request_items?.length > 0 &&
        request.purchase_request_items.every((item: any) => item.is_received),
      received_count: (request.purchase_request_items || []).filter(
        (item: any) => item.is_received
      ).length,
      total_count: request.purchase_request_items?.length || 0
    }))
    
    // 4. 캐시에 저장
    purchaseMemoryCache.allPurchases = processedData
    purchaseMemoryCache.lastFetch = Date.now()
    
    // 5. 통계 정보 업데이트
    const memoryUsage = calculateMemoryUsage(processedData)
    purchaseMemoryCache.stats = {
      totalCount: processedData.length,
      loadedCount: processedData.length,
      memoryUsage
    }
    
    const loadTime = Date.now() - startTime
    logger.info(`[PurchaseDataLoader] Loaded ${processedData.length} purchases in ${loadTime}ms`)
    logger.info(`[PurchaseDataLoader] Memory usage: ${memoryUsage.toFixed(2)}MB`)
    
    return true
    
  } catch (error) {
    logger.error('[PurchaseDataLoader] Failed to load data:', error)
    purchaseMemoryCache.error = error instanceof Error ? error.message : 'Unknown error'
    return false
    
  } finally {
    purchaseMemoryCache.isLoading = false
  }
}

/**
 * 추가 데이터 로드 (날짜 필터 등으로 더 많은 데이터가 필요할 때)
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 */
export const loadAdditionalData = async (
  startDate?: string, 
  endDate?: string
): Promise<Purchase[]> => {
  try {
    const supabase = createClient()
    
    let query = supabase
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_items(*)
      `)
    
    // 날짜 필터 적용
    if (startDate) {
      query = query.gte('request_date', startDate)
    }
    if (endDate) {
      query = query.lte('request_date', endDate)
    }
    
    const { data: rawData, error } = await query
      .order('request_date', { ascending: false })
      .limit(5000) // 추가 로드는 더 많이 가능
    
    if (error) throw error
    
    // 데이터 처리
    const processedData: Purchase[] = (rawData || []).map(request => ({
      ...request,
      items: request.purchase_request_items || [],
      total_price: (request.purchase_request_items || []).reduce(
        (sum: number, item: any) => sum + (item.total_price || 0), 
        0
      ),
      actual_amount: (request.purchase_request_items || []).reduce(
        (sum: number, item: any) => sum + (item.actual_amount || 0), 
        0
      ),
      is_all_received: request.purchase_request_items?.length > 0 &&
        request.purchase_request_items.every((item: any) => item.is_received),
      received_count: (request.purchase_request_items || []).filter(
        (item: any) => item.is_received
      ).length,
      total_count: request.purchase_request_items?.length || 0
    }))
    
    return processedData
    
  } catch (error) {
    logger.error('[PurchaseDataLoader] Failed to load additional data:', error)
    return []
  }
}
