import { useState } from 'react'
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
  MapPin
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface PurchaseStatusModalProps {
  isOpen: boolean
  onClose: () => void
  item: any
  type: 'purchase' | 'delivery' | 'completed'
}

export default function PurchaseStatusModal({ 
  isOpen, 
  onClose, 
  item, 
  type 
}: PurchaseStatusModalProps) {
  const navigate = useNavigate()

  if (!item) return null

  const items = item.purchase_request_items || []
  const totalAmount = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.amount_value) || 0)
  }, 0)
  const totalQuantity = items.reduce((sum: number, i: any) => {
    return sum + (Number(i.quantity) || 0)
  }, 0)

  const getTypeInfo = () => {
    switch (type) {
      case 'purchase':
        return {
          icon: <ShoppingCart className="w-5 h-5 text-yellow-600" />,
          title: '구매 대기',
          status: '구매 처리 대기중',
          color: 'bg-yellow-50 text-yellow-700 border-yellow-200'
        }
      case 'delivery':
        return {
          icon: <Truck className="w-5 h-5 text-blue-600" />,
          title: '입고 대기',
          status: '입고 처리 대기중',
          color: 'bg-blue-50 text-blue-700 border-blue-200'
        }
      case 'completed':
        return {
          icon: <CheckCircle className="w-5 h-5 text-green-600" />,
          title: '처리 완료',
          status: '모든 처리 완료',
          color: 'bg-green-50 text-green-700 border-green-200'
        }
    }
  }

  const typeInfo = getTypeInfo()

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {typeInfo.icon}
            {typeInfo.title} 상세정보
          </DialogTitle>
          <DialogDescription>
            발주요청 상세 정보 및 처리 현황
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 기본 정보 */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">업체명</p>
                    <p className="font-medium">{item.vendor_name || '업체명 없음'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">요청자</p>
                    <p className="font-medium">{item.requester_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">요청일</p>
                    <p className="font-medium">
                      {new Date(item.request_date || item.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">상태</p>
                    <Badge className={typeInfo.color}>
                      {typeInfo.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 발주 항목 목록 */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" />
              발주 항목 ({items.length}개)
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {items.map((pItem: any, index: number) => (
                <Card key={index} className="border-gray-200">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                      <div>
                        <p className="text-gray-500">품명</p>
                        <p className="font-medium">{pItem.item_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">규격</p>
                        <p className="text-gray-700 truncate" title={pItem.specification}>
                          {pItem.specification || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">수량</p>
                        <p className="font-medium">{pItem.quantity || 0}개</p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500">금액</p>
                        <p className="font-semibold text-gray-900">
                          ₩{(Number(pItem.amount_value) || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {type === 'delivery' && (
                      <div className="mt-2 pt-2 border-t">
                        <div className="flex items-center gap-2">
                          {pItem.is_received ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span className="text-sm text-green-600">입고 완료</span>
                            </>
                          ) : (
                            <>
                              <Truck className="w-4 h-4 text-blue-600" />
                              <span className="text-sm text-blue-600">입고 대기중</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* 총 금액 */}
          <Card className="border-2 border-dashed border-gray-300">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-600">총 수량</p>
                  <p className="text-lg font-bold">{totalQuantity}개</p>
                </div>
                <Separator orientation="vertical" className="h-12" />
                <div className="text-right">
                  <p className="text-gray-600">총 금액</p>
                  <p className="text-2xl font-bold text-hansl-600">
                    ₩{totalAmount.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 진행 상태 (입고 대기인 경우) */}
          {type === 'delivery' && items.length > 1 && (
            <Card>
              <CardContent className="pt-6">
                <h4 className="font-semibold mb-3">입고 진행률</h4>
                <div className="space-y-2">
                  {(() => {
                    const receivedCount = items.filter((i: any) => i.is_received).length
                    const totalCount = items.length
                    const percentage = (receivedCount / totalCount) * 100
                    
                    return (
                      <>
                        <div className="flex justify-between text-sm">
                          <span>입고 완료</span>
                          <span>{receivedCount}/{totalCount}개</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </>
                    )
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2 pt-4">
            <Button
              onClick={() => {
                navigate(`/purchase?highlight=${item.id}`)
                onClose()
              }}
              className="flex-1"
            >
              발주 목록에서 보기
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}