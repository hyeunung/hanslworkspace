import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { filterBySearchTerm, isPurchaseTemplate } from '@/utils/purchaseFilters'
import type { Purchase } from '@/types/purchase'

const makePurchase = (overrides: Record<string, unknown> = {}, items: Record<string, unknown>[] = []) =>
  ({ id: 1, vendor_name: '다른업체', purchase_request_items: items, ...overrides }) as unknown as Purchase

describe('filterBySearchTerm', () => {
  it.each([
    ['project_vendor', 'LGPRI'],
    ['project_item', 'PRAiVision'],
    ['sales_order_number', 'HS2609'],
    ['payment_category', '구매 요청'],
    ['progress_type', '선진행'],
    ['contact_name', '김담당'],
    ['vendor_alias', '스뷰'],
  ])('헤더 칼럼 %s 로 찾는다', (column, value) => {
    expect(filterBySearchTerm([makePurchase({ [column]: value })], value)).toHaveLength(1)
  })

  it.each([
    ['item_name', 'IMX540'],
    ['specification', 'AAQJ'],
    ['remark', '선진행 요청'],
    ['link', 'digikey'],
  ])('품목 칼럼 %s 로 찾고 일치 품목만 남긴다', (column, value) => {
    const purchase = makePurchase({}, [{ id: 1, [column]: value }, { id: 2, item_name: '무관' }])
    const result = filterBySearchTerm([purchase], value)
    expect(result).toHaveLength(1)
    expect(result[0].purchase_request_items).toHaveLength(1)
  })

  it('품목의 업체명 일치는 발주를 품목별로 쪼개지 않는다', () => {
    const purchase = makePurchase({}, [
      { id: 1, vendor_name: '스카이뷰', item_name: 'A' },
      { id: 2, vendor_name: '스카이뷰', item_name: 'B' },
    ])
    const result = filterBySearchTerm([purchase], '스카이뷰')
    expect(result).toHaveLength(1)
    expect(result[0].purchase_request_items).toHaveLength(2)
  })

  it('어느 칼럼에도 없으면 제외한다', () => {
    expect(filterBySearchTerm([makePurchase({ project_item: 'ABC' })], '스카이뷰')).toHaveLength(0)
  })
})

describe('isPurchaseTemplate', () => {
  it.each([null, '일반', '발주/구매', 'default', '발주서(Default)'])('%s 양식은 목록에 포함한다', (type) => {
    expect(isPurchaseTemplate({ po_template_type: type } as never)).toBe(true)
  })

  it.each(['카드사용', '출장', '차량', '연차 신청'])('%s 양식은 제외한다', (type) => {
    expect(isPurchaseTemplate({ po_template_type: type } as never)).toBe(false)
  })
})
