
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Package, 
  User, 
  Calendar,
  DollarSign,
  Building2,
  FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { formatCurrency } from '@/utils/purchase'

interface ApprovalCardProps {
  approval: PurchaseRequestWithDetails
  onApprove: () => void
  onReject: () => void
  selected?: boolean
  onSelectionChange?: (checked: boolean) => void
  showBuyerActions?: boolean
}

export default function ApprovalCard({
  approval,
  onApprove,
  onReject,
  selected = false,
  onSelectionChange,
  showBuyerActions = false
}: ApprovalCardProps) {
  const getStatusBadge = () => {
    if (approval.middle_manager_status === 'pending') {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          1차 승인 대기
        </Badge>
      )
    }
    
    if (approval.middle_manager_status === 'approved' && approval.final_manager_status === 'pending') {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          최종 승인 대기
        </Badge>
      )
    }
    
    if (approval.middle_manager_status === 'approved' && 
        approval.final_manager_status === 'approved' && 
        approval.purchase_status === 'pending') {
      return (
        <Badge variant="default" className="flex items-center gap-1">
          <Package className="w-3 h-3" />
          구매 처리 대기
        </Badge>
      )
    }
    
    return null
  }

  const getUrgencyLevel = () => {
    const requestDate = new Date(approval.request_date)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays >= 7) return 'high'
    if (diffDays >= 3) return 'medium'
    return 'low'
  }

  const urgency = getUrgencyLevel()
  
  const getUrgencyColor = (level: string) => {
    switch (level) {
      case 'high': return 'border-red-200 bg-red-50'
      case 'medium': return 'border-yellow-200 bg-yellow-50'
      default: return 'border-gray-200 bg-white'
    }
  }


  const getTotalItemsText = () => {
    const itemCount = approval.items?.length || 0
    if (itemCount === 0) return '품목 없음'
    if (itemCount === 1) return approval.items?.[0]?.item_name || '품목명 없음'
    return `${approval.items?.[0]?.item_name || '품목명 없음'} 외 ${itemCount - 1}건`
  }

  return (
    <Card className={`transition-all hover:shadow-md ${getUrgencyColor(urgency)}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {onSelectionChange && (
              <Checkbox
                checked={selected}
                onCheckedChange={onSelectionChange}
                className="mt-1"
              />
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">
                  {approval.purchase_order_number || `발주 #${approval.id?.toString().slice(-8)}`}
                </h3>
                {urgency === 'high' && (
                  <Badge variant="destructive" className="text-xs">
                    긴급
                  </Badge>
                )}
                {urgency === 'medium' && (
                  <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">
                    주의
                  </Badge>
                )}
              </div>
              {getStatusBadge()}
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <XCircle className="w-4 h-4 mr-1" />
              반려
            </Button>
            <Button
              size="sm"
              onClick={onApprove}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              {showBuyerActions ? '구매처리' : '승인'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 기본 정보 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-500" />
            <div>
              <p className="text-xs text-gray-500">요청자</p>
              <p className="font-medium">{approval.requester_name}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-500" />
            <div>
              <p className="text-xs text-gray-500">업체</p>
              <p className="font-medium">{approval.vendor?.vendor_name || '알 수 없음'}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <div>
              <p className="text-xs text-gray-500">요청일</p>
              <p className="font-medium">
                {format(new Date(approval.request_date), 'MM/dd', { locale: ko })}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-gray-500" />
            <div>
              <p className="text-xs text-gray-500">총액</p>
              <p className="font-medium">
                {formatCurrency(approval.total_amount, approval.currency as 'KRW' | 'USD')}
              </p>
            </div>
          </div>
        </div>

        {/* 품목 정보 */}
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500 mb-1">품목</p>
            <p className="font-medium">{getTotalItemsText()}</p>
          </div>
        </div>

        {/* 프로젝트 정보 */}
        {(approval.project_vendor || approval.project_item) && (
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {approval.project_vendor && (
                <div>
                  <p className="text-xs text-gray-500">프로젝트 업체</p>
                  <p className="text-sm font-medium">{approval.project_vendor}</p>
                </div>
              )}
              {approval.project_item && (
                <div>
                  <p className="text-xs text-gray-500">프로젝트 품목</p>
                  <p className="text-sm font-medium">{approval.project_item}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 특이사항 */}
        <div className="flex gap-2">
          <Badge variant={approval.progress_type === '선진행' ? 'default' : 'secondary'}>
            {approval.progress_type}
          </Badge>
          <Badge variant="outline">
            {approval.request_type}
          </Badge>
          <Badge variant="outline">
            {approval.payment_category}
          </Badge>
        </div>

        {/* 납기 요청일 */}
        {approval.delivery_request_date && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">납기 요청일:</span>{' '}
            {format(new Date(approval.delivery_request_date), 'yyyy년 MM월 dd일', { locale: ko })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}