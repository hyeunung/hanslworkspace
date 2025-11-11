import { memo } from 'react'
import { Eye } from 'lucide-react'
import { Purchase } from '@/types/purchase'
import { formatDateShort } from '@/utils/helpers'

interface MobilePurchaseCardProps {
  purchase: Purchase
  onClick: (purchase: Purchase) => void
}


const getReceiptProgress = (purchase: Purchase) => {
  if (!purchase.purchase_request_items || purchase.purchase_request_items.length === 0) return { received: 0, total: 0, percentage: 0 }
  
  const total = purchase.purchase_request_items.length
  const received = purchase.purchase_request_items.filter((item: any) => 
    item.actual_received_date !== null && item.actual_received_date !== undefined
  ).length
  const percentage = total > 0 ? Math.round((received / total) * 100) : 0
  
  return { received, total, percentage }
}

const StatusBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const status = purchase.is_received 
    ? 'completed'
    : (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved')
    ? 'inProgress'
    : (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected')
    ? 'rejected'
    : 'pending'
  
  const config = {
    completed: { text: '입고완료', className: 'badge-success' },
    inProgress: { text: '구매진행', className: 'badge-primary' },
    rejected: { text: '반려', className: 'badge-danger' },
    pending: { text: '승인대기', className: 'badge-warning' }
  }
  
  const { text, className } = config[status]
  return <span className={`badge-stats ${className}`}>{text}</span>
})

StatusBadge.displayName = 'StatusBadge'

const MobilePurchaseCard = memo(({ purchase, onClick }: MobilePurchaseCardProps) => {
  const receiptProgress = getReceiptProgress(purchase)
  const isAdvance = purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행')
  
  return (
    <div 
      className={`bg-white rounded-lg border p-4 space-y-3 cursor-pointer transition-all hover:shadow-md ${isAdvance ? 'border-red-400 bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
      onClick={() => onClick(purchase)}
    >
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {isAdvance ? (
              <span className="badge-stats bg-red-500 text-white">
                선진행
              </span>
            ) : (
              <span className="badge-stats bg-gray-500 text-white">
                일반
              </span>
            )}
            <span className="card-title text-gray-900">
              {purchase.purchase_order_number || '-'}
            </span>
          </div>
          <div className="badge-text text-gray-500 mt-1">
            {formatDateShort(purchase.request_date)} 요청
          </div>
        </div>
        <StatusBadge purchase={purchase} />
      </div>

      {/* 중간 정보 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between card-subtitle">
          <span className="text-gray-600">요청자</span>
          <span className="card-title">{purchase.requester_name}</span>
        </div>
        <div className="flex items-center justify-between card-subtitle">
          <span className="text-gray-600">업체</span>
          <span className="card-title">{purchase.vendor_name}</span>
        </div>
        {purchase.project_vendor && (
          <div className="flex items-center justify-between card-subtitle">
            <span className="text-gray-600">PJ업체</span>
            <span className="card-title truncate max-w-[150px]">{purchase.project_vendor}</span>
          </div>
        )}
        {purchase.project_item && (
          <div className="flex items-center justify-between card-subtitle">
            <span className="text-gray-600">PJ ITEM</span>
            <span className="card-title truncate max-w-[150px]">{purchase.project_item}</span>
          </div>
        )}
        {purchase.sales_order_number && (
          <div className="flex items-center justify-between card-subtitle">
            <span className="text-gray-600">수주번호</span>
            <span className="card-title truncate max-w-[150px]">{purchase.sales_order_number}</span>
          </div>
        )}
        {purchase.item_name && (
          <div className="flex items-center justify-between card-subtitle">
            <span className="text-gray-600">품목</span>
            <span className="card-title truncate max-w-[150px]">{purchase.item_name}</span>
          </div>
        )}
        <div className="flex items-center justify-between card-subtitle">
          <span className="text-gray-600">금액</span>
          <span className="font-semibold text-gray-900">
            {(purchase.amount_value || purchase.total_amount)?.toLocaleString()} {purchase.currency}
          </span>
        </div>
      </div>

      {/* 입고 현황 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between badge-text">
          <span className="text-gray-600">입고현황</span>
          <span className="text-gray-700">
            {receiptProgress.received}/{receiptProgress.total} ({receiptProgress.percentage}%)
          </span>
        </div>
        <div className="bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all ${
              receiptProgress.percentage === 100 ? 'bg-green-500' : 
              receiptProgress.percentage > 0 ? 'bg-hansl-500' : 'bg-gray-300'
            }`}
            style={{ width: `${receiptProgress.percentage}%` }}
          />
        </div>
      </div>

      {/* 결제 상태 */}
      {purchase.is_payment_completed !== undefined && (
        <div className="flex items-center justify-between card-subtitle">
          <span className="text-gray-600">결제</span>
          {purchase.is_payment_completed ? (
            <span className="badge-stats bg-green-500 text-white">완료</span>
          ) : (
            <span className="badge-stats bg-gray-500 text-white">대기</span>
          )}
        </div>
      )}

      {/* 카드 전체가 클릭 가능하므로 버튼 제거 */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-center badge-text text-gray-500">
          <Eye className="w-3 h-3 mr-1" />
          클릭하여 상세보기
        </div>
      </div>
    </div>
  )
})

MobilePurchaseCard.displayName = 'MobilePurchaseCard'

export default MobilePurchaseCard