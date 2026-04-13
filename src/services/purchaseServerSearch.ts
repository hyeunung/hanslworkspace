import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import type { Purchase, PurchaseRequestItem } from '@/types/purchase'

const SERVER_SEARCH_LIMIT = 50

const FULL_SELECT = `
  *,
  purchase_request_items(*),
  vendors!vendor_id(vendor_payment_schedule),
  vendor_contacts!contact_id(contact_name)
`

type RawPurchase = Record<string, unknown> & {
  purchase_request_items?: PurchaseRequestItem[]
  vendors?: { vendor_payment_schedule?: string } | null
  vendor_contacts?: { contact_name?: string } | null
}

function processRawData(rawData: RawPurchase[]): Purchase[] {
  return rawData.map((request) => ({
    ...request,
    purchase_request_items: request.purchase_request_items || [],
    vendor_payment_schedule: request.vendors?.vendor_payment_schedule || null,
    contact_name: request.vendor_contacts?.contact_name || null,
  })) as Purchase[]
}

/**
 * 서버에서 발주 데이터를 검색 (메모리 캐시 폴백용)
 * 메모리에 없는 과거 데이터를 검색할 때 사용
 */
export async function serverSearchPurchases(
  searchTerm: string,
  abortSignal?: AbortSignal
): Promise<Purchase[]> {
  if (!searchTerm || searchTerm.trim().length < 2) return []

  const term = searchTerm.trim()
  const supabase = createClient()

  try {
    logger.info(`[ServerSearch] Searching for: "${term}"`)

    // 1. 헤더 필드 검색
    const headerSearchPromise = supabase
      .from('purchase_requests')
      .select(FULL_SELECT)
      .or(
        `purchase_order_number.ilike.%${term}%,` +
        `sales_order_number.ilike.%${term}%,` +
        `requester_name.ilike.%${term}%,` +
        `vendor_name.ilike.%${term}%,` +
        `project_item.ilike.%${term}%`
      )
      .order('request_date', { ascending: false })
      .limit(SERVER_SEARCH_LIMIT)
      .abortSignal(abortSignal!)

    // 2. 품목 필드 검색 → purchase_request_id 목록 추출
    const itemSearchPromise = supabase
      .from('purchase_request_items')
      .select('purchase_request_id')
      .or(
        `item_name.ilike.%${term}%,` +
        `specification.ilike.%${term}%,` +
        `remark.ilike.%${term}%`
      )
      .limit(SERVER_SEARCH_LIMIT)
      .abortSignal(abortSignal!)

    // 3. vendor_alias 검색 → vendor_id로 발주 조회
    const aliasSearchPromise = supabase
      .from('vendors')
      .select('id')
      .ilike('vendor_alias', `%${term}%`)
      .limit(50)
      .abortSignal(abortSignal!)

    const [headerResult, itemResult, aliasResult] = await Promise.all([
      headerSearchPromise,
      itemSearchPromise,
      aliasSearchPromise,
    ])

    if (abortSignal?.aborted) return []

    if (headerResult.error) {
      logger.error('[ServerSearch] Header search error:', headerResult.error)
    }
    if (itemResult.error) {
      logger.error('[ServerSearch] Item search error:', itemResult.error)
    }

    const headerData = processRawData((headerResult.data as RawPurchase[]) || [])
    const headerIds = new Set(headerData.map((p) => p.id))

    // vendor_alias 매칭된 업체의 발주 추가 조회
    let aliasData: Purchase[] = []
    if (aliasResult.data && aliasResult.data.length > 0) {
      const aliasVendorIds = aliasResult.data.map((v: { id: number }) => v.id)
      const { data: aliaspurchases } = await supabase
        .from('purchase_requests')
        .select(FULL_SELECT)
        .in('vendor_id', aliasVendorIds)
        .order('request_date', { ascending: false })
        .limit(SERVER_SEARCH_LIMIT)

      if (aliaspurchases) {
        aliasData = processRawData((aliaspurchases as RawPurchase[]).filter(
          (p: RawPurchase) => !headerIds.has((p as unknown as Purchase).id)
        ))
        aliasData.forEach((p) => headerIds.add(p.id))
      }
    }

    // 품목 검색으로 찾은 purchase_request_id 중 헤더 검색에 없는 것만 추가 조회
    let itemParentData: Purchase[] = []
    if (itemResult.data && itemResult.data.length > 0) {
      const itemParentIds = [
        ...new Set(
          itemResult.data
            .map((item: { purchase_request_id: number }) => item.purchase_request_id)
            .filter((id: number) => !headerIds.has(id))
        ),
      ]

      if (itemParentIds.length > 0) {
        const { data: parentData, error: parentError } = await supabase
          .from('purchase_requests')
          .select(FULL_SELECT)
          .in('id', itemParentIds)
          .order('request_date', { ascending: false })
          .limit(SERVER_SEARCH_LIMIT)

        if (parentError) {
          logger.error('[ServerSearch] Parent fetch error:', parentError)
        } else {
          itemParentData = processRawData((parentData as RawPurchase[]) || [])
        }
      }
    }

    // 결과 병합 (중복 제거)
    const merged = [...headerData, ...aliasData, ...itemParentData]
    logger.info(`[ServerSearch] Found ${merged.length} results for "${term}"`)

    return merged
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('[ServerSearch] Search aborted')
      return []
    }
    logger.error('[ServerSearch] Search failed:', error)
    throw error
  }
}
