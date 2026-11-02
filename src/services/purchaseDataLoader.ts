import { createClient } from '@/lib/supabase/client'
import { purchaseMemoryCache, calculateMemoryUsage, notifyCacheListeners } from '@/stores/purchaseMemoryStore'
import { logger } from '@/lib/logger'
import type { Purchase, PurchaseRequestItem } from '@/types/purchase'

// PostgREST 1회 응답 상한 — .limit()을 더 크게 줘도 이 건수까지만 내려온다
const PAGE_SIZE = 1000

const PURCHASE_SELECT = `
  *,
  purchase_request_items(*),
  vendors!vendor_id(vendor_payment_schedule, vendor_alias),
  vendor_contacts!contact_id(contact_name)
`

// 실제 금액 계산 (검수 금액 또는 기본 금액)
function calculateActualAmount(items: Pick<PurchaseRequestItem, 'amount_value'>[]): number {
  return items.reduce((sum, item) => {
    const baseAmount = item.amount_value || 0
    return sum + baseAmount
  }, 0)
}

// 실제 입고일 계산
function calculateActualReceivedDate(items: Pick<PurchaseRequestItem, 'is_received' | 'actual_received_date'>[]): string | null {
  const receivedItems = items.filter(item => item.is_received)
  if (receivedItems.length === 0) return null
  
  const dates = receivedItems
    .map(item => item.actual_received_date)
    .filter((date): date is string => !!date)
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
 * - 검색/필터가 메모리 기준으로 동작하므로 전체 건을 페이지 단위로 빠짐없이 로드
 * - 한 페이지라도 실패하면 일부만 캐시하지 않고 에러 처리
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
    
    // 2. 전체 구매 데이터 + 품목 + 벤더 정보 로드
    const fetchPage = (from: number, withCount = false) => supabase
      .from('purchase_requests')
      .select(PURCHASE_SELECT, withCount ? { count: 'exact' } : undefined)
      .order('request_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    const firstPage = await fetchPage(0, true)
    if (firstPage.error) {
      throw firstPage.error
    }

    const restOffsets: number[] = []
    for (let from = PAGE_SIZE; from < (firstPage.count ?? 0); from += PAGE_SIZE) {
      restOffsets.push(from)
    }
    const restPages = await Promise.all(restOffsets.map((from) => fetchPage(from)))
    const pageError = restPages.find((page) => page.error)?.error
    if (pageError) {
      throw pageError
    }

    // 페이지 사이에 새 발주가 들어와 밀린 행이 중복되지 않도록 id로 제거
    const rawData = [
      ...new Map(
        [firstPage, ...restPages]
          .flatMap((page) => (page.data || []) as unknown as Record<string, unknown>[])
          .map((request) => [request.id, request])
      ).values(),
    ]
    
    // 3. 데이터 처리 및 변환
    const processedData = rawData
      .filter((request: any) => !request.deleted_at)
      .map((request: Record<string, unknown> & { purchase_request_items?: PurchaseRequestItem[]; vendors?: { vendor_payment_schedule?: string; vendor_alias?: string } | null; vendor_contacts?: { contact_name?: string } | null }) => {
        const activeItems = (request.purchase_request_items || []).filter(item => !item.deleted_at)
        return {
          ...request,
          purchase_request_items: activeItems,
          // JOIN된 데이터 플랫하게 추가
          vendor_payment_schedule: request.vendors?.vendor_payment_schedule || null,
          vendor_alias: request.vendors?.vendor_alias || null,
          contact_name: request.vendor_contacts?.contact_name || null
        }
      }) as unknown as Purchase[]

    // 4. 메모리 캐시에 저장
    purchaseMemoryCache.allPurchases = processedData
    purchaseMemoryCache.lastFetch = Date.now()
    purchaseMemoryCache.isLoading = false
    purchaseMemoryCache.stats = {
      totalCount: processedData.length,
      loadedCount: processedData.length,
      memoryUsage: calculateMemoryUsage(processedData)
    }

    // 캐시 채움을 구독자(usePurchaseMemory 등)에게 알려 loading 상태 해제
    notifyCacheListeners()

    logger.info(`[PurchaseDataLoader] Loaded ${processedData.length} purchase records into memory`)

  } catch (error) {
    logger.error('[PurchaseDataLoader] Failed to load purchase data:', error)
    purchaseMemoryCache.error = error instanceof Error ? error.message : 'Unknown error'
    purchaseMemoryCache.isLoading = false
    notifyCacheListeners()
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