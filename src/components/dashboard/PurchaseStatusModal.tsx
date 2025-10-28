import React, { useState, useEffect } from 'react'
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { 
  ShoppingCart, 
  Truck, 
  Package, 
  CheckCircle,
  Building2,
  Calendar,
  FileText,
  ArrowRight,
  User,
  CreditCard,
  MapPin,
  DollarSign
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface PurchaseStatusModalProps {
  isOpen: boolean
  onClose: () => void
  item: any
  type: 'purchase' | 'delivery' | 'completed'
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

  // Get current user roles
  useEffect(() => {
    const fetchUserRoles = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      console.log('Fetching roles for user:', user?.email)
      
      if (user?.email) {
        const { data: employee } = await supabase
          .from('employees')
          .select('purchase_role')
          .eq('email', user.email)
          .single()
        
        console.log('Employee data:', employee)
        
        if (employee?.purchase_role) {
          // purchase_role이 이미 배열이면 그대로 사용, 문자열이면 split
          const roles = Array.isArray(employee.purchase_role) 
            ? employee.purchase_role 
            : employee.purchase_role.split(',').map((r: string) => r.trim())
          console.log('Parsed roles:', roles)
          setCurrentUserRoles(roles)
        } else {
          console.log('No purchase_role found for employee')
        }
      }
    }
    fetchUserRoles()
  }, [type])

  if (!item) return null

  const items = item.purchase_request_items || []
  const totalAmount = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.amount_value) || 0)
  }, 0)
  const totalQuantity = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.quantity) || 0)
  }, 0)
  
  // 디버깅
  console.log('PurchaseStatusModal Debug:', {
    type,
    currentUserRoles,
    item: item.purchase_order_number,
    showPurchaseButton: type === 'purchase',
    hasPermission: currentUserRoles.includes('app_admin') || 
                   currentUserRoles.includes('lead buyer')
  })

  const getTypeInfo = () => {
    switch (type) {
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
    }
  }

  const typeInfo = getTypeInfo()

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {item.purchase_order_number || 'PO번호 없음'} 상세보기
          </DialogTitle>
          <DialogDescription>
            {item.vendor_name || '업체명 없음'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 기본 정보 */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="font-semibold mb-4 flex items-center text-gray-900">
              <FileText className="w-5 h-5 mr-2 text-gray-700" />
              기본 정보
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500 mb-1">요청자</p>
                <p className="font-medium text-gray-900">{item.requester_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">요청일</p>
                <p className="font-medium text-gray-900">
                  {new Date(item.request_date || item.created_at).toLocaleDateString('ko-KR')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">납기요청일</p>
                <p className="font-medium text-gray-900">
                  {item.delivery_request_date 
                    ? new Date(item.delivery_request_date).toLocaleDateString('ko-KR')
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">결제유형</p>
                <p className="font-medium text-gray-900">{item.payment_category || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">진행구분</p>
                <p className="font-medium text-gray-900">{item.progress_type || '일반'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">상태</p>
                <p className="font-medium">
                  <Badge className={typeInfo.color}>
                    {typeInfo.title}
                  </Badge>
                </p>
              </div>
            </div>
          </div>

          {/* 업체 정보 */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="font-semibold mb-4 flex items-center text-gray-900">
              <Building2 className="w-5 h-5 mr-2 text-gray-700" />
              업체 정보
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500 mb-1">업체명</p>
                <p className="font-medium text-gray-900">{item.vendor_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">프로젝트 업체</p>
                <p className="font-medium text-gray-900">{item.project_vendor || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">판매주문번호</p>
                <p className="font-medium text-gray-900">{item.sales_order_number || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">프로젝트 품목</p>
                <p className="font-medium text-gray-900">{item.project_item || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">발주서 템플릿</p>
                <p className="font-medium text-gray-900">{item.po_template_type || '일반'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">통화</p>
                <p className="font-medium text-gray-900">{item.currency || 'KRW'}</p>
              </div>
            </div>
          </div>

          {/* 품목 리스트 */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="font-semibold mb-4 flex items-center text-gray-900">
              <Package className="w-5 h-5 mr-2 text-gray-700" />
              품목 리스트
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-sm">
                <thead className="bg-gray-100">
                  <tr>
                    {type === 'purchase' && (
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">구매</th>
                    )}
                    {type === 'delivery' && (
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">입고</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">품명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">규격</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">수량</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">단가</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">금액</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">비고</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((pItem: any, index: number) => {
                    const unitPrice = pItem.quantity > 0 ? (Number(pItem.amount_value) || 0) / pItem.quantity : 0
                    return (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                        {type === 'purchase' && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center">
                              {item.is_payment_completed ? (
                                <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                                  구매완료
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-600 text-xs">
                                  구매대기
                                </Badge>
                              )}
                            </div>
                          </td>
                        )}
                        {type === 'delivery' && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center">
                              {pItem.is_received ? (
                                <Badge className="bg-green-100 text-green-800 text-xs">
                                  입고완료
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-600 text-xs">
                                  미입고
                                </Badge>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">{pItem.item_name || '품목명 없음'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{pItem.specification || '-'}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-medium text-gray-900">{pItem.quantity || 0}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-gray-900">₩{unitPrice.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-semibold text-gray-900">₩{(Number(pItem.amount_value) || 0).toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{pItem.remark || '-'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 총액 */}
            <div className="mt-6 bg-white rounded-lg p-4 shadow-sm">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-sm text-gray-600">총</span>
                  <span className="ml-1 font-semibold text-gray-900">{totalQuantity}개</span>
                  <span className="text-sm text-gray-600 ml-1">항목</span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-gray-600 block">총액</span>
                  <span className="font-bold text-xl text-gray-900">₩{totalAmount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 입고 진행률 (입고 대기인 경우) */}
          {type === 'delivery' && items.length > 1 && (
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">입고 진행 현황</h4>
              {(() => {
                const receivedCount = items.filter((i: any) => i.is_received).length
                const totalCount = items.length
                const percentage = (receivedCount / totalCount) * 100
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">입고 완료</span>
                      <span className="font-medium text-gray-900">{receivedCount}/{totalCount}개 ({percentage.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* 버튼 영역 */}
          <div className="flex justify-between gap-3 mt-6">
            <div className="flex gap-2">
              {/* 입고 완료 버튼 - 입고 대기 상태이고 권한 있을 때 */}
            {type === 'delivery' && 
             (currentUserRoles.includes('app_admin') || 
              currentUserRoles.includes('lead buyer') ||
              currentUserRoles.includes('receiver')) && (
              <Button
                onClick={async () => {
                  setProcessing(true)
                  try {
                    const { error } = await supabase
                      .from('purchase_requests')
                      .update({ 
                        is_received: true,
                        received_at: new Date().toISOString()
                      })
                      .eq('id', item.id)

                    if (error) throw error
                    
                    // 개별 품목도 모두 입고완료 처리
                    await supabase
                      .from('purchase_request_items')
                      .update({ 
                        is_received: true,
                        delivery_status: 'received'
                      })
                      .eq('purchase_request_id', item.id)
                    
                    toast.success('입고완료 처리되었습니다.')
                    onClose()
                    // 모달이 닫힌 후에 새로고침
                    setTimeout(() => {
                      onRefresh?.()
                    }, 100)
                  } catch (error) {
                    toast.error('처리 중 오류가 발생했습니다.')
                  } finally {
                    setProcessing(false)
                  }
                }}
                disabled={processing}
                className="bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                {processing ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                입고 완료 처리
              </Button>
            )}

            {/* 구매 완료 버튼 - 구매 대기 상태이고 권한 있을 때 */}
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
                      .eq('id', item.id)

                    if (error) throw error
                    
                    toast.success('구매완료 처리되었습니다.')
                    onClose()
                    // 모달이 닫힌 후에 새로고침
                    setTimeout(() => {
                      onRefresh?.()
                    }, 100)
                  } catch (error) {
                    toast.error('처리 중 오류가 발생했습니다.')
                  } finally {
                    setProcessing(false)
                  }
                }}
                disabled={processing}
                className="bg-yellow-600 hover:bg-yellow-700"
                size="sm"
              >
                {processing ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                ) : (
                  <CreditCard className="w-4 h-4 mr-2" />
                )}
                구매 완료 처리
              </Button>
            )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  navigate(`/purchase?highlight=${item.id}`)
                  onClose()
                }}
                size="sm"
              >
                발주 목록에서 보기
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button variant="ghost" onClick={onClose} size="sm">
                닫기
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}