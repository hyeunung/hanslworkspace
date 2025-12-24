import { useEffect, useState, useRef, useCallback, useMemo, memo, type CSSProperties } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase/client'
import { PurchaseRequestWithDetails, Purchase, Vendor } from '@/types/purchase'
import { findPurchaseInMemory, markItemAsPaymentCompleted, markPurchaseAsPaymentCompleted, markItemAsReceived, markPurchaseAsReceived, markItemAsPaymentCanceled, markItemAsStatementReceived, markItemAsStatementCanceled, usePurchaseMemory, updatePurchaseInMemory, removeItemFromMemory, markItemAsExpenditureSet, markBulkExpenditureSet, removePurchaseFromMemory, addCacheListener } from '@/stores/purchaseMemoryStore'
import { formatDate } from '@/utils/helpers'
import { DatePickerPopover } from '@/components/ui/date-picker-popover'
import { DateAmountPickerPopover } from '@/components/ui/date-amount-picker-popover'
import { DateQuantityPickerPopover } from '@/components/ui/date-quantity-picker-popover'
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
  Truck,
  MessageSquarePlus,
  Loader2,
  GripVertical,
  Image as ImageIcon,
  FileCheck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useConfirmDateAction } from '@/hooks/useConfirmDateAction'
import { format as formatDateInput } from 'date-fns'
import { AUTHORIZED_ROLES } from '@/constants/columnSettings'
import ReactSelect from 'react-select'
import transactionStatementService from '@/services/transactionStatementService'
import type { TransactionStatement } from '@/types/transactionStatement'

interface PurchaseDetailModalProps {
  purchaseId: number | null
  isOpen: boolean
  onClose: () => void
  embedded?: boolean  // Dialog 없이 내용만 렌더링
  currentUserRoles?: string[]
  activeTab?: string
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void
  onDelete?: (purchase: PurchaseRequestWithDetails) => void
}

type SortableRenderProps = {
  setNodeRef: (element: HTMLElement | null) => void
  style: CSSProperties
  attributes: any
  listeners: any
  isDragging: boolean
}

type SortableRowProps = {
  id: string
  children: (props: SortableRenderProps) => React.ReactNode
}

// ✅ SortableRow를 컴포넌트 외부에서 정의하여 리렌더링 시 재생성 방지 (입력 포커스 유지)
const SortableRow = ({ id, children }: SortableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }
  return <>{children({ setNodeRef, attributes, listeners, isDragging, style })}</>
}

function PurchaseDetailModal({ 
  purchaseId, 
  isOpen, 
  onClose, 
  embedded = false,
  currentUserRoles = [],
  activeTab,
  onRefresh,
  onOptimisticUpdate,
  onDelete
}: PurchaseDetailModalProps) {
  const { allPurchases, lastFetch } = usePurchaseMemory(); // 🚀 메모리 캐시 실시간 동기화
  
  const [loading, setLoading] = useState(false)
  const [purchase, setPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedPurchase, setEditedPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [editedItems, setEditedItems] = useState<any[]>([])
  const [deletedItemIds, setDeletedItemIds] = useState<number[]>([])
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorSearchTerm, setVendorSearchTerm] = useState('')
  
  // 수정요청 관련 상태
  const [isModifyRequestOpen, setIsModifyRequestOpen] = useState(false)
  const [modifySubject, setModifySubject] = useState('')
  const [modifyMessage, setModifyMessage] = useState('')
  const [isSendingModify, setIsSendingModify] = useState(false)
  
  // 저장 로딩 상태
  const [isSaving, setIsSaving] = useState(false)

  // 거래명세서 관련 상태
  const [linkedStatements, setLinkedStatements] = useState<TransactionStatement[]>([])
  const [isStatementViewerOpen, setIsStatementViewerOpen] = useState(false)
  const [selectedStatementImage, setSelectedStatementImage] = useState<string>('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const makeStableKey = useCallback((item: any, idx: number) => {
    return item?.stableKey
      ?? (item?.id != null ? `sk-item-${item.id}`
      : item?.tempId ? `sk-tmp-${item.tempId}`
      : item?.line_number != null ? `sk-line-${item.line_number}-${idx}`
      : `sk-idx-${idx}`)
  }, [])

  const normalizeItems = useCallback((items: any[] = []) => {
    return items.map((item, idx) => {
      const withTemp = {
        ...item,
        tempId: item?.tempId ?? `tmp-${item?.id ?? item?.line_number ?? idx}-${idx}`
      }
      return {
        ...withTemp,
        stableKey: makeStableKey(withTemp, idx)
      }
    })
  }, [makeStableKey])

  const getSortableId = useCallback((item: any, index: number) => {
    if (item?.stableKey) return item.stableKey
    if (item?.id != null) return `item-${item.id}`
    if (item?.tempId) return `tmp-${item.tempId}`
    if (item?.line_number != null) return `line-${item.line_number}`
    return `temp-${index}`
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setEditedItems(prev => {
      const oldIndex = prev.findIndex((item, index) => getSortableId(item, index) === active.id)
      const newIndex = prev.findIndex((item, index) => getSortableId(item, index) === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev

      const reordered = arrayMove(prev, oldIndex, newIndex).map((item, idx) => ({
        ...item,
        line_number: idx + 1,
        stableKey: item.stableKey ?? makeStableKey(item, idx)
      }))
      return reordered
    })
  }, [getSortableId, makeStableKey])

  // 수정요청 초기값 설정
  useEffect(() => {
    if (isModifyRequestOpen && purchase) {
      setModifySubject(`[수정요청] 발주번호 ${purchase.purchase_order_number} 수정 요청합니다.`)
      setModifyMessage('') // 내용은 빈 칸으로 시작
    }
  }, [isModifyRequestOpen, purchase])

  // 수정요청 전송
  const handleSendModifyRequest = async () => {
    if (!modifySubject.trim() || !modifyMessage.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
      return
    }

    setIsSendingModify(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        toast.error('로그인이 필요합니다.')
        return
      }

      const { error } = await supabase
        .from('support_inquires')
        .insert({
          user_id: user.id,
          user_email: user.email,
          user_name: currentUserName,
          inquiry_type: 'modify',
          subject: modifySubject,
          message: modifyMessage,
          status: 'open',
          purchase_request_id: purchase?.id,
          purchase_order_number: purchase?.purchase_order_number,
          requester_id: purchase?.requester_id,
          purchase_info: JSON.stringify({
            vendor_name: purchase?.vendor_name,
            total_amount: purchase?.total_amount,
            item_count: purchase?.purchase_request_items?.length || 0
          })
        })

      if (error) throw error

      toast.success('수정 요청이 전송되었습니다.')
      setIsModifyRequestOpen(false)
      setModifySubject('')
      setModifyMessage('')
    } catch (error) {
      logger.error('수정 요청 전송 실패', error)
      toast.error('수정 요청 전송 중 오류가 발생했습니다.')
    } finally {
      setIsSendingModify(false)
    }
  }

  // 메모리 캐시 동기화는 useEffect에서 처리

  // ✅ isEditing 상태를 ref로 추적 (콜백에서 최신 값 참조 가능)
  const isEditingRef = useRef(isEditing)
  useEffect(() => {
    isEditingRef.current = isEditing
  }, [isEditing])

  // 🚀 Realtime 이벤트 구독 - 모달이 열려있는 동안 다른 화면에서 발생한 변경 실시간 반영
  const realtimeFirstMount = useRef(true)
  useEffect(() => {
    if (!isOpen || !purchaseId) return

    const handleCacheUpdate = () => {
      if (realtimeFirstMount.current) {
        realtimeFirstMount.current = false
        return
      }
      // ✅ 편집 모드일 때는 캐시 동기화 방지 (입력 포커스 유지)
      if (isEditingRef.current) {
        return
      }
      // 캐시에서 최신 데이터 가져와서 로컬 상태 업데이트
      const updatedPurchase = findPurchaseInMemory(purchaseId)
      if (updatedPurchase) {
        // 🚀 캐시의 items가 비어있으면 기존 로컬 상태의 items 유지 (입고완료 시 품목 사라짐 방지)
        const cachedItems = updatedPurchase.items || updatedPurchase.purchase_request_items || []
        
        setPurchase((prevPurchase) => {
          // 기존 로컬 items가 있고 캐시 items가 비어있으면 기존 items 유지
          const prevItems = prevPurchase?.items || prevPurchase?.purchase_request_items || []
          const shouldPreserveItems = prevItems.length > 0 && cachedItems.length === 0
          
          const mergedItems = shouldPreserveItems ? prevItems : cachedItems
          
          return {
            ...updatedPurchase,
            id: String(updatedPurchase.id),
            is_po_generated: false,
            items: mergedItems,
            purchase_request_items: mergedItems
          } as PurchaseRequestWithDetails
        })
      }
      // updatedPurchase가 null인 경우 기존 로컬 상태 유지 (setPurchase 호출 안함)
    }

    const unsubscribe = addCacheListener(handleCacheUpdate)
    return () => unsubscribe()
  }, [isOpen, purchaseId])

  // 🚀 이전 items 값을 저장하여 캐시 업데이트 시 품목 사라짐 방지
  const prevItemsRef = useRef<any[]>([])

  // 🚀 실시간 items 데이터 (로컬 purchase state를 우선 사용)
  const currentItems = useMemo(() => {
    let result: any[] = []
    
    // purchase state를 우선 사용 (로컬 상태가 가장 최신)
    if (purchase?.items && purchase.items.length > 0) {
      result = normalizeItems(purchase.items);
    } else if (purchase?.purchase_request_items && purchase.purchase_request_items.length > 0) {
      result = normalizeItems(purchase.purchase_request_items);
    } else if (purchaseId && allPurchases) {
      // purchase state가 없으면 메모리 캐시에서 가져오기
      const memoryPurchase = allPurchases.find(p => p.id === purchaseId);
      if (memoryPurchase) {
        const memoryItems = (memoryPurchase.items && memoryPurchase.items.length > 0)
          ? memoryPurchase.items
          : (memoryPurchase.purchase_request_items || []);
        result = normalizeItems(memoryItems);
      }
    }
    
    // 🚀 모든 소스에서 데이터를 못 찾았지만 이전에 유효한 items가 있었으면 이전 값 유지 (입고완료 시 품목 사라짐 방지)
    if (result.length === 0 && prevItemsRef.current.length > 0) {
      return prevItemsRef.current;
    }
    
    // 유효한 결과가 있으면 ref 업데이트
    if (result.length > 0) {
      prevItemsRef.current = result;
    }
    
    return result;
  }, [purchase, purchaseId, allPurchases, lastFetch, normalizeItems]); // purchase 객체 전체를 의존성으로 사용하여 실시간 업데이트 보장

  // 화면 표시용 순서: 편집 중에는 편집 상태 순서를 그대로, 보기 모드에서는 line_number 오름차순
  const displayItems = useMemo(() => {
    if (isEditing) return editedItems || []
    const base = currentItems || []
    return [...base].sort((a, b) => {
      const la = a?.line_number ?? 999999
      const lb = b?.line_number ?? 999999
      if (la !== lb) return la - lb
      // tie-breakers to keep stable order
      const ca = a?.created_at ? new Date(a.created_at).getTime() : 0
      const cb = b?.created_at ? new Date(b.created_at).getTime() : 0
      if (ca !== cb) return ca - cb
      const ia = a?.id ?? 0
      const ib = b?.id ?? 0
      if (ia !== ib) return ia - ib
      const ta = a?.tempId ?? ''
      const tb = b?.tempId ?? ''
      if (ta < tb) return -1
      if (ta > tb) return 1
      return 0
    })
  }, [isEditing, editedItems, currentItems])

  // ✅ SortableContext items를 메모이제이션하여 불필요한 재생성 방지 (입력 포커스 유지)
  const sortableIds = useMemo(() => {
    return (editedItems || []).map((item, idx) => getSortableId(item, idx))
  }, [editedItems, getSortableId])

  const tableMinWidth = useMemo(() => {
    if (columnWidths.length > 0) {
      const columnGap = columnWidths.length > 1 ? (columnWidths.length - 1) * 12 : 0
      const padding = 24
      const total = columnWidths.reduce((sum, width) => sum + width, 0) + columnGap + padding
      return Math.max(total, 720)
    }

    const baseColumns: number[] = [120, 200, 70, 90, 100, 150, 80] // 품목명, 규격, 수량, 단가, 합계, 비고, 상태

    if (activeTab === 'purchase') {
      baseColumns.push(120)
    }

    if (activeTab === 'receipt' || activeTab === 'done') {
      baseColumns.push(120)
    }

    if (activeTab === 'receipt') {
      baseColumns.push(140)
    }

    if (activeTab === 'done') {
      baseColumns.push(100, 80, 110) // 거래명세서(100), 회계상입고일(80), 지출정보(110)
    }

    if (isEditing) {
      baseColumns.push(110)
    }

    const columnGap = baseColumns.length > 1 ? (baseColumns.length - 1) * 12 : 0
    const total = baseColumns.reduce((sum, width) => sum + width, 0) + columnGap + 48
    return Math.max(total, 720)
  }, [columnWidths, activeTab, isEditing])
  const headerRowRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  
  // 사용자 권한 및 이름 직접 로드
  useEffect(() => {
    const loadUserRoles = async () => {
      try {
        // Supabase 환경 변수 확인
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
          logger.warn('Supabase 환경 변수가 설정되지 않음 - PurchaseDetailModal');
          return;
        }

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

  // 업체 목록 로드
  useEffect(() => {
    const loadVendors = async () => {
      try {
        const { data: vendorsData, error } = await supabase
          .from('vendors')
          .select('*')
          .order('vendor_name', { ascending: true })
        
        if (error) throw error
        if (vendorsData) {
          setVendors(vendorsData)
        }
      } catch (error) {
        logger.error('업체 목록 로드 실패:', error)
      }
    }
    
    if (isOpen) {
      loadVendors()
    }
  }, [isOpen])
  
  // currentUserRoles가 배열이 아니면 userRoles 사용
  const effectiveRoles = Array.isArray(currentUserRoles) && currentUserRoles.length > 0 
    ? currentUserRoles 
    : userRoles
  
  // 권한 체크
  // 전체 수정 권한 (모든 필드 수정 가능)
  const canEditAll = effectiveRoles.includes('final_approver') || 
                     effectiveRoles.includes('app_admin') || 
                     effectiveRoles.includes('ceo')
  
  // lead buyer 제한적 수정 권한 (금액/수량만 수정 가능)
  const canEditLimited = effectiveRoles.includes('lead buyer')
  
  // 통합 수정 권한 (둘 중 하나라도 있으면 수정 모드 활성화)
  const canEdit = canEditAll || canEditLimited
  
  // 재무 정보 열람 권한 체크
  const canViewFinancialInfo = effectiveRoles.some(role => AUTHORIZED_ROLES.includes(role))
  
  const showStatementColumns = purchase?.payment_category === '발주' && (
    activeTab === 'done' || (activeTab === 'receipt' && effectiveRoles.includes('lead buyer'))
  )
  const showExpenditureColumn = purchase?.payment_category === '발주' && activeTab === 'done'
  
  // 삭제 권한: 관리자 또는 요청자 본인 (단, 승인된 요청은 관리자만, lead buyer는 삭제 불가)
  const isApproved = purchase?.final_manager_status === 'approved';
  const canDelete = isApproved 
    ? canEditAll  // 승인된 요청은 관리자만 삭제 가능 (lead buyer 제외)
    : (canEditAll || (purchase?.requester_name === currentUserName))  // 미승인도 lead buyer 제외
  
  // 구매 권한 체크: app_admin + lead buyer만 (요청자 본인 제외)
  const canPurchase = effectiveRoles.includes('app_admin') || 
                     effectiveRoles.includes('lead buyer') || 
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
  
  // 거래명세서 확인 & UTK 확인 권한: app_admin과 lead buyer, accounting만 가능
  const canReceiptCheck = effectiveRoles.includes('app_admin') || 
                         effectiveRoles.includes('lead buyer') ||
                         effectiveRoles.includes('accounting')
  
  // 입고 처리 권한: app_admin 또는 본인이 요청한 건
  const canProcessReceipt = effectiveRoles.includes('app_admin') || isRequester
  

  // 모달 내부 데이터만 새로고침하는 함수 (모달 닫지 않음)
  const refreshModalData = useCallback(async () => {
    if (!purchaseId) return
    
    try {
      // 항상 DB에서 최신 데이터를 가져와서 vendor_contacts 정보를 정확히 반영
      // 메모리 캐시는 vendor_contacts를 포함하지 않으므로 사용하지 않음
      const supabase = createClient()
      // 최신 구매 요청 데이터 로드
      // 먼저 purchase_requests 데이터 가져오기
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          *,
          vendors:vendor_id(id, vendor_name, is_active),
          purchase_request_items(*),
          contact:contact_id(id, contact_name, contact_email, contact_phone, position)
        `)
        .eq('id', purchaseId)
        .single()
      
      if (error) throw error
      
      // vendor_id가 있으면 해당 업체의 모든 담당자를 가져오고, 현재 선택된 담당자를 첫 번째로 배치
      let vendorContacts = []
      if (data && data.vendor_id) {
        const { data: allContacts } = await supabase
          .from('vendor_contacts')
          .select('id, contact_name, contact_email, contact_phone, position')
          .eq('vendor_id', data.vendor_id)
          .order('contact_name')
        
        if (allContacts && allContacts.length > 0) {
          // contact_id와 일치하는 담당자를 첫 번째로 배치
          if (data.contact_id) {
            const currentContact = allContacts.find((c: any) => c.id === data.contact_id)
            const otherContacts = allContacts.filter((c: any) => c.id !== data.contact_id)
            vendorContacts = currentContact ? [currentContact, ...otherContacts] : allContacts
          } else {
            vendorContacts = allContacts
          }
          logger.info('🔍 업체의 모든 담당자 로드:', {
            vendor_id: data.vendor_id,
            contact_id: data.contact_id,
            allContacts_count: allContacts.length,
            vendorContacts
          })
        }
      } else if (data && data.contact) {
        // vendor_id가 없는 경우 contact 정보만 사용
        vendorContacts = [data.contact]
      }

      if (data) {
        // 라인넘버 순서대로 정렬
        const sortedItems = normalizeItems((data.purchase_request_items || []).sort((a: any, b: any) => {
          const lineA = a.line_number || 999999;
          const lineB = b.line_number || 999999;
          return lineA - lineB;
        }));

        const purchaseData = {
          ...data,
          items: sortedItems,
          vendor: data.vendors || null,
          vendor_contacts: vendorContacts,
          contact_id: data.contact_id,  // contact_id 포함
          contact_name: vendorContacts[0]?.contact_name || data.contact?.contact_name || null  // contact_name 포함
        } as PurchaseRequestWithDetails

        setPurchase({
          ...purchaseData,
          items: sortedItems
        })
        setEditedPurchase(purchaseData)
        setEditedItems(sortedItems)
        logger.info('🔍 refreshModalData DB에서 로드 완료:', { 
          vendor_contacts: purchaseData.vendor_contacts,
          vendorContacts_from_query: vendorContacts,
          purchase_updated: true,
          vendor_id: data.vendor_id,
          has_vendor_contacts: vendorContacts && vendorContacts.length > 0
        })
        console.log('🔍 refreshModalData - DB에서 가져온 데이터:', {
          vendor_id: data.vendor_id,
          vendor_contacts: vendorContacts,
          purchaseData_full: purchaseData,
          담당자이름: vendorContacts?.[0]?.contact_name || '없음'
        })
      }
    } catch (error) {
      logger.error('모달 데이터 새로고침 실패', error)
    }
  }, [purchaseId])

  // 🚀 메모리 캐시 변경 실시간 감지 및 모달 데이터 동기화
  useEffect(() => {
    if (!purchaseId || !allPurchases || !purchase) return;
    // ✅ 편집 모드일 때는 데이터 덮어쓰기 방지 (입력 포커스 유지)
    if (isEditing) return;

    const memoryPurchase = allPurchases.find(p => p.id === purchaseId);
    if (memoryPurchase) {
      // 메모리 데이터로 purchase state 업데이트 (깜빡임 없이 실시간 반영)
      const normalizedItems = normalizeItems((memoryPurchase.items && memoryPurchase.items.length > 0) 
        ? memoryPurchase.items 
        : (memoryPurchase.purchase_request_items || []));
      
      const updatedPurchase = {
        ...purchase,
        ...memoryPurchase,
        id: String(memoryPurchase.id),
        items: normalizedItems,
        purchase_request_items: normalizedItems
      } as PurchaseRequestWithDetails;

      setPurchase(updatedPurchase);
      setEditedPurchase(updatedPurchase);
      setEditedItems(normalizedItems.length > 0 ? normalizedItems : []);
    }
  }, [allPurchases, lastFetch, isEditing]); // isEditing 의존성 추가

  // 🚀 모달이 열릴 때마다 메모리에서 최신 데이터 강제 동기화
  useEffect(() => {
    if (!isOpen || !purchaseId || !allPurchases) return;
    // ✅ 편집 모드일 때는 데이터 덮어쓰기 방지 (입력 포커스 유지)
    if (isEditing) return;

    const memoryPurchase = allPurchases.find(p => p.id === purchaseId);
    if (memoryPurchase) {
      const normalizedItems = normalizeItems((memoryPurchase.items && memoryPurchase.items.length > 0) 
        ? memoryPurchase.items 
        : (memoryPurchase.purchase_request_items || []));
      
      const updatedPurchase = {
        ...memoryPurchase,
        id: String(memoryPurchase.id),
        is_po_generated: false,
        items: normalizedItems,
        purchase_request_items: normalizedItems,
        vendor: {
          id: memoryPurchase.vendor_id,
          vendor_name: memoryPurchase.vendor_name || '알 수 없음',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as Vendor,
        vendor_contacts: []
      } as PurchaseRequestWithDetails;

      setPurchase(updatedPurchase);
      setEditedPurchase(updatedPurchase);
      setEditedItems(normalizedItems.length > 0 ? normalizedItems : []);
    }
  }, [isOpen, purchaseId, allPurchases, isEditing]); // isEditing 의존성 추가
  
  // 컴포넌트가 마운트될 때 외부 새로고침을 방지하는 플래그
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  
  // 커스텀 훅 설정
  const purchaseIdNumber = purchaseId ? Number(purchaseId) : (purchase ? Number(purchase.id) : NaN)

  const handleActualReceiptOptimisticUpdate = useCallback(({ itemId, selectedDate, action, receivedQuantity }: {
    itemId: number
    selectedDate?: Date
    action: 'confirm' | 'cancel'
    receivedQuantity?: number
    itemInfo?: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
      received_quantity?: number
    }
  }) => {
    const itemIdStr = String(itemId)
    const nowIso = new Date().toISOString()
    const selectedDateIso = selectedDate ? selectedDate.toISOString() : undefined

    const updateItems = (items?: any[]) => {
      if (!items) return items
      return items.map(item => {
        if (String(item.id) !== itemIdStr) return item

        if (action === 'confirm') {
          return {
            ...item,
            is_received: true,
            actual_received_date: selectedDateIso,
            received_at: nowIso,
            received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.received_quantity
          }
        }

        return {
          ...item,
          is_received: false,
          actual_received_date: undefined,
          received_at: undefined,
          received_quantity: undefined
        }
      })
    }

    setPurchase(prev => {
      if (!prev) return prev
      const updatedItems = updateItems(prev.items) || []
      const updatedRequestItems = updateItems(prev.purchase_request_items) || []
      const total = updatedItems.length
      const completed = updatedItems.filter(item => item.is_received).length
      const allReceived = total > 0 && completed === total

      return {
        ...prev,
        items: updatedItems,
        purchase_request_items: updatedRequestItems,
        is_received: allReceived,
        received_at: allReceived ? (prev.received_at || nowIso) : undefined,
        updated_at: new Date().toISOString()
      }
    })

    setEditedPurchase(prev => {
      if (!prev) return prev
      const updatedItems = updateItems(prev.items) || []
      const updatedRequestItems = updateItems(prev.purchase_request_items) || []
      return {
        ...prev,
        items: updatedItems,
        purchase_request_items: updatedRequestItems
      }
    })

    setEditedItems(prevItems => {
      if (!prevItems || prevItems.length === 0) return prevItems
      return prevItems.map(item => {
        if (!item.id || String(item.id) !== itemIdStr) return item

        if (action === 'confirm') {
          return {
            ...item,
            is_received: true,
            actual_received_date: selectedDateIso,
            received_at: nowIso,
            received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.received_quantity
          }
        }

        return {
          ...item,
          is_received: false,
          actual_received_date: undefined,
          received_at: undefined,
          received_quantity: undefined
        }
      })
    })

    if (!Number.isNaN(purchaseIdNumber)) {
      onOptimisticUpdate?.(purchaseIdNumber, prevPurchase => {
        const updatedItems = updateItems(prevPurchase.items) || prevPurchase.items || []
        const updatedRequestItems = updateItems(prevPurchase.purchase_request_items) || prevPurchase.purchase_request_items || []
        const total = updatedItems.length || prevPurchase.items?.length || 0
        const completed = updatedItems.filter(item => item.is_received).length
        const allReceived = total > 0 && completed === total

        return {
          ...prevPurchase,
          items: updatedItems,
          purchase_request_items: updatedRequestItems,
          is_received: allReceived,
          received_at: allReceived ? (prevPurchase.received_at || nowIso) : undefined,
          updated_at: new Date().toISOString()
        }
      })
    }
  }, [onOptimisticUpdate, purchaseIdNumber])

  const handleStatementReceivedOptimisticUpdate = useCallback(({ itemId, selectedDate, action }: {
    itemId: number
    selectedDate?: Date
    action: 'confirm' | 'cancel'
    itemInfo?: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
    }
  }) => {
    const itemIdStr = String(itemId)
    const selectedDateIso = selectedDate ? selectedDate.toISOString() : undefined

    let nextAllCompleted = false
    let nextStatementAt: string | null = null

    setPurchase(prev => {
      if (!prev) return prev

      const updatedItems = (prev.items || []).map(item => {
        if (String(item.id) !== itemIdStr) return item

        if (action === 'confirm') {
          return {
            ...item,
            is_statement_received: true,
            statement_received_date: selectedDateIso,
            statement_received_by_name: currentUserName
          }
        }

        return {
          ...item,
          is_statement_received: false,
          statement_received_date: null,
          statement_received_by_name: null
        }
      })

      nextAllCompleted = updatedItems.length > 0 && updatedItems.every(item => item.is_statement_received)
      nextStatementAt = nextAllCompleted
        ? (selectedDateIso || prev.statement_received_at || new Date().toISOString())
        : null

      return {
        ...prev,
        items: updatedItems,
        is_statement_received: nextAllCompleted,
        statement_received_at: nextStatementAt
      }
    })

    setEditedPurchase(prev => {
      if (!prev) return prev

      const updatedItems = (prev.items || []).map(item => {
        if (String(item.id) !== itemIdStr) return item

        if (action === 'confirm') {
          return {
            ...item,
            is_statement_received: true,
            statement_received_date: selectedDateIso,
            statement_received_by_name: currentUserName
          }
        }

        return {
          ...item,
          is_statement_received: false,
          statement_received_date: null,
          statement_received_by_name: null
        }
      })

      return {
        ...prev,
        items: updatedItems,
        is_statement_received: nextAllCompleted,
        statement_received_at: nextStatementAt
      }
    })

    setEditedItems(prevItems => {
      if (!prevItems) return prevItems
      return prevItems.map(item => {
        if (String(item.id) !== itemIdStr) return item

        if (action === 'confirm') {
          return {
            ...item,
            is_statement_received: true,
            statement_received_date: selectedDateIso,
            statement_received_by_name: currentUserName
          }
        }

        return {
          ...item,
          is_statement_received: false,
          statement_received_date: null,
          statement_received_by_name: null
        }
      })
    })

    if (!Number.isNaN(purchaseIdNumber)) {
      onOptimisticUpdate?.(purchaseIdNumber, prevPurchase => {
        const updatedItems = (prevPurchase.items || []).map(item => {
          if (String(item.id) !== itemIdStr) return item

          if (action === 'confirm') {
            return {
              ...item,
              is_statement_received: true,
              statement_received_date: selectedDateIso,
              statement_received_by_name: currentUserName
            }
          }

          return {
            ...item,
            is_statement_received: false,
            statement_received_date: null,
            statement_received_by_name: null
          }
        })

        const allCompleted = updatedItems.length > 0 && updatedItems.every(item => item.is_statement_received)

        return {
          ...prevPurchase,
          items: updatedItems,
          is_statement_received: allCompleted
        }
      })
    }

    // purchase_requests 레벨 플래그도 업데이트
    if (purchase && nextAllCompleted !== undefined) {
      const supabase = createClient()
      supabase
        .from('purchase_requests')
        .update({
          is_statement_received: nextAllCompleted,
          statement_received_at: nextStatementAt
        })
        .eq('id', purchase.id)
        .then(({ error }: { error: any }) => {
          if (error) {
            logger.error('거래명세서 확인 purchase_requests 업데이트 실패', error)
          }
        })
    }
  }, [currentUserName, onOptimisticUpdate, purchaseIdNumber, purchase])

  const statementReceivedAction = useConfirmDateAction({
    config: {
      field: 'statement_received',
      confirmMessage: {
        confirm: '거래명세서 확인을 처리하시겠습니까?',
        cancel: '거래명세서 확인을 취소하시겠습니까?'
      },
      successMessage: {
        confirm: '거래명세서 확인이 완료되었습니다.',
        cancel: '거래명세서 확인이 취소되었습니다.'
      },
      completedText: '✓ 완료',
      waitingText: '대기'
    },
    currentUserName,
    canPerformAction: canReceiptCheck,
    purchaseId: purchase?.id,
    onUpdate: refreshModalData,
    onOptimisticUpdate: handleStatementReceivedOptimisticUpdate
  })

  const actualReceivedAction = useConfirmDateAction({
    config: {
      field: 'actual_received',
      confirmMessage: {
        confirm: '실제 입고 처리를 진행하시겠습니까?',
        cancel: '실제 입고 처리를 취소하시겠습니까?'
      },
      successMessage: {
        confirm: '실제 입고 처리가 완료되었습니다.',
        cancel: '실제 입고 처리가 취소되었습니다.'
      },
      completedText: '입고완료',
      waitingText: '입고대기'
    },
    currentUserName,
    canPerformAction: canProcessReceipt,
    purchaseId: purchase?.id,
    onUpdate: refreshModalData,
    onOptimisticUpdate: handleActualReceiptOptimisticUpdate
  })
  
  // 날짜 선택 핸들러들
  
  
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
 
 
  useEffect(() => {
    if (purchaseId && isOpen) {
      // 🚀 메모리에서 즉시 데이터 확인 후 로드
      const memoryPurchase = findPurchaseInMemory(purchaseId)
      if (memoryPurchase) {
        // 메모리에 있으면 즉시 로드 (loading 상태 없음)
        const purchaseData = {
          ...memoryPurchase,
          id: String(memoryPurchase.id), // PurchaseRequest는 id가 string
          is_po_generated: false, // Purchase 타입에는 없지만 PurchaseRequest에 필수
          vendor: (memoryPurchase as any).vendor || (memoryPurchase.vendor_id ? {
            id: memoryPurchase.vendor_id,
            vendor_name: memoryPurchase.vendor_name || '알 수 없음',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          } as Vendor : null),
          vendor_contacts: (memoryPurchase as any).vendor_contacts || []
        } as PurchaseRequestWithDetails
        
        setPurchase(purchaseData)
        setEditedPurchase(purchaseData)
        setEditedItems(memoryPurchase.items || [])
      } else {
        // 메모리에 없으면 기존 방식으로 로드
        loadPurchaseDetail(purchaseId.toString())
      }
      setIsEditing(false) // 모달 열 때마다 편집 모드 초기화
      
      // 연결된 거래명세서 로드
      loadLinkedStatements(purchaseId)
    }
  }, [purchaseId, isOpen])

  // 연결된 거래명세서 로드
  const loadLinkedStatements = async (purchaseId: number) => {
    try {
      const result = await transactionStatementService.getStatementsByPurchaseId(purchaseId)
      if (result.success && result.data) {
        setLinkedStatements(result.data)
      }
    } catch (e) {
      // 에러는 조용히 처리 (연결된 거래명세서가 없어도 정상)
      setLinkedStatements([])
    }
  }

  // 거래명세서 이미지 보기
  const handleViewStatementImage = (imageUrl: string) => {
    setSelectedStatementImage(imageUrl)
    setIsStatementViewerOpen(true)
  }

  // 칼럼 너비 계산 (텍스트 길이 기반)
  const calculateOptimalColumnWidths = useCallback(() => {
    // items와 purchase_request_items 둘 다 확인
    const items = (purchase?.items && purchase.items.length > 0) 
      ? purchase.items 
      : (purchase?.purchase_request_items && purchase.purchase_request_items.length > 0)
      ? purchase.purchase_request_items
      : []
    
    if (items.length === 0) return []

    const columnConfigs = [
      { key: 'line_number', minWidth: 32, maxWidth: 32, baseWidth: 32, isFixed: true }, // 라인넘버 칼럼
      { key: 'item_name', minWidth: 80, maxWidth: 500, baseWidth: 80 },
      { key: 'specification', minWidth: 80, maxWidth: 200, baseWidth: 150, isFixed: false }, // 동적 너비 (80px~200px)
      { key: 'quantity', minWidth: 70, maxWidth: 120, baseWidth: 70 }, // 100/0 형식 고려하여 maxWidth 증가
      { key: 'unit_price', minWidth: 90, maxWidth: 150, baseWidth: 90 },
      { key: 'total_price', minWidth: 100, maxWidth: 180, baseWidth: 100 },
    ]
    
    // 발주인 경우에만 세액 칼럼 추가
    if (purchase?.payment_category === '발주') {
      columnConfigs.push({ key: 'tax_amount', minWidth: 80, maxWidth: 150, baseWidth: 80 })
    }
    
    // 링크 칼럼 추가 (합계 다음, 비고 전)
    columnConfigs.push({ key: 'link', minWidth: 60, maxWidth: 80, baseWidth: 60, isFixed: true })
    
    columnConfigs.push(
      { key: 'remarks', minWidth: 150, maxWidth: 150, baseWidth: 150, isFixed: true } // 고정 너비 150px
    )
    
    // pending 탭이 아닌 경우에만 상태 칼럼 추가
    if (activeTab !== 'pending') {
      columnConfigs.push(
        { key: 'status', minWidth: 70, maxWidth: 100, baseWidth: 70 } // 입고상태 칼럼 너비 축소
      )
    }

      // 추가 칼럼들 (탭별)
      if (activeTab === 'receipt') {
        columnConfigs.push(
          { key: 'actual_receipt_date', minWidth: 100, maxWidth: 160, baseWidth: 100, isFixed: false }
        )
        if (showStatementColumns) {
          columnConfigs.push(
            { key: 'transaction_confirm', minWidth: 85, maxWidth: 120, baseWidth: 85, isFixed: false },
            { key: 'accounting_date', minWidth: 70, maxWidth: 70, baseWidth: 70, isFixed: true }
          )
        }
      }
      if (activeTab === 'done' && purchase?.payment_category === '발주') {
        columnConfigs.push(
          { key: 'transaction_confirm', minWidth: 85, maxWidth: 120, baseWidth: 85, isFixed: false }, // 거래명세서 확인 칼럼 너비 축소
          { key: 'accounting_date', minWidth: 70, maxWidth: 70, baseWidth: 70, isFixed: true }, // 회계상 입고일 칼럼 너비 축소
          { key: 'expenditure_info', minWidth: 90, maxWidth: 150, baseWidth: 90, isFixed: false } // 지출정보 칼럼 너비 축소
        )
      }

    const calculatedWidths = columnConfigs.map((config, index) => {
      let maxLength = 4 // 최소 4자

      // 헤더 텍스트 길이 고려 (탭별)
      const getHeaders = () => {
        const statusHeader = activeTab === 'purchase'
          ? '구매상태'
          : (activeTab === 'receipt' || activeTab === 'done')
          ? '입고상태'
          : '상태'

        // 승인대기탭에서는 상태 칼럼 제외
        // receipt, done 탭에서는 '요청/실제 입고수량' 형식으로 헤더 길이 계산
        const quantityHeader = (activeTab === 'receipt' || activeTab === 'done') 
          ? '요청/실제 입고수량' 
          : '요청수량'
        const baseHeaders = activeTab === 'pending' 
          ? ['#', '품목명', '규격', quantityHeader, '단가', '합계', purchase?.payment_category === '발주' ? '세액' : null, '비고'].filter(h => h !== null)
          : ['#', '품목명', '규격', quantityHeader, '단가', '합계', purchase?.payment_category === '발주' ? '세액' : null, '비고', statusHeader].filter(h => h !== null)
        if (activeTab === 'receipt') {
          const receiptHeaders = [...baseHeaders, '실제입고일']
          if (showStatementColumns) {
            receiptHeaders.push('거래명세서 확인', '회계상 입고일')
          }
          return receiptHeaders
        } else if (activeTab === 'done') {
          const doneHeaders = [...baseHeaders]
          if (showStatementColumns) {
            doneHeaders.push('거래명세서 확인', '회계상 입고일')
            if (showExpenditureColumn) {
              doneHeaders.push('지출정보')
            }
          }
          return doneHeaders
        }
        return baseHeaders
      }
      
      const headers = getHeaders()
      if (headers[index]) {
        maxLength = Math.max(maxLength, headers[index].length)
      }

      // 실제 데이터에서 최대 길이 찾기
      items.forEach(item => {
        let cellValue = ''
        switch (config.key) {
          case 'line_number':
            cellValue = item.line_number?.toString() || ''
            break
          case 'item_name':
            cellValue = item.item_name || ''
            break
          case 'specification':
            cellValue = item.specification || ''
            break
          case 'quantity':
            // receipt, done 탭에서는 요청수량/실제입고수량 형식으로 표시
            if (activeTab === 'receipt' || activeTab === 'done') {
              const quantity = item.quantity || 0
              const receivedQuantity = item.received_quantity ?? 0
              // 100 이상이면 2행으로 표시되므로 더 긴 숫자 기준으로 계산
              // 첫 번째 행의 숫자 길이만 고려 (두 번째 행은 /숫자이므로 더 짧음)
              cellValue = quantity >= 100 || receivedQuantity >= 100 
                ? `${quantity}` // 2행일 때는 첫 번째 행만 고려
                : `${quantity}/${receivedQuantity}` // 1행일 때는 전체 고려
            } else {
              cellValue = item.quantity?.toString() || ''
            }
            break
          case 'unit_price':
            cellValue = item.unit_price_value != null ? item.unit_price_value.toLocaleString() : ''
            break
          case 'total_price':
            if (item.amount_value != null) {
              cellValue = item.amount_value.toLocaleString()
            } else if (item.quantity != null && item.unit_price_value != null) {
              cellValue = (Number(item.quantity) * Number(item.unit_price_value)).toLocaleString()
            } else {
              cellValue = ''
            }
            break
          case 'tax_amount':
            cellValue = item.tax_amount_value != null ? item.tax_amount_value.toLocaleString() : ''
            break
          case 'remarks':
            cellValue = item.remark || ''
            break
          case 'status':
            cellValue = getStatusDisplay(item) || ''
            break
          case 'actual_receipt_date':
            cellValue = item.actual_received_date ? formatDate(item.actual_received_date) : ''
            break
          case 'transaction_confirm':
            cellValue = item.is_statement_received ? '확인완료' : '미확인'
            break
          case 'accounting_date':
            cellValue = item.statement_received_date ? formatDate(item.statement_received_date) : ''
            break
          case 'expenditure_info':
            // 지출정보는 날짜와 금액이 2줄로 표시되므로 특별 처리
            if (item.expenditure_date && item.expenditure_amount !== null && item.expenditure_amount !== undefined) {
              // 실제 표시 형식: "2025. 11. 25." (약 14자)
              cellValue = '2025. 11. 25.' // 날짜 형식 고정 길이
            } else {
              cellValue = '지출입력' // 버튼 텍스트
            }
            break
        }
        
        // 한글/영문 혼합 텍스트 길이 계산 (한글은 1.5배 가중치)
        const adjustedLength = cellValue.split('').reduce((acc, char) => {
          return acc + (/[가-힣]/.test(char) ? 1.5 : 1)
        }, 0)
        
        maxLength = Math.max(maxLength, Math.ceil(adjustedLength))
      })

      // 고정 너비 칼럼은 바로 반환
      if (config.isFixed) {
        return config.baseWidth
      }
      
      // 길이를 픽셀로 변환 (글자당 약 7px + 여백 20px)
      let calculatedWidth = Math.max(
        config.minWidth,
        Math.min(config.maxWidth, maxLength * 7 + 20)
      )
      
      // 지출정보 칼럼은 실제 표시되는 텍스트가 2줄이므로 더 정확한 계산
      if (config.key === 'expenditure_info') {
        // 날짜 형식 "2025. 11. 25." 기준으로 고정
        // 2줄 표시이므로 충분한 여백을 주되 최소화
        calculatedWidth = 110 // 고정 너비로 설정
      }

      return calculatedWidth
    })

    setColumnWidths(calculatedWidths)
    return calculatedWidths
  }, [purchase, activeTab, showStatementColumns, showExpenditureColumn])

  // 상태 표시 텍스트 반환 함수
  const getStatusDisplay = (item: any) => {
    if (activeTab === 'purchase') {
      return item.is_payment_completed ? '구매완료' : '구매요청'
    } else if (activeTab === 'receipt') {
      return item.is_received ? '입고' : '입고대기'
    }
    return item.is_payment_completed ? '구매완료' : '구매요청'
  }

  // 동적 gridTemplateColumns 생성
  const getGridTemplateColumns = () => {
    // 동적 계산된 너비가 있으면 사용 (단, 특정 컬럼은 고정값 강제)
    if (columnWidths.length > 0) {
      const widths = columnWidths.map(width => `${width}px`)
      
      // 동적 계산된 값을 그대로 사용 (고정값 제거)
      // 모든 칼럼이 내용에 맞게 동적으로 조절됨
      
      return widths.join(' ')
    }
    
    // 기본값 (데이터 로드 전)
    // [라인넘버, 품목명, 규격, 수량, 단가, 합계]
    let baseColumns = ['32px', 'minmax(80px, 1fr)', '200px', '70px', '90px', '100px']
    
    // 발주인 경우 세액 칼럼 추가
    if (purchase?.payment_category === '발주') {
      baseColumns.push('100px') // 세액
    }
    
    // 링크 칼럼 추가
    baseColumns.push('60px')
    
    // 비고 칼럼 추가
    baseColumns.push('150px')
    
    // pending 탭이 아닌 경우에만 상태/삭제 칼럼 추가
    if (activeTab !== 'pending') {
      if (isEditing) {
        baseColumns.push('80px') // 삭제
      } else {
        baseColumns.push('80px') // 상태
      }
    }
    
    // 탭별 추가 칼럼
    if (activeTab === 'receipt') {
      const receiptColumns = [...baseColumns, '100px'] // 실제입고일
      if (showStatementColumns) {
        receiptColumns.push('100px', '80px') // 거래명세서 확인, 회계상 입고일
      }
      return receiptColumns.join(' ')
    } else if (activeTab === 'done') {
      const doneColumns = [...baseColumns]
      if (showStatementColumns) {
        doneColumns.push('100px', '80px') // 거래명세서 확인, 회계상 입고일
        if (showExpenditureColumn) {
          doneColumns.push('110px') // 지출정보
        }
      }
      return doneColumns.join(' ')
    }
    
    return baseColumns.join(' ')
  }

  // 레거시 measureColumnWidths 함수 (호환성 유지)
  const measureColumnWidths = () => {
    calculateOptimalColumnWidths()
  }

  // View 모드에서 칼럼 너비 계산 (데이터 로드 후)
  // 비동기로 처리하여 모달이 먼저 표시되도록 함
  useEffect(() => {
    // items와 purchase_request_items 둘 다 확인
    const hasItems = (purchase?.items && purchase.items.length > 0) || 
                     (purchase?.purchase_request_items && purchase.purchase_request_items.length > 0)
    
    if (purchase && hasItems && !isEditing) {
      // requestAnimationFrame으로 다음 프레임에 계산하여 모달 렌더링을 블로킹하지 않음
      requestAnimationFrame(() => {
        calculateOptimalColumnWidths()
      })
    }
  }, [purchase, isEditing, activeTab, calculateOptimalColumnWidths])

  // Edit 모드 전환 시 너비 계산
  const handleEditToggle = (editing: boolean) => {
    if (editing && !isEditing) {
      // Edit 모드로 전환할 때 현재 데이터로 초기화 (line_number 오름차순 정렬)
      setEditedPurchase(purchase)
      const sortedItems = [...(currentItems || [])].sort((a, b) => {
        const la = a?.line_number ?? 999999
        const lb = b?.line_number ?? 999999
        return la - lb
      })
      setEditedItems(sortedItems)
      setDeletedItemIds([])
      // Edit 모드로 전환하기 전에 현재 너비 계산
      calculateOptimalColumnWidths()
    }
    setIsEditing(editing)
  }

  const loadPurchaseDetail = async (id: string) => {
    try {
      // 🚀 메모리에서 먼저 찾기 (로딩 상태 없이 즉시 로드)
      const memoryPurchase = findPurchaseInMemory(id)
      if (memoryPurchase) {
        // 메모리 데이터를 PurchaseRequestWithDetails 형태로 변환
        const purchaseData = {
          ...memoryPurchase,
          id: String(memoryPurchase.id), // PurchaseRequest는 id가 string
          is_po_generated: false, // Purchase 타입에는 없지만 PurchaseRequest에 필수
          vendor: (memoryPurchase as any).vendor || (memoryPurchase.vendor_id ? {
            id: memoryPurchase.vendor_id,
            vendor_name: memoryPurchase.vendor_name || '알 수 없음',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          } as Vendor : null),
          vendor_contacts: (memoryPurchase as any).vendor_contacts || []
        } as PurchaseRequestWithDetails
        
        setPurchase({
          ...purchaseData,
          items: normalizeItems(memoryPurchase.items || purchaseData.items || [])
        })
        setEditedPurchase(purchaseData)
        setEditedItems(normalizeItems(memoryPurchase.items || []))
        return
      }
      
      // 메모리에 없는 경우에만 로딩 상태 표시 후 DB에서 로드 (fallback)
      setLoading(true)
      const supabase = createClient()
      
      // 먼저 purchase_requests 데이터 가져오기
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          *,
          vendors:vendor_id(id, vendor_name, is_active),
          purchase_request_items(*),
          contact:contact_id(id, contact_name, contact_email, contact_phone, position)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      
      // vendor_id가 있으면 해당 업체의 모든 담당자를 가져오고, 현재 선택된 담당자를 첫 번째로 배치
      let vendorContacts = []
      if (data && data.vendor_id) {
        const { data: allContacts } = await supabase
          .from('vendor_contacts')
          .select('id, contact_name, contact_email, contact_phone, position')
          .eq('vendor_id', data.vendor_id)
          .order('contact_name')
        
        if (allContacts && allContacts.length > 0) {
          // contact_id와 일치하는 담당자를 첫 번째로 배치
          if (data.contact_id) {
            const currentContact = allContacts.find((c: any) => c.id === data.contact_id)
            const otherContacts = allContacts.filter((c: any) => c.id !== data.contact_id)
            vendorContacts = currentContact ? [currentContact, ...otherContacts] : allContacts
          } else {
            vendorContacts = allContacts
          }
          logger.info('🔍 loadPurchaseDetail - 업체의 모든 담당자 로드:', {
            vendor_id: data.vendor_id,
            contact_id: data.contact_id,
            allContacts_count: allContacts.length,
            vendorContacts
          })
        }
      } else if (data && data.contact) {
        // vendor_id가 없는 경우 contact 정보만 사용
        vendorContacts = [data.contact]
      }

      if (data) {
        // 라인넘버 순서대로 정렬
        const sortedItems = normalizeItems((data.purchase_request_items || []).sort((a: any, b: any) => {
          const lineA = a.line_number || 999999;
          const lineB = b.line_number || 999999;
          return lineA - lineB;
        }));

        const purchaseData = {
          ...data,
          items: sortedItems,
          vendor: data.vendors || null,
          vendor_contacts: vendorContacts,
          contact_id: data.contact_id,  // contact_id 포함
          contact_name: vendorContacts[0]?.contact_name || data.contact?.contact_name || null  // contact_name 포함
        } as PurchaseRequestWithDetails
        setPurchase({
          ...purchaseData,
          items: sortedItems
        })
        setEditedPurchase(purchaseData)
        setEditedItems(sortedItems)
      }
    } catch (error) {
      logger.error('[PurchaseDetailModal] 발주 상세 로드 실패:', error)
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
        return <span className="badge-stats bg-green-500 text-white">발주</span>
      } else if (category === '구매요청') {
        return <span className="badge-stats bg-blue-500 text-white">구매요청</span>
      } else if (category === '현장결제') {
        return <span className="badge-stats bg-gray-500 text-white">현장결제</span>
      } else {
        // payment_category 값이 있지만 알려진 값이 아닌 경우
        return <span className="badge-stats bg-blue-500 text-white">{category}</span>
      }
    }
    
    // payment_category가 없으면 기본값
    return <span className="badge-stats bg-blue-500 text-white">구매요청</span>
  }


  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount)
  }

  const handleSave = async () => {
    if (!purchase || !editedPurchase) {
      toast.error('저장할 데이터가 없습니다.')
      return
    }
    
    // 🚀 저장 로딩 상태 시작
    setIsSaving(true)
    
    logger.info('handleSave 시작:', { 
      purchaseId: purchase.id,
      vendor_id: editedPurchase.vendor_id,
      vendor_name: editedPurchase.vendor_name,
      vendor: editedPurchase.vendor,
      editedPurchase: editedPurchase
    })
    
    try {
      const supabase = createClient()
      
      // 발주 기본 정보 업데이트
      const totalAmount = editedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
      
      logger.info('Update payload:', {
        purchase_order_number: editedPurchase.purchase_order_number || null,
        requester_name: editedPurchase.requester_name || null,
        vendor_id: editedPurchase.vendor_id || null,
        vendor_name: editedPurchase.vendor_name || null,
        delivery_request_date: editedPurchase.delivery_request_date || null,
        revised_delivery_request_date: editedPurchase.revised_delivery_request_date || null,
        payment_category: editedPurchase.payment_category || null,
        project_vendor: editedPurchase.project_vendor || null,
        project_item: editedPurchase.project_item || null,
        sales_order_number: editedPurchase.sales_order_number || null,
        total_amount: Number(totalAmount),
        updated_at: new Date().toISOString()
      })
      
      // contact_id 결정: 우선순위 1. editedPurchase.contact_id 2. vendor_contacts[0].id 3. null
      let contactId = null
      if ((editedPurchase as any).contact_id) {
        contactId = (editedPurchase as any).contact_id
      } else if (Array.isArray(editedPurchase.vendor_contacts) && editedPurchase.vendor_contacts.length > 0) {
        contactId = editedPurchase.vendor_contacts[0].id || null
      }
      
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({
          purchase_order_number: editedPurchase.purchase_order_number || null,
          requester_name: editedPurchase.requester_name || null,
          vendor_id: editedPurchase.vendor_id || null,
          vendor_name: editedPurchase.vendor_name || null,
          contact_id: contactId, // contact_id 업데이트
          delivery_request_date: editedPurchase.delivery_request_date || null,
          revised_delivery_request_date: editedPurchase.revised_delivery_request_date || null,
          payment_category: editedPurchase.payment_category || null,
          project_vendor: editedPurchase.project_vendor || null,
          project_item: editedPurchase.project_item || null,
          sales_order_number: editedPurchase.sales_order_number || null,
          total_amount: Number(totalAmount),
          updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id)

      if (updateError) {
        logger.error('Purchase update error:', updateError)
        throw updateError
      }

      // 업체 담당자 정보 업데이트 및 contact_id 저장
      let finalContactId = null
      logger.info('담당자 저장 시작:', { 
        vendor_id: editedPurchase.vendor_id,
        vendor_contacts: editedPurchase.vendor_contacts,
        isArray: Array.isArray(editedPurchase.vendor_contacts)
      })
      
      if (editedPurchase.vendor_id && Array.isArray(editedPurchase.vendor_contacts) && editedPurchase.vendor_contacts.length > 0) {
        const contact = editedPurchase.vendor_contacts[0]
        logger.info('담당자 정보:', { contact })
        
        // 기존 담당자가 있으면 업데이트, 없으면 생성
        if (contact.id) {
          finalContactId = contact.id
          const { error: contactUpdateError } = await supabase
            .from('vendor_contacts')
            .update({
              contact_name: contact.contact_name || '',
              contact_email: contact.contact_email || '',
              contact_phone: contact.contact_phone || '',
              position: contact.position || ''
            })
            .eq('id', contact.id)
          
          if (contactUpdateError) {
            logger.error('담당자 업데이트 오류:', contactUpdateError)
          } else {
            // 즉시 UI 상태 업데이트
            setPurchase(prev => {
              const updated = prev ? {
                ...prev,
                vendor_contacts: [contact],
                contact_id: contact.id,
                contact_name: contact.contact_name  // contact_name도 추가
              } : null
              logger.info('🔍 담당자 업데이트 후 setPurchase:', { 
                prev_vendor_contacts: prev?.vendor_contacts,
                new_vendor_contacts: [contact],
                updated_purchase: updated
              })
              console.log('🔍 담당자 업데이트 후 setPurchase 호출')
              return updated
            })
          }
        } else if (contact.contact_name) {
          // 새 담당자 생성
          const { data: newContact, error: contactInsertError } = await supabase
            .from('vendor_contacts')
            .insert({
              vendor_id: editedPurchase.vendor_id,
              contact_name: contact.contact_name,
              contact_email: contact.contact_email || '',
              contact_phone: contact.contact_phone || '',
              position: contact.position || ''
            })
            .select()
            .single()
          
          if (contactInsertError) {
            logger.error('담당자 생성 오류:', contactInsertError)
          } else if (newContact) {
            finalContactId = newContact.id
            // 새로 생성된 담당자를 editedPurchase에 반영
            editedPurchase.vendor_contacts = [newContact]
            logger.info('담당자 생성 완료:', newContact)
            
            // 즉시 UI 상태 업데이트
            setPurchase(prev => {
              const updated = prev ? {
                ...prev,
                vendor_contacts: [newContact],
                contact_id: newContact.id,
                contact_name: newContact.contact_name  // contact_name도 추가
              } : null
              logger.info('🔍 새 담당자 생성 후 setPurchase:', { 
                prev_vendor_contacts: prev?.vendor_contacts,
                new_vendor_contacts: [newContact],
                newContact_full: newContact,
                updated_purchase: updated
              })
              console.log('🔍 새 담당자 생성 후 setPurchase 호출:', newContact)
              return updated
            })
            
            // purchase_requests 테이블의 contact_id도 업데이트
            const { error: purchaseUpdateError } = await supabase
              .from('purchase_requests')
              .update({
                contact_id: newContact.id
              })
              .eq('id', purchase.id)
            
            if (purchaseUpdateError) {
              logger.error('purchase_requests contact_id 업데이트 오류:', purchaseUpdateError)
            }
          }
        }
      }

      // 삭제된 항목들 처리
      if (deletedItemIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('purchase_request_items')
          .delete()
          .in('id', deletedItemIds)

        if (deleteError) throw deleteError
      }

      // 모든 품목이 삭제된 경우 발주기본정보도 삭제
      if (editedItems.length === 0) {
        logger.info('🚀 모든 품목이 삭제되어 발주기본정보도 삭제합니다', {
          purchaseId: purchase.id,
          deletedItemIds: deletedItemIds
        })

        // 발주기본정보 삭제
        const { error: requestDeleteError } = await supabase
          .from('purchase_requests')
          .delete()
          .eq('id', purchase.id)

        if (requestDeleteError) {
          logger.error('발주기본정보 삭제 실패', requestDeleteError)
          throw requestDeleteError
        }

        // 메모리 캐시에서 제거
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          const memoryUpdated = removePurchaseFromMemory(purchaseIdNumber)
          if (!memoryUpdated) {
            logger.warn('[handleSave] 발주기본정보 삭제 메모리 캐시 업데이트 실패', { 
              purchaseId: purchaseIdNumber
            })
          } else {
            logger.info('✅ [handleSave] 발주기본정보 삭제 메모리 캐시 업데이트 성공', { 
              purchaseId: purchaseIdNumber
            })
          }
        }

        toast.success('모든 품목이 삭제되어 발주요청이 삭제되었습니다.')
        handleEditToggle(false)
        setDeletedItemIds([])
        onClose() // 모달 닫기
        
        // 데이터 새로고침
        const refreshResult = onRefresh?.(true, { silent: false })
        if (refreshResult instanceof Promise) {
          await refreshResult
        }
        
        return // 여기서 함수 종료
      }

      // 각 아이템 업데이트 또는 생성
      
      for (const item of editedItems) {
        
        // 필수 필드 검증
        if (!item.item_name || !item.item_name.trim()) {
          throw new Error('품목명은 필수입니다.');
        }
        if (!item.quantity || item.quantity <= 0) {
          throw new Error('수량은 0보다 커야 합니다.');
        }
        if (item.unit_price_value !== null && item.unit_price_value !== undefined && item.unit_price_value < 0) {
          throw new Error('단가는 0 이상이어야 합니다.');
        }
        if (item.amount_value !== null && item.amount_value !== undefined && item.amount_value < 0) {
          throw new Error('합계는 0 이상이어야 합니다.');
        }
        
        if (item.id) {
          // 기존 항목 업데이트
          const { error } = await supabase
            .from('purchase_request_items')
            .update({
              item_name: item.item_name.trim(),
              specification: item.specification || null,
              quantity: Number(item.quantity),
              received_quantity: item.received_quantity !== null && item.received_quantity !== undefined ? Number(item.received_quantity) : null,
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
          const insertData = {
            purchase_request_id: purchase.id,
            item_name: item.item_name.trim(),
            specification: item.specification || null,
            quantity: Number(item.quantity),
            received_quantity: item.received_quantity !== null && item.received_quantity !== undefined ? Number(item.received_quantity) : null,
            unit_price_value: Number(item.unit_price_value),
            unit_price_currency: purchase.currency || 'KRW',
            amount_value: Number(item.amount_value),
            amount_currency: purchase.currency || 'KRW',
            remark: item.remark || null,
            line_number: item.line_number || editedItems.indexOf(item) + 1,
            created_at: new Date().toISOString()
          };
          
          // 🚀 INSERT 후 새 ID 받기 (.select() 추가)
          const { data: insertedItem, error } = await supabase
            .from('purchase_request_items')
            .insert(insertData)
            .select()
            .single()

          if (error) {
            logger.error('새 항목 생성 오류', error);
            throw error;
          }
          
          // 🚀 반환된 새 ID로 editedItems 업데이트
          if (insertedItem) {
            const itemIndex = editedItems.indexOf(item)
            if (itemIndex !== -1) {
              editedItems[itemIndex] = { ...editedItems[itemIndex], ...insertedItem }
              logger.info('✅ 새 항목 ID 할당됨:', { id: insertedItem.id, itemIndex })
            }
          }
        }
      }

      // 🚀 전체완료 함수와 정확히 동일한 패턴 적용 (메모리 캐시 포함)
      const purchaseIdNumber = purchase ? Number(purchase.id) : NaN
      const sourceData = editedPurchase || purchase
      
      // 1. 🚀 삭제된 품목들에 대해 개별 메모리 캐시 처리 (구매완료와 동일한 방식)
      if (!Number.isNaN(purchaseIdNumber) && deletedItemIds.length > 0) {
        logger.info('🚀 [메모리 캐시] 개별 품목 삭제 처리 시작', {
          purchaseId: purchaseIdNumber,
          deletedItemIds: deletedItemIds,
          deletedCount: deletedItemIds.length
        })
        
        // 각 삭제된 품목에 대해 개별 메모리 캐시 업데이트 (구매완료와 정확히 동일한 패턴)
        deletedItemIds.forEach(itemId => {
          const memoryUpdated = removeItemFromMemory(purchaseIdNumber, itemId)
          if (!memoryUpdated) {
            logger.warn('[handleSave] 개별 품목 삭제 메모리 캐시 업데이트 실패', { 
              purchaseId: purchaseIdNumber, 
              itemId: itemId 
            })
          } else {
            logger.info('✅ [handleSave] 개별 품목 삭제 메모리 캐시 업데이트 성공', { 
              purchaseId: purchaseIdNumber, 
              itemId: itemId 
            })
          }
        })
      }
      
      // 2. 발주 기본 정보 메모리 캐시 업데이트 (수정된 필드들만)
      if (!Number.isNaN(purchaseIdNumber)) {
        const memoryUpdated = updatePurchaseInMemory(purchaseIdNumber, (prev) => {
          const totalAmount = editedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
          
          logger.info('🚀 [메모리 캐시] 발주 기본 정보 업데이트', {
            purchaseId: purchaseIdNumber,
            newTotalAmount: totalAmount,
            itemsCount: editedItems.length
          })
          
          return {
            ...prev,
            // 발주 기본 정보 업데이트
            purchase_order_number: sourceData?.purchase_order_number || prev.purchase_order_number,
            requester_name: sourceData?.requester_name || prev.requester_name,
            vendor_id: sourceData?.vendor_id || prev.vendor_id,
            vendor_name: sourceData?.vendor_name || prev.vendor_name,
            vendor: sourceData?.vendor || (prev as any).vendor,
            vendor_contacts: sourceData?.vendor_contacts || (prev as any).vendor_contacts,
            delivery_request_date: sourceData?.delivery_request_date || prev.delivery_request_date,
            revised_delivery_request_date: sourceData?.revised_delivery_request_date || prev.revised_delivery_request_date,
            payment_category: sourceData?.payment_category || prev.payment_category,
            project_vendor: sourceData?.project_vendor || prev.project_vendor,
            project_item: sourceData?.project_item || prev.project_item,
            total_amount: totalAmount,
            // 🚀 품목 데이터도 메모리 캐시에 업데이트 (단가 등 실시간 반영)
            items: editedItems,
            purchase_request_items: editedItems,
            updated_at: new Date().toISOString()
          } as Purchase
        })
        
        logger.info('🚀 [메모리 캐시] 기본 정보 업데이트 결과:', { memoryUpdated })
      }
      
      // 3. applyOptimisticUpdate 함수 정의 (전체완료 함수 패턴)
      const applyOptimisticUpdate = () => {
        if (!Number.isNaN(purchaseIdNumber) && onOptimisticUpdate) {
          onOptimisticUpdate(purchaseIdNumber, prev => {
            const finalItems = editedItems // 삭제된 항목이 이미 제외됨
            const totalAmount = finalItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)
            
            logger.info('🚀 [onOptimisticUpdate] 즉시 UI 업데이트', {
              originalItemsCount: prev.items?.length || prev.purchase_request_items?.length || 0,
              finalItemsCount: finalItems.length,
              deletedItemsCount: deletedItemIds.length
            })
            
            return {
              ...prev,
              // 발주 기본 정보 업데이트
              purchase_order_number: sourceData?.purchase_order_number || prev.purchase_order_number,
              requester_name: sourceData?.requester_name || prev.requester_name,
              vendor_id: sourceData?.vendor_id || prev.vendor_id,
              vendor_name: sourceData?.vendor_name || prev.vendor_name,
              vendor: sourceData?.vendor || (prev as any).vendor,
              vendor_contacts: sourceData?.vendor_contacts || (prev as any).vendor_contacts,
              delivery_request_date: sourceData?.delivery_request_date || prev.delivery_request_date,
              revised_delivery_request_date: sourceData?.revised_delivery_request_date || prev.revised_delivery_request_date,
              payment_category: sourceData?.payment_category || prev.payment_category,
              project_vendor: sourceData?.project_vendor || prev.project_vendor,
              project_item: sourceData?.project_item || prev.project_item,
              total_amount: totalAmount,
              // 품목 데이터 업데이트 - 삭제된 항목 제외
              items: finalItems,
              purchase_request_items: finalItems,
              updated_at: new Date().toISOString()
            } as Purchase
          })
        }
      }
      
      // 4. 즉시 UI 업데이트 실행 (전체완료 함수 패턴)
      applyOptimisticUpdate()

      toast.success('발주 내역이 성공적으로 저장되었습니다.')
      handleEditToggle(false)
      setDeletedItemIds([])
      
      // 5. 전체완료 함수 패턴: refreshModalData 먼저, 그 다음 onRefresh
      await refreshModalData()
      logger.info('🔍 refreshModalData 완료 후 purchase:', { purchaseId: purchase?.id })
      console.log('🔍 refreshModalData 완료 후 - 전체 purchase 상태:', purchase)
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('저장 중 전체 오류', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'
      toast.error(`저장 실패: ${errorMessage}`)
    } finally {
      // 🚀 저장 로딩 상태 종료
      setIsSaving(false)
    }
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...editedItems]
    
    if (field === 'quantity' || field === 'unit_price_value') {
      // 수량이나 단가를 수정한 경우 금액 및 세액 자동 계산
      const quantity = field === 'quantity' ? value : newItems[index].quantity
      const unitPrice = field === 'unit_price_value' ? value : newItems[index].unit_price_value
      const amount = (quantity || 0) * (unitPrice || 0)
      
      // 발주 카테고리인 경우 세액(10%) 자동 계산
      const taxAmount = purchase?.payment_category === '발주' ? Math.round(amount * 0.1) : 0
      
      newItems[index] = {
        ...newItems[index],
        [field]: value,
        amount_value: amount,
        tax_amount_value: taxAmount
      }
    } else if (field === 'amount_value') {
      // 합계금액을 직접 수정한 경우
      const amount = Number(value) || 0
      
      // 발주 카테고리인 경우 세액(10%) 자동 계산
      const taxAmount = purchase?.payment_category === '발주' ? Math.round(amount * 0.1) : 0
      
      newItems[index] = {
        ...newItems[index],
        amount_value: amount,
        tax_amount_value: taxAmount
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
    // 현재 최대 라인넘버 찾기
    const maxLineNumber = editedItems.reduce((max, item) => {
      const lineNum = item.line_number || 0;
      return lineNum > max ? lineNum : max;
    }, 0);

    const newItem = {
      item_name: '',
      specification: '',
      quantity: 1,
      unit_price_value: 0,
      amount_value: 0,
      remark: '',
      line_number: maxLineNumber + 1,
      tempId: `tmp-new-${Date.now()}-${Math.random()}`
    }
    
    // 새 아이템 추가 후 라인넘버 순서대로 정렬
    const newItems = [...editedItems, newItem].sort((a, b) => {
      const lineA = a.line_number || 999999;
      const lineB = b.line_number || 999999;
      return lineA - lineB;
    }).map((item, idx) => ({
      ...item,
      line_number: idx + 1,
      stableKey: item.stableKey ?? makeStableKey(item, idx)
    }));
    
    setEditedItems(newItems)
  }

  const handleRemoveItem = (index: number) => {
    const item = editedItems[index]
    if (item.id) {
      setDeletedItemIds([...deletedItemIds, item.id])
    }
    const newItems = editedItems
      .filter((_, i) => i !== index)
      .sort((a, b) => {
        const lineA = a.line_number || 999999;
        const lineB = b.line_number || 999999;
        return lineA - lineB;
      })
      .map((it, idx) => ({
        ...it,
        line_number: idx + 1,
        stableKey: it.stableKey ?? makeStableKey(it, idx)
      }))
    setEditedItems(newItems)
  }

  // 구매완료 처리 함수
  const handlePaymentToggle = async (itemId: number | string, isCompleted: boolean) => {
    
    if (!canPurchase) {
      logger.warn('[handlePaymentToggle] 권한 없음', { canPurchase, currentUserRoles })
      toast.error('구매완료 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)


    if (Number.isNaN(numericId)) {
      logger.error('[handlePaymentToggle] 잘못된 ID', { itemId, numericId })
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 해당 품목 정보 찾기 - 데이터 구조 디버깅
    
    // items와 purchase_request_items 둘 다 확인 - length로 실제 데이터 유무 판단
    if (!purchase) return
    
    const purchaseItems = (purchase.items && purchase.items.length > 0) ? purchase.items : []
    const requestItems = (purchase.purchase_request_items && purchase.purchase_request_items.length > 0) ? purchase.purchase_request_items : []
    const items = purchaseItems.length > 0 ? purchaseItems : requestItems
    
    
    const targetItem = items.find(item => String(item.id) === itemIdStr)
    
    
    if (!targetItem) {
      return
    }

    const itemInfo = `품명: ${targetItem.item_name}
규격: ${targetItem.specification || '미입력'}
수량: ${targetItem.quantity?.toLocaleString() || 0}${targetItem.unit || ''}
단가: ₩${targetItem.unit_price_value?.toLocaleString() || 0}
합계: ₩${targetItem.amount_value?.toLocaleString() || 0}`

    const confirmMessage = isCompleted 
      ? `다음 품목을 구매완료 처리하시겠습니까?\n\n${itemInfo}` 
      : `다음 품목의 구매완료를 취소하시겠습니까?\n\n${itemInfo}`
    
    const confirm = window.confirm(confirmMessage)
    
    if (!confirm) {
      return
    }

    try {
      
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_payment_completed: isCompleted,
          payment_completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', numericId)

      if (error) {
        throw error
      }
      

      // 🚀 메모리 캐시 즉시 업데이트 (구매완료/취소 모두 처리)
      if (purchase) {
        
        const memoryUpdated = isCompleted 
          ? markItemAsPaymentCompleted(purchase.id, numericId)
          : markItemAsPaymentCanceled(purchase.id, numericId);
          
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 품목 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: numericId,
            isCompleted
          });
        }
      }

      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) {
          return null
        }
        
        // items와 purchase_request_items 둘 다 확인하여 업데이트 - length로 실제 데이터 유무 판단
        const prevItems = (prev.items && prev.items.length > 0) ? prev.items : []
        const prevRequestItems = (prev.purchase_request_items && prev.purchase_request_items.length > 0) ? prev.purchase_request_items : []
        const currentItems = prevItems.length > 0 ? prevItems : prevRequestItems
        const updatedItems = currentItems.map(item => 
          String(item.id) === itemIdStr 
            ? { ...item, is_payment_completed: isCompleted, payment_completed_at: isCompleted ? new Date().toISOString() : null }
            : item
        )
        
        
        // 데이터 구조에 맞게 업데이트
        const result = {
          ...prev,
          items: prev.items ? updatedItems : prev.items,
          purchase_request_items: prev.purchase_request_items ? updatedItems : prev.purchase_request_items
        }
        
        return result
      })

      if (purchase) {
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate?.(purchaseIdNumber, prev => {
            const updatedItems = (prev.items || []).map(item =>
              String(item.id) === itemIdStr
                ? { ...item, is_payment_completed: isCompleted }
                : item
            )
            const total = updatedItems.length || prev.items?.length || 0
            const completed = updatedItems.filter(item => item.is_payment_completed).length
            const allCompleted = total > 0 && completed === total
            return {
              ...prev,
              items: updatedItems,
              is_payment_completed: allCompleted,
              payment_completed_at: allCompleted ? new Date().toISOString() : null,
              payment_completed_by_name: allCompleted ? (currentUserName || prev.payment_completed_by_name) : prev.payment_completed_by_name
            }
          })
        }
      }
      
      toast.success(isCompleted ? '구매완료 처리되었습니다.' : '구매완료가 취소되었습니다.')

      // 상세 모달 및 상위 리스트 모두 최신 상태로 동기화
      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 개별 품목 입고완료 처리 (날짜 선택 + 실제입고수량) - 분할 입고 지원
  const handleItemReceiptToggle = async (itemId: number | string, selectedDate: Date, receivedQuantity?: number) => {
    if (!canReceiveItems) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 현재 품목 정보 가져오기
    const currentItem = purchase?.items?.find(item => String(item.id) === itemIdStr) 
      || purchase?.purchase_request_items?.find(item => String(item.id) === itemIdStr)
    
    const requestedQty = currentItem?.quantity || 0
    const currentReceivedQty = currentItem?.received_quantity || 0
    const newReceivedQty = receivedQuantity !== undefined ? receivedQuantity : requestedQty
    const totalReceivedQty = currentReceivedQty + newReceivedQty
    const isFullyReceived = totalReceivedQty >= requestedQty
    const deliveryStatus: 'pending' | 'partial' | 'received' = totalReceivedQty === 0 ? 'pending' : (isFullyReceived ? 'received' : 'partial')

    // 기존 입고 이력 가져오기
    const existingHistory = (currentItem?.receipt_history as any[]) || []
    const nextSeq = existingHistory.length + 1
    const newHistoryItem = {
      seq: nextSeq,
      qty: newReceivedQty,
      date: selectedDate.toISOString(),
      by: currentUserName || '알수없음'
    }
    const updatedHistory = [...existingHistory, newHistoryItem]

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item =>
            String(item.id) === itemIdStr
              ? {
                  ...item,
                  is_received: isFullyReceived,
                  delivery_status: deliveryStatus,
                  actual_received_date: selectedDate.toISOString(),
                  received_quantity: totalReceivedQty,
                  receipt_history: updatedHistory
                }
              : item
          )
          const total = updatedItems.length || prev.items?.length || 0
          const completed = updatedItems.filter(item => item.is_received).length
          const allReceived = total > 0 && completed === total

          return {
            ...prev,
            items: updatedItems,
            is_received: allReceived,
            received_at: allReceived ? new Date().toISOString() : prev.received_at
          }
        })
      }
    }

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: isFullyReceived,
          delivery_status: deliveryStatus,
          received_at: new Date().toISOString(),
          actual_received_date: selectedDate.toISOString(),
          received_quantity: totalReceivedQty,
          receipt_history: updatedHistory
        })
        .eq('id', numericId)

      if (error) throw error

      // 🚀 메모리 캐시 즉시 업데이트 (분할 입고 지원)
      if (purchase) {
        const memoryUpdated = markItemAsReceived(purchase.id, numericId, selectedDate.toISOString(), totalReceivedQty);
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 개별 품목 입고완료 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: numericId 
          });
        }
      }

      // 로컬 상태 즉시 업데이트 (분할 입고 지원)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          String(item.id) === itemIdStr 
            ? { 
                ...item, 
                is_received: isFullyReceived, 
                delivery_status: deliveryStatus,
                received_at: new Date().toISOString(),
                actual_received_date: selectedDate.toISOString(),
                received_quantity: totalReceivedQty,
                receipt_history: updatedHistory
              }
            : item
        )
        const updatedRequestItems = prev.purchase_request_items?.map(item => 
          String(item.id) === itemIdStr 
            ? { 
                ...item, 
                is_received: isFullyReceived, 
                delivery_status: deliveryStatus,
                received_at: new Date().toISOString(),
                actual_received_date: selectedDate.toISOString(),
                received_quantity: totalReceivedQty,
                receipt_history: updatedHistory
              }
            : item
        )
        return { 
          ...prev, 
          items: updatedItems,
          purchase_request_items: updatedRequestItems,
          updated_at: new Date().toISOString()
        }
      })

      applyOptimisticUpdate()
      
      const targetItem = purchase?.items?.find(item => String(item.id) === itemIdStr)
      toast.success(`"${targetItem?.item_name}" 품목이 입고완료 처리되었습니다.`)

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      toast.error('입고완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 입고완료 취소 처리
  const handleReceiptCancel = async (itemId: number | string) => {
    if (!canProcessReceipt) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    const targetItem = purchase?.items?.find(item => String(item.id) === itemIdStr)
    if (!targetItem) return

    const confirm = window.confirm(`"${targetItem.item_name}" 품목의 입고완료를 취소하시겠습니까?`)
    if (!confirm) return

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item =>
            String(item.id) === itemIdStr
              ? {
                  ...item,
                  is_received: false,
                  actual_received_date: undefined
                }
              : item
          )
          const total = updatedItems.length || prev.items?.length || 0
          const completed = updatedItems.filter(item => item.is_received).length
          const allReceived = total > 0 && completed === total

          return {
            ...prev,
            items: updatedItems,
            is_received: allReceived,
            received_at: allReceived ? prev.received_at : null
          }
        })
      }
    }

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_received: false,
          received_at: null,
          actual_received_date: null,
          actual_received_by_name: null
        })
        .eq('id', numericId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          String(item.id) === itemIdStr 
            ? { ...item, is_received: false, received_at: null, actual_received_date: undefined, actual_received_by_name: undefined }
            : item
        )
        return { ...prev, items: updatedItems }
      })
      
      applyOptimisticUpdate()

      toast.success('입고완료가 취소되었습니다.')

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
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

      // 🚀 메모리 캐시 즉시 업데이트 (자동으로 notifyCacheListeners 호출됨 -> 대시보드 등 실시간 반영)
      updatePurchaseInMemory(String(purchase.id), (prev) => ({
        ...prev,
        ...(type === 'middle' 
          ? { middle_manager_status: 'approved' as any }
          : { final_manager_status: 'approved' as any }
        )
      }))

      // Optimistic Update로 리스트 즉시 반영 (구매완료/입고완료와 동일한 패턴)
      if (purchase && onOptimisticUpdate) {
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate(purchaseIdNumber, prev => {
            if (type === 'middle') {
              return {
                ...prev,
                middle_manager_status: 'approved' as any
              }
            } else {
              return {
                ...prev,
                final_manager_status: 'approved' as any
              }
            }
          })
        }
      }
      
      toast.success(`${type === 'middle' ? '중간' : '최종'} 승인이 완료되었습니다.`)

      // 상세 모달 및 리스트 모두 새로고침
      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  }
  
  // 전체 구매완료 처리 (개별 품목별 처리 방식)
  const handleCompleteAllPayment = async () => {
    
    if (!purchase || !canPurchase) {
      return
    }
    
    const confirmMessage = `발주번호: ${purchase.purchase_order_number}\n\n전체 구매완료 처리하시겠습니까?`
    const confirm = window.confirm(confirmMessage)
    if (!confirm) {
      return
    }

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const allItems = prev.purchase_request_items || [];
          const pendingItems = allItems.filter(item => !item.is_payment_completed);
          
          const updatedItems = allItems.map(item => 
            !item.is_payment_completed 
              ? { ...item, is_payment_completed: true, payment_completed_at: new Date().toISOString() }
              : item
          );
          
          return {
            ...prev,
            purchase_request_items: updatedItems,
            items: prev.items ? updatedItems : prev.items,
            is_payment_completed: updatedItems.every(item => item.is_payment_completed)
          }
        })
      }
    }
    
    try {
      // 🚀 미완료 품목만 필터링 (이미 구매완료된 품목 제외)
      const allItems = purchase.purchase_request_items || [];
      const pendingItems = allItems.filter(item => !item.is_payment_completed);
      
      if (pendingItems.length === 0) {
        toast.info('모든 품목이 이미 구매완료되었습니다.');
        return;
      }

      logger.info(`전체 구매완료 처리: ${pendingItems.length}개 품목 (총 ${allItems.length}개 중)`);
      
      for (const item of pendingItems) {
        // 각 품목별로 DB 업데이트 (개별 품목과 동일한 방식)
        const updateData = {
          is_payment_completed: true,
          payment_completed_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('purchase_request_items')
          .update(updateData)
          .eq('id', item.id);

        if (error) throw error;

        // 🚀 개별 품목 메모리 캐시 업데이트 (개별 처리와 동일)
        const memoryUpdated = markItemAsPaymentCompleted(purchase.id, item.id);
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 개별 품목 구매완료 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: item.id 
          });
        }
      }

      toast.success(`${pendingItems.length}개 품목이 구매완료 처리되었습니다.`);

      // 🚀 새로고침 (개별 품목과 동일)
      await refreshModalData();
      const refreshResult = onRefresh?.(true, { silent: true });
      if (refreshResult instanceof Promise) {
        await refreshResult;
      }
    } catch (error) {
      logger.error('전체 구매완료 처리 오류', error);
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 개별 지출 정보 입력 처리
  const handleItemExpenditure = async (itemId: number | string, date: Date, amount: number) => {
    if (!purchase || !canReceiptCheck) {
      toast.error('지출 정보 입력 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      logger.error('유효하지 않은 itemId', { itemId })
      return
    }

    const targetItem = purchase.items?.find(item => String(item.id) === itemIdStr)
    if (!targetItem) return

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item =>
            String(item.id) === itemIdStr
              ? {
                  ...item,
                  expenditure_date: date.toISOString(),
                  expenditure_amount: amount
                }
              : item
          )
          return { ...prev, items: updatedItems }
        })
      }
    }

    try {
      applyOptimisticUpdate()

      // 로컬 상태 즉시 업데이트 (items와 purchase_request_items 모두 업데이트) - 다른 함수들과 동일한 패턴
      setPurchase(prev => {
        if (!prev) return null
        const currentItems = prev.items || prev.purchase_request_items || []
        const updatedItems = currentItems.map(item => 
          String(item.id) === itemIdStr
            ? {
                ...item,
                expenditure_date: date.toISOString(),
                expenditure_amount: amount
              }
            : item
        )
        const totalExpenditure = updatedItems.reduce((sum, item) => sum + (item.expenditure_amount || 0), 0)
        // 새 객체를 반환하여 React가 변경을 감지하도록 함
        return { 
          ...prev, 
          items: updatedItems,
          purchase_request_items: updatedItems,
          total_expenditure_amount: totalExpenditure,
          updated_at: new Date().toISOString() // 강제로 객체 참조 변경
        }
      })

      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          expenditure_date: date.toISOString(),
          expenditure_amount: amount
        })
        .eq('id', numericId)

      if (error) {
        logger.error('지출 정보 DB 업데이트 실패', { error, itemId: numericId })
        throw error
      }

      // purchase_requests의 total_expenditure_amount 업데이트
      const allItemsForTotal = purchase.items || purchase.purchase_request_items || []
      const totalExpenditure = allItemsForTotal.reduce((sum, item) => {
        if (String(item.id) === itemIdStr) {
          return sum + amount
        }
        return sum + (item.expenditure_amount || 0)
      }, 0)

      await supabase
        .from('purchase_requests')
        .update({ total_expenditure_amount: totalExpenditure })
        .eq('id', purchaseIdNumber)

      // 🚀 메모리 캐시 즉시 업데이트 (실시간 UI 반영) - DB 업데이트 후에 호출
      if (purchase?.id) {
        const memoryUpdated = markItemAsExpenditureSet(purchase.id, numericId, date.toISOString(), amount)
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 지출 정보 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: numericId 
          })
        }
      }

      toast.success(`"${targetItem.item_name}" 품목의 지출 정보가 저장되었습니다.`)

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('지출 정보 입력 중 오류', error)
      toast.error('지출 정보 입력 중 오류가 발생했습니다.')
    }
  }

  // 일괄 지출 정보 입력 처리
  const handleBulkExpenditure = async (date: Date, amount: number) => {
    if (!purchase || !canReceiptCheck) {
      toast.error('지출 정보 입력 권한이 없습니다.')
      return
    }

    const confirmMessage = `발주번호: ${purchase.purchase_order_number}\n\n일괄 지출 정보를 입력하시겠습니까?\n날짜: ${date.toLocaleDateString('ko-KR')}\n총 금액: ${amount.toLocaleString()}원\n\n* 주의: 기존에 입력된 개별 품목의 지출 정보가 모두 초기화되고, 입력하신 총 금액으로 설정됩니다.`
    
    if (!window.confirm(confirmMessage)) {
      return
    }

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item => ({
            ...item,
            expenditure_date: date.toISOString(),
            expenditure_amount: null
          }))
          return { 
            ...prev, 
            items: updatedItems,
            total_expenditure_amount: amount
          }
        })
      }
    }

    try {
      applyOptimisticUpdate()

      const allItems = purchase.items || purchase.purchase_request_items || []
      
      if (allItems.length === 0) {
        toast.error('품목이 없습니다.')
        return
      }

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const allItems = prev.items || prev.purchase_request_items || []
        const updatedItems = allItems.map(item => ({
            ...item,
            expenditure_date: date.toISOString(),
            expenditure_amount: null
        }))
        
        return { 
          ...prev, 
          items: updatedItems,
          purchase_request_items: updatedItems,
          total_expenditure_amount: amount,
          updated_at: new Date().toISOString()
        }
      })

      // DB 업데이트 - 전체 아이템 (금액은 null)
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .update({
          expenditure_date: date.toISOString(),
          expenditure_amount: null
        })
        .in('id', allItems.map(item => item.id))

      if (itemsError) {
        logger.error('일괄 지출 정보 아이템 DB 업데이트 실패', { error: itemsError })
        throw itemsError
      }

      // DB 업데이트 - 요청 총액
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .update({ total_expenditure_amount: amount })
        .eq('id', purchaseIdNumber)

      if (requestError) {
        logger.error('일괄 지출 정보 총액 DB 업데이트 실패', { error: requestError })
        throw requestError
      }

      // 🚀 메모리 캐시 즉시 업데이트 (실시간 UI 반영)
      markBulkExpenditureSet(purchase.id, date.toISOString(), amount)

      toast.success('일괄 지출 정보가 입력되었습니다.')
    } catch (error) {
      logger.error('일괄 지출 정보 입력 중 오류', error)
      toast.error('일괄 지출 정보 입력 중 오류가 발생했습니다.')
    }
  }

  // 전체 거래명세서 확인 처리 (개별 품목별 처리 방식)
  const handleCompleteAllStatement = async (selectedDate: Date) => {
    if (!purchase || !canReceiptCheck) {
      return
    }

    const formattedDate = selectedDate.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })

    const confirmMessage = `발주번호: ${purchase.purchase_order_number}

전체 거래명세서 확인 처리하시겠습니까?`
    
    if (!window.confirm(confirmMessage)) {
      return
    }

    const selectedDateIso = selectedDate.toISOString()
    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const allItems = prev.purchase_request_items || [];
          const pendingItems = allItems.filter(item => !item.is_statement_received);
          
          const updatedItems = allItems.map(item => 
            !item.is_statement_received 
              ? { 
                  ...item, 
                  is_statement_received: true, 
                  statement_received_date: selectedDateIso,
                  statement_received_by_name: currentUserName || null
                }
              : item
          );
          
          return {
            ...prev,
            purchase_request_items: updatedItems,
            items: prev.items ? updatedItems : prev.items,
            is_statement_received: updatedItems.every(item => item.is_statement_received),
            statement_received_at: selectedDateIso
          }
        })
      }
    }

    try {
      // 🚀 미완료 품목만 필터링 (이미 거래명세서 확인된 품목 제외)
      const allItems = purchase.purchase_request_items || [];
      const pendingItems = allItems.filter(item => !item.is_statement_received);
      
      if (pendingItems.length === 0) {
        toast.info('모든 품목의 거래명세서가 이미 확인되었습니다.');
        return;
      }

      logger.info(`전체 거래명세서 확인 처리: ${pendingItems.length}개 품목 (총 ${allItems.length}개 중)`);
      
      for (const item of pendingItems) {
        // 각 품목별로 DB 업데이트 (개별 품목과 동일한 방식)
        const updateData = {
          is_statement_received: true,
          statement_received_date: selectedDateIso,
          statement_received_by_name: currentUserName || null
        };

        const { error } = await supabase
          .from('purchase_request_items')
          .update(updateData)
          .eq('id', item.id);

        if (error) throw error;

        // 🚀 개별 품목 메모리 캐시 업데이트 (개별 처리와 동일)
        const memoryUpdated = markItemAsStatementReceived(purchase.id, item.id, selectedDateIso, currentUserName || undefined);
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 개별 품목 거래명세서 확인 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: item.id 
          });
        }
      }

      toast.success(`${pendingItems.length}개 품목의 거래명세서 확인이 완료되었습니다.`);

      // 🚀 새로고침 (개별 품목과 동일)
      await refreshModalData();
      const refreshResult = onRefresh?.(true, { silent: true });
      if (refreshResult instanceof Promise) {
        await refreshResult;
      }
    } catch (error) {
      logger.error('전체 거래명세서 확인 처리 오류', error)
      toast.error('거래명세서 확인 처리 중 오류가 발생했습니다.')
    }
  }

  // 전체 입고완료 처리 (날짜 선택 + 실제입고수량)
  const handleCompleteAllReceipt = async (selectedDate: Date, receivedQuantity?: number) => {
    if (!purchase || !canReceiveItems) {
      return
    }

    // 확인 다이얼로그 표시
    const confirmMessage = `발주번호: ${purchase.purchase_order_number}

전체 입고완료 처리하시겠습니까?`
    
    if (!window.confirm(confirmMessage)) {
      return
    }

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    try {
      // 🚀 미완료 품목만 필터링 (이미 입고완료된 품목 제외)
      const allItems = purchase.purchase_request_items || [];
      const pendingItems = allItems.filter(item => !item.is_received);
      
      const applyOptimisticUpdate = () => {
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate?.(purchaseIdNumber, prev => {
            const updatedItems = (prev.items || []).map(item => {
              const pendingItem = pendingItems.find((p: any) => String(p.id) === String(item.id))
              if (pendingItem) {
                // 미완료 품목만 업데이트, receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
                return {
                  ...item,
                  is_received: true,
                  actual_received_date: item.actual_received_date || selectedDate.toISOString(),
                  received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.quantity
                }
              }
              return item
            })
            const updatedRequestItems = (prev.purchase_request_items || []).map(item => {
              const pendingItem = pendingItems.find((p: any) => String(p.id) === String(item.id))
              if (pendingItem) {
                // 미완료 품목만 업데이트, receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
                return {
                  ...item,
                  is_received: true,
                  actual_received_date: item.actual_received_date || selectedDate.toISOString(),
                  received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.quantity
                }
              }
              return item
            })

            return {
              ...prev,
              items: updatedItems,
              purchase_request_items: updatedRequestItems,
              is_received: true,
              received_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          })
        }
      }
      
      if (pendingItems.length === 0) {
        toast.info('모든 품목이 이미 입고완료되었습니다.');
        return;
      }

      logger.info(`전체 입고완료 처리: ${pendingItems.length}개 품목 (총 ${allItems.length}개 중)`);
      
      // Optimistic Update 먼저 실행
      applyOptimisticUpdate()
      
      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => {
          const pendingItem = pendingItems.find(p => String(p.id) === String(item.id))
          if (pendingItem) {
            // receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
            return {
              ...item,
              is_received: true,
              received_at: new Date().toISOString(),
              actual_received_date: selectedDate.toISOString(),
              received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.quantity
            }
          }
          return item
        }) || []
        const updatedRequestItems = prev.purchase_request_items?.map(item => {
          const pendingItem = pendingItems.find(p => String(p.id) === String(item.id))
          if (pendingItem) {
            // receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
            return {
              ...item,
              is_received: true,
              received_at: new Date().toISOString(),
              actual_received_date: selectedDate.toISOString(),
              received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.quantity
            }
          }
          return item
        }) || []
        const total = updatedItems.length
        const completed = updatedItems.filter(item => item.is_received).length
        const allReceived = total > 0 && completed === total
        
        return {
          ...prev,
          items: updatedItems,
          purchase_request_items: updatedRequestItems,
          is_received: allReceived,
          received_at: allReceived ? new Date().toISOString() : prev.received_at,
          updated_at: new Date().toISOString()
        }
      })
      
      for (const item of pendingItems) {
        // 각 품목별로 DB 업데이트 (개별 품목과 동일한 방식)
        // receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
        const updateData = {
          actual_received_date: selectedDate.toISOString(),
          is_received: true,
          received_quantity: receivedQuantity !== undefined ? receivedQuantity : item.quantity // 전체 입고시 요청수량과 동일하게 설정
        };

        const { error } = await supabase
          .from('purchase_request_items')
          .update(updateData)
          .eq('id', item.id);

        if (error) throw error;

        // 🚀 개별 품목 메모리 캐시 업데이트 (개별 처리와 동일)
        // receivedQuantity가 없으면 요청수량(quantity)을 그대로 사용
        const itemReceivedQuantity = receivedQuantity !== undefined ? receivedQuantity : item.quantity
        const memoryUpdated = markItemAsReceived(purchase.id, item.id, selectedDate.toISOString(), itemReceivedQuantity);
        if (!memoryUpdated) {
          logger.warn('[PurchaseDetailModal] 메모리 캐시 개별 품목 입고완료 업데이트 실패', { 
            purchaseId: purchase.id, 
            itemId: item.id 
          });
        }
      }

      toast.success(`${pendingItems.length}개 품목이 입고완료 처리되었습니다.`);

      // 🚀 새로고침 (개별 품목과 동일)
      await refreshModalData();
      const refreshResult = onRefresh?.(true, { silent: true });
      if (refreshResult instanceof Promise) {
        await refreshResult;
      }
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

  const renderItemRow = (item: any, index: number, dragProps?: SortableRenderProps, rowKey?: string) => {
    const stableKey = rowKey || item?.stableKey || getSortableId(item, index)
    const rowClass = `px-2 sm:px-3 py-1 border-b border-gray-50 hover:bg-gray-50/50 relative overflow-visible w-fit ${isEditing ? 'pl-7 sm:pl-8' : ''} ${dragProps?.isDragging ? 'shadow-lg ring-2 ring-blue-200 bg-white' : ''}`
    const rowProps: any = {
      className: rowClass,
      key: stableKey
    }
    if (dragProps?.setNodeRef) rowProps.ref = dragProps.setNodeRef
    if (dragProps?.style) rowProps.style = dragProps.style

    return (
      <div {...rowProps}>
        {isEditing && dragProps && (
          <button
            className="absolute left-1 top-2 sm:top-3 text-gray-400 hover:text-gray-600 p-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200"
            {...dragProps.attributes}
            {...dragProps.listeners}
            aria-label="드래그하여 품목 순서 변경"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Desktop Layout */}
        <div className={`hidden sm:grid items-center gap-1 overflow-visible w-fit`} style={{
          gridTemplateColumns: getGridTemplateColumns()
        }}>
          {/* 라인넘버 */}
          <div className="flex justify-center items-center text-[11px] text-gray-500 font-medium -ml-2 sm:-ml-3">
            {item.line_number || index + 1}
          </div>
          {/* 품목명 */}
          <div className="min-w-0 relative overflow-visible flex items-center">
            {isEditing ? (
              <Input
                value={item.item_name}
                onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                onFocus={() => setFocusedInput(`item_name_${index}`)}
                onBlur={() => setFocusedInput(null)}
                className={`modal-label border-gray-200 rounded-lg w-full !px-1.5 !py-0.5 !text-[10px] focus:border-blue-400 transition-all duration-200 ${
                  focusedInput === `item_name_${index}` 
                    ? '!h-auto !min-h-[20px] !absolute !z-[9999] !bg-white !shadow-lg !left-0 !right-0 !-translate-y-1/2 !top-1/2 !whitespace-normal' 
                    : '!h-5 !truncate'
                }`}
                placeholder="품목명"
              />
            ) : (
              <div 
                className="modal-value" 
                style={{
                  whiteSpace: 'normal',
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word',
                  hyphens: 'none',
                  WebkitHyphens: 'none',
                  MozHyphens: 'none',
                  msHyphens: 'none',
                  lineHeight: '1.4',
                  maxHeight: '2.8em',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
                title={item.item_name || '품목명 없음'}
              >
                {item.item_name || '품목명 없음'}
              </div>
            )}
          </div>
          
          {/* 규격 */}
          <div className="min-w-0 relative overflow-visible flex items-center w-full">
            {isEditing ? (
              <Input
                value={item.specification}
                onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                onFocus={() => setFocusedInput(`specification_${index}`)}
                onBlur={() => setFocusedInput(null)}
                className={`modal-label border-gray-200 rounded-lg w-full !px-1.5 !py-0.5 !text-[10px] focus:border-blue-400 transition-all duration-200 ${
                  focusedInput === `specification_${index}` 
                    ? '!h-auto !min-h-[20px] !absolute !z-[9999] !bg-white !shadow-lg !left-0 !right-0 !-translate-y-1/2 !top-1/2 !whitespace-normal' 
                    : '!h-5 !truncate'
                }`}
                placeholder="규격"
              />
            ) : (
              <div 
                className="text-[11px] text-gray-600 font-medium" 
                style={{
                  whiteSpace: 'normal',
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word',
                  hyphens: 'none',
                  WebkitHyphens: 'none',
                  MozHyphens: 'none',
                  msHyphens: 'none',
                  lineHeight: '1.4',
                  maxHeight: '2.8em',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
                title={item.specification || '-'}
              >
                {item.specification || '-'}
              </div>
            )}
          </div>
          
          {/* 수량 */}
          <div className="text-center min-w-0 flex items-center justify-center">
            {isEditing ? (
              (activeTab === 'receipt' || activeTab === 'done') ? (
                <div className="flex flex-col items-center gap-0.5 w-full">
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                    className="border-gray-200 rounded-lg text-center w-full !h-5 !px-1.5 !py-0.5 !text-[9px] font-normal text-gray-600 focus:border-blue-400"
                    placeholder="요청수량"
                    max="99999"
                    disabled={canEditLimited && !canEditAll}
                  />
                  <div className="flex items-center gap-0.5 w-full">
                    <span className="text-[9px] text-gray-500">/</span>
                    <Input
                      type="number"
                      value={item.received_quantity ?? ''}
                      onChange={(e) => handleItemChange(index, 'received_quantity', e.target.value ? Number(e.target.value) : null)}
                      className="border-gray-200 rounded-lg text-center flex-1 !h-5 !px-1.5 !py-0.5 !text-[9px] font-normal text-gray-600 focus:border-blue-400"
                      placeholder="실제입고"
                      max="99999"
                      disabled={canEditLimited && !canEditAll}
                    />
                  </div>
                </div>
              ) : (
                <Input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                  className="border-gray-200 rounded-lg text-center w-full !h-5 !px-1.5 !py-0.5 !text-[9px] font-normal text-gray-600 focus:border-blue-400"
                  placeholder="수량"
                  max="99999"
                  disabled={canEditLimited && !canEditAll}
                />
              )
            ) : (
              (activeTab === 'receipt' || activeTab === 'done') ? (
                (() => {
                  const quantity = item.quantity || 0
                  const receivedQuantity = item.received_quantity ?? 0
                  const shouldWrap = quantity >= 100 || receivedQuantity >= 100
                  const hasReceived = receivedQuantity > 0
                  
                  if (shouldWrap) {
                    return (
                      <div className="flex flex-col items-center leading-tight">
                        <div className={`modal-subtitle ${hasReceived ? 'text-gray-400' : ''}`}>{quantity}</div>
                        <div className={`modal-subtitle ${hasReceived ? '' : 'text-gray-400'}`}>/{receivedQuantity}</div>
                      </div>
                    )
                  } else {
                    return (
                      <span className="modal-subtitle">
                        <span className={hasReceived ? 'text-gray-400' : ''}>{quantity}</span>
                        <span className={hasReceived ? '' : 'text-gray-400'}>/{receivedQuantity}</span>
                      </span>
                    )
                  }
                })()
              ) : (
                <span className="modal-subtitle">{item.quantity || 0}</span>
              )
            )}
          </div>
          
          {/* 단가 */}
          <div className="text-right min-w-0 flex items-center justify-end">
            {isEditing ? (
              <Input
                type="number"
                value={item.unit_price_value}
                onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                className="border-gray-200 rounded-lg text-right w-full !h-5 !px-1.5 !py-0.5 !text-[9px] font-normal text-gray-600 focus:border-blue-400"
                placeholder="단가"
                max="100000000000"
              />
            ) : (
              <span className="modal-subtitle">
                {activeTab === 'done' && !canViewFinancialInfo 
                  ? '-' 
                  : `₩${formatCurrency(item.unit_price_value)}`}
              </span>
            )}
          </div>
          
          {/* 합계 (수동 입력 가능) */}
          <div className="text-right min-w-0 flex items-center justify-end">
            {isEditing ? (
              <Input
                type="number"
                value={item.amount_value || 0}
                onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                className="border-gray-200 rounded-lg w-full !h-6 !px-1.5 !py-0.5 !text-[10px] font-normal text-gray-600 focus:border-blue-400 text-right"
                placeholder="합계"
              />
            ) : (
              <span className="modal-value">
                {activeTab === 'done' && !canViewFinancialInfo 
                  ? '-' 
                  : `₩${formatCurrency(item.amount_value || 0)}`}
              </span>
            )}
          </div>
          
          {/* 세액 - 발주 카테고리인 경우 모든 탭에서 표시 */}
          {purchase?.payment_category === '발주' && (
            <div className="text-right min-w-0 flex items-center justify-end">
              <span className={isEditing ? "modal-subtitle" : "modal-value"}>
                {activeTab === 'done' && !canViewFinancialInfo 
                  ? '-' 
                  : `₩${formatCurrency(item.tax_amount_value || 0)}`}
              </span>
            </div>
          )}
          
          {/* 링크 */}
          <div className="text-center min-w-0 flex items-center justify-center">
            {item.link ? (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline text-[11px]"
                onClick={(e) => e.stopPropagation()}
              >
                링크
              </a>
            ) : (
              <span className="text-gray-400 text-[11px]">-</span>
            )}
          </div>
          
          {/* 비고 */}
          <div className="min-w-0 flex justify-center items-center text-center relative overflow-visible" style={{ width: '150px', maxWidth: '150px', minWidth: '150px' }}>
            {isEditing ? (
              <Input
                value={item.remark || ''}
                disabled={canEditLimited && !canEditAll}
                onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                onFocus={() => setFocusedInput(`remark_${index}`)}
                onBlur={() => setFocusedInput(null)}
                className={`modal-label border-gray-200 rounded-lg text-center w-full !px-1.5 !py-0.5 !text-[10px] focus:border-blue-400 transition-all duration-200 ${
                  focusedInput === `remark_${index}` 
                    ? '!h-auto !min-h-[20px] !absolute !z-[9999] !bg-white !shadow-lg !left-0 !right-0 !-translate-y-1/2 !top-1/2 !whitespace-normal !text-left' 
                    : '!h-5 !truncate'
                }`}
                placeholder="비고"
              />
            ) : (
              <div 
                className="text-[11px] text-gray-600 font-medium"
                style={{
                  width: '150px',
                  maxWidth: '150px',
                  minWidth: '150px',
                  boxSizing: 'border-box',
                  whiteSpace: 'normal',
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word',
                  hyphens: 'none',
                  WebkitHyphens: 'none',
                  MozHyphens: 'none',
                  msHyphens: 'none',
                  lineHeight: '1.4',
                  maxHeight: '2.8em',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
                title={item.remark || '-'}
              >
                {item.remark || '-'}
              </div>
            )}
          </div>
          
          {/* 상태/액션 - 승인대기탭에서는 제외 */}
          {activeTab !== 'pending' && (
            <div className="text-center flex justify-center items-center">
              {isEditing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveItem(index)}
                  className="text-red-600 hover:bg-red-50 rounded-lg p-1 h-6 w-6"
                  disabled={canEditLimited && !canEditAll}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              ) : (
                <>
                  {activeTab === 'purchase' && (
                  <div className="flex justify-center">
                    {canPurchase ? (
                      <button
                        onClick={() => handlePaymentToggle(item.id, !item.is_payment_completed)}
                        className={`${
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
                
                {activeTab === 'receipt' && (
                  <div className="flex justify-center">
                    {canReceiveItems ? (
                      actualReceivedAction.isCompleted(item) ? (
                        // 입고완료 상태 - 진파랑
                        <button
                          onClick={() => {
                            actualReceivedAction.handleCancel(item.id, {
                              item_name: item.item_name,
                              specification: item.specification,
                              quantity: item.quantity,
                              unit_price_value: item.unit_price_value,
                              amount_value: item.amount_value,
                              remark: item.remark
                            })
                          }}
                          className="button-action-primary"
                        >
                          {actualReceivedAction.config.completedText}
                        </button>
                      ) : actualReceivedAction.isPartiallyReceived(item) ? (
                        // 부분입고 상태 - 연파랑 (추가 입고 가능)
                        <DateQuantityPickerPopover
                          onConfirm={(date, quantity) => {
                            handleItemReceiptToggle(item.id, date, quantity)
                          }}
                          placeholder="추가 입고수량을 입력하세요"
                          align="center"
                          side="bottom"
                          maxQuantity={actualReceivedAction.getRemainingQuantity(item)}
                          quantityInfoText={`미입고: ${actualReceivedAction.getRemainingQuantity(item)}개`}
                        >
                          <button className="button-base bg-blue-300 hover:bg-blue-400 text-white">
                            부분입고
                          </button>
                        </DateQuantityPickerPopover>
                      ) : (
                        // 입고대기 상태 - 회색
                        <DateQuantityPickerPopover
                          onConfirm={(date, quantity) => {
                            handleItemReceiptToggle(item.id, date, quantity)
                          }}
                          placeholder="날짜와 실제입고수량을 입력하세요"
                          align="center"
                          side="bottom"
                          defaultQuantity={item.received_quantity ?? undefined}
                          maxQuantity={item.quantity}
                        >
                          <button className="button-toggle-inactive">
                            {actualReceivedAction.config.waitingText}
                          </button>
                        </DateQuantityPickerPopover>
                      )
                    ) : (
                      <span className={`${
                        actualReceivedAction.isCompleted(item)
                          ? 'button-action-primary' 
                          : actualReceivedAction.isPartiallyReceived(item)
                          ? 'button-base bg-blue-300 text-white'
                          : 'button-waiting-inactive'
                      }`}>
                        {actualReceivedAction.isCompleted(item) 
                          ? actualReceivedAction.config.completedText 
                          : actualReceivedAction.isPartiallyReceived(item)
                          ? '부분입고'
                          : actualReceivedAction.config.waitingText}
                      </span>
                    )}
                  </div>
                )}
                
                {activeTab === 'done' && (
                  <div className="flex justify-center">
                    <span className={`button-base ${
                      actualReceivedAction.isCompleted(item)
                        ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                        : actualReceivedAction.isPartiallyReceived(item)
                        ? 'bg-blue-300 text-white'
                        : 'border border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                    }`}>
                      {actualReceivedAction.isCompleted(item) 
                        ? '입고완료' 
                        : actualReceivedAction.isPartiallyReceived(item)
                        ? '부분입고'
                        : '입고대기'}
                    </span>
                  </div>
                )}
                
                {activeTab !== 'purchase' && activeTab !== 'receipt' && activeTab !== 'done' && (
                  <div className="flex justify-center">
                    <span className="badge-text">-</span>
                  </div>
                )}
              </>
            )}
            </div>
          )}
          
          {/* 실제 입고 날짜 - 입고 탭에서만 표시 (상태 컬럼 오른쪽) */}
          {activeTab === 'receipt' && (
            <div className="text-center flex justify-center items-center pl-2">
              {actualReceivedAction.getCompletedDate(item) ? (
                <div className="modal-subtitle text-green-700">
                  {new Date(actualReceivedAction.getCompletedDate(item)).toLocaleDateString('ko-KR', {
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

          {/* 거래명세서 확인 - 발주 + 리드바이어 입고현황/전체항목 */}
          {showStatementColumns && (
            <div className="text-center flex justify-center items-center">
              {canReceiptCheck ? (
                statementReceivedAction.isCompleted(item) ? (
                  <button
                    onClick={() => {
                      statementReceivedAction.handleCancel(item.id, {
                        item_name: item.item_name,
                        specification: item.specification,
                        quantity: item.quantity,
                        unit_price_value: item.unit_price_value,
                        amount_value: item.amount_value,
                        remark: item.remark
                      })
                    }}
                    className="button-action-primary hover:bg-green-600"
                    title="클릭하여 거래명세서 확인 취소"
                  >
                    {statementReceivedAction.config.completedText}
                  </button>
                ) : (
                  <DatePickerPopover
                    onDateSelect={(date) => {
                      statementReceivedAction.handleConfirm(item.id, date, {
                        item_name: item.item_name,
                        specification: item.specification,
                        quantity: item.quantity,
                        unit_price_value: item.unit_price_value,
                        amount_value: item.amount_value,
                        remark: item.remark
                      })
                    }}
                    placeholder="회계상 입고일을 선택하세요"
                    align="center"
                    side="bottom"
                  >
                    <button 
                      className="button-toggle-inactive"
                      onClick={() => {}}
                    >
                      {statementReceivedAction.config.waitingText}
                    </button>
                  </DatePickerPopover>
                )
              ) : (
                <span className={`${
                  statementReceivedAction.isCompleted(item)
                    ? 'button-action-primary' 
                    : 'button-waiting-inactive'
                }`}>
                  {statementReceivedAction.isCompleted(item) ? statementReceivedAction.config.completedText : statementReceivedAction.config.waitingText}
                </span>
              )}
            </div>
          )}

          {/* 회계상 입고일 - 발주 + 리드바이어 입고현황/전체항목 */}
          {showStatementColumns && (
            <div className="text-center flex justify-center items-center">
              {statementReceivedAction.getCompletedDate(item) ? (
                <div className="modal-subtitle text-blue-700">
                  {new Date(statementReceivedAction.getCompletedDate(item)).toLocaleDateString('ko-KR', {
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

          {/* 지출정보 - 발주인 경우에만 전체항목 탭에서 표시 */}
          {showExpenditureColumn && (
            <div className="text-center flex justify-center items-center">
              {(() => {
                const hasExpenditure = !!item.expenditure_date
                const hasExpenditureAmount = item.expenditure_amount !== null && item.expenditure_amount !== undefined
                
                if (canReceiptCheck) {
                  return hasExpenditure ? (
                    <div className="w-full px-1 leading-none">
                      <div className="text-blue-700 text-[9px] leading-[1.1] font-normal">
                        {(() => {
                          const date = new Date(item.expenditure_date)
                          const year = date.getFullYear().toString().slice(-2)
                          const month = (date.getMonth() + 1).toString().padStart(2, '0')
                          const day = date.getDate().toString().padStart(2, '0')
                          return `${year}.${month}.${day}`
                        })()}
                      </div>
                      <div className="text-gray-700 text-[9px] leading-[1.1] font-normal">
                        {!canViewFinancialInfo 
                          ? '-' 
                          : (hasExpenditureAmount ? `₩${Number(item.expenditure_amount).toLocaleString()}` : '')}
                      </div>
                    </div>
                  ) : (
                    <DateAmountPickerPopover
                      onConfirm={(date, amount) => handleItemExpenditure(item.id, date, amount)}
                      placeholder="지출 날짜와 금액을 입력하세요"
                      align="center"
                      side="bottom"
                    >
                      <button className="button-toggle-inactive">
                        지출입력
                      </button>
                    </DateAmountPickerPopover>
                  )
                } else {
                  return hasExpenditure ? (
                    <div className="w-full px-1 leading-none">
                      <div className="text-blue-700 text-[9px] leading-[1.1] font-normal">
                        {(() => {
                          const date = new Date(item.expenditure_date)
                          const year = date.getFullYear().toString().slice(-2)
                          const month = (date.getMonth() + 1).toString().padStart(2, '0')
                          const day = date.getDate().toString().padStart(2, '0')
                          return `${year}.${month}.${day}`
                        })()}
                      </div>
                      <div className="text-gray-700 text-[9px] leading-[1.1] font-normal">
                        {!canViewFinancialInfo 
                          ? '-' 
                          : (hasExpenditureAmount ? `₩${Number(item.expenditure_amount).toLocaleString()}` : '')}
                      </div>
                    </div>
                  ) : (
                    <span className="modal-subtitle text-gray-400">-</span>
                  )
                }
              })()}
            </div>
          )}

        </div>
        
        {/* Mobile Layout */}
        <div className="block sm:hidden space-y-2">
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0 relative">
              {isEditing ? (
                <Input
                  value={item.item_name}
                  onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                  onFocus={() => setFocusedInput(`m_item_name_${index}`)}
                  onBlur={() => setFocusedInput(null)}
                  className={`modal-label border-gray-200 rounded-lg w-full !px-1.5 !py-0.5 !text-[10px] focus:border-blue-400 transition-all duration-200 ${
                    focusedInput === `m_item_name_${index}` 
                      ? '!h-auto !min-h-[20px] !absolute !z-[9999] !bg-white !shadow-lg !left-0 !right-0 !-translate-y-1/2 !top-1/2 !whitespace-normal' 
                      : '!h-5 !truncate'
                  }`}
                  placeholder="품목명"
                />
              ) : (
                <div className="modal-value font-medium">{item.item_name || '품목명 없음'}</div>
              )}
              {isEditing ? (
                <Input
                  value={item.specification}
                  onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                  onFocus={() => setFocusedInput(`m_specification_${index}`)}
                  onBlur={() => setFocusedInput(null)}
                  className={`modal-label border-gray-200 rounded-lg mt-1 w-full !px-1.5 !py-0.5 !text-[10px] focus:border-blue-400 transition-all duration-200 ${
                    focusedInput === `m_specification_${index}` 
                      ? '!h-auto !min-h-[20px] !absolute !z-[9999] !bg-white !shadow-lg !left-0 !right-0 !-translate-y-1/2 !top-1/2 !whitespace-normal !w-full' 
                      : '!h-5 !truncate'
                  }`}
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
                  value={item.amount_value || 0}
                  onChange={(e) => handleItemChange(index, 'amount_value', Number(e.target.value))}
                  className="border-gray-200 rounded-lg w-24 !h-6 !px-1.5 !py-0.5 !text-[10px] font-normal text-gray-600 focus:border-blue-400 text-right"
                  placeholder="합계"
                />
              ) : (
                <div className="modal-value font-semibold">₩{formatCurrency(item.amount_value || 0)}</div>
              )}
              <div className="text-[10px] text-gray-500 mt-0.5">
                {activeTab === 'done' && !canViewFinancialInfo 
                  ? '-' 
                  : `₩${formatCurrency(item.unit_price_value || 0)}`} / 단가
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-gray-500 text-xs">수량</span>
              {isEditing ? (
                (activeTab === 'receipt' || activeTab === 'done') ? (
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                      className="border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                      placeholder="요청수량"
                      max="99999"
                    />
                    <Input
                      type="number"
                      value={item.received_quantity ?? ''}
                      onChange={(e) => handleItemChange(index, 'received_quantity', e.target.value ? Number(e.target.value) : null)}
                      className="border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                      placeholder="실제입고"
                      max="99999"
                    />
                  </div>
                ) : (
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                    className="border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400 mt-1"
                    placeholder="수량"
                    max="99999"
                  />
                )
              ) : (
                <div className="modal-subtitle mt-1">
                  {activeTab === 'receipt' || activeTab === 'done' ? (
                    <>
                      <span className="text-gray-500">{item.quantity || 0}</span>
                      <span className="text-gray-400">/{item.received_quantity ?? 0}</span>
                    </>
                  ) : (
                    item.quantity || 0
                  )}
                </div>
              )}
            </div>

            <div>
              <span className="text-gray-500 text-xs">링크</span>
              <div className="mt-1">
                {item.link ? (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline text-[11px] break-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.link}
                  </a>
                ) : (
                  <span className="text-gray-400 text-[11px]">-</span>
                )}
              </div>
            </div>
          </div>

          {/* 상태/액션 */}
          <div className="grid grid-cols-2 gap-2 items-center">
            <div>
              <span className="text-gray-500 text-xs">상태</span>
              <div className="mt-1">
                {activeTab === 'pending' ? (
                  <span className="text-xs text-gray-400">-</span>
                ) : (
                  <>
                    {activeTab === 'purchase' && (
                      <div className="flex items-center gap-2">
                        {canPurchase ? (
                          <button
                            onClick={() => handlePaymentToggle(item.id, !item.is_payment_completed)}
                            className={`text-xs px-2 py-1 rounded ${
                              item.is_payment_completed
                                ? 'button-action-primary'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {item.is_payment_completed ? '구매완료' : '구매대기'}
                          </button>
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded ${
                            item.is_payment_completed 
                              ? 'button-action-primary' 
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            {item.is_payment_completed ? '구매완료' : '구매대기'}
                          </span>
                        )}
                      </div>
                    )}

                    {activeTab === 'receipt' && (
                      <div className="flex items-center gap-2">
                        {canReceiveItems ? (
                          actualReceivedAction.isCompleted(item) ? (
                            <button
                              onClick={() => {
                                actualReceivedAction.handleCancel(item.id, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              className="text-xs px-2 py-1 rounded button-action-primary"
                            >
                              {actualReceivedAction.config.completedText}
                            </button>
                          ) : (
                            <DatePickerPopover
                              onDateSelect={(date) => {
                                actualReceivedAction.handleConfirm(item.id, date, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              placeholder="실제 입고된 날짜를 선택하세요"
                              align="center"
                              side="bottom"
                            >
                              <button className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                                {actualReceivedAction.config.waitingText}
                              </button>
                            </DatePickerPopover>
                          )
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded ${
                            actualReceivedAction.isCompleted(item)
                              ? 'button-action-primary' 
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            {actualReceivedAction.isCompleted(item) ? actualReceivedAction.config.completedText : actualReceivedAction.config.waitingText}
                          </span>
                        )}
                      </div>
                    )}
                    
                    {activeTab === 'done' && (
                      <>
                        <span className={`button-base ${
                          actualReceivedAction.isCompleted(item)
                            ? 'bg-green-500 text-white' 
                            : 'border border-gray-300 text-gray-600 bg-white'
                        }`}>
                          {actualReceivedAction.isCompleted(item) ? '입고완료' : '입고대기'}
                        </span>
                      </>
                    )}
                    
                    {activeTab !== 'purchase' && activeTab !== 'receipt' && activeTab !== 'done' && (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </>
                )}
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
          </div>

          {!isEditing && activeTab === 'receipt' && actualReceivedAction.getCompletedDate(item) && (
            <div>
              <span className="text-gray-500 text-xs">실제입고일:</span>
              <div className="mt-1">
                <div className="modal-subtitle text-green-700">
                  {new Date(actualReceivedAction.getCompletedDate(item)).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  })}
                </div>
                <div className="text-[9px] text-gray-500">
                  {new Date(actualReceivedAction.getCompletedDate(item)).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
            </div>
          )}

          {!isEditing && showStatementColumns && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">거래명세서 확인:</span>
              <div className="flex items-center gap-2">
                {canReceiptCheck ? (
                  statementReceivedAction.isCompleted(item) ? (
                    <button
                      onClick={() => {
                        statementReceivedAction.handleCancel(item.id, {
                          item_name: item.item_name,
                          specification: item.specification,
                          quantity: item.quantity,
                          unit_price_value: item.unit_price_value,
                          amount_value: item.amount_value,
                          remark: item.remark
                        })
                      }}
                      className="text-xs px-2 py-1 rounded button-action-primary"
                    >
                      {statementReceivedAction.config.completedText}
                    </button>
                  ) : (
                    <DatePickerPopover
                      onDateSelect={(date) => {
                        statementReceivedAction.handleConfirm(item.id, date, {
                          item_name: item.item_name,
                          specification: item.specification,
                          quantity: item.quantity,
                          unit_price_value: item.unit_price_value,
                          amount_value: item.amount_value,
                          remark: item.remark
                        })
                      }}
                      placeholder="회계상 입고일을 선택하세요"
                      align="center"
                      side="bottom"
                    >
                      <button className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                        {statementReceivedAction.config.waitingText}
                      </button>
                    </DatePickerPopover>
                  )
                ) : (
                  <span className={`text-xs px-2 py-1 rounded ${
                    statementReceivedAction.isCompleted(item)
                      ? 'button-action-primary' 
                      : 'bg-gray-100 text-gray-400'
                  }`}>
                    {statementReceivedAction.isCompleted(item) ? statementReceivedAction.config.completedText : statementReceivedAction.config.waitingText}
                  </span>
                )}
              </div>
            </div>
          )}

          {!isEditing && showStatementColumns && statementReceivedAction.getCompletedDate(item) && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">회계상 입고일:</span>
              <span className="modal-subtitle text-blue-700">
                {new Date(statementReceivedAction.getCompletedDate(item)).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit'
                })}
              </span>
            </div>
          )}

          {!isEditing && showExpenditureColumn && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">지출정보:</span>
              <div className="text-right">
                {item.expenditure_date ? (
                  <>
                    <div className="text-blue-700 text-[11px]">
                      {(() => {
                        const date = new Date(item.expenditure_date)
                        const year = date.getFullYear().toString().slice(-2)
                        const month = (date.getMonth() + 1).toString().padStart(2, '0')
                        const day = date.getDate().toString().padStart(2, '0')
                        return `${year}.${month}.${day}`
                      })()}
                    </div>
                    <div className="text-gray-700 text-[11px]">
                      {!canViewFinancialInfo 
                        ? '-' 
                        : (item.expenditure_amount !== null && item.expenditure_amount !== undefined
                          ? `₩${Number(item.expenditure_amount).toLocaleString()}`
                          : '')}
                    </div>
                  </>
                ) : (
                  <span className="text-gray-400 text-[11px]">-</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
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
                {(() => {
                  const shouldShow = canApproveMiddle && purchase.middle_manager_status === 'pending';
                  return shouldShow;
                })() && (
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
                {(() => {
                  const shouldShow = canApproveFinal && purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'pending';
                  return shouldShow;
                })() && (
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
                  <div className="flex items-center justify-between">
                    <h3 className="modal-section-title flex items-center">
                      <FileText className="w-4 h-4 mr-2 text-gray-600" />
                      {purchase?.purchase_order_number || 'PO번호 없음'}
                    </h3>
                    {canReceiptCheck && canViewFinancialInfo && activeTab === 'done' && (
                      <button
                        onClick={async () => {
                          if (!purchase) return
                          const isCurrentlyChecked = purchase.is_utk_checked || false
                          const newStatus = !isCurrentlyChecked
                          
                          const confirmMessage = newStatus
                            ? `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인 처리하시겠습니까?`
                            : `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인을 취소하시겠습니까?`
                          
                          if (!window.confirm(confirmMessage)) return
                          
                          try {
                            const supabase = createClient()
                            const { error } = await supabase
                              .from('purchase_requests')
                              .update({ is_utk_checked: newStatus })
                              .eq('id', purchase.id)
                            
                            if (error) {
                              logger.error('UTK 확인 DB 업데이트 실패', { error, purchaseId: purchase.id })
                              toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
                              return
                            }
                            
                            // 로컬 상태 즉시 업데이트 (객체 참조 변경으로 React 재렌더링 보장)
                            setPurchase(prev => prev ? { 
                              ...prev, 
                              is_utk_checked: newStatus,
                              updated_at: new Date().toISOString() // 강제로 객체 참조 변경
                            } : null)
                            
                            // 메모리 캐시 업데이트
                            if (purchase.id) {
                              updatePurchaseInMemory(purchase.id, (prev) => ({
                                ...prev,
                                is_utk_checked: newStatus
                              }))
                            }
                            
                            toast.success(newStatus ? 'UTK 확인이 완료되었습니다.' : 'UTK 확인이 취소되었습니다.')
                            
                            await refreshModalData()
                            const refreshResult = onRefresh?.(true, { silent: true })
                            if (refreshResult instanceof Promise) {
                              await refreshResult
                            }
                          } catch (error) {
                            logger.error('UTK 확인 처리 중 오류', error)
                            toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
                          }
                        }}
                        className={`button-base text-xs px-2 py-1 flex items-center ${
                          purchase?.is_utk_checked
                            ? 'button-toggle-active bg-orange-500 hover:bg-orange-600 text-white'
                            : 'button-toggle-inactive'
                        }`}
                        title={purchase?.is_utk_checked ? 'UTK 확인 취소' : 'UTK 확인'}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        UTK {purchase?.is_utk_checked ? '완료' : '확인'}
                      </button>
                    )}
                  </div>
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
                          disabled={canEditLimited && !canEditAll}
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
                          disabled={canEditLimited && !canEditAll}
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
                        <DatePickerPopover
                          onDateSelect={(date) => {
                            setEditedPurchase(prev => prev ? {
                              ...prev,
                              delivery_request_date: formatDateInput(date, 'yyyy-MM-dd')
                            } : null)
                          }}
                          placeholder="입고 요청일을 선택하세요"
                          align="start"
                          side="bottom"
                        >
                          <Button
                            variant="outline"
                            className="mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] justify-start text-left font-normal business-radius-input"
                            disabled={canEditLimited && !canEditAll}
                          >
                            <Calendar className="mr-1 h-3 w-3" />
                            {editedPurchase?.delivery_request_date ? 
                              formatDate(editedPurchase.delivery_request_date) : 
                              '날짜 선택'
                            }
                          </Button>
                        </DatePickerPopover>
                      ) : (
                        <p className="modal-subtitle">{formatDate(purchase.delivery_request_date)}</p>
                      )}
                    </div>
                    <div className="w-32">
                      <span className="modal-label text-orange-500">변경 입고일</span>
                      {isEditing ? (
                        <DatePickerPopover
                          onDateSelect={(date) => {
                            setEditedPurchase(prev => prev ? {
                              ...prev,
                              revised_delivery_request_date: formatDateInput(date, 'yyyy-MM-dd')
                            } : null)
                          }}
                          placeholder="변경 입고일을 선택하세요"
                          align="start"
                          side="bottom"
                        >
                          <Button
                            variant="outline"
                            className="mt-1 w-full h-5 px-1.5 py-0.5 text-[10px] justify-start text-left font-normal business-radius-input"
                            disabled={canEditLimited && !canEditAll}
                          >
                            <Calendar className="mr-1 h-3 w-3" />
                            {editedPurchase?.revised_delivery_request_date ? 
                              formatDate(editedPurchase.revised_delivery_request_date) : 
                              '날짜 선택'
                            }
                          </Button>
                        </DatePickerPopover>
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
                        <ReactSelect
                          options={vendors.map(v => ({ 
                            value: v.id.toString(), 
                            label: v.vendor_name 
                          }))}
                          value={editedPurchase?.vendor_id ? {
                            value: editedPurchase.vendor_id.toString(),
                            label: editedPurchase.vendor_name || vendors.find(v => v.id === editedPurchase.vendor_id)?.vendor_name || ''
                          } : null}
                          isDisabled={canEditLimited && !canEditAll}
                          onChange={(option) => {
                            logger.info('ReactSelect onChange:', { option })
                            if (option) {
                              const selectedVendor = vendors.find(v => v.id.toString() === option.value)
                              logger.info('Selected vendor:', { selectedVendor })
                              if (selectedVendor) {
                                // 업체의 담당자 목록 가져오기
                                const supabase = createClient()
                                supabase
                                  .from('vendor_contacts')
                                  .select('id, contact_name, contact_email, contact_phone, position')
                                  .eq('vendor_id', selectedVendor.id)
                                  .then(({ data: contactsData, error }: { data: any, error: any }) => {
                                    if (error) {
                                      logger.error('🔍 담당자 목록 로드 오류:', error)
                                      console.error('담당자 목록 로드 오류:', error)
                                    }
                                    
                                    logger.info('🔍 업체 변경 - 담당자 목록 로드:', { 
                                      vendor_id: selectedVendor.id,
                                      vendor_name: selectedVendor.vendor_name,
                                      contactsData,
                                      contactsCount: contactsData?.length || 0
                                    })
                                    console.log('🔍 업체 변경 - 담당자 목록:', contactsData)
                                    
                                    setEditedPurchase(prev => {
                                      const updated = prev ? { 
                                        ...prev, 
                                        vendor_id: selectedVendor.id,
                                        vendor_name: selectedVendor.vendor_name,
                                        vendor: selectedVendor,
                                        vendor_contacts: Array.isArray(contactsData) ? contactsData : [],
                                        contact_id: undefined,  // 업체 변경 시 담당자 초기화
                                        contact_name: undefined  // 업체 변경 시 담당자 이름 초기화
                                      } : null
                                      logger.info('🔍 업체 변경 - editedPurchase 업데이트 완료:', { 
                                        vendor_id: selectedVendor.id,
                                        vendor_name: selectedVendor.vendor_name,
                                        contactsData,
                                        updated_vendor_contacts: updated?.vendor_contacts,
                                        updated_full: updated
                                      })
                                      console.log('🔍 업체 변경 - editedPurchase 전체:', updated)
                                      return updated
                                    })
                                  })
                              }
                            } else {
                              setEditedPurchase(prev => prev ? { 
                                ...prev, 
                                vendor_id: undefined,
                                vendor_name: '',
                                vendor: undefined,
                                vendor_contacts: [],
                                contact_id: undefined,  // 업체 해제 시 담당자 초기화
                                contact_name: undefined  // 업체 해제 시 담당자 이름 초기화
                              } : null)
                            }
                          }}
                          placeholder="업체 선택"
                          isClearable
                          isSearchable
                          menuPortalTarget={document.body}
                          styles={{
                            control: (base) => ({
                              ...base,
                              minHeight: '20px',
                              height: '20px',
                              fontSize: '10px',
                              borderRadius: '8px', // rounded-lg와 정확히 동일
                              borderColor: '#e5e7eb', // border-gray-200과 정확히 동일
                              borderWidth: '1px',
                              backgroundColor: '#ffffff',
                              boxShadow: 'none',
                              paddingLeft: '6px', // px-1.5
                              paddingRight: '6px', // px-1.5
                              '&:hover': {
                                borderColor: '#e5e7eb', // hover 시에도 동일한 색상 유지
                              },
                              '&:focus-within': {
                                borderColor: '#60a5fa', // focus:border-blue-400
                                boxShadow: 'none',
                                outline: 'none',
                              },
                            }),
                            valueContainer: (base) => ({
                              ...base,
                              height: '18px', // Input의 실제 높이와 맞춤
                              padding: '0 2px', // 내부 패딩 최소화
                              margin: '0',
                            }),
                            input: (base) => ({
                              ...base,
                              margin: '0',
                              padding: '0',
                              fontSize: '10px',
                            }),
                            indicatorsContainer: (base) => ({
                              ...base,
                              height: '18px',
                              padding: '0',
                            }),
                            indicatorSeparator: () => ({
                              display: 'none',
                            }),
                            dropdownIndicator: (base) => ({
                              ...base,
                              padding: '0 2px',
                              svg: {
                                width: '12px',
                                height: '12px',
                              },
                            }),
                            clearIndicator: (base) => ({
                              ...base,
                              padding: '0 2px',
                              svg: {
                                width: '12px',
                                height: '12px',
                              },
                            }),
                            option: (base) => ({
                              ...base,
                              fontSize: '10px',
                              padding: '4px 8px',
                            }),
                            menuPortal: (base) => ({
                              ...base,
                              zIndex: 9999,
                            }),
                          }}
                          classNamePrefix="vendor-select"
                        />
                      ) : (
                        <p className="modal-value">{purchase.vendor?.vendor_name || '-'}</p>
                      )}
                    </div>
                    <div className="w-32">
                      <span className="modal-label">업체 담당자</span>
                      {isEditing ? (
                        editedPurchase?.vendor_id ? (
                          <ReactSelect
                            isDisabled={canEditLimited && !canEditAll}
                            options={(() => {
                              const contacts = Array.isArray(editedPurchase.vendor_contacts) ? editedPurchase.vendor_contacts : []
                              // 중복 제거: id 기준으로 중복 제거 (같은 ID는 같은 사람)
                              const uniqueContacts = contacts.filter((contact, index, arr) => 
                                arr.findIndex(c => c.id === contact.id) === index
                              )
                              // 추가로 contact_name 기준으로도 중복 제거 (같은 이름이 여러 ID로 있을 경우)
                              const finalUniqueContacts = uniqueContacts.filter((contact, index, arr) => 
                                arr.findIndex(c => c.contact_name === contact.contact_name) === index
                              )
                              const options = finalUniqueContacts.map(c => ({
                                value: c.id.toString(),
                                label: c.contact_name || ''
                              })) || []
                              logger.info('🔍 담당자 드롭다운 옵션:', {
                                vendor_id: editedPurchase.vendor_id,
                                vendor_contacts_raw: editedPurchase.vendor_contacts,
                                vendor_contacts_count: contacts.length,
                                unique_by_id_count: uniqueContacts.length,
                                final_unique_count: finalUniqueContacts.length,
                                options
                              })
                              console.log('🔍 담당자 드롭다운 옵션:', options)
                              return options
                            })()}
                            value={(() => {
                              const contacts = Array.isArray(editedPurchase.vendor_contacts) ? editedPurchase.vendor_contacts : []
                              const firstContact = contacts[0]
                              return firstContact?.id ? {
                                value: firstContact.id.toString(),
                                label: firstContact.contact_name || ''
                              } : null
                            })()}
                            onChange={(option) => {
                              logger.info('🔍 담당자 선택 변경:', { option })
                              if (option) {
                                const contacts = Array.isArray(editedPurchase.vendor_contacts) ? editedPurchase.vendor_contacts : []
                                const selectedContact = contacts.find(c => c.id.toString() === option.value)
                                if (selectedContact) {
                                  setEditedPurchase(prev => prev ? {
                                    ...prev,
                                    contact_id: selectedContact.id,
                                    contact_name: selectedContact.contact_name,
                                    vendor_contacts: [selectedContact, ...contacts.filter(c => c.id !== selectedContact.id)]
                                  } : null)
                                }
                              } else {
                                setEditedPurchase(prev => prev ? {
                                  ...prev,
                                  contact_id: undefined,
                                  contact_name: undefined,
                                  vendor_contacts: Array.isArray(editedPurchase.vendor_contacts) ? editedPurchase.vendor_contacts : []
                                } : null)
                              }
                            }}
                            placeholder="담당자를 선택하세요"
                            isClearable
                            isSearchable
                            noOptionsMessage={() => "담당자가 없습니다"}
                            menuPortalTarget={document.body}
                            styles={{
                              control: (base) => ({
                                ...base,
                                minHeight: '20px',
                                height: '20px',
                                fontSize: '10px',
                                borderRadius: '8px', // rounded-lg와 정확히 동일
                                borderColor: '#e5e7eb', // border-gray-200과 정확히 동일
                                borderWidth: '1px',
                                backgroundColor: '#ffffff',
                                boxShadow: 'none',
                                paddingLeft: '6px', // px-1.5
                                paddingRight: '6px', // px-1.5
                                '&:hover': {
                                  borderColor: '#e5e7eb', // hover 시에도 동일한 색상 유지
                                },
                                '&:focus-within': {
                                  borderColor: '#60a5fa', // focus:border-blue-400
                                  boxShadow: 'none',
                                  outline: 'none',
                                },
                              }),
                              valueContainer: (base) => ({
                                ...base,
                                height: '18px', // Input의 실제 높이와 맞춤
                                padding: '0 2px', // 내부 패딩 최소화
                                margin: '0',
                              }),
                              input: (base) => ({
                                ...base,
                                margin: '0',
                                padding: '0',
                                fontSize: '10px',
                              }),
                              indicatorsContainer: (base) => ({
                                ...base,
                                height: '18px',
                                padding: '0',
                              }),
                              indicatorSeparator: () => ({
                                display: 'none',
                              }),
                              dropdownIndicator: (base) => ({
                                ...base,
                                padding: '0 2px',
                                svg: {
                                  width: '12px',
                                  height: '12px',
                                },
                              }),
                              clearIndicator: (base) => ({
                                ...base,
                                padding: '0 2px',
                                svg: {
                                  width: '12px',
                                  height: '12px',
                                },
                              }),
                              option: (base) => ({
                                ...base,
                                fontSize: '10px',
                                padding: '4px 8px',
                              }),
                              menuPortal: (base) => ({
                                ...base,
                                zIndex: 9999,
                              }),
                            }}
                            classNamePrefix="contact-select"
                          />
                        ) : (
                          <Input
                            value=""
                            disabled
                            className="mt-1 rounded-lg border-gray-200 w-full h-5 px-1.5 py-0.5 text-[10px]"
                            placeholder="업체를 먼저 선택하세요"
                          />
                        )
                      ) : (
                        <p className="modal-value">{(() => {
                          // 우선순위: 1. contact_name 필드, 2. vendor_contacts 배열의 첫 번째 담당자, 3. '-'
                          const contacts = Array.isArray(purchase.vendor_contacts) ? purchase.vendor_contacts : []
                          const contactName = (purchase as any).contact_name ||
                                            contacts[0]?.contact_name || 
                                            '-'
                          logger.info('🔍 vendor_contacts display 렌더링:', { 
                            purchase_id: purchase?.id,
                            vendor_id: purchase?.vendor_id,
                            contact_id: purchase?.contact_id,
                            vendor_contacts: purchase.vendor_contacts,
                            purchase_contact_name: purchase.contact_name,
                            contactName,
                            purchase_full: purchase
                          })
                          console.log('🔍 vendor_contacts display 렌더링:', { 
                            purchase_id: purchase?.id,
                            vendor_id: purchase?.vendor_id,
                            contact_id: purchase?.contact_id,
                            vendor_contacts: purchase.vendor_contacts,
                            purchase_contact_name: purchase.contact_name,
                            contactName
                          })
                          return contactName
                        })()}</p>
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
                          disabled={canEditLimited && !canEditAll}
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
                          disabled={canEditLimited && !canEditAll}
                        />
                      ) : (
                        <p
                          className="modal-subtitle break-all whitespace-pre-wrap"
                          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                        >
                          {purchase.project_item || '-'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:flex sm:gap-8">
                    <div className="w-32">
                      <span className="modal-label">수주번호</span>
                      {isEditing ? (
                        <Input
                          value={editedPurchase?.sales_order_number || ''}
                          onChange={(e) => setEditedPurchase(prev => prev ? { ...prev, sales_order_number: e.target.value } : null)}
                          className="mt-1 rounded-lg border-gray-200 focus:border-blue-400 w-full h-5 px-1.5 py-0.5 text-[10px]"
                          placeholder="입력"
                          disabled={canEditLimited && !canEditAll}
                        />
                      ) : (
                        <p className="modal-subtitle">{purchase.sales_order_number || '-'}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 연결된 거래명세서 */}
              {linkedStatements.length > 0 && (
                <div className="bg-white rounded-lg p-2 sm:p-3 border border-gray-100 shadow-sm mt-3">
                  <div className="mb-2">
                    <h3 className="modal-section-title flex items-center">
                      <FileCheck className="w-4 h-4 mr-2 text-gray-600" />
                      연결된 거래명세서
                      <span className="ml-2 badge-stats bg-green-500 text-white text-[10px]">
                        {linkedStatements.length}건
                      </span>
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {linkedStatements.map((stmt) => (
                      <div
                        key={stmt.id}
                        className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                        onClick={() => handleViewStatementImage(stmt.image_url)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ImageIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-900 truncate">
                              {stmt.vendor_name || stmt.file_name || '거래명세서'}
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {stmt.statement_date 
                                ? formatDate(stmt.statement_date)
                                : formatDate(stmt.uploaded_at)
                              }
                              {stmt.grand_total && (
                                <span className="ml-2 text-gray-700">
                                  {stmt.grand_total.toLocaleString()}원
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 flex-shrink-0"
                          title="이미지 보기"
                        >
                          <ImageIcon className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Right Column - Items List (Fit Width) */}
            <div className="lg:w-fit lg:min-w-0 relative overflow-visible">
              
              <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
                <div className="p-2 sm:p-3 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                  <h3 className="modal-section-title flex items-center">
                    <Package className="w-4 h-4 mr-2 text-gray-600" />
                    품목 리스트
                    <span className="ml-2 badge-stats bg-gray-500 text-white">
                      {currentItems?.length || 0}개
                    </span>
                    {isEditing ? (
                      <ReactSelect
                        isDisabled={canEditLimited && !canEditAll}
                        options={[
                          { value: 'KRW', label: 'KRW' },
                          { value: 'USD', label: 'USD' },
                          { value: 'EUR', label: 'EUR' },
                          { value: 'JPY', label: 'JPY' },
                          { value: 'CNY', label: 'CNY' },
                        ]}
                        value={editedPurchase?.currency ? {
                          value: editedPurchase.currency,
                          label: editedPurchase.currency
                        } : { value: 'KRW', label: 'KRW' }}
                        onChange={(option) => {
                          if (option) {
                            setEditedPurchase(prev => prev ? { ...prev, currency: option.value as 'KRW' | 'USD' } : null)
                          }
                        }}
                        menuPortalTarget={document.body}
                        styles={{
                          control: (base) => ({
                            ...base,
                            minHeight: '20px',
                            height: '20px',
                            width: '75px',
                            fontSize: '10px',
                            borderRadius: '8px',
                            borderColor: '#e5e7eb',
                            marginLeft: '8px',
                          }),
                          valueContainer: (base) => ({
                            ...base,
                            padding: '0 6px',
                            height: '20px',
                          }),
                          singleValue: (base) => ({
                            ...base,
                            margin: 0,
                            position: 'absolute',
                            top: '50%',
                            transform: 'translateY(-50%)',
                          }),
                          input: (base) => ({
                            ...base,
                            margin: 0,
                            padding: 0,
                          }),
                          indicatorsContainer: (base) => ({
                            ...base,
                            height: '20px',
                          }),
                          indicatorSeparator: () => ({ display: 'none' }),
                          dropdownIndicator: (base) => ({
                            ...base,
                            padding: '0 4px',
                          }),
                          option: (base) => ({
                            ...base,
                            fontSize: '10px',
                            padding: '4px 8px',
                          }),
                          menuPortal: (base) => ({
                            ...base,
                            zIndex: 9999,
                          }),
                        }}
                      />
                    ) : (
                      <span className="ml-2 badge-stats bg-blue-500 text-white">
                        {purchase.currency || 'KRW'}
                      </span>
                    )}
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
                        <DateQuantityPickerPopover
                          onConfirm={handleCompleteAllReceipt}
                          placeholder="입고일을 선택하세요"
                          align="end"
                          side="bottom"
                          hideQuantityInput={true}
                          quantityInfoText="요청입고수량과 동일한 수량으로 입력됩니다"
                        >
                          <Button
                            size="sm"
                            className="button-base button-action-primary"
                          >
                            <Truck className="w-3 h-3 mr-1" />
                            전체 입고완료
                          </Button>
                        </DateQuantityPickerPopover>
                      )}
                      {showStatementColumns && canReceiptCheck && canViewFinancialInfo && (
                        <div className="flex items-center gap-2">
                          <DatePickerPopover
                            onDateSelect={handleCompleteAllStatement}
                            placeholder="전체 회계상 입고일을 선택하세요"
                            align="end"
                            side="bottom"
                          >
                            <Button
                              size="sm"
                              className="button-base button-action-primary"
                            >
                              <FileText className="w-3 h-3 mr-1" />
                              거래명세서 확인
                            </Button>
                          </DatePickerPopover>
                          {activeTab === 'done' && purchase.payment_category === '발주' && (
                            <DateAmountPickerPopover
                              onConfirm={handleBulkExpenditure}
                              placeholder="일괄 지출 날짜와 금액을 입력하세요"
                              align="end"
                              side="bottom"
                            >
                              <Button
                                size="sm"
                                className="button-base button-action-primary"
                              >
                                <DollarSign className="w-3 h-3 mr-1" />
                                일괄지출
                              </Button>
                            </DateAmountPickerPopover>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                {/* Mobile Table Header */}
                <div className="block sm:hidden bg-gray-50 px-2 py-1 border-b border-gray-100">
                  <div className="text-xs font-medium text-gray-600">품목 목록 (터치하여 스크롤)</div>
                </div>
                
                {/* Items List with Header Inside Scrollable Container */}
                <div className="max-h-[50vh] sm:max-h-[40vh] overflow-auto">
                  <div className="w-fit">
                    {/* Items Table Header - Sticky inside scroll container */}
                    <div className={`bg-gray-50 px-2 sm:px-3 py-1 border-b border-gray-100 sticky top-0 z-10 w-fit ${isEditing ? 'pl-7 sm:pl-8' : ''}`}>
                      <div 
                        ref={headerRowRef}
                         className="hidden sm:grid gap-1 modal-label w-fit"
                        style={{
                          gridTemplateColumns: getGridTemplateColumns()
                        }}
                      >
                        <div className="text-center -ml-2 sm:-ml-3">#</div>
                        <div>품목명</div>
                        <div>규격</div>
                        <div className="text-center">
                          {(activeTab === 'receipt' || activeTab === 'done') && !isEditing ? (
                            <div className="flex flex-col items-center leading-tight">
                              <div className="text-[9px]">요청/실제</div>
                              <div className="text-[10px]">입고수량</div>
                            </div>
                          ) : (
                            '요청수량'
                          )}
                        </div>
                        <div className="text-right">단가</div>
                        <div className="text-right">합계</div>
                        {purchase.payment_category === '발주' && (
                          <div className="text-right">세액</div>
                        )}
                        <div className="text-center">링크</div>
                        <div className="text-center">비고</div>
                        {activeTab !== 'pending' && (
                          isEditing ? (
                            <>
                              <div className="text-center">삭제</div>
                              {activeTab === 'receipt' && (
                                <>
                                  <div className="text-center">실제입고일</div>
                                </>
                              )}
                              {showStatementColumns && (
                                <>
                                  <div className="text-center">거래명세서 확인</div>
                                  <div className="text-center">회계상 입고일</div>
                                  {showExpenditureColumn && <div className="text-center">지출정보</div>}
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="text-center">
                                {activeTab === 'purchase'
                                  ? '구매상태'
                                  : (activeTab === 'receipt' || activeTab === 'done')
                                  ? '입고상태'
                                  : '상태'}
                              </div>
                              {activeTab === 'receipt' && (
                                <>
                                  <div className="text-center">실제입고일</div>
                                </>
                              )}
                              {showStatementColumns && (
                                <>
                                  <div className="text-center">거래명세서 확인</div>
                                  <div className="text-center">회계상 입고일</div>
                                  {showExpenditureColumn && <div className="text-center">지출정보</div>}
                                </>
                              )}
                            </>
                          )
                        )}
                      </div>
                    </div>
                    {isEditing && (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext
                          items={sortableIds}
                          strategy={verticalListSortingStrategy}
                        >
                          {(editedItems || []).map((item, index) => (
                            <SortableRow key={getSortableId(item, index)} id={getSortableId(item, index)}>
                              {(dragProps) => renderItemRow(item, index, dragProps, getSortableId(item, index))}
                            </SortableRow>
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                    {!isEditing && (
                    <div className="divide-y divide-gray-100 overflow-visible w-fit">
                      {(displayItems)?.map((item, index) => (
                        renderItemRow(item, index, undefined, getSortableId(item, index))
                      ))}
                    </div>
                    )}
                </div>
              </div>
                
                {/* 합계 */}
                <div className="bg-gray-50 px-2 sm:px-3 border-t border-gray-100">
                  <div className="hidden sm:grid items-center gap-1 py-2 w-fit" style={{
                    gridTemplateColumns: getGridTemplateColumns()
                  }}>
                    {/* 라인넘버 */}
                    <div className="-ml-2 sm:-ml-3"></div>
                    {/* 품목명 */}
                    <div></div>
                    {/* 규격 */}
                    <div></div>
                    {/* 수량 */}
                    <div></div>
                    {/* 단가 칼럼 - 라벨 표시 */}
                    <div className="text-right flex items-center justify-end">
                      <span className="text-[11px] text-gray-600 font-medium">공급가액</span>
                    </div>
                    {/* 합계 칼럼 - 합계 총액 표시 */}
                    <div className="text-right flex items-center justify-end">
                      <span className="text-[12px] font-bold text-gray-900">
                        {activeTab === 'done' && !canViewFinancialInfo 
                          ? '-' 
                          : `${(isEditing ? editedPurchase?.currency : purchase.currency) === 'USD' ? '$' : '₩'}${formatCurrency(
                              (displayItems)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                            )}`}
                      </span>
                    </div>
                    {/* 세액 칼럼 (발주인 경우만) */}
                    {purchase.payment_category === '발주' && (
                      <div className="text-right flex items-center justify-end">
                        {/* 세액 합계 - 같은 행에 표시 */}
                        <span className="text-[12px] font-bold text-gray-900">
                          {activeTab === 'done' && !canViewFinancialInfo 
                            ? '-' 
                            : `${(isEditing ? editedPurchase?.currency : purchase.currency) === 'USD' ? '$' : '₩'}${formatCurrency(
                                (displayItems)?.reduce((sum, item) => sum + (item.tax_amount_value || 0), 0) || 0
                              )}`}
                        </span>
                      </div>
                    )}
                    {/* 링크 */}
                    <div></div>
                    {/* 비고 */}
                    <div></div>
                    {/* 상태 또는 삭제 - pending 탭 제외, 발주인 경우 지출총합 텍스트 표시 */}
                    {activeTab !== 'pending' && (
                      isEditing ? (
                        <div></div>
                      ) : (
                        <div className={activeTab === 'done' && purchase.payment_category === '발주' ? "text-right flex items-center justify-end" : ""}>
                          {activeTab === 'done' && purchase.payment_category === '발주' && (
                            <span className="text-[11px] text-gray-600 font-medium">지출총합</span>
                          )}
                        </div>
                      )
                    )}
                    {activeTab === 'receipt' && <div></div>}
                    {activeTab === 'done' && (
                      <>
                        {/* 거래명세서 칼럼 - 발주인 경우 지출총합 금액 표시 */}
                        {purchase.payment_category === '발주' && (
                          <>
                            <div className="text-right flex items-center justify-end">
                              <div className="text-[12px] font-bold text-blue-700">
                                {!canViewFinancialInfo 
                                  ? '-' 
                                  : `₩${formatCurrency(
                                      purchase.total_expenditure_amount ?? 
                                      ((isEditing ? editedItems : currentItems)?.reduce((sum: number, item: any) => {
                                        return sum + (Number(item.expenditure_amount) || 0)
                                      }, 0) || 0)
                                    )}`}
                              </div>
                            </div>
                            {/* 회계상 입고일 칼럼 */}
                            <div></div>
                            {/* 지출정보 칼럼 */}
                            <div></div>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* 합계+세액 행 (발주인 경우에만) */}
                  {purchase.payment_category === '발주' && (
                    <div className="hidden sm:grid items-center gap-1 py-2 w-fit border-t border-gray-300" style={{
                      gridTemplateColumns: getGridTemplateColumns()
                    }}>
                      {/* 라인넘버 */}
                      <div className="-ml-2 sm:-ml-3"></div>
                      {/* 빈 칸들 */}
                      <div></div>
                      <div></div>
                      <div></div>
                      {/* 단가 칼럼 - 빈칸 */}
                      <div></div>
                      {/* 합계 칼럼 - 총액 라벨 */}
                      <div className="text-right flex items-center justify-end">
                        <span className="text-[11px] text-gray-600 font-medium">총액</span>
                      </div>
                      {/* 세액 칼럼 - 합계+세액 표시 */}
                      <div className="text-right flex items-center justify-end">
                        <span className="text-[12px] font-bold text-blue-600">
                          {activeTab === 'done' && !canViewFinancialInfo 
                            ? '-' 
                            : `₩${formatCurrency(
                                (isEditing ? editedItems : currentItems)?.reduce((sum, item) => {
                                  const amount = item.amount_value || 0
                                  const tax = item.tax_amount_value || 0
                                  return sum + amount + tax
                                }, 0) || 0
                              )}`}
                        </span>
                      </div>
                      {/* 링크 칼럼 - 빈칸 */}
                      <div></div>
                      {/* 나머지 빈 칸들 */}
                      <div></div>
                      {isEditing ? <div></div> : <div></div>}
                      {activeTab === 'receipt' && <div></div>}
                      {activeTab === 'done' && purchase.payment_category === '발주' && (
                        <>
                          {/* 거래명세서 칼럼 */}
                          <div></div>
                          {/* 회계상 입고일 칼럼 */}
                          <div></div>
                          {/* 지출정보 칼럼 */}
                          <div></div>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Mobile 총액 */}
                  <div className="block sm:hidden py-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-gray-500">합계 총액</span>
                      <span className="text-[13px] font-bold text-gray-900">
                        {activeTab === 'done' && !canViewFinancialInfo 
                          ? '-' 
                          : `₩${formatCurrency(
                              (isEditing ? editedItems : currentItems)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
                            )}`}
                      </span>
                    </div>
                    {/* 세액 (발주인 경우) */}
                    {purchase.payment_category === '발주' && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-[12px] text-gray-500">세액 총액</span>
                          <span className="text-[13px] font-bold text-gray-900">
                            {activeTab === 'done' && !canViewFinancialInfo 
                              ? '-' 
                              : `₩${formatCurrency(
                                  (isEditing ? editedItems : currentItems)?.reduce((sum, item) => sum + (item.tax_amount_value || 0), 0) || 0
                                )}`}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t pt-1">
                          <span className="text-[12px] text-gray-500">합계+세액</span>
                          <span className="text-[13px] font-bold text-blue-600">
                            {activeTab === 'done' && !canViewFinancialInfo 
                              ? '-' 
                              : `₩${formatCurrency(
                                  (isEditing ? editedItems : currentItems)?.reduce((sum, item) => {
                                    const amount = item.amount_value || 0
                                    const tax = item.tax_amount_value || 0
                                    return sum + amount + tax
                                  }, 0) || 0
                                )}`}
                          </span>
                        </div>
                      </>
                    )}
                    {/* Mobile 지출 총합 - 발주인 경우에만 표시 */}
                    {activeTab === 'done' && purchase.payment_category === '발주' && (
                      <div className="flex justify-between items-center border-t pt-1">
                        <span className="text-[12px] text-gray-500">지출 총합</span>
                        <span className="text-[13px] font-bold text-blue-700">
                          {!canViewFinancialInfo 
                            ? '-' 
                            : `₩${formatCurrency(
                                purchase.total_expenditure_amount ??
                                ((isEditing ? editedItems : currentItems)?.reduce((sum: number, item: any) => {
                                  return sum + (Number(item.expenditure_amount) || 0)
                                }, 0) || 0)
                              )}`}
                        </span>
                      </div>
                    )}
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
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              <span className="modal-subtitle">불러오는 중...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <span className="modal-subtitle">
                발주내역이 삭제 되었거나 없습니다.
              </span>
              {!embedded && (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onClose}
                    className="button-base button-action-secondary"
                  >
                    닫기
                  </Button>
                </div>
              )}
            </div>
          )}
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
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="overflow-hidden bg-white rounded-lg shadow-sm border-0 w-full sm:w-auto max-w-[calc(100vw-48px)] sm:max-w-[calc(100vw-80px)] lg:max-w-[90vw] xl:max-w-[85vw] h-[95vh] sm:h-auto sm:max-h-[90vh] lg:max-h-[85vh] sm:rounded-lg flex flex-col" 
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>발주 상세 정보</DialogTitle>
        </DialogHeader>
        {/* Apple-style Header */}
        <div className="relative px-3 sm:px-6 pt-0 sm:pt-3 lg:pt-4 pb-0 sm:pb-2 lg:pb-3 flex-shrink-0">
          <div className="absolute right-3 sm:right-6 top-3 sm:top-3 lg:top-4 flex items-center gap-2 z-10">
            {/* 수정 버튼 (app_admin, final_approver, ceo, lead_buyer) */}
            {!isEditing && canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleEditToggle(true)}
                className="button-base button-action-secondary h-8 text-xs px-3"
              >
                <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                수정
              </Button>
            )}
            
            {/* 삭제 버튼 */}
            {!isEditing && canDelete && onDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (purchase) {
                    // 삭제 확인 다이얼로그를 열기만 함 (실제 삭제는 확인 다이얼로그에서 처리)
                    onDelete(purchase);
                    // 삭제 버튼을 누른 후 모달을 즉시 닫지 않고 삭제 확인 다이얼로그가 처리하도록 함
                  }
                }}
                className="button-base button-action-danger h-8 text-xs px-3"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                삭제
              </Button>
            )}
            
            {/* 수정요청 버튼 (관리자 제외, 일반 직원 및 lead_buyer용) */}
            {!isAdmin && !isEditing && (
              <Popover open={isModifyRequestOpen} onOpenChange={setIsModifyRequestOpen}>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="button-base button-action-secondary h-8 text-xs px-3 gap-1.5"
                    title="수정 요청"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5 text-gray-500" />
                    <span>수정 요청</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-80 sm:w-96 p-4" 
                  align="end"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="font-medium leading-none">수정 요청</h4>
                      <p className="text-xs text-muted-foreground">
                        해당 발주서에 대한 수정 요청사항을 입력해주세요.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="subject" className="text-xs">제목</Label>
                        <Input
                          id="subject"
                          value={modifySubject}
                          onChange={(e) => setModifySubject(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="제목을 입력하세요"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="message" className="text-xs">내용</Label>
                        <div className="relative" onWheel={(e) => e.stopPropagation()}>
                          <Textarea
                            id="message"
                            value={modifyMessage}
                            onChange={(e) => setModifyMessage(e.target.value)}
                            className="min-h-[150px] text-xs font-mono overflow-auto"
                            placeholder="요청 내용을 입력하세요"
                            style={{ resize: 'none' }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setIsModifyRequestOpen(false)}
                        className="h-8 text-xs"
                      >
                        취소
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={handleSendModifyRequest}
                        disabled={isSendingModify}
                        className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
                      >
                        {isSendingModify ? '전송 중...' : '요청 전송'}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            
            <button
              onClick={onClose}
              className="button-base button-action-secondary w-8 h-8 rounded-full flex items-center justify-center"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          
          <div className="pr-8 sm:pr-16">
            <div className="flex items-start gap-4 mb-0 sm:mb-3">
              <div className="min-w-0 flex-1">
                <h1 className="page-title mb-0 sm:mb-1">
                  발주 기본정보
                </h1>
              </div>
              <div className="flex items-center gap-3">
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
                      disabled={isSaving}
                      className="button-base button-action-primary"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          저장 중...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          저장
                        </>
                      )}
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

    {/* 거래명세서 이미지 뷰어 */}
    <Dialog open={isStatementViewerOpen} onOpenChange={setIsStatementViewerOpen}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-black/90 border-none">
        <div className="absolute top-4 right-4 z-50">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsStatementViewerOpen(false)}
            className="text-white hover:bg-white/20"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex items-center justify-center w-full h-[80vh] overflow-auto p-4">
          {selectedStatementImage && (
            <img
              src={selectedStatementImage}
              alt="거래명세서"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

export default memo(PurchaseDetailModal)
export default memo(PurchaseDetailModal)