import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const TOTAL = 3896
const PAGE_LIMIT = 1000
let failFrom: number | null = null

// PostgREST처럼 1회 응답을 1000건으로 자르는 가짜 클라이언트
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        range: async (from: number, to: number) => {
          if (from === failFrom) return { data: null, error: new Error('page failed'), count: null }
          const end = Math.min(to + 1, from + PAGE_LIMIT, TOTAL)
          const data = Array.from({ length: Math.max(end - from, 0) }, (_, i) => ({
            id: from + i,
            purchase_request_items: [],
          }))
          return { data, error: null, count: TOTAL }
        },
      }
      return query
    },
  }),
}))

import { loadAllPurchaseData } from '@/services/purchaseDataLoader'
import { purchaseMemoryCache } from '@/stores/purchaseMemoryStore'

describe('loadAllPurchaseData', () => {
  beforeEach(() => {
    failFrom = null
    purchaseMemoryCache.allPurchases = null
  })

  it('1000건 상한을 넘어 전체 건을 중복 없이 로드한다', async () => {
    await loadAllPurchaseData()
    const ids = (purchaseMemoryCache.allPurchases || []).map((p) => p.id)
    expect(ids).toHaveLength(TOTAL)
    expect(new Set(ids).size).toBe(TOTAL)
  })

  it('한 페이지라도 실패하면 일부만 캐시하지 않는다', async () => {
    failFrom = 2000
    await expect(loadAllPurchaseData()).rejects.toThrow('page failed')
    expect(purchaseMemoryCache.allPurchases).toBeNull()
  })
})
