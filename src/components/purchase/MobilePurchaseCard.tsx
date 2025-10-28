import { memo } from 'react'
import { Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Purchase } from '@/types/purchase'
import { formatDateShort } from '@/utils/helpers'

interface MobilePurchaseCardProps {
  purchase: Purchase
  onClick: (purchase: Purchase) => void
}

// formatDateShort는 utils/helpers.ts에서 import

const getReceiptProgress = (purchase: Purchase) => {
  if (!purchase.items || purchase.items.length === 0) return { received: 0, total: 0, percentage: 0 }
  
  const total = purchase.items.length
  const received = purchase.items.filter((item: any) => item.is_received || item.delivery_status === 'received').length
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
    completed: { text: '입고완료', className: 'bg-green-100 text-green-800' },
    inProgress: { text: '구매진행', className: 'bg-hansl-100 text-hansl-800' },
    rejected: { text: '반려', className: 'bg-red-100 text-red-800' },
    pending: { text: '승인대기', className: 'bg-yellow-100 text-yellow-800' }
  }
  
  const { text, className } = config[status]
  return <Badge className={`${className} text-xs`}>{text}</Badge>
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
              <Badge className="bg-red-500 text-white font-bold text-xs px-2 py-0.5">
                선진행
              </Badge>
            ) : (
              <Badge className="bg-gray-200 text-gray-700 text-xs px-2 py-0.5">
                일반
              </Badge>
            )}
            <span className="font-semibold text-sm text-gray-900">
              {purchase.purchase_order_number || '-'}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {formatDateShort(purchase.request_date)} 요청
          </div>
        </div>
        <StatusBadge purchase={purchase} />
      </div>

      {/* 중간 정보 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">요청자</span>
          <span className="font-medium">{purchase.requester_name}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">업체</span>
          <span className="font-medium">{purchase.vendor_name}</span>
        </div>
        {purchase.project_vendor && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">PJ업체</span>
            <span className="font-medium truncate max-w-[150px]">{purchase.project_vendor}</span>
          </div>
        )}
        {purchase.project_item && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">PJ ITEM</span>
            <span className="font-medium truncate max-w-[150px]">{purchase.project_item}</span>
          </div>
        )}
        {purchase.sales_order_number && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">수주번호</span>
            <span className="font-medium truncate max-w-[150px]">{purchase.sales_order_number}</span>
          </div>
        )}
        {purchase.item_name && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">품목</span>
            <span className="font-medium truncate max-w-[150px]">{purchase.item_name}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">금액</span>
          <span className="font-semibold text-gray-900">
            {(purchase.amount_value || purchase.total_amount)?.toLocaleString()} {purchase.currency}
          </span>
        </div>
      </div>

      {/* 입고 현황 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
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
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">결제</span>
          {purchase.is_payment_completed ? (
            <Badge className="bg-green-100 text-green-800 text-xs">완료</Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-800 text-xs">대기</Badge>
          )}
        </div>
      )}

      {/* 카드 전체가 클릭 가능하므로 버튼 제거 */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-center text-xs text-gray-500">
          <Eye className="w-3 h-3 mr-1" />
          클릭하여 상세보기
        </div>
      </div>
    </div>
  )
})

MobilePurchaseCard.displayName = 'MobilePurchaseCard'

export default MobilePurchaseCard