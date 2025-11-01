import React, { useState, useEffect } from 'react'
import { 
  Dialog, 
  DialogContent
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { 
  ShoppingCart, 
  Truck, 
  Package, 
  CheckCircle,
  Clock,
  ArrowRight,
  X,
  CheckCircle2
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

interface PurchaseStatusModalProps {
  isOpen: boolean
  onClose: () => void
  item: any
  type: 'pending' | 'purchase' | 'delivery' | 'completed'
  onRefresh?: () => void
}

export default function PurchaseStatusModal({ 
  isOpen, 
  onClose, 
  item, 
  type,
  onRefresh
}: PurchaseStatusModalProps) {
  const navigate = useNavigate()
  const supabase = createClient()
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [localItem, setLocalItem] = useState(item)

  // localItem을 item prop 변경 시 업데이트
  useEffect(() => {
    setLocalItem(item)
  }, [item])

  // Get current user roles
  useEffect(() => {
    const fetchUserRoles = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user?.email) {
        const { data: employee } = await supabase
          .from('employees')
          .select('purchase_role')
          .eq('email', user.email)
          .single()
        
        
        if (employee?.purchase_role) {
          // purchase_role이 이미 배열이면 그대로 사용, 문자열이면 split
          const roles = Array.isArray(employee.purchase_role) 
            ? employee.purchase_role 
            : employee.purchase_role.split(',').map((r: string) => r.trim())
          setCurrentUserRoles(roles)
        } else {
        }
      }
    }
    fetchUserRoles()
  }, [type])

  if (!localItem) return null

  const items = localItem.purchase_request_items || []
  const totalAmount = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.amount_value) || 0)
  }, 0)
  const totalQuantity = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.quantity) || 0)
  }, 0)
  
  // 디버깅
  logger.debug('PurchaseStatusModal 디버깅', {
    type,
    currentUserRoles,
    item: localItem.purchase_order_number,
    showPurchaseButton: type === 'purchase',
    showDeliveryButton: type === 'delivery',
    hasAdminPermission: currentUserRoles.includes('app_admin'),
    hasLeadBuyerPermission: currentUserRoles.includes('lead buyer'),
    itemData: {
      is_payment_completed: localItem.is_payment_completed,
      is_received: localItem.is_received
    }
  })

  const getTypeInfo = () => {
    switch (type) {
      case 'pending':
        return {
          icon: <Clock className="w-6 h-6 text-orange-600" />,
          title: '승인 대기',
          status: '승인 처리 대기중',
          color: 'bg-orange-50 text-orange-700 border-orange-200'
        }
      case 'purchase':
        return {
          icon: <ShoppingCart className="w-6 h-6 text-yellow-600" />,
          title: '구매 대기',
          status: '구매 처리 대기중',
          color: 'bg-yellow-50 text-yellow-700 border-yellow-200'
        }
      case 'delivery':
        return {
          icon: <Truck className="w-6 h-6 text-blue-600" />,
          title: '입고 대기',
          status: '입고 처리 대기중',
          color: 'bg-blue-50 text-blue-700 border-blue-200'
        }
      case 'completed':
        return {
          icon: <CheckCircle className="w-6 h-6 text-green-600" />,
          title: '처리 완료',
          status: '모든 처리 완료',
          color: 'bg-green-50 text-green-700 border-green-200'
        }
      default:
        return {
          icon: <Package className="w-6 h-6 text-gray-600" />,
          title: '상태 확인',
          status: '상태 확인 필요',
          color: 'bg-gray-50 text-gray-700 border-gray-200'
        }
    }
  }

  const typeInfo = getTypeInfo()

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="overflow-hidden bg-white rounded-3xl shadow-2xl border-0"
        style={{ maxWidth: '1280px', width: '90vw', maxHeight: '50vh' }}
        showCloseButton={false}
      >
        {/* Apple-style Header */}
        <div className="relative px-6 pt-6 pb-4">
          <button
            onClick={onClose}
            className="absolute right-6 top-6 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all duration-200"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
          
          <div className="pr-16">
            <div className="flex items-start gap-4 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                {typeInfo.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="modal-title mb-1">
                  {localItem.purchase_order_number || 'PO번호 없음'}
                </h1>
                <p className="modal-subtitle">{localItem.vendor_name || '업체명 없음'}</p>
              </div>
              <div className={`px-3 py-1.5 business-radius-badge badge-text ${typeInfo.color}`}>
                {typeInfo.title}
              </div>
            </div>
          </div>
        </div>

        {/* Apple-style Content */}
        <div className="overflow-y-auto max-h-[calc(50vh-160px)] px-6 pb-4 space-y-3">
          
          {/* Dense Basic Information Grid */}
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div><span className="modal-label">요청자:</span> <span className="modal-value">{localItem.requester_name}</span></div>
              <div><span className="modal-label">요청일:</span> <span className="modal-value">{new Date(localItem.request_date || localItem.created_at).toLocaleDateString('ko-KR')}</span></div>
              <div><span className="modal-label">납기요청일:</span> <span className="modal-value">{localItem.delivery_request_date ? new Date(localItem.delivery_request_date).toLocaleDateString('ko-KR') : '미지정'}</span></div>
              
              <div><span className="modal-label">업체명:</span> <span className="modal-value">{localItem.vendor_name || '-'}</span></div>
              <div><span className="modal-label">결제유형:</span> <span className="modal-value">{localItem.payment_category || '일반'}</span></div>
              <div><span className="modal-label">진행구분:</span> <span className="modal-value">{localItem.progress_type || '일반'}</span></div>
              
              <div><span className="modal-label">프로젝트업체:</span> <span className="modal-value">{localItem.project_vendor || '-'}</span></div>
              <div><span className="modal-label">판매주문번호:</span> <span className="modal-value">{localItem.sales_order_number || '-'}</span></div>
              <div><span className="modal-label">배송지:</span> <span className="modal-value">{localItem.shipping_address || '본사'}</span></div>
              
              <div><span className="modal-label">통화:</span> <span className="modal-value">{localItem.currency || 'KRW'}</span></div>
              <div><span className="modal-label">템플릿:</span> <span className="modal-value">{localItem.po_template_type || '일반'}</span></div>
              {localItem.revised_delivery_request_date && (
                <div><span className="modal-label text-orange-500">변경입고일:</span> <span className="modal-value text-orange-900">{new Date(localItem.revised_delivery_request_date).toLocaleDateString('ko-KR')}</span></div>
              )}
            </div>
          </div>


          {/* Compact Items Table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
              <h3 className="modal-section-title text-gray-700">주문 품목 ({items.length}개, 총 ₩{totalAmount.toLocaleString()})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  {(type === 'delivery' || type === 'purchase') && <col className="w-[15%]" />}
                </colgroup>
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left p-2 modal-label text-gray-600">품목명</th>
                    <th className="text-left p-2 modal-label text-gray-600">규격</th>
                    <th className="text-right p-2 modal-label text-gray-600">수량</th>
                    <th className="text-right p-2 modal-label text-gray-600">단가</th>
                    <th className="text-right p-2 modal-label text-gray-600">금액</th>
                    {type === 'delivery' && <th className="text-center p-2 modal-label text-gray-600">입고상태</th>}
                    {type === 'purchase' && <th className="text-center p-2 modal-label text-gray-600">구매상태</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((pItem: any, index: number) => {
                    const unitPrice = pItem.quantity > 0 ? (Number(pItem.amount_value) || 0) / pItem.quantity : 0
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="p-2">
                          <div className="modal-value text-gray-900">{pItem.item_name || '품목명 없음'}</div>
                          {pItem.remark && (
                            <div className="text-xs text-amber-600 mt-1">비고: {pItem.remark}</div>
                          )}
                        </td>
                        <td className="p-2 text-gray-600">{pItem.specification || '-'}</td>
                        <td className="p-2 text-right modal-value">{pItem.quantity || 0}</td>
                        <td className="p-2 text-right">₩{unitPrice.toLocaleString()}</td>
                        <td className="p-2 text-right modal-value">₩{(Number(pItem.amount_value) || 0).toLocaleString()}</td>
                        {type === 'delivery' && (
                          <td className="p-2 text-center">
                            {pItem.is_received ? (
                              <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 px-2 py-1 business-radius-badge text-xs border border-green-200">
                                <CheckCircle2 className="w-3 h-3" />
                                완료
                              </span>
                            ) : (
                              (currentUserRoles.includes('app_admin') || 
                               currentUserRoles.includes('requester')) && (
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    if (!confirm('이 품목을 입고완료 처리하시겠습니까?')) return
                                    
                                    try {
                                      const { error } = await supabase
                                        .from('purchase_request_items')
                                        .update({ 
                                          is_received: true,
                                          received_at: new Date().toISOString()
                                        })
                                        .eq('id', pItem.id)

                                      if (error) throw error
                                      
                                      // 로컬 상태 업데이트
                                      setLocalItem(prev => ({
                                        ...prev,
                                        purchase_request_items: prev.purchase_request_items?.map((item: any) =>
                                          item.id === pItem.id ? { ...item, is_received: true, received_at: new Date().toISOString() } : item
                                        ) || []
                                      }))
                                      
                                      toast.success('입고완료 처리되었습니다.')
                                      if (onRefresh) onRefresh()
                                    } catch (error) {
                                      toast.error('처리 중 오류가 발생했습니다.')
                                    }
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 text-white h-6 px-2 text-xs"
                                >
                                  입고완료
                                </Button>
                              )
                            )}
                          </td>
                        )}
                        {type === 'purchase' && (
                          <td className="p-2 text-center">
                            {pItem.is_payment_completed ? (
                              <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 px-2 py-1 business-radius-badge text-xs border border-green-200">
                                <CheckCircle2 className="w-3 h-3" />
                                완료
                              </span>
                            ) : (
                              (currentUserRoles.includes('app_admin') || 
                               currentUserRoles.includes('lead buyer')) && (
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    if (!confirm('이 품목을 구매완료 처리하시겠습니까?')) return
                                    
                                    try {
                                      const { error } = await supabase
                                        .from('purchase_request_items')
                                        .update({ 
                                          is_payment_completed: true,
                                          payment_completed_at: new Date().toISOString()
                                        })
                                        .eq('id', pItem.id)

                                      if (error) throw error
                                      
                                      // 로컬 상태 업데이트
                                      setLocalItem((prev: any) => ({
                                        ...prev,
                                        purchase_request_items: prev.purchase_request_items?.map((item: any) =>
                                          item.id === pItem.id 
                                            ? { ...item, is_payment_completed: true, payment_completed_at: new Date().toISOString() }
                                            : item
                                        )
                                      }))
                                      
                                      toast.success('품목 구매완료 처리되었습니다.')
                                      onRefresh?.()
                                    } catch (error) {
                                      toast.error('처리 중 오류가 발생했습니다.')
                                    }
                                  }}
                                  className="bg-yellow-600 hover:bg-yellow-700 text-white px-2 py-1 badge-text"
                                >
                                  구매완료
                                </Button>
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compact Delivery Progress */}
          {type === 'delivery' && items.length > 1 && (
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
              {(() => {
                const receivedCount = items.filter((i: any) => i.is_received).length
                const totalCount = items.length
                const percentage = (receivedCount / totalCount) * 100
                
                return (
                  <div className="flex items-center gap-4">
                    <div className="modal-value text-blue-700">입고 진행률</div>
                    <div className="flex-1 bg-blue-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="modal-value text-blue-700">{receivedCount}/{totalCount} ({percentage.toFixed(0)}%)</div>
                  </div>
                )
              })()}
            </div>
          )}

        </div>
        
        {/* Apple-style Action Bar */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-6">
          <div className="flex items-center justify-between gap-6">
            {/* Purchase Complete Button - for purchase type with permissions */}
            {type === 'purchase' && 
             (currentUserRoles.includes('app_admin') || 
              currentUserRoles.includes('lead buyer')) && (
              <Button
                onClick={async () => {
                  setProcessing(true)
                  try {
                    const { error } = await supabase
                      .from('purchase_requests')
                      .update({ 
                        is_payment_completed: true,
                        payment_completed_at: new Date().toISOString()
                      })
                      .eq('id', localItem.id)

                    if (error) throw error
                    
                    setLocalItem((prev: any) => ({
                      ...prev,
                      is_payment_completed: true,
                      payment_completed_at: new Date().toISOString()
                    }))
                    
                    toast.success('구매완료 처리되었습니다.')
                    onRefresh?.()
                  } catch (error) {
                    toast.error('처리 중 오류가 발생했습니다.')
                  } finally {
                    setProcessing(false)
                  }
                }}
                disabled={processing}
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-8 py-4 rounded-2xl shadow-lg transition-all duration-200 modal-subtitle"
              >
                {processing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 mr-3" />
                )}
                구매 완료 처리
              </Button>
            )}

            <div className="flex items-center gap-4 ml-auto">
              <Button
                variant="outline"
                onClick={() => {
                  navigate(`/purchase?highlight=${localItem.id}`)
                  onClose()
                }}
                className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 px-8 py-4 rounded-2xl modal-subtitle transition-all duration-200"
              >
                발주 목록에서 보기
                <ArrowRight className="w-5 h-5 ml-3" />
              </Button>
              <Button 
                onClick={onClose} 
                className="bg-gray-900 hover:bg-gray-800 text-white px-10 py-4 rounded-2xl modal-subtitle transition-all duration-200 shadow-lg"
              >
                완료
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}