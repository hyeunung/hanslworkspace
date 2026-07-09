import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Purchase, PurchaseRequestItem } from '@/types/purchase'
import { PurchaseFilterRule } from '@/utils/purchaseTableFilters'

// 월간(월별) 필터 적용 시 합계금액 요약 — 기존 PurchaseListMain의 monthlyFilterSummary 블록을
// 새 노션식 규칙 모델(op='month_in') 기준으로 이관한 컴포넌트. 계산/표시는 기존과 동일하게
// 청구일(request_date) 기준, 발주 카테고리는 세액 포함.

interface PurchaseMonthlySummaryProps {
  rules: PurchaseFilterRule[]
  purchases: Purchase[] // 필터가 모두 적용된 표시 목록
}

// 발주 카테고리 세액 포함 합계
const purchaseTotalOf = (purchase: Purchase): number => {
  if (purchase.purchase_request_items?.length) {
    return purchase.purchase_request_items.reduce((sum: number, item: PurchaseRequestItem) => {
      const baseAmount = item.amount_value || 0
      const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0
      return sum + baseAmount + taxAmount
    }, 0)
  }
  const baseAmount = purchase.total_amount || 0
  const taxAmount = (purchase.payment_category === '발주') ? baseAmount * 0.1 : 0
  return baseAmount + taxAmount
}

export default function PurchaseMonthlySummary({ rules, purchases }: PurchaseMonthlySummaryProps) {
  const summary = useMemo(() => {
    // 청구일 월별 필터만 요약 대상 (연도 미지정 규칙은 미완성이므로 제외)
    const monthRule = rules.find(r => r.op === 'month_in' && r.field === 'request_date' && r.year != null)
    if (!monthRule || monthRule.year == null) return null

    const totalFilteredAmount = purchases.reduce((sum, p) => sum + purchaseTotalOf(p), 0)
    const year = monthRule.year

    if (monthRule.month != null) {
      // 단일 월
      const month = monthRule.month
      const monthData = purchases.filter(p => {
        const d = new Date(p.request_date)
        return d.getFullYear() === year && (d.getMonth() + 1) === month
      })
      return {
        type: 'single' as const,
        year, month,
        count: monthData.length,
        totalFilteredAmount,
      }
    }

    // 전체월 = 해당 연도 1~12월별 분해
    const months = Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
      const monthData = purchases.filter(p => {
        const d = new Date(p.request_date)
        return d.getFullYear() === year && (d.getMonth() + 1) === month
      })
      return {
        month,
        monthStr: `${year}-${String(month).padStart(2, '0')}`,
        count: monthData.length,
        total: monthData.reduce((sum, p) => sum + purchaseTotalOf(p), 0),
      }
    })
    return { type: 'range' as const, year, months, totalFilteredAmount }
  }, [rules, purchases])

  if (!summary) return null

  if (summary.type === 'single') {
    return (
      <div className="mb-3">
        <div className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 business-radius-badge px-3 py-2 shadow-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
            <span className="card-subtitle text-gray-700">
              {summary.year}년 {summary.month}월
            </span>
            <span className="badge-text text-gray-500">{summary.count}건</span>
          </div>
          <div className="h-4 w-px bg-blue-300"></div>
          <span className="modal-value text-blue-700 font-semibold">
            ₩{summary.totalFilteredAmount?.toLocaleString() || '0'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <Card className="business-radius-card border border-gray-200 shadow-sm">
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
              <CardTitle className="section-title text-gray-800">월별 발주요청 총액</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge-text text-gray-600">
                ({summary.months.reduce((sum, m) => sum + m.count, 0)}건)
              </span>
              <div className="h-4 w-px bg-gray-300"></div>
              <span className="modal-value text-gray-500 font-bold">
                ₩{summary.totalFilteredAmount?.toLocaleString() || '0'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {/* 월별 데이터 - 가로 스크롤 한 행 */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {summary.months.map(monthData => (
              <div
                key={monthData.monthStr}
                className="bg-gray-50 business-radius-card px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex-shrink-0"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="modal-value font-bold text-gray-800 whitespace-nowrap">
                    {monthData.month}월
                  </span>
                  <span className="text-[9px] text-gray-500 whitespace-nowrap">
                    ({monthData.count})
                  </span>
                  <span className="modal-value text-gray-500 font-bold whitespace-nowrap ml-1">
                    ₩{monthData.total.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
