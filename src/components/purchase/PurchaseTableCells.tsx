import { memo } from 'react'
import { usePurchaseMemory } from '@/hooks/usePurchaseMemory'
import { Purchase, PurchaseRequestItem } from '@/types/purchase'

// ─── 발주/구매 컴팩트 테이블 셀 컴포넌트 ─────────────────────────────────
// 칼럼 정의(purchaseTableColumns)에서 참조하는 타입별 셀 모음.
// 진행바/승인상태 배지는 FastPurchaseTable의 검증된 구현을 이관한 것 —
// 메모리 캐시 변경 감지를 위해 usePurchaseMemory로 최신 행을 조회한다.

// 통화 코드를 기호로 변환
export const getCurrencySymbol = (currency?: string) => {
  if (!currency) return '₩'
  if (['KRW', '원', '₩'].includes(currency)) return '₩'
  if (['USD', '$', '달러'].includes(currency)) return '$'
  if (['EUR', '€'].includes(currency)) return '€'
  if (['JPY', '엔', '¥'].includes(currency)) return '¥'
  if (['CNY', '위안', '元'].includes(currency)) return '¥'
  return currency
}

// 말줄임 텍스트 셀 (title 툴팁 포함)
export const TextCell = memo(({ value }: { value?: string | null }) => (
  <span className="block truncate" title={value || ''}>{value || '-'}</span>
))
TextCell.displayName = 'TextCell'

// 승인 상태 상세 배지 (승인대기 탭 맨앞 칼럼)
export const ApprovalStatusBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory() // 메모리 캐시 변경 감지용
  const p = allPurchases?.find(x => x.id === purchase.id) || purchase

  const middleApproved = p.middle_manager_status === 'approved'
  const middleRejected = p.middle_manager_status === 'rejected'
  const finalApproved = p.final_manager_status === 'approved'
  const finalRejected = p.final_manager_status === 'rejected'

  if (middleRejected || finalRejected) {
    return <span className="badge-stats bg-red-500 text-white">반려</span>
  }
  if (middleApproved && finalApproved) {
    return <span className="badge-stats bg-green-500 text-white">승인완료</span>
  }
  if (middleApproved) {
    return <span className="badge-stats bg-yellow-500 text-white">1차 승인</span>
  }
  return <span className="badge-stats bg-gray-500 text-white">승인대기</span>
})
ApprovalStatusBadge.displayName = 'ApprovalStatusBadge'

// 진행바 공통 렌더 (색상만 주입)
const ProgressBar = ({ percentage, color }: { percentage: number; color: string }) => (
  <div className="flex items-center justify-center gap-1">
    <div className="bg-gray-200 rounded-full h-1.5 w-8">
      <div
        className={`h-1.5 rounded-full ${percentage > 0 ? color : 'bg-gray-300'}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
    <span className="text-gray-600">{percentage}%</span>
  </div>
)

// 구매완료 진행률 (구매현황 탭 맨앞 + 전체항목 구매진행 칼럼)
export const PaymentProgressBar = memo(({ purchase, activeTab }: { purchase: Purchase; activeTab?: string }) => {
  const { allPurchases } = usePurchaseMemory()
  const p = allPurchases?.find(x => x.id === purchase.id) || purchase

  // 전체항목 탭에서 결제종류가 '구매 요청'이 아닌 경우 "-" 표시
  if (activeTab === 'done' && p.payment_category !== '구매 요청') {
    return <span className="text-gray-500">-</span>
  }
  // purchase_requests의 is_payment_completed 우선
  if (p.is_payment_completed) return <ProgressBar percentage={100} color="bg-orange-500" />

  const items = p.purchase_request_items || []
  if (items.length === 0) return <ProgressBar percentage={0} color="bg-gray-300" />
  const completed = items.filter((item: PurchaseRequestItem) => item.is_payment_completed === true).length
  const percentage = Math.round((completed / items.length) * 100)
  return <ProgressBar percentage={percentage} color={percentage === 100 ? 'bg-orange-500' : 'bg-orange-400'} />
})
PaymentProgressBar.displayName = 'PaymentProgressBar'

// 입고완료 진행률 (입고현황 탭 맨앞 + 전체항목 입고진행 칼럼)
export const ReceiptProgressBar = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory()
  const p = allPurchases?.find(x => x.id === purchase.id) || purchase

  const items = p.purchase_request_items || []
  if (items.length === 0) return <ProgressBar percentage={0} color="bg-gray-300" />
  const received = items.filter((item: PurchaseRequestItem) => item.is_received === true).length
  const percentage = Math.round((received / items.length) * 100)
  return <ProgressBar percentage={percentage} color={percentage === 100 ? 'bg-blue-500' : 'bg-blue-400'} />
})
ReceiptProgressBar.displayName = 'ReceiptProgressBar'

// 거래명세서 진행률 (전체항목 탭 맨앞 칼럼)
export const StatementProgressBar = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory()
  const p = allPurchases?.find(x => x.id === purchase.id) || purchase

  const items = p.purchase_request_items || p.items || []
  if (items.length === 0) return <ProgressBar percentage={0} color="bg-gray-300" />
  const completed = items.filter((item: PurchaseRequestItem) => item.is_statement_received === true).length
  const percentage = Math.round((completed / items.length) * 100)
  return <ProgressBar percentage={percentage} color={percentage === 100 ? 'bg-green-500' : 'bg-green-400'} />
})
StatementProgressBar.displayName = 'StatementProgressBar'

// 발주번호 + 엑셀 발주서 다운로드 아이콘 + 품목수 + 무상샘플 배지
export const OrderNumberCell = memo(({ purchase, onExcelDownload }: {
  purchase: Purchase
  onExcelDownload?: (p: Purchase) => Promise<void> | void
}) => {
  const downloadable =
    purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행') ||
    (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved')
  return (
    <div className="flex items-center gap-1">
      {onExcelDownload && (
        <img
          src="/excels-icon.svg"
          alt="엑셀 다운로드"
          width="14"
          height="14"
          className={`inline-block align-middle shrink-0 transition-transform p-0.5 rounded
            ${purchase.is_po_download ? 'border border-gray-400' : ''}
            ${downloadable ? 'cursor-pointer hover:scale-110' : 'opacity-40 grayscale cursor-not-allowed'}`}
          onClick={async (e: React.MouseEvent) => {
            if (!downloadable) return
            e.stopPropagation()
            await onExcelDownload(purchase)
          }}
          style={{ pointerEvents: downloadable ? 'auto' : 'none' }}
          title={purchase.is_po_download ? '다운로드 완료' : '엑셀 발주서 다운로드'}
        />
      )}
      <span className="block truncate" title={purchase.purchase_order_number || ''}>
        {purchase.purchase_order_number || '-'}
        {purchase.purchase_request_items && purchase.purchase_request_items.length > 1 && (
          <span className="text-gray-500 ml-0.5">({purchase.purchase_request_items.length})</span>
        )}
        {purchase.is_free_sample && (
          <span
            className="ml-1 inline-flex items-center px-1 text-[9px] font-semibold rounded bg-purple-100 text-purple-700 align-middle"
            title="무상샘플"
          >
            샘플
          </span>
        )}
      </span>
    </div>
  )
})
OrderNumberCell.displayName = 'OrderNumberCell'

// 결제종류 배지 (표시 텍스트 통일 포함)
export const PaymentCategoryBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const c = purchase.payment_category
  const className =
    c === '구매요청' || c === '구매 요청' ? 'bg-blue-500 text-white' :
    c === '발주' ? 'bg-green-500 text-white' :
    'bg-gray-500 text-white'
  const text =
    c === '발주' ? '발주요청' :
    c === '구매 요청' ? '구매요청' :
    c === '현장 결제' ? '현장결제' :
    c || '-'
  return <span className={`badge-stats ${className}`}>{text}</span>
})
PaymentCategoryBadge.displayName = 'PaymentCategoryBadge'

// 수량 셀 — 입고/전체 탭은 "요청수량/입고수량" 병기, 완전 입고 시 입고수량만 검정 표시
export const QuantityCell = memo(({ purchase, activeTab }: { purchase: Purchase; activeTab: string }) => {
  const items = purchase.purchase_request_items || []
  const quantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0)
  if (activeTab !== 'receipt' && activeTab !== 'done') return <>{quantity || 0}</>

  const receivedQuantity = items.reduce((sum, item) => sum + (item.received_quantity || 0), 0)
  if (quantity === receivedQuantity && receivedQuantity > 0) {
    return <span className="text-gray-900">{receivedQuantity}</span>
  }
  const hasReceived = receivedQuantity > 0
  return (
    <span className="whitespace-nowrap">
      <span className={hasReceived ? 'text-gray-400' : ''}>{quantity}</span>
      <span className={hasReceived ? '' : 'text-gray-400'}>/{receivedQuantity}</span>
    </span>
  )
})
QuantityCell.displayName = 'QuantityCell'

// 단가 셀 — 품목 2개 이상이면 '-'
export const UnitPriceCell = memo(({ purchase }: { purchase: Purchase }) => {
  const items = purchase.purchase_request_items || []
  if (items.length > 1) return <>-</>
  const unitPrice = items[0]?.unit_price_value || 0
  const currency = items[0]?.unit_price_currency || 'KRW'
  return <>{`${unitPrice.toLocaleString()} ${getCurrencySymbol(currency)}`}</>
})
UnitPriceCell.displayName = 'UnitPriceCell'

// 합계 셀 — 품목 합계 (발주 카테고리는 세액 포함)
export const AmountCell = memo(({ purchase }: { purchase: Purchase }) => {
  const items = purchase.purchase_request_items || []
  const totalAmount = items.reduce((sum, item) => {
    const baseAmount = item.amount_value || 0
    const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0
    return sum + baseAmount + taxAmount
  }, 0)
  const currency = items[0]?.amount_currency || purchase.currency || 'KRW'
  return <>{`${totalAmount.toLocaleString()} ${getCurrencySymbol(currency)}`}</>
})
AmountCell.displayName = 'AmountCell'

// UTK 확인 셀 (전체항목 탭) — 권한자는 클릭 토글
export const UtkCell = memo(({ purchase, canUtkCheck, onToggleUtkCheck }: {
  purchase: Purchase
  canUtkCheck: boolean
  onToggleUtkCheck?: (p: Purchase) => Promise<void> | void
}) => {
  const badgeClass = purchase.is_utk_checked ? 'badge-utk-complete' : 'badge-utk-pending'
  const text = purchase.is_utk_checked ? '완료' : '대기'
  if (!canUtkCheck) return <span className={badgeClass}>{text}</span>
  return (
    <button
      type="button"
      onClick={async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onToggleUtkCheck?.(purchase)
      }}
      className={`${badgeClass} mx-auto cursor-pointer`}
      title={purchase.is_utk_checked ? 'UTK 확인 취소' : 'UTK 확인'}
    >
      {text}
    </button>
  )
})
UtkCell.displayName = 'UtkCell'

// 링크 셀
export const LinkCell = memo(({ purchase }: { purchase: Purchase }) => {
  const link = purchase.purchase_request_items?.[0]?.link
  if (!link) return <span className="text-gray-400">-</span>
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline truncate block"
      title={link}
      onClick={(e) => e.stopPropagation()}
    >
      링크 보기
    </a>
  )
})
LinkCell.displayName = 'LinkCell'
