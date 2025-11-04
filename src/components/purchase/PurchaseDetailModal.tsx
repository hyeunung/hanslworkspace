import { useEffect, useState, useRef } from 'react'
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
import { DatePickerPopover } from '@/components/ui/date-picker-popover'
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
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const headerRowRef = useRef<HTMLDivElement>(null)
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
  
  // 구매 권한 체크: app_admin + lead buyer만 (요청자 본인 제외)
  const canPurchase = effectiveRoles.includes('app_admin') || 
                     effectiveRoles.includes('lead_buyer') || 
                     effectiveRoles.includes('lead buyer')
  
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
 
 const approvalPillClass = 'inline-flex items-center gap-1 business-radius-badge px-2 py-0.5 badge-text leading-tight'
 const approvalButtonClass = 'inline-flex items-center gap-1 business-radius-badge !h-auto !min-h-0 !px-2.5 !py-0.5 badge-text leading-tight'
 const approvalWaitingPillClass = 'inline-flex items-center gap-1 business-radius-badge px-2.5 py-0.5 badge-text leading-tight'
 
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

  // 칼럼 너비 측정 및 저장
  const measureColumnWidths = () => {
    if (headerRowRef.current && !isEditing) {
      const cells = headerRowRef.current.children
      const widths = Array.from(cells).map(cell => {
        const rect = cell.getBoundingClientRect()
        return rect.width
      })
      setColumnWidths(widths)
      logger.debug('Column widths measured:', widths)
    }
  }

  // View 모드에서 칼럼 너비 측정 (데이터 로드 후)
  useEffect(() => {
    if (purchase && purchase.items && purchase.items.length > 0 && !isEditing) {
      // 다음 렌더링 사이클에서 측정 (DOM이 완전히 렌더링된 후)
      setTimeout(measureColumnWidths, 100)
    }
  }, [purchase, isEditing, activeTab])

  // Edit 모드 전환 시 너비 측정
  const handleEditToggle = (editing: boolean) => {
    if (editing && !isEditing) {
      // Edit 모드로 전환하기 전에 현재 너비 측정
      measureColumnWidths()
    }
    setIsEditing(editing)
  }

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
    
    // payment_category 우선 확인
    if (purchase.payment_category) {
      const category = purchase.payment_category.trim()
      
      if (category === '발주') {
        return <Badge variant={null} className="badge-success">발주</Badge>
      } else if (category === '구매요청') {
        return <Badge variant={null} className="badge-primary">구매요청</Badge>
      } else if (category === '현장결제') {
        return <Badge variant={null} className="badge-secondary">현장결제</Badge>
      } else {
        // payment_category 값이 있지만 알려진 값이 아닌 경우
        return <Badge variant={null} className="badge-primary">{category}</Badge>
      }
    }
    
    // payment_category가 없으면 기본값
    return <Badge variant={null} className="badge-primary">구매요청</Badge>
  }

  // formatDate는 utils/helpers.ts에서 import

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount)
  }

  const handleSave = async () => {
    if (!purchase || !editedPurchase) {
      toast.error('저장할 데이터가 없습니다.')
      return
    }
    
    try {
      logger.debug('저장 시작', { 
        purchaseId: purchase.id, 
        editedItemsCount: editedItems.length,
        deletedItemsCount: deletedItemIds.length 
      });
      
      // 발주 기본 정보 업데이트
      const totalAmount = editedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
      logger.debug('계산된 총액', { totalAmount });
      
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({
          purchase_order_number: editedPurchase.purchase_order_number || null,
          requester_name: editedPurchase.requester_name || null,
          delivery_request_date: editedPurchase.delivery_request_date || null,
          revised_delivery_request_date: editedPurchase.revised_delivery_request_date || null,
          payment_category: editedPurchase.payment_category || null,
          project_vendor: editedPurchase.project_vendor || null,
          total_amount: Number(totalAmount),
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
        logger.debug('처리 중인 item', { 
          itemId: item.id, 
          itemName: item.item_name,
          quantity: item.quantity,
          unitPrice: item.unit_price_value,
          amount: item.amount_value
        });
        
        // 필수 필드 검증
        if (!item.item_name || !item.item_name.trim()) {
          throw new Error('품목명은 필수입니다.');
        }
        if (!item.quantity || item.quantity <= 0) {
          throw new Error('수량은 0보다 커야 합니다.');
        }
        if (!item.unit_price_value || item.unit_price_value < 0) {
          throw new Error('단가는 0 이상이어야 합니다.');
        }
        if (!item.amount_value || item.amount_value < 0) {
          throw new Error('합계는 0 이상이어야 합니다.');
        }
        
        if (item.id) {
          // 기존 항목 업데이트
          logger.debug('기존 항목 업데이트', { itemId: item.id });
          const { error } = await supabase
            .from('purchase_request_items')
            .update({
              item_name: item.item_name.trim(),
              specification: item.specification || null,
              quantity: Number(item.quantity),
              unit_price_value: Number(item.unit_price_value),
              unit_price_currency: purchase.currency || 'KRW',
              amount_value: Number(item.amount_value),
              amount_currency: purchase.currency || 'KRW',
              remark: item.remark || null,
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
            item_name: item.item_name.trim(),
            specification: item.specification || null,
            quantity: Number(item.quantity),
            unit_price_value: Number(item.unit_price_value),
            unit_price_currency: purchase.currency || 'KRW',
            amount_value: Number(item.amount_value),
            amount_currency: purchase.currency || 'KRW',
            remark: item.remark || null,
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

      logger.debug('저장 완료');
      toast.success('발주 내역이 성공적으로 저장되었습니다.')
      handleEditToggle(false)
      setDeletedItemIds([])
      
      // 수정된 데이터 다시 로드 (모달은 열린 상태 유지)
      await loadPurchaseDetail(purchaseId?.toString() || '')
    } catch (error) {
      logger.error('저장 중 전체 오류', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'
      toast.error(`저장 실패: ${errorMessage}`)
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
    if (!canPurchase) {
      toast.error('구매완료 처리 권한이 없습니다.')
      return
    }

    // 해당 품목 정보 찾기
    const targetItem = purchase?.items?.find(item => item.id === itemId)
    if (!targetItem) return

    const itemInfo = `품명: ${targetItem.item_name}
규격: ${targetItem.specification || '미입력'}
수량: ${targetItem.quantity?.toLocaleString() || 0}${targetItem.unit || ''}
단가: ₩${targetItem.unit_price_value?.toLocaleString() || 0}
합계: ₩${targetItem.amount_value?.toLocaleString() || 0}`

    const confirmMessage = isCompleted 
      ? `다음 품목을 구매완료 처리하시겠습니까?\n\n${itemInfo}` 
      : `다음 품목의 구매완료를 취소하시겠습니까?\n\n${itemInfo}`
    
    const confirm = window.confirm(confirmMessage)
    if (!confirm) return

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_payment_completed: isCompleted,
          payment_completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', itemId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          item.id === itemId 
            ? { ...item, is_payment_completed: isCompleted, payment_completed_at: isCompleted ? new Date().toISOString() : null }
            : item
        )
        return { ...prev, items: updatedItems }
      })
      
      toast.success(isCompleted ? '구매완료 처리되었습니다.' : '구매완료가 취소되었습니다.')
    } catch (error) {
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 개별 품목 입고완료 처리 (날짜 선택)
  const handleItemReceiptToggle = async (itemId: number, selectedDate: Date) => {
    if (!canReceiptCheck) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: true,
          received_at: new Date().toISOString(),
          actual_received_date: selectedDate.toISOString()
        })
        .eq('id', itemId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          item.id === itemId 
            ? { 
                ...item, 
                is_received: true, 
                received_at: new Date().toISOString(),
                actual_received_date: selectedDate.toISOString()
              }
            : item
        )
        return { ...prev, items: updatedItems }
      })
      
      const targetItem = purchase?.items?.find(item => item.id === itemId)
      toast.success(`"${targetItem?.item_name}" 품목이 입고완료 처리되었습니다.`)
    } catch (error) {
      toast.error('입고완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 입고완료 취소 처리
  const handleReceiptCancel = async (itemId: number) => {
    if (!canReceiptCheck) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    const targetItem = purchase?.items?.find(item => item.id === itemId)
    if (!targetItem) return

    const confirm = window.confirm(`"${targetItem.item_name}" 품목의 입고완료를 취소하시겠습니까?`)
    if (!confirm) return

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: false,
          received_at: null,
          actual_received_date: null
        })
        .eq('id', itemId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          item.id === itemId 
            ? { ...item, is_received: false, received_at: null, actual_received_date: null }
            : item
        )
        return { ...prev, items: updatedItems }
      })
      
      toast.success('입고완료가 취소되었습니다.')
    } catch (error) {
      toast.error('입고완료 취소 중 오류가 발생했습니다.')
    }
  }

  // 승인 처리
  const handleApprove = async (type: 'middle' | 'final') => {
    if (!purchase) return
    
    const approvalType = type === 'middle' ? '1차 승인' : '최종 승인'
    const confirmMessage = `발주번호: ${purchase.purchase_order_number}\n\n${approvalType}을 진행하시겠습니까?`
    const confirm = window.confirm(confirmMessage)
    if (!confirm) return
    
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
      
      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      if (type === 'middle') {
        setPurchase(prev => prev ? { ...prev, middle_manager_status: 'approved' } : null)
      } else {
        setPurchase(prev => prev ? { ...prev, final_manager_status: 'approved' } : null)
      }
      
      toast.success(`${type === 'middle' ? '중간' : '최종'} 승인이 완료되었습니다.`)
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  }
  
  // 전체 구매완료 처리
  const handleCompleteAllPayment = async () => {
    if (!purchase || !canPurchase) return
    
    const confirmMessage = `발주번호: ${purchase.purchase_order_number}\n\n모든 품목을 구매완료 처리하시겠습니까?`
    const confirm = window.confirm(confirmMessage)
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
      
      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          !item.is_payment_completed 
            ? { ...item, is_payment_completed: true, payment_completed_at: new Date().toISOString() }
            : item
        )
        return { ...prev, items: updatedItems }
      })
      
      toast.success('모든 품목이 구매완료 처리되었습니다.')
    } catch (error) {
      logger.error('전체 구매완료 처리 오류', error);
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 전체 입고완료 처리 (날짜 선택)
  const handleCompleteAllReceipt = async (selectedDate: Date) => {
    if (!purchase || !canReceiveItems) return

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: true,
          received_at: new Date().toISOString(),
          actual_received_date: selectedDate.toISOString()
        })
        .eq('purchase_request_id', purchase.id)
        .is('actual_received_date', null) // 아직 실제 입고되지 않은 항목만

      if (error) throw error

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          !item.actual_received_date 
            ? { 
                ...item, 
                is_received: true, 
                received_at: new Date().toISOString(),
                actual_received_date: selectedDate.toISOString()
              }
            : item
        )
        return { ...prev, items: updatedItems }
      })

      toast.success('모든 품목이 입고완료 처리되었습니다.')
    } catch (error) {
      logger.error('전체 입고완료 처리 오류', error)
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
      
      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      if (type === 'middle') {
        setPurchase(prev => prev ? { ...prev, middle_manager_status: 'rejected' } : null)
      } else {
        setPurchase(prev => prev ? { ...prev, final_manager_status: 'rejected' } : null)
      }
      
      toast.success(`${type === 'middle' ? '중간' : '최종'} 반려가 완료되었습니다.`)
    } catch (error) {
      toast.error('반려 처리 중 오류가 발생했습니다.')
    }
  }

  const content = (
    <div className="space-y-1 sm:space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-hansl-600"></div>
        </div>
      ) : purchase ? (
        <div>
          {/* Compact Info Header */}
          <div className="bg-gray-50 rounded-lg p-2 sm:p-3 mb-1 sm:mb-2 border border-gray-100">
            <div className="grid grid-cols-1 sm:grid-cols-3 items-center gap-3 sm:gap-0">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-3">
                  {getStatusBadge()}
                  <div className="flex items-center gap-2">
                    <span className="modal-label">요청자:</span>
                    <span className="modal-value">{purchase.requester_name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 text-gray-500" />
                  <span className="modal-subtitle">청구일: {formatDate(purchase.request_date)}</span>
                </div>
              </div>
              
              {/* 승인 버튼들을 중앙에 배치 */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
                {/* 1차 승인 버튼 */}
                {canApproveMiddle && purchase.middle_manager_status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApprove('middle')}
                    className={`${approvalButtonClass} border border-gray-400 bg-white hover:bg-gray-50 hover:border-gray-500`}
                  >
                    1차 승인 대기
                  </Button>
                )}
                {purchase.middle_manager_status === 'approved' && (
                  <div className="button-approved badge-text shadow-sm">
                    <Check className="w-3 h-3" />
                    1차 승인완료
                  </div>
                )}
                {purchase.middle_manager_status === 'rejected' && (
                  <div className="button-rejected badge-text">
                    <X className="w-3 h-3" />
                    1차 반려
                  </div>
                )}
                {purchase.middle_manager_status === 'pending' && !canApproveMiddle && (
                  <div className={`${approvalWaitingPillClass} border border-gray-300 text-gray-600 bg-white`}>
                    1차 승인대기
                  </div>
                )}

                {/* 최종 승인 버튼 */}
                {canApproveFinal && purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApprove('final')}
                    className={`${approvalButtonClass} border border-gray-400 bg-white hover:bg-gray-50 hover:border-gray-500`}
                  >
                    <Check className="w-3 h-3" />
                    최종 승인
                  </Button>
                )}
                {purchase.final_manager_status === 'approved' && (
                  <div className="button-approved badge-text">
                    <Check className="w-3 h-3" />
                    최종 승인완료
                  </div>
                )}
                {purchase.final_manager_status === 'rejected' && (
                  <div className="button-rejected badge-text">
                    <X className="w-3 h-3" />
                    최종 반려
                  </div>
                )}
                {purchase.middle_manager_status !== 'approved' && purchase.final_manager_status === 'pending' && (
                  <div className={`${approvalWaitingPillClass} border border-gray-300 text-gray-600 bg-white`}>
                    최종 승인대기
                  </div>
                )}
              </div>
              
              {/* 우측 빈 영역 */}
              <div></div>
            </div>
          </div>

          {/* Main 2-Column Layout */}
          <div className="flex flex-col lg:flex-row gap-3 sm:gap-6">
            {/* Left Column - Basic Info (Fixed Width) */}
            <div className="lg:w-80 lg:flex-shrink-0 space-y-1 sm:space-y-4 relative">
              
              {/* 발주 기본정보 */}
              <div className="bg-white rounded-lg p-2 sm:p-3 border border-gray-100 shadow-sm">
                <div className="mb-3">
                  <h3 className="modal-section-title flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-gray-600" />
                    {purchase?.purchase_order_number || 'PO번호 없음'}
                  </h3>
                </div>
                
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">발주서 종류</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.request_type || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, request_type: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="일반"
                        />
                      ) : (
                        <p className="modal-value">{purchase.request_type || '일반'}</p>
                      )}
                    </div>
                    <div className="w-32">
                      <span className="modal-label">결제 종류</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.payment_category || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, payment_category: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="발주/구매요청/현장결제"
                        />
                      ) : (
                        <p className="modal-value">{purchase.payment_category || '-'}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">입고 요청일</span>
                      {isEditing ? (
                        <DatePicker
                          date={editedPurchase?.delivery_request_date ? new Date(editedPurchase.delivery_request_date) : undefined}
                          onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, delivery_request_date: date?.toISOString().split('T')[0] || '' } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                        />
                      ) : (
                        <p className="modal-subtitle">{formatDate(purchase.delivery_request_date)}</p>
                      )}
                    </div>
                    <div className="w-32">
                      <span className="modal-label text-orange-500">변경 입고일</span>
                      {isEditing ? (
                        <DatePicker
                          date={editedPurchase?.revised_delivery_request_date ? new Date(editedPurchase.revised_delivery_request_date) : undefined}
                          onDateChange={(date: Date | undefined) => setEditedPurchase(prev => prev ? { ...prev, revised_delivery_request_date: date?.toISOString().split('T')[0] || '' } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                        />
                      ) : (
                        <p className="modal-subtitle text-orange-700">
                          {purchase.revised_delivery_request_date ? formatDate(purchase.revised_delivery_request_date) : '미설정'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 업체 정보 */}
              <div className="bg-white rounded-lg p-2 sm:p-3 border border-gray-100 shadow-sm">
                <h3 className="modal-section-title mb-3 flex items-center">
                  <Building2 className="w-4 h-4 mr-2 text-gray-600" />
                  업체 정보
                </h3>
                
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">업체명</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.vendor?.vendor_name || editedPurchase?.vendor_name || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, vendor_name: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="업체 선택"
                        />
                      ) : (
                        <p className="modal-value">{purchase.vendor?.vendor_name || '-'}</p>
                      )}
                    </div>
                    <div className="w-32">
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
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="담당자 선택"
                        />
                      ) : (
                        <p className="modal-value">{purchase.vendor_contacts?.[0]?.contact_name || '-'}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">PJ업체</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.project_vendor || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, project_vendor: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="입력"
                        />
                      ) : (
                        <p className="modal-value">{purchase.project_vendor || '-'}</p>
                      )}
                    </div>
                    <div className="w-32">
                      <span className="modal-label">Item</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.project_item || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, project_item: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="입력"
                        />
                      ) : (
                        <p className="modal-subtitle">{purchase.project_item || '-'}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">수주번호</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.order_number || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, order_number: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="입력"
                        />
                      ) : (
                        <p className="modal-subtitle">{purchase.order_number || '-'}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column - Items List (Flexible Width) */}
            <div className="lg:flex-1 lg:min-w-0 relative overflow-visible">
              
              <div className="bg-white rounded-lg border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-2 sm:p-3 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                  <h3 className="modal-section-title flex items-center">
                    <Package className="w-4 h-4 mr-2 text-gray-600" />
                    품목 리스트
                    <span className="ml-2 badge-secondary">
                      {purchase.items?.length || 0}개
                    </span>
                  </h3>
                  {!isEditing && (
                    <>
                      {activeTab === 'purchase' && canPurchase && (
                        <Button
                          size="sm"
                          onClick={handleCompleteAllPayment}
                          className="button-base bg-orange-500 hover:bg-orange-600 text-white"
                        >
                          <CreditCard className="w-3 h-3 mr-1" />
                          전체 구매완료
                        </Button>
                      )}
                      {activeTab === 'receipt' && canReceiveItems && (
                        <DatePickerPopover
                          onDateSelect={handleCompleteAllReceipt}
                          placeholder="전체 입고완료 날짜를 선택하세요"
                          align="end"
                          side="bottom"
                        >
                          <Button
                            size="sm"
                            className="button-base button-action-primary"
                          >
                            <Truck className="w-3 h-3 mr-1" />
                            전체 입고완료
                          </Button>
                        </DatePickerPopover>
                      )}
                    </>
                  )}
                </div>
                
                {/* Mobile Table Header */}
                <div className="block sm:hidden bg-gray-50 px-2 py-1 border-b border-gray-100">
                  <div className="text-xs font-medium text-gray-600">품목 목록 (터치하여 스크롤)</div>
                </div>
                
                {/* Items List with Header Inside Scrollable Container */}
                <div className="max-h-[50vh] sm:max-h-[40vh] overflow-y-auto overflow-x-auto min-w-fit">
                  {/* Items Table Header - Sticky inside scroll container */}
                  <div className="bg-gray-50 px-2 sm:px-3 py-1 border-b border-gray-100 sticky top-0 z-10">
                    <div 
                      ref={headerRowRef}
                      className="hidden sm:grid gap-3 modal-label" 
                      style={{
                        gridTemplateColumns: isEditing && columnWidths.length > 0
                          ? columnWidths.map(width => `${width}px`).join(' ')
                          : activeTab === 'receipt' 
                            ? 'minmax(120px, 1fr) minmax(200px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(80px, 1fr) minmax(80px, auto) minmax(100px, auto)'
                            : 'minmax(120px, 1fr) minmax(250px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(120px, 1fr) minmax(80px, auto)'
                      }}
                    >
                      <div>품목명</div>
                      <div>규격</div>
                      <div className="text-center">수량</div>
                      <div className="text-right">단가</div>
                      <div className="text-right">합계</div>
                      <div className="text-center">비고</div>
                      {isEditing ? (
                        <>
                          <div className="text-center">삭제</div>
                          {activeTab === 'receipt' && (
                            <div className="text-center">실제입고일</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-center">상태</div>
                          {activeTab === 'receipt' && (
                            <div className="text-center">실제입고일</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {(isEditing ? editedItems : purchase.items)?.map((item, index) => (
                    <div key={index} className="px-2 sm:px-3 py-1.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      {/* Desktop Layout */}
                      <div className={`hidden sm:grid items-center gap-3`} style={{
                        gridTemplateColumns: isEditing && columnWidths.length > 0
                          ? columnWidths.map(width => `${width}px`).join(' ')
                          : activeTab === 'receipt' 
                            ? 'minmax(120px, 1fr) minmax(200px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(80px, 1fr) minmax(80px, auto) minmax(100px, auto)'
                            : 'minmax(120px, 1fr) minmax(250px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(120px, 1fr) minmax(80px, auto)'
                      }}>
                        {/* 품목명 */}
                        <div className="min-w-0">
                          {isEditing ? (
                            <Input
                              value={item.item_name}
                              onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                              className="modal-label border-gray-200 rounded-lg w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="품목명"
                            />
                          ) : (
                            <span className="modal-value">{item.item_name || '품목명 없음'}</span>
                          )}
                        </div>
                        
                        {/* 규격 */}
                        <div className="min-w-0">
                          {isEditing ? (
                            <Input
                              value={item.specification}
                              onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                              className="modal-label border-gray-200 rounded-lg w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="규격"
                            />
                          ) : (
                            <span className="modal-subtitle">{item.specification || '-'}</span>
                          )}
                        </div>
                        
                        {/* 수량 */}
                        <div className="text-center min-w-0">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                              className="modal-label border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="수량"
                              max="99999"
                            />
                          ) : (
                            <span className="modal-subtitle">{item.quantity || 0}</span>
                          )}
                        </div>
                        
                        {/* 단가 */}
                        <div className="text-right min-w-0">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.unit_price_value}
                              onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                              className="modal-label border-gray-200 rounded-lg text-right w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="단가"
                              max="100000000000"
                            />
                          ) : (
                            <span className="modal-subtitle">₩{formatCurrency(item.unit_price_value)}</span>
                          )}
                        </div>
                        
                        {/* 합계 */}
                        <div className="text-right min-w-0">
                          {isEditing ? (
                            <Input
                              type="number"
                              value={item.amount_value}
                              onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                              className="modal-label border-gray-200 rounded-lg text-right w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="합계"
                              max="10000000000"
                            />
                          ) : (
                            <span className="modal-value">₩{formatCurrency(item.amount_value || 0)}</span>
                          )}
                        </div>
                        
                        {/* 비고 */}
                        <div className="min-w-0 flex justify-center items-start pt-1 text-center">
                          {isEditing ? (
                            <Input
                              value={item.remark || ''}
                              onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                              className="modal-label border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                              placeholder="비고"
                            />
                          ) : (
                            <span className="modal-subtitle text-center">{item.remark || '-'}</span>
                          )}
                        </div>
                        
                        {/* 상태/액션 */}
                        <div className="text-center flex justify-center items-start pt-1">
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
                              {/* 구매 탭에서의 구매완료 상태 */}
                              {activeTab === 'purchase' && (
                                <div className="flex justify-center">
                                  {canPurchase ? (
                                    <button
                                      onClick={() => handlePaymentToggle(item.id, !item.is_payment_completed)}
                                      className={`transition-colors ${
                                        item.is_payment_completed
                                          ? 'button-toggle-active bg-orange-500 hover:bg-orange-600 text-white'
                                          : 'button-toggle-inactive'
                                      }`}
                                    >
                                      {item.is_payment_completed ? '구매완료' : '구매대기'}
                                    </button>
                                  ) : (
                                    <span className={`${
                                      item.is_payment_completed 
                                        ? 'button-toggle-active bg-orange-500 text-white' 
                                        : 'button-waiting-inactive'
                                    }`}>
                                      {item.is_payment_completed ? '구매완료' : '구매대기'}
                                    </span>
                                  )}
                                </div>
                              )}
                              
                              {/* 입고 탭에서의 입고완료 상태 */}
                              {activeTab === 'receipt' && (
                                <div className="flex justify-center">
                                  {canReceiptCheck ? (
                                    item.actual_received_date ? (
                                      <button
                                        onClick={() => handleReceiptCancel(item.id)}
                                        className="button-action-primary"
                                      >
                                        입고완료
                                      </button>
                                    ) : (
                                      <DatePickerPopover
                                        onDateSelect={(date) => handleItemReceiptToggle(item.id, date)}
                                        placeholder="실제 입고된 날짜를 선택하세요"
                                        align="center"
                                        side="bottom"
                                      >
                                        <button className="button-toggle-inactive">
                                          입고대기
                                        </button>
                                      </DatePickerPopover>
                                    )
                                  ) : (
                                    <span className={`${
                                      item.actual_received_date 
                                        ? 'button-action-primary' 
                                        : 'button-waiting-inactive'
                                    }`}>
                                      {item.actual_received_date ? '입고완료' : '입고대기'}
                                    </span>
                                  )}
                                </div>
                              )}
                              
                              {/* 기타 탭에서는 기본 상태 표시 */}
                              {activeTab !== 'purchase' && activeTab !== 'receipt' && (
                                <div className="flex justify-center">
                                  <span className="badge-text">-</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        
                        {/* 실제 입고 날짜 - 입고 탭에서만 표시 (상태 컬럼 오른쪽) */}
                        {activeTab === 'receipt' && (
                          <div className="text-center flex justify-center items-start pt-1 pl-2">
                            {item.actual_received_date ? (
                              <div className="modal-subtitle text-green-700">
                                {new Date(item.actual_received_date).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit'
                                })}
                              </div>
                            ) : (
                              <span className="modal-subtitle text-gray-400">-</span>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Mobile Layout */}
                      <div className="block sm:hidden space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            {isEditing ? (
                              <Input
                                value={item.item_name}
                                onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                                className="modal-label border-gray-200 rounded-lg w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="품목명"
                              />
                            ) : (
                              <div className="modal-value font-medium">{item.item_name || '품목명 없음'}</div>
                            )}
                            {isEditing ? (
                              <Input
                                value={item.specification}
                                onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                                className="modal-label border-gray-200 rounded-lg mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="규격"
                              />
                            ) : (
                              <div className="modal-subtitle text-gray-500">{item.specification || '-'}</div>
                            )}
                          </div>
                          <div className="ml-3 text-right flex-shrink-0">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={item.amount_value}
                                onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                                className="modal-label border-gray-200 rounded-lg text-right w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="합계"
                              />
                            ) : (
                              <div className="modal-value font-semibold">₩{formatCurrency(item.amount_value || 0)}</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-gray-500 text-xs">수량:</span>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                                className="modal-label border-gray-200 rounded-lg mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="수량"
                              />
                            ) : (
                              <div className="modal-subtitle">{item.quantity || 0}</div>
                            )}
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">단가:</span>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={item.unit_price_value}
                                onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                                className="modal-label border-gray-200 rounded-lg mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="단가"
                              />
                            ) : (
                              <div className="modal-subtitle">₩{formatCurrency(item.unit_price_value)}</div>
                            )}
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">상태:</span>
                            <div className="mt-1">
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
                                  {activeTab === 'purchase' && (
                                    <>
                                      {canPurchase ? (
                                        <button
                                          onClick={() => handlePaymentToggle(item.id, !item.is_payment_completed)}
                                          className={`text-xs px-2 py-1 rounded transition-colors ${
                                            item.is_payment_completed
                                              ? 'bg-orange-500 text-white hover:bg-orange-600'
                                              : 'bg-gray-100 text-gray-600'
                                          }`}
                                        >
                                          {item.is_payment_completed ? '구매완료' : '구매대기'}
                                        </button>
                                      ) : (
                                        <span className={`text-xs px-2 py-1 rounded ${
                                          item.is_payment_completed 
                                            ? 'bg-orange-500 text-white' 
                                            : 'bg-gray-100 text-gray-400'
                                        }`}>
                                          {item.is_payment_completed ? '구매완료' : '구매대기'}
                                        </span>
                                      )}
                                    </>
                                  )}
                                  
                                  {activeTab === 'receipt' && (
                                    <>
                                      {canReceiptCheck ? (
                                        item.actual_received_date ? (
                                          <button
                                            onClick={() => handleReceiptCancel(item.id)}
                                            className="text-xs px-2 py-1 rounded button-action-primary"
                                          >
                                            입고완료
                                          </button>
                                        ) : (
                                          <DatePickerPopover
                                            onDateSelect={(date) => handleItemReceiptToggle(item.id, date)}
                                            placeholder="실제 입고된 날짜를 선택하세요"
                                            align="center"
                                            side="bottom"
                                          >
                                            <button className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                                              입고대기
                                            </button>
                                          </DatePickerPopover>
                                        )
                                      ) : (
                                        <span className={`text-xs px-2 py-1 rounded ${
                                          item.actual_received_date 
                                            ? 'button-action-primary' 
                                            : 'bg-gray-100 text-gray-400'
                                        }`}>
                                          {item.actual_received_date ? '입고완료' : '입고대기'}
                                        </span>
                                      )}
                                    </>
                                  )}
                                  
                                  {activeTab !== 'purchase' && activeTab !== 'receipt' && (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {(item.remark || isEditing) && (
                          <div>
                            <span className="text-gray-500 text-xs">비고:</span>
                            {isEditing ? (
                              <Input
                                value={item.remark || ''}
                                onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                                className="modal-label border-gray-200 rounded-lg mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                placeholder="비고"
                              />
                            ) : (
                              <div className="modal-subtitle text-gray-500 mt-1">{item.remark || '-'}</div>
                            )}
                          </div>
                        )}
                        
                        {/* 모바일에서 실제 입고 날짜 표시 */}
                        {!isEditing && activeTab === 'receipt' && item.actual_received_date && (
                          <div>
                            <span className="text-gray-500 text-xs">실제입고일:</span>
                            <div className="mt-1">
                              <div className="modal-subtitle text-green-700">
                                {new Date(item.actual_received_date).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit'
                                })}
                              </div>
                              <div className="text-[9px] text-gray-500">
                                {new Date(item.actual_received_date).toLocaleTimeString('ko-KR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* 합계 */}
                <div className="bg-gray-50 px-2 sm:px-3 border-t border-gray-100">
                  <div className="hidden sm:grid items-center gap-3 py-0.5" style={{
                    gridTemplateColumns: isEditing && columnWidths.length > 0
                      ? columnWidths.map(width => `${width}px`).join(' ')
                      : activeTab === 'receipt' 
                        ? 'minmax(120px, 1fr) minmax(200px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(80px, 1fr) minmax(80px, auto) minmax(100px, auto)'
                        : 'minmax(120px, 1fr) minmax(250px, 2fr) minmax(70px, auto) minmax(90px, auto) minmax(100px, auto) minmax(120px, 1fr) minmax(80px, auto)'
                  }}>
                    {/* 품목명 */}
                    <div></div>
                    {/* 규격 */}
                    <div></div>
                    {/* 수량 */}
                    <div></div>
                    {/* 단가 */}
                    <div className="text-right">
                      <span className="text-[12px] font-bold text-gray-900">총액</span>
                    </div>
                    {/* 합계 */}
                    <div className="text-right">
                      <span className="text-[12px] font-bold text-gray-900">
                        ₩{formatCurrency(
                          (isEditing ? editedItems : purchase.items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                        )}
                      </span>
                    </div>
                    {/* 나머지 칼럼들 */}
                    <div></div>
                    <div></div>
                    {activeTab === 'receipt' && <div></div>}
                  </div>
                  
                  {/* Mobile 총액 */}
                  <div className="block sm:hidden py-0.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] font-bold text-gray-900">총액</span>
                      <span className="text-[13px] font-bold text-gray-900">
                        ₩{formatCurrency(
                          (isEditing ? editedItems : purchase.items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* 항목 추가 버튼 */}
                {isEditing && (
                  <div className="p-2 sm:p-3 border-t border-gray-100">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddItem}
                      className="w-full rounded-lg border-dashed border-2 border-gray-300 hover:border-gray-400 py-2 badge-text"
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
        <div className="text-center py-12">
          <span className="modal-subtitle">
            발주 정보를 불러올 수 없습니다.
          </span>
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
        className="overflow-hidden bg-white rounded-lg shadow-sm border-0 w-[100vw] h-[100vh] sm:w-auto sm:min-w-[1000px] sm:max-w-none sm:max-h-[90vh] lg:max-h-[85vh] sm:rounded-lg flex flex-col" 
        showCloseButton={false}
      >
        {/* Apple-style Header */}
        <div className="relative px-3 sm:px-6 pt-0 sm:pt-3 lg:pt-4 pb-0 sm:pb-2 lg:pb-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="button-base button-action-secondary absolute right-3 sm:right-6 top-0 sm:top-3 lg:top-4 w-6 h-6 sm:w-8 sm:h-8 rounded-full"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
          
          <div className="pr-8 sm:pr-16">
            <div className="flex items-start gap-4 mb-0 sm:mb-3">
              <div className="min-w-0 flex-1">
                <h1 className="page-title mb-0 sm:mb-1">
                  발주 기본정보
                </h1>
              </div>
              <div className="flex items-center gap-3">
                {!isEditing && canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditToggle(true)}
                      className="button-base button-action-secondary"
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      수정
                    </Button>
                    {canDelete && onDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => purchase && onDelete(purchase)}
                        className="button-base button-action-danger"
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
                        handleEditToggle(false)
                        setEditedPurchase(purchase)
                        setEditedItems(purchase?.items || [])
                        setDeletedItemIds([])
                      }}
                      className="button-base button-action-secondary"
                    >
                      <X className="w-4 h-4 mr-2" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="button-base button-action-primary"
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
        <div className="overflow-y-auto flex-1 px-3 sm:px-6 pb-1 sm:pb-6 mt-0">
          {content}
        </div>
      </DialogContent>
      
    </Dialog>
  )
}