
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { ArrowLeft, Calendar, User, Building2, Package, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function PurchaseDetailMain() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [purchase, setPurchase] = useState<PurchaseRequestWithDetails | null>(null)

  useEffect(() => {
    if (id) {
      loadPurchaseDetail(id)
    }
  }, [id])

  const loadPurchaseDetail = async (purchaseId: string) => {
    try {
      const supabase = createClient()
      
      
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*,vendors(id,vendor_name),purchase_request_items(*)')
        .eq('id', purchaseId)
        .single()


      if (error) throw error

      if (data) {
        setPurchase({
          ...data,
          items: data.purchase_request_items || [],
          vendor: data.vendors || { id: 0, vendor_name: '알 수 없음' },
          vendor_contacts: []
        } as PurchaseRequestWithDetails)
      }
    } catch (error) {
      toast.error('발주 상세 정보를 불러오는데 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <span className="badge-stats bg-green-500 text-white">승인</span>
      case 'rejected':
        return <span className="badge-stats bg-red-500 text-white">반려</span>
      case 'pending':
        return <span className="badge-stats bg-yellow-500 text-white">대기</span>
      default:
        return <span className="badge-stats bg-gray-500 text-white">-</span>
    }
  }

  const getDeliveryStatusBadge = (status: string | null) => {
    switch (status) {
      case 'completed':
        return <span className="badge-stats bg-green-500 text-white">납품완료</span>
      case 'partial':
        return <span className="badge-stats bg-yellow-500 text-white">부분납품</span>
      case 'pending':
        return <span className="badge-stats bg-gray-500 text-white">납품대기</span>
      default:
        return <span className="badge-stats bg-gray-500 text-white">-</span>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!purchase) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">발주 정보를 찾을 수 없습니다</h3>
        <Button onClick={() => navigate('/purchase/list')} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          목록으로 돌아가기
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/purchase/list')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            목록으로
          </Button>
          <h1 className="text-2xl font-semibold text-gray-900">
            발주 상세 - {purchase.order_number}
          </h1>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-600 mb-1">1차 승인</p>
          {getStatusBadge(purchase.middle_manager_status)}
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-600 mb-1">최종 승인</p>
          {getStatusBadge(purchase.final_manager_status)}
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-600 mb-1">구매 처리</p>
          {getStatusBadge(purchase.is_payment_completed ? 'completed' : 'pending')}
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-600 mb-1">납품 상태</p>
          {getDeliveryStatusBadge(purchase.delivery_status || 'pending')}
        </div>
      </div>

      {/* Basic Info */}
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">기본 정보</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center text-sm text-gray-600 mb-1">
              <Calendar className="w-4 h-4 mr-2" />
              요청일
            </div>
            <p className="font-medium">
              {purchase.created_at ? new Date(purchase.created_at).toLocaleDateString('ko-KR') : '-'}
            </p>
          </div>
          
          <div>
            <div className="flex items-center text-sm text-gray-600 mb-1">
              <User className="w-4 h-4 mr-2" />
              요청자
            </div>
            <p className="font-medium">{purchase.requester_name || '-'}</p>
          </div>
          
          <div>
            <div className="flex items-center text-sm text-gray-600 mb-1">
              <Building2 className="w-4 h-4 mr-2" />
              업체명
            </div>
            <p className="font-medium">{purchase.vendor?.vendor_name || '-'}</p>
          </div>
          
          <div>
            <div className="flex items-center text-sm text-gray-600 mb-1">
              <CreditCard className="w-4 h-4 mr-2" />
              총 금액
            </div>
            <p className="font-medium">
              {purchase.total_amount?.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>

        {purchase.purpose && (
          <div>
            <p className="text-sm text-gray-600 mb-1">구매 목적</p>
            <p className="text-gray-900">{purchase.purpose}</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">구매 품목</h2>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  품목명
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  수량
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  단가
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  금액
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(purchase.items || []).map((item, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.item_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.quantity} {item.unit || '개'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.unit_price?.toLocaleString('ko-KR')}원
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {((item.quantity || 0) * (item.unit_price || 0)).toLocaleString('ko-KR')}원
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comments */}
      {(purchase.middle_manager_comment || purchase.final_manager_comment || purchase.purchase_comment) && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">처리 내역</h2>
          
          {purchase.middle_manager_comment && (
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">1차 승인자 코멘트</p>
              <p className="text-gray-900">{purchase.middle_manager_comment}</p>
            </div>
          )}
          
          {purchase.final_manager_comment && (
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">최종 승인자 코멘트</p>
              <p className="text-gray-900">{purchase.final_manager_comment}</p>
            </div>
          )}
          
          {purchase.purchase_comment && (
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">구매담당자 코멘트</p>
              <p className="text-gray-900">{purchase.purchase_comment}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}