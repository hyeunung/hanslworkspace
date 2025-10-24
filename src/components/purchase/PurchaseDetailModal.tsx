import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { 
  Calendar, 
  User, 
  Building2, 
  Package, 
  CreditCard,
  X,
  FileText,
  DollarSign,
  Edit2,
  Trash2,
  Save,
  Plus,
  CheckCircle,
  XCircle,
  Check,
  Truck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DatePicker } from '@/components/ui/datepicker'
import { toast } from 'sonner'

interface PurchaseDetailModalProps {
  purchaseId: number | null
  isOpen: boolean
  onClose: () => void
  embedded?: boolean  // Dialog 없이 내용만 렌더링
  currentUserRoles?: string[]
  activeTab?: string
  onRefresh?: () => void
  onDelete?: (purchase: PurchaseRequestWithDetails) => void
}

export default function PurchaseDetailModal({ 
  purchaseId, 
  isOpen, 
  onClose, 
  embedded = false,
  currentUserRoles = [],
  activeTab,
  onRefresh,
  onDelete
}: PurchaseDetailModalProps) {
  const [loading, setLoading] = useState(false)
  const [purchase, setPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedPurchase, setEditedPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [editedItems, setEditedItems] = useState<any[]>([])
  const [deletedItemIds, setDeletedItemIds] = useState<number[]>([])
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const supabase = createClient()
  
  // 사용자 권한 및 이름 직접 로드
  useEffect(() => {
    const loadUserRoles = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // 먼저 ID로 시도
          let { data: employeeData } = await supabase
            .from('employees')
            .select('*')
            .eq('id', user.id)
            .maybeSingle()
          
          // ID로 못 찾았으면 이메일로 시도
          if (!employeeData && user.email) {
            const { data: employeeByEmail } = await supabase
              .from('employees')
              .select('*')
              .eq('email', user.email)
              .maybeSingle()
            
            employeeData = employeeByEmail
          }
          
          // 사용자 이름 저장
          if (employeeData?.name) {
            setCurrentUserName(employeeData.name)
          }
          
          if (employeeData?.purchase_role) {
            let roles: string[] = []
            if (Array.isArray(employeeData.purchase_role)) {
              roles = employeeData.purchase_role.map((r: any) => String(r).trim())
            } else {
              const roleString = String(employeeData.purchase_role)
              roles = roleString
                .split(',')
                .map((r: string) => r.trim())
                .filter((r: string) => r.length > 0)
            }
            setUserRoles(roles)
          }
        }
      } catch (error) {
      }
    }
    
    if (isOpen) {
      loadUserRoles()
    }
  }, [isOpen])
  
  // currentUserRoles가 배열이 아니면 userRoles 사용
  const effectiveRoles = Array.isArray(currentUserRoles) && currentUserRoles.length > 0 
    ? currentUserRoles 
    : userRoles
  
  // 권한 체크
  const canEdit = effectiveRoles.includes('final_approver') || 
                  effectiveRoles.includes('app_admin') || 
                  effectiveRoles.includes('ceo')
  
  const canDelete = canEdit
  
  // 입고 권한 체크 
  // 1. 관리자는 모든 건 입고 처리 가능
  // 2. 요청자는 자신의 요청건만 입고 처리 가능
  const canReceiveItems = effectiveRoles.includes('app_admin') || 
                         (purchase?.requester_name === currentUserName)
  // 2. 일반 직원은 본인이 요청한 건만 입고 처리 가능
  const isAdmin = effectiveRoles.includes('final_approver') || 
                  effectiveRoles.includes('app_admin') || 
                  effectiveRoles.includes('ceo')
  const isRequester = purchase?.requester_name === currentUserName
  const canReceiptCheck = isAdmin || isRequester
  
  // 디버깅용 로그
  console.log('Receipt Check Debug:', {
    activeTab,
    canReceiptCheck,
    isAdmin,
    isRequester,
    currentUserName,
    requesterName: purchase?.requester_name,
    effectiveRoles
  })
  
  // 승인 권한 체크
  const canApproveMiddle = effectiveRoles.includes('middle_manager') || 
                           effectiveRoles.includes('app_admin') || 
                           effectiveRoles.includes('ceo')
  
   const canApproveFinal = effectiveRoles.includes('final_approver') || 
                           effectiveRoles.includes('app_admin') || 
                           effectiveRoles.includes('ceo')
   
   // 디버깅 로그
   console.log('=== PurchaseDetailModal Debug ===')
   console.log('Current User Roles (prop):', currentUserRoles)
   console.log('User Roles (direct load):', userRoles)
   console.log('Effective Roles:', effectiveRoles)
   console.log('Can Approve Middle:', canApproveMiddle)
   console.log('Can Approve Final:', canApproveFinal)
   console.log('Is Editing:', isEditing)
   console.log('Middle Manager Status:', purchase?.middle_manager_status)
   console.log('Final Manager Status:', purchase?.final_manager_status)
   console.log('================================')
 
  useEffect(() => {
    if (purchaseId && isOpen) {
      loadPurchaseDetail(purchaseId.toString())
    }
  }, [purchaseId, isOpen])

  const loadPurchaseDetail = async (id: string) => {
    try {
      setLoading(true)
      const supabase = createClient()
      
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          *,
          vendors(id, vendor_name),
          purchase_request_items(*)
        `)
        .eq('id', id)
        .single()

      if (error) throw error

      if (data) {
        const purchaseData = {
          ...data,
          items: data.purchase_request_items || [],
          vendor: data.vendors || { id: 0, vendor_name: '알 수 없음' },
          vendor_contacts: []
        } as PurchaseRequestWithDetails
        setPurchase(purchaseData)
        setEditedPurchase(purchaseData)
        setEditedItems(purchaseData.items || [])
      }
    } catch (error) {
      toast.error('발주 상세 정보를 불러오는데 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = () => {
    if (!purchase) return null
    
    if (purchase.is_received) {
      return <Badge className="bg-green-100 text-green-800">입고완료</Badge>
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <Badge className="bg-hansl-100 text-hansl-800">구매진행</Badge>
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <Badge className="bg-red-100 text-red-800">반려</Badge>
    } else {
      return <Badge className="bg-yellow-100 text-yellow-800">승인대기</Badge>
    }
  }

  const formatDate = (date: string | null | undefined) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('ko-KR')
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount)
  }

  const handleSave = async () => {
    if (!purchase || !editedPurchase) return
    
    try {
      // 발주 기본 정보 업데이트
      const totalAmount = editedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
      
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({
          purchase_order_number: editedPurchase.purchase_order_number,
          requester_name: editedPurchase.requester_name,
          delivery_request_date: editedPurchase.delivery_request_date,
          payment_category: editedPurchase.payment_category,
          project_vendor: editedPurchase.project_vendor,
          total_amount: totalAmount,
          updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id)

      if (updateError) throw updateError

      // 삭제된 항목들 처리
      if (deletedItemIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('purchase_request_items')
          .delete()
          .in('id', deletedItemIds)

        if (deleteError) throw deleteError
      }

      // 각 아이템 업데이트 또는 생성
      console.log('저장할 editedItems:', editedItems);
      
      for (const item of editedItems) {
        console.log('처리 중인 item:', item);
        
        if (item.id) {
          // 기존 항목 업데이트
          console.log('기존 항목 업데이트:', item.id);
          const { error } = await supabase
            .from('purchase_request_items')
            .update({
              item_name: item.item_name,
              specification: item.specification,
              quantity: item.quantity,
              unit_price_value: item.unit_price_value,
              amount_value: item.amount_value,
              remark: item.remark,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id)

          if (error) {
            console.error('기존 항목 업데이트 오류:', error);
            throw error;
          }
        } else {
          // 새 항목 생성
          console.log('새 항목 생성:', item);
          const insertData = {
            purchase_request_id: purchase.id,
            item_name: item.item_name,
            specification: item.specification,
            quantity: item.quantity,
            unit_price_value: item.unit_price_value,
            amount_value: item.amount_value,
            remark: item.remark,
            line_number: item.line_number || editedItems.indexOf(item) + 1,
            created_at: new Date().toISOString()
          };
          console.log('삽입할 데이터:', insertData);
          
          const { error } = await supabase
            .from('purchase_request_items')
            .insert(insertData)

          if (error) {
            console.error('새 항목 생성 오류:', error);
            throw error;
          } else {
            console.log('새 항목 생성 성공');
          }
        }
      }

      toast.success('발주 내역이 수정되었습니다.')
      setIsEditing(false)
      setDeletedItemIds([])
      onRefresh?.()
      
      // 수정된 데이터 다시 로드
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      console.error('저장 중 전체 오류:', error);
      toast.error('저장 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
    }
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...editedItems]
    
    if (field === 'amount_value') {
      // 금액을 직접 수정한 경우
      newItems[index] = {
        ...newItems[index],
        amount_value: value
      }
    } else if (field === 'quantity' || field === 'unit_price_value') {
      // 수량이나 단가를 수정한 경우 금액 자동 계산
      const quantity = field === 'quantity' ? value : newItems[index].quantity
      const unitPrice = field === 'unit_price_value' ? value : newItems[index].unit_price_value
      newItems[index] = {
        ...newItems[index],
        [field]: value,
        amount_value: quantity * unitPrice
      }
    } else {
      // 기타 필드 수정
      newItems[index] = {
        ...newItems[index],
        [field]: value
      }
    }
    
    setEditedItems(newItems)
  }

  const handleAddItem = () => {
    const newItem = {
      item_name: '',
      specification: '',
      quantity: 1,
      unit_price_value: 0,
      amount_value: 0,
      remark: '',
      line_number: editedItems.length + 1
    }
    setEditedItems([...editedItems, newItem])
  }

  const handleRemoveItem = (index: number) => {
    const item = editedItems[index]
    if (item.id) {
      setDeletedItemIds([...deletedItemIds, item.id])
    }
    const newItems = editedItems.filter((_, i) => i !== index)
    setEditedItems(newItems)
  }

  // 입고 처리 함수
  const handleReceiptToggle = async (itemId: number, isReceived: boolean) => {
    if (!canReceiptCheck) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    try {
      // purchase_request_items 테이블 업데이트 (필요한 컬럼만)
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: isReceived,
          received_at: isReceived ? new Date().toISOString() : null
        })
        .eq('id', itemId)

      if (error) throw error

      toast.success(isReceived ? '입고 처리되었습니다.' : '입고가 취소되었습니다.')
      
      // 데이터 새로고침
      if (purchaseId) {
        await loadPurchaseDetail(purchaseId.toString())
      }
      
      // 부모 컴포넌트 새로고침
      onRefresh?.()
    } catch (error) {
      toast.error('입고 처리 중 오류가 발생했습니다.')
    }
  }

  // 승인 처리
  const handleApprove = async (type: 'middle' | 'final') => {
    if (!purchase) return
    
    try {
      const updateData = type === 'middle' 
        ? { 
            middle_manager_status: 'approved'
          }
        : { 
            final_manager_status: 'approved'
          }
      
      const { error } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', purchase.id)
      
      if (error) {
        throw error
      }
      
      toast.success(`${type === 'middle' ? '중간' : '최종'} 승인이 완료되었습니다.`)
      onRefresh?.()
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  }
  
  // 전체 입고완료 처리
  const handleCompleteAllReceipt = async () => {
    if (!purchase || !canReceiveItems) return
    
    const confirm = window.confirm('모든 품목을 입고완료 처리하시겠습니까?')
    if (!confirm) return
    
    try {
      // 모든 품목을 입고완료로 업데이트
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('사용자 인증이 필요합니다')
      
      const updateData = {
        is_received: true,
        delivery_status: 'received',
        received_quantity: null, // 트리거에서 quantity로 설정됨
        received_date: new Date().toISOString(),
        received_by: user.id,
        received_by_name: currentUserName
      }
      
      const { error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('purchase_request_id', purchase.id)
        .eq('is_received', false) // 아직 입고되지 않은 항목만
      
      if (error) throw error
      
      toast.success('모든 품목이 입고완료 처리되었습니다.')
      onRefresh?.()
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      console.error('전체 입고완료 처리 오류:', error)
      toast.error('입고완료 처리 중 오류가 발생했습니다.')
    }
  }
  
  // 개별 품목 입고완료 처리
  const handleCompleteItemReceipt = async (itemId: number, itemName: string) => {
    if (!purchase || !canReceiveItems) return
    
    const confirm = window.confirm(`"${itemName}" 품목을 입고완료 처리하시겠습니까?`)
    if (!confirm) return
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('사용자 인증이 필요합니다')
      
      const updateData = {
        is_received: true,
        delivery_status: 'received',
        received_date: new Date().toISOString(),
        received_by: user.id,
        received_by_name: currentUserName
      }
      
      const { error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', itemId)
      
      if (error) throw error
      
      toast.success(`"${itemName}" 품목이 입고완료 처리되었습니다.`)
      onRefresh?.()
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      console.error('개별 입고완료 처리 오류:', error)
      toast.error('입고완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 반려 처리
  const handleReject = async (type: 'middle' | 'final') => {
    if (!purchase) return
    
    const reason = window.prompt('반려 사유를 입력해주세요:')
    if (!reason) return
    
    try {
      const updateData = type === 'middle'
        ? {
            middle_manager_status: 'rejected'
          }
        : {
            final_manager_status: 'rejected'
          }
      
      const { error } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', purchase.id)
      
      if (error) {
        throw error
      }
      
      toast.success(`${type === 'middle' ? '중간' : '최종'} 반려가 완료되었습니다.`)
      onRefresh?.()
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      toast.error('반려 처리 중 오류가 발생했습니다.')
    }
  }

  const content = (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-hansl-600"></div>
        </div>
      ) : purchase ? (
        <div className="space-y-6">
            {/* 기본 정보 */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold mb-4 flex items-center text-gray-900">
                <FileText className="w-5 h-5 mr-2 text-gray-700" />
                기본 정보
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-gray-500 mb-1">요청자</p>
                  {isEditing ? (
                    <Input
                      value={editedPurchase?.requester_name || ''}
                      onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, requester_name: e.target.value } : null)}
                      className="h-8"
                    />
                  ) : (
                    <p className="font-medium text-gray-900">{purchase.requester_name}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">요청일</p>
                  <p className="font-medium text-gray-900">{formatDate(purchase.request_date)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">입고예정일</p>
                  {isEditing ? (
                    <DatePicker
                      date={editedPurchase?.delivery_request_date ? new Date(editedPurchase.delivery_request_date) : undefined}
                      onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, delivery_request_date: date?.toISOString().split('T')[0] || '' } : null)}
                      className="h-8"
                    />
                  ) : (
                    <p className="font-medium text-gray-900">{formatDate(purchase.delivery_request_date)}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">결제유형</p>
                  {isEditing ? (
                    <Input
                      value={editedPurchase?.payment_category || ''}
                      onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, payment_category: e.target.value } : null)}
                      className="h-8"
                    />
                  ) : (
                    <p className="font-medium text-gray-900">{purchase.payment_category || '-'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* 업체 정보 */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold mb-4 flex items-center text-gray-900">
                <Building2 className="w-5 h-5 mr-2 text-gray-700" />
                업체 정보
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-gray-500 mb-1">업체명</p>
                  {isEditing ? (
                    <Input
                      value={editedPurchase?.vendor?.vendor_name || editedPurchase?.vendor_name || ''}
                      onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, vendor_name: e.target.value } : null)}
                      className="h-8"
                    />
                  ) : (
                    <p className="font-medium text-gray-900">{purchase.vendor?.vendor_name || '-'}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">프로젝트 업체</p>
                  {isEditing ? (
                    <Input
                      value={editedPurchase?.project_vendor || ''}
                      onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, project_vendor: e.target.value } : null)}
                      className="h-8"
                    />
                  ) : (
                    <p className="font-medium text-gray-900">{purchase.project_vendor || '-'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* 품목 리스트 */}
            <div className="bg-gray-50 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold flex items-center text-gray-900">
                  <Package className="w-5 h-5 mr-2 text-gray-700" />
                  품목 리스트
                </h3>
                {!isEditing && canReceiveItems && purchase?.items?.some(item => !item.is_received) && (
                  <Button
                    size="sm"
                    onClick={handleCompleteAllReceipt}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Truck className="w-4 h-4 mr-1" />
                    전체 입고완료
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {canReceiptCheck && activeTab === 'receipt' && (
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">입고</th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">품명</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">규격</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">수량</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">단가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">금액</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">비고</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">입고상태</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(isEditing ? editedItems : purchase.items)?.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                        {canReceiptCheck && activeTab === 'receipt' && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center">
                              {item.is_received ? (
                                <button
                                  onClick={() => handleReceiptToggle(item.id, false)}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-md hover:bg-green-200 transition-colors"
                                  disabled={!canReceiptCheck}
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  입고완료
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleReceiptToggle(item.id, true)}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                                  disabled={!canReceiptCheck}
                                >
                                  <Package className="w-3 h-3" />
                                  미입고
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <Input
                              value={item.item_name}
                              onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                              className="text-sm"
                            />
                          ) : (
                            <span className="text-sm">{item.item_name}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <Input
                              value={item.specification}
                              onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                              className="text-sm"
                            />
                          ) : (
                            <span className="text-sm">{item.specification}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                              className="text-sm text-center w-20 mx-auto"
                            />
                          ) : (
                            <span className="text-sm">{item.quantity}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.unit_price_value}
                              onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                              className="text-sm text-right"
                            />
                          ) : (
                            <span className="text-sm">{formatCurrency(item.unit_price_value)} {purchase.currency}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.amount_value}
                              onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                              className="text-sm text-right"
                            />
                          ) : (
                            <span className="text-sm">{formatCurrency(item.amount_value)} {purchase.currency}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={item.remark || ''}
                                onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                                className="text-sm"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemoveItem(index)}
                                className="text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm">{item.remark || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.is_received ? (
                            <div className="flex items-center justify-center">
                              <Badge className="bg-green-100 text-green-800 border-green-200">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                입고완료
                              </Badge>
                            </div>
                          ) : !isEditing && canReceiveItems ? (
                            <Button
                              size="sm"
                              onClick={() => handleCompleteItemReceipt(item.id, item.item_name)}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1"
                            >
                              <Truck className="w-3 h-3 mr-1" />
                              입고완료
                            </Button>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-600 border-gray-200">
                              {isEditing ? '입고대기' : '입고대기'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td colSpan={
                        ((canReceiptCheck && activeTab === 'receipt') ? 1 : 0) + 5
                      } className="px-3 py-2 text-sm font-semibold text-right">
                        총액
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold text-right">
                        {formatCurrency(
                          (isEditing ? editedItems : purchase.items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                        )} {purchase.currency}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {isEditing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddItem}
                  className="w-full mt-2"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  항목 추가
                </Button>
              )}
            </div>

            {/* 승인 정보 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center">
                <User className="w-4 h-4 mr-2" />
                승인 정보
              </h3>
              <div className="space-y-4">
                {/* 중간 승인 */}
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">중간승인</p>
                      <Badge 
                        variant={purchase.middle_manager_status === 'approved' ? 'default' : 'secondary'}
                        className={purchase.middle_manager_status === 'approved' ? 'bg-green-100 text-green-800' : 
                                 purchase.middle_manager_status === 'rejected' ? 'bg-red-100 text-red-800' : ''}
                      >
                        {purchase.middle_manager_status === 'approved' ? '승인' : 
                         purchase.middle_manager_status === 'rejected' ? '반려' : '대기'}
                      </Badge>
                    </div>
                    {!isEditing && canApproveMiddle && 
                     purchase.middle_manager_status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove('middle')}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject('middle')}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          반려
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* 최종 승인 */}
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">최종승인</p>
                      <Badge 
                        variant={purchase.final_manager_status === 'approved' ? 'default' : 'secondary'}
                        className={purchase.final_manager_status === 'approved' ? 'bg-green-100 text-green-800' : 
                                 purchase.final_manager_status === 'rejected' ? 'bg-red-100 text-red-800' : ''}
                      >
                        {purchase.final_manager_status === 'approved' ? '승인' : 
                         purchase.final_manager_status === 'rejected' ? '반려' : '대기'}
                      </Badge>
                    </div>
                    {!isEditing && canApproveFinal && 
                     purchase.middle_manager_status === 'approved' &&
                     purchase.final_manager_status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove('final')}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject('final')}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          반려
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            발주 정보를 불러올 수 없습니다.
          </div>
        )}
    </>
  )

  // embedded가 true면 Dialog 없이 내용만 반환
  if (embedded) {
    return content
  }

  // embedded가 false면 Dialog로 감싸서 반환
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="text-xl font-bold">
              {isEditing ? '발주 내역 수정' : '발주 상세 정보'}
            </span>
            {purchase && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">#{purchase.purchase_order_number}</span>
                {!isEditing && getStatusBadge()}
                {!isEditing && canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      className="text-blue-600 hover:bg-blue-50"
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      수정
                    </Button>
                    {canDelete && onDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDelete(purchase)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        삭제
                      </Button>
                    )}
                  </>
                )}
                {isEditing && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false)
                        setEditedPurchase(purchase)
                        setEditedItems(purchase.items || [])
                        setDeletedItemIds([])
                      }}
                    >
                      <X className="w-4 h-4 mr-1" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="bg-hansl-600 hover:bg-hansl-700 text-white"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      저장
                    </Button>
                  </>
                )}
              </div>
            )}
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}