import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
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
import { logger } from '@/lib/logger'

interface PurchaseDetailModalProps {
  purchaseId: number | null
  isOpen: boolean
  onClose: () => void
  embedded?: boolean  // Dialog 없이 내용만 렌더링
  currentUserRoles?: string[]
  activeTab?: string
  onRefresh?: (forceRefresh?: boolean) => void
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
  
  // 삭제 권한: 관리자 또는 요청자 본인 (단, 승인된 요청은 관리자만)
  const isApproved = purchase?.final_manager_status === 'approved';
  const canDelete = isApproved 
    ? canEdit  // 승인된 요청은 관리자만 삭제 가능
    : (canEdit || (purchase?.requester_name === currentUserName))  // 미승인 요청은 요청자도 삭제 가능
  
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
  logger.debug('Receipt Check', {
    activeTab,
    canReceiptCheck,
    isAdmin,
    isRequester,
    currentUserName,
    requesterName: purchase?.requester_name,
    effectiveRoles
  });
  
  // 승인 권한 체크
  const canApproveMiddle = effectiveRoles.includes('middle_manager') || 
                           effectiveRoles.includes('app_admin') || 
                           effectiveRoles.includes('ceo')
  
   const canApproveFinal = effectiveRoles.includes('final_approver') || 
                           effectiveRoles.includes('app_admin') || 
                           effectiveRoles.includes('ceo')
   
   // 디버깅 로그
   logger.debug('PurchaseDetailModal 권한 체크', {
     currentUserRoles,
     userRoles,
     effectiveRoles,
     canApproveMiddle,
     canApproveFinal,
     isEditing,
     middleManagerStatus: purchase?.middle_manager_status,
     finalManagerStatus: purchase?.final_manager_status
   });
 
  useEffect(() => {
    if (purchaseId && isOpen) {
      loadPurchaseDetail(purchaseId.toString())
      setIsEditing(false) // 모달 열 때마다 편집 모드 초기화
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

  // formatDate는 utils/helpers.ts에서 import

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
          revised_delivery_request_date: editedPurchase.revised_delivery_request_date,
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
      logger.debug('저장할 editedItems', { count: editedItems.length });
      
      for (const item of editedItems) {
        logger.debug('처리 중인 item', { itemId: item.id });
        
        if (item.id) {
          // 기존 항목 업데이트
          logger.debug('기존 항목 업데이트', { itemId: item.id });
          const { error } = await supabase
            .from('purchase_request_items')
            .update({
              item_name: item.item_name,
              specification: item.specification,
              quantity: item.quantity,
              unit_price_value: item.unit_price_value,
              unit_price_currency: purchase.currency || 'KRW',
              amount_value: item.amount_value,
              amount_currency: purchase.currency || 'KRW',
              remark: item.remark,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id)

          if (error) {
            logger.error('기존 항목 업데이트 오류', error);
            throw error;
          }
        } else {
          // 새 항목 생성
          logger.debug('새 항목 생성', { itemName: item.item_name });
          const insertData = {
            purchase_request_id: purchase.id,
            item_name: item.item_name,
            specification: item.specification,
            quantity: item.quantity,
            unit_price_value: item.unit_price_value,
            unit_price_currency: purchase.currency || 'KRW',
            amount_value: item.amount_value,
            amount_currency: purchase.currency || 'KRW',
            remark: item.remark,
            line_number: item.line_number || editedItems.indexOf(item) + 1,
            created_at: new Date().toISOString()
          };
          logger.debug('삽입할 데이터', { itemName: insertData.item_name });
          
          const { error } = await supabase
            .from('purchase_request_items')
            .insert(insertData)

          if (error) {
            logger.error('새 항목 생성 오류', error);
            throw error;
          } else {
            logger.debug('새 항목 생성 성공');
          }
        }
      }

      toast.success('발주 내역이 수정되었습니다.')
      setIsEditing(false)
      setDeletedItemIds([])
      onRefresh?.(true)
      
      // 수정된 데이터 다시 로드
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      logger.error('저장 중 전체 오류', error);
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

  // 구매완료 처리 함수
  const handlePaymentToggle = async (itemId: number, isCompleted: boolean) => {
    if (!canReceiptCheck) {
      toast.error('구매완료 처리 권한이 없습니다.')
      return
    }

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_payment_completed: isCompleted,
          payment_completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', itemId)

      if (error) throw error

      toast.success(isCompleted ? '구매완료 처리되었습니다.' : '구매완료가 취소되었습니다.')
      
      // 데이터 새로고침
      if (purchaseId) {
        await loadPurchaseDetail(purchaseId.toString())
      }
      
      // 부모 컴포넌트 새로고침
      onRefresh?.(true)
    } catch (error) {
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
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
      onRefresh?.(true)
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
      // 승인 완료 후 강제로 데이터 새로고침 (캐시 무시)
      onRefresh?.(true)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  }
  
  // 전체 구매완료 처리
  const handleCompleteAllPayment = async () => {
    if (!purchase || !canReceiveItems) return
    
    const confirm = window.confirm('모든 품목을 구매완료 처리하시겠습니까?')
    if (!confirm) return
    
    try {
      const updateData = {
        is_payment_completed: true,
        payment_completed_at: new Date().toISOString()
      }
      
      const { error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('purchase_request_id', purchase.id)
        .eq('is_payment_completed', false) // 아직 구매완료되지 않은 항목만
      
      if (error) throw error
      
      toast.success('모든 품목이 구매완료 처리되었습니다.')
      onRefresh?.(true)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      logger.error('전체 구매완료 처리 오류', error);
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
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
      onRefresh?.(true)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      logger.error('전체 입고완료 처리 오류', error);
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
      onRefresh?.(true)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      logger.error('개별 입고완료 처리 오류', error);
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
      // 반려 완료 후 강제로 데이터 새로고침 (캐시 무시)
      onRefresh?.(true)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      toast.error('반려 처리 중 오류가 발생했습니다.')
    }
  }

  const content = (
    <div className="space-y-4 max-h-[80vh]">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-hansl-600"></div>
        </div>
      ) : purchase ? (
        <div>
          {/* Compact Summary Bar */}
          <div className="bg-gray-50 rounded-2xl p-4 mb-4 border border-gray-100">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-gray-500" />
                  <span className="modal-label">총 품목</span>
                </div>
                <p className="modal-value">{purchase.items?.length || 0}개</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-gray-500" />
                  <span className="modal-label">총 금액</span>
                </div>
                <p className="modal-value">₩{formatCurrency(purchase.total_amount || 0)}</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <span className="modal-label">납기요청일</span>
                </div>
                <p className="modal-subtitle">
                  {purchase.delivery_request_date ? formatDate(purchase.delivery_request_date) : '미지정'}
                </p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 text-gray-500" />
                  <span className="modal-label">상태</span>
                </div>
                <div className="flex justify-center">{getStatusBadge()}</div>
              </div>
            </div>
          </div>

          {/* Main 2-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left Column - Basic Info (40%) */}
            <div className="lg:col-span-2 space-y-4">
              {/* 발주 기본정보 */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <h3 className="modal-section-title mb-4 flex items-center">
                  <FileText className="w-4 h-4 mr-2 text-gray-600" />
                  발주 기본정보
                </h3>
                
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="modal-label">발주서 종류</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.request_type || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, request_type: e.target.value } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                          placeholder="일반"
                        />
                      ) : (
                        <p className="modal-value">{purchase.request_type || '일반'}</p>
                      )}
                    </div>
                    <div>
                      <span className="modal-label">진행 종류</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.progress_type || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, progress_type: e.target.value } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                          placeholder="선택"
                        />
                      ) : (
                        <p className="modal-value">{purchase.progress_type || '-'}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="modal-label">결제 종류</span>
                    {isEditing ? (
                      <Input
                        value={editedPurchase?.payment_category || ''}
                        onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, payment_category: e.target.value } : null)}
                        className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        placeholder="선택"
                      />
                    ) : (
                      <p className="modal-value">{purchase.payment_category || '-'}</p>
                    )}
                  </div>

                  <div>
                    <span className="modal-label">구매요청자</span>
                    {isEditing ? (
                      <Input
                        value={editedPurchase?.requester_name || ''}
                        onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, requester_name: e.target.value } : null)}
                        className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                      />
                    ) : (
                      <p className="modal-value">{purchase.requester_name}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="modal-label">청구일</span>
                      {isEditing ? (
                        <DatePicker
                          date={editedPurchase?.request_date ? new Date(editedPurchase.request_date) : undefined}
                          onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, request_date: date?.toISOString().split('T')[0] || '' } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        />
                      ) : (
                        <p className="modal-subtitle">{formatDate(purchase.request_date)}</p>
                      )}
                    </div>
                    <div>
                      <span className="modal-label">입고 요청일</span>
                      {isEditing ? (
                        <DatePicker
                          date={editedPurchase?.delivery_request_date ? new Date(editedPurchase.delivery_request_date) : undefined}
                          onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, delivery_request_date: date?.toISOString().split('T')[0] || '' } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        />
                      ) : (
                        <p className="modal-subtitle">{formatDate(purchase.delivery_request_date)}</p>
                      )}
                    </div>
                  </div>

                  {(purchase.revised_delivery_request_date || isEditing) && (
                    <div>
                      <span className="modal-label text-orange-500">변경 입고일</span>
                      {isEditing ? (
                        <DatePicker
                          date={editedPurchase?.revised_delivery_request_date ? new Date(editedPurchase.revised_delivery_request_date) : undefined}
                          onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, revised_delivery_request_date: date?.toISOString().split('T')[0] || '' } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        />
                      ) : (
                        <p className="modal-subtitle text-orange-700">{formatDate(purchase.revised_delivery_request_date)}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 업체 정보 */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <h3 className="modal-section-title mb-4 flex items-center">
                  <Building2 className="w-4 h-4 mr-2 text-gray-600" />
                  업체 정보
                </h3>
                
                <div className="space-y-3">
                  <div>
                    <span className="modal-label">업체명</span>
                    {isEditing ? (
                      <Input
                        value={editedPurchase?.vendor?.vendor_name || editedPurchase?.vendor_name || ''}
                        onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, vendor_name: e.target.value } : null)}
                        className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        placeholder="업체 선택"
                      />
                    ) : (
                      <p className="modal-value">{purchase.vendor?.vendor_name || '-'}</p>
                    )}
                  </div>

                  <div>
                    <span className="modal-label">업체 담당자</span>
                    {isEditing ? (
                      <Input
                        value={editedPurchase?.vendor_contacts?.[0]?.contact_name || ''}
                        onChange={(e) => {
                          setEditedPurchase(prev => {
                            if (!prev) return null;
                            const contacts = prev.vendor_contacts || [];
                            const updatedContacts = [...contacts];
                            if (updatedContacts[0]) {
                              updatedContacts[0] = { ...updatedContacts[0], contact_name: e.target.value };
                            } else {
                              updatedContacts[0] = { contact_name: e.target.value } as any;
                            }
                            return { ...prev, vendor_contacts: updatedContacts };
                          })
                        }}
                        className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        placeholder="담당자 선택"
                      />
                    ) : (
                      <p className="modal-value">{purchase.vendor_contacts?.[0]?.contact_name || '-'}</p>
                    )}
                  </div>

                  <div>
                    <span className="modal-label">PJ업체</span>
                    {isEditing ? (
                      <Input
                        value={editedPurchase?.project_vendor || ''}
                        onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, project_vendor: e.target.value } : null)}
                        className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                        placeholder="입력"
                      />
                    ) : (
                      <p className="modal-value">{purchase.project_vendor || '-'}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="modal-label">수주번호</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.order_number || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, order_number: e.target.value } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                          placeholder="입력"
                        />
                      ) : (
                        <p className="modal-subtitle">{purchase.order_number || '-'}</p>
                      )}
                    </div>
                    <div>
                      <span className="modal-label">Item</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.project_item || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, project_item: e.target.value } : null)}
                          className="mt-1 rounded-xl border-gray-200 focus:border-gray-400 text-xs"
                          placeholder="입력"
                        />
                      ) : (
                        <p className="modal-subtitle">{purchase.project_item || '-'}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 승인 정보 */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <h3 className="modal-section-title mb-4 flex items-center">
                  <User className="w-4 h-4 mr-2 text-gray-600" />
                  승인 정보
                </h3>
                
                <div className="space-y-4">
                  {/* 중간 승인 */}
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="modal-label">중간승인</span>
                      <div className={`inline-flex px-3 py-1 rounded-xl badge-text text-xs ${
                        purchase.middle_manager_status === 'approved' 
                          ? 'bg-green-50 text-green-700 border border-green-200' 
                          : purchase.middle_manager_status === 'rejected' 
                          ? 'bg-red-50 text-red-700 border border-red-200' 
                          : 'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}>
                        {purchase.middle_manager_status === 'approved' ? '승인완료' : 
                         purchase.middle_manager_status === 'rejected' ? '반려됨' : '승인대기'}
                      </div>
                    </div>
                    {!isEditing && canApproveMiddle && 
                     purchase.middle_manager_status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove('middle')}
                          className="bg-green-500 hover:bg-green-600 text-white rounded-xl px-4 py-1 text-xs"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject('middle')}
                          className="border-red-200 text-red-600 hover:bg-red-50 rounded-xl px-4 py-1 text-xs"
                        >
                          <X className="w-3 h-3 mr-1" />
                          반려
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {/* 최종 승인 */}
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="modal-label">최종승인</span>
                      <div className={`inline-flex px-3 py-1 rounded-xl badge-text text-xs ${
                        purchase.final_manager_status === 'approved' 
                          ? 'bg-green-50 text-green-700 border border-green-200' 
                          : purchase.final_manager_status === 'rejected' 
                          ? 'bg-red-50 text-red-700 border border-red-200' 
                          : 'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}>
                        {purchase.final_manager_status === 'approved' ? '승인완료' : 
                         purchase.final_manager_status === 'rejected' ? '반려됨' : '승인대기'}
                      </div>
                    </div>
                    {!isEditing && canApproveFinal && 
                     purchase.middle_manager_status === 'approved' &&
                     purchase.final_manager_status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove('final')}
                          className="bg-green-500 hover:bg-green-600 text-white rounded-xl px-4 py-1 text-xs"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject('final')}
                          className="border-red-200 text-red-600 hover:bg-red-50 rounded-xl px-4 py-1 text-xs"
                        >
                          <X className="w-3 h-3 mr-1" />
                          반려
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Items List (60%) */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="modal-section-title flex items-center">
                    <Package className="w-4 h-4 mr-2 text-gray-600" />
                    품목 리스트
                  </h3>
                  {!isEditing && canReceiveItems && (
                    <>
                      {activeTab === 'purchase' && (
                        <Button
                          size="sm"
                          onClick={handleCompleteAllPayment}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl text-xs"
                        >
                          <CreditCard className="w-3 h-3 mr-1" />
                          전체 구매완료
                        </Button>
                      )}
                      {activeTab === 'receipt' && (
                        <Button
                          size="sm"
                          onClick={handleCompleteAllReceipt}
                          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-xs"
                        >
                          <Truck className="w-3 h-3 mr-1" />
                          전체 입고완료
                        </Button>
                      )}
                    </>
                  )}
                </div>
                
                {/* Items Table Header */}
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
                  <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-600">
                    <div className="col-span-4">품목명</div>
                    <div className="col-span-2">규격</div>
                    <div className="col-span-1 text-center">수량</div>
                    <div className="col-span-2 text-right">단가</div>
                    <div className="col-span-2 text-right">금액</div>
                    <div className="col-span-1 text-center">상태</div>
                  </div>
                </div>
                
                {/* Items List */}
                <div className="max-h-[40vh] overflow-y-auto">
                  {(isEditing ? editedItems : purchase.items)?.map((item, index) => (
                    <div key={index} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <div className="grid grid-cols-12 gap-2 items-center">
                        {/* 품목명 */}
                        <div className="col-span-4">
                          {isEditing ? (
                            <Input
                              value={item.item_name}
                              onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                              className="text-xs border-gray-200 rounded-lg"
                              placeholder="품목명"
                            />
                          ) : (
                            <span className="modal-value text-xs font-semibold">{item.item_name || '품목명 없음'}</span>
                          )}
                        </div>
                        
                        {/* 규격 */}
                        <div className="col-span-2">
                          {isEditing ? (
                            <Input
                              value={item.specification}
                              onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                              className="text-xs border-gray-200 rounded-lg"
                              placeholder="규격"
                            />
                          ) : (
                            <span className="modal-subtitle text-xs">{item.specification || '-'}</span>
                          )}
                        </div>
                        
                        {/* 수량 */}
                        <div className="col-span-1 text-center">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                              className="text-xs border-gray-200 rounded-lg text-center"
                            />
                          ) : (
                            <span className="modal-subtitle text-xs">{item.quantity || 0}</span>
                          )}
                        </div>
                        
                        {/* 단가 */}
                        <div className="col-span-2 text-right">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.unit_price_value}
                              onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                              className="text-xs border-gray-200 rounded-lg text-right"
                            />
                          ) : (
                            <span className="modal-subtitle text-xs">₩{formatCurrency(item.unit_price_value)}</span>
                          )}
                        </div>
                        
                        {/* 금액 */}
                        <div className="col-span-2 text-right">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.amount_value}
                              onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                              className="text-xs border-gray-200 rounded-lg text-right"
                            />
                          ) : (
                            <span className="modal-value text-xs font-semibold">₩{formatCurrency(item.amount_value || 0)}</span>
                          )}
                        </div>
                        
                        {/* 상태/액션 */}
                        <div className="col-span-1 text-center">
                          {isEditing ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveItem(index)}
                              className="text-red-600 hover:bg-red-50 rounded-lg p-1 h-6 w-6"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          ) : (
                            <>
                              {canReceiptCheck && activeTab === 'purchase' && (
                                <button
                                  onClick={() => handlePaymentToggle(item.id, !item.is_payment_completed)}
                                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                    item.is_payment_completed
                                      ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                  }`}
                                  disabled={!canReceiptCheck}
                                >
                                  {item.is_payment_completed ? '완료' : '대기'}
                                </button>
                              )}
                              
                              {canReceiptCheck && activeTab === 'receipt' && (
                                <button
                                  onClick={() => handleReceiptToggle(item.id, !item.is_received)}
                                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                    item.is_received
                                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                  }`}
                                  disabled={!canReceiptCheck}
                                >
                                  {item.is_received ? '입고' : '대기'}
                                </button>
                              )}
                              
                              {!canReceiptCheck && (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* 비고 */}
                      {(item.remark || (isEditing && index === editedItems.length - 1)) && (
                        <div className="mt-2 col-span-12">
                          {isEditing ? (
                            <Input
                              value={item.remark || ''}
                              onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                              className="text-xs border-gray-200 rounded-lg w-full"
                              placeholder="비고"
                            />
                          ) : item.remark ? (
                            <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
                              <span className="text-xs text-amber-700">{item.remark}</span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 합계 */}
                <div className="bg-gray-50 p-4 border-t border-gray-100">
                  <div className="flex justify-between items-center">
                    <span className="modal-section-title">총액</span>
                    <span className="modal-value text-lg font-bold">
                      ₩{formatCurrency(
                        (isEditing ? editedItems : purchase.items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                      )}
                    </span>
                  </div>
                </div>
                
                {/* 항목 추가 버튼 */}
                {isEditing && (
                  <div className="p-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddItem}
                      className="w-full rounded-xl border-dashed border-2 border-gray-300 hover:border-gray-400 py-3 text-xs"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      항목 추가
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 modal-subtitle">
          발주 정보를 불러올 수 없습니다.
        </div>
      )}
    </div>
  )

  // embedded가 true면 Dialog 없이 내용만 반환
  if (embedded) {
    return content
  }

  // embedded가 false면 Dialog로 감싸서 반환
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="overflow-hidden bg-white rounded-3xl shadow-2xl border-0" 
        style={{ maxWidth: '1280px', width: '90vw', maxHeight: '80vh' }}
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
            <div className="flex items-start gap-4 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="modal-title mb-1">
                  {purchase?.purchase_order_number || 'PO번호 없음'}
                </h1>
                <p className="modal-subtitle">{purchase?.vendor?.vendor_name || '업체명 없음'}</p>
              </div>
              <div className="flex items-center gap-3">
                {purchase && !isEditing && getStatusBadge()}
                {!isEditing && canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 rounded-2xl px-4 py-2 transition-all duration-200"
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      수정
                    </Button>
                    {canDelete && onDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => purchase && onDelete(purchase)}
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-2xl px-4 py-2 transition-all duration-200"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
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
                        setEditedItems(purchase?.items || [])
                        setDeletedItemIds([])
                      }}
                      className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 rounded-2xl px-4 py-2 transition-all duration-200"
                    >
                      <X className="w-4 h-4 mr-2" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="bg-gray-900 hover:bg-gray-800 text-white rounded-2xl px-6 py-2 shadow-lg transition-all duration-200"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      저장
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Apple-style Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-160px)] px-6 pb-6">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  )
}