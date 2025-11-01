
import { useState } from 'react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { 
  CheckCircle, 
  XCircle, 
  User, 
  Building2, 
  Calendar, 
  DollarSign,
  FileText,
  Package
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { formatCurrency } from '@/utils/purchase'

interface ApprovalModalProps {
  approval: PurchaseRequestWithDetails
  type: 'approve' | 'reject'
  open: boolean
  onClose: () => void
  onSubmit: (comment?: string) => void
}

export default function ApprovalModal({
  approval,
  type,
  open,
  onClose,
  onSubmit
}: ApprovalModalProps) {
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await onSubmit(comment.trim() || undefined)
    } catch (_error) {
      // 에러는 상위 컴포넌트에서 처리
    } finally {
      setLoading(false)
    }
  }


  const getModalTitle = () => {
    if (type === 'approve') {
      // 현재 상태에 따라 승인 타이틀 결정
      if (approval.middle_manager_status === 'pending') {
        return '1차 승인'
      } else if (approval.final_manager_status === 'pending') {
        return '최종 승인'
      } else {
        return '구매 처리'
      }
    }
    return '반려'
  }

  const getActionButtonText = () => {
    if (type === 'approve') {
      if (approval.middle_manager_status === 'approved' && 
          approval.final_manager_status === 'approved') {
        return '구매 처리 완료'
      }
      return '승인'
    }
    return '반려'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'approve' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600" />
            )}
            {getModalTitle()}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 발주 기본 정보 */}
          <div className="bg-gray-50 p-4 business-radius-card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="modal-section-title">
                {approval.purchase_order_number || `발주 #${approval.id?.toString().slice(-8)}`}
              </h3>
              <div className="flex gap-2">
                <Badge variant={approval.progress_type === '선진행' ? 'default' : 'secondary'}>
                  {approval.progress_type}
                </Badge>
                <Badge variant="outline">
                  {approval.request_type}
                </Badge>
              </div>
            </div>
            
            {/* 승인 버튼을 별도 행으로 배치 */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={loading}
                size="sm"
              >
                취소
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || (type === 'reject' && !comment.trim())}
                size="sm"
                className={
                  type === 'approve' 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-red-600 hover:bg-red-700'
                }
              >
                {loading ? '처리 중...' : getActionButtonText()}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="modal-label text-gray-500">요청자</p>
                  <p className="modal-value">{approval.requester_name}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="modal-label text-gray-500">업체</p>
                  <p className="modal-value">{approval.vendor?.vendor_name || '알 수 없음'}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="modal-label text-gray-500">요청일</p>
                  <p className="modal-value">
                    {format(new Date(approval.request_date), 'yyyy년 MM월 dd일', { locale: ko })}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="modal-label text-gray-500">총액</p>
                  <p className="modal-value-large">
                    {formatCurrency(approval.total_amount, approval.currency as 'KRW' | 'USD')}
                  </p>
                </div>
              </div>
            </div>

            {approval.delivery_request_date && (
              <div className="pt-2 border-t border-gray-200">
                <p className="modal-value">
                  <span className="modal-value">납기 요청일:</span>{' '}
                  {format(new Date(approval.delivery_request_date), 'yyyy년 MM월 dd일', { locale: ko })}
                </p>
              </div>
            )}
          </div>

          {/* 프로젝트 정보 */}
          {(approval.project_vendor || approval.project_item) && (
            <div className="space-y-2">
              <h4 className="modal-section-title flex items-center gap-2">
                <Package className="w-4 h-4" />
                프로젝트 정보
              </h4>
              <div className="bg-hansl-50 p-3 business-radius-card space-y-2">
                {approval.project_vendor && (
                  <div>
                    <p className="modal-label text-gray-500">프로젝트 업체</p>
                    <p className="modal-value">{approval.project_vendor}</p>
                  </div>
                )}
                {approval.project_item && (
                  <div>
                    <p className="modal-label text-gray-500">프로젝트 품목</p>
                    <p className="modal-value">{approval.project_item}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 품목 목록 */}
          <div className="space-y-2">
            <h4 className="modal-section-title flex items-center gap-2">
              <FileText className="w-4 h-4" />
              품목 목록 ({approval.items?.length || 0}건)
            </h4>
            <div className="max-h-60 overflow-y-auto border business-radius-card">
              {approval.items?.map((item, index) => (
                <div key={item.id || index} className="p-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="modal-value">{item.item_name}</p>
                      {item.specification && (
                        <p className="card-description mt-1">{item.specification}</p>
                      )}
                      <div className="flex gap-4 mt-2 card-description">
                        <span>수량: {item.quantity.toLocaleString()}</span>
                        <span>
                          단가: {item.unit_price_value ? formatCurrency(item.unit_price_value, (item.unit_price_currency || 'KRW') as 'KRW' | 'USD') : '-'}
                        </span>
                      </div>
                      {item.remark && (
                        <p className="text-xs text-gray-500 mt-1">비고: {item.remark}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="modal-value">
                        {item.amount_value ? formatCurrency(item.amount_value, (item.amount_currency || 'KRW') as 'KRW' | 'USD') : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 코멘트 입력 */}
          <div className="space-y-2">
            <label className="modal-label">
              {type === 'approve' ? '승인 코멘트 (선택사항)' : '반려 사유 (필수)'}
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                type === 'approve' 
                  ? '승인 관련 코멘트를 입력하세요...' 
                  : '반려 사유를 입력하세요...'
              }
              rows={3}
              required={type === 'reject'}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {/* 승인 버튼이 카드 안으로 이동했으므로 빈 footer */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}