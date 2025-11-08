import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PurchaseRequestWithDetails, Purchase } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
import { DatePickerPopover } from '@/components/ui/date-picker-popover'
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
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useConfirmDateAction } from '@/hooks/useConfirmDateAction'
import { format as formatDateInput } from 'date-fns'

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
  const [loading, setLoading] = useState(false)
  const [purchase, setPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedPurchase, setEditedPurchase] = useState<PurchaseRequestWithDetails | null>(null)
  const [editedItems, setEditedItems] = useState<any[]>([])
  const [deletedItemIds, setDeletedItemIds] = useState<number[]>([])
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const tableMinWidth = useMemo(() => {
    if (columnWidths.length > 0) {
      const columnGap = columnWidths.length > 1 ? (columnWidths.length - 1) * 12 : 0
      const padding = 48
      const total = columnWidths.reduce((sum, width) => sum + width, 0) + columnGap + padding
      return Math.max(total, 720)
    }

    const baseColumns: number[] = [120, 140, 80, 110, 130, 110, 120]

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
      baseColumns.push(140, 140, 110)
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
  
  // 거래명세서 확인 & UTK 확인 권한: app_admin과 lead buyer만 가능
  const canReceiptCheck = effectiveRoles.includes('app_admin') || 
                         effectiveRoles.includes('lead buyer')
  

  // 모달 내부 데이터만 새로고침하는 함수 (모달 닫지 않음)
  const refreshModalData = useCallback(async () => {
    if (!purchaseId) return
    
    try {
      const supabase = createClient()
      // 최신 구매 요청 데이터 로드
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          *,
          vendors(id, vendor_name),
          purchase_request_items(*)
        `)
        .eq('id', purchaseId)
        .single()
      
      if (error) throw error

      if (data) {
        // 라인넘버 순서대로 정렬
        const sortedItems = (data.purchase_request_items || []).sort((a: any, b: any) => {
          const lineA = a.line_number || 999999;
          const lineB = b.line_number || 999999;
          return lineA - lineB;
        });

        const purchaseData = {
          ...data,
          items: sortedItems,
          vendor: data.vendors || { id: 0, vendor_name: '알 수 없음' },
          vendor_contacts: []
        } as PurchaseRequestWithDetails

        setPurchase(purchaseData)
        setEditedPurchase(purchaseData)
        setEditedItems(sortedItems)
        
        logger.debug('모달 데이터 새로고침 완료 - 모달 상태 유지')
      }
    } catch (error) {
      logger.error('모달 데이터 새로고침 실패', error)
    }
  }, [purchaseId])
  
  // 컴포넌트가 마운트될 때 외부 새로고침을 방지하는 플래그
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  
  // 커스텀 훅 설정
  const purchaseIdNumber = purchaseId ? Number(purchaseId) : (purchase ? Number(purchase.id) : NaN)

  const handleActualReceiptOptimisticUpdate = useCallback(({ itemId, selectedDate, action }: {
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
            received_at: nowIso
          }
        }

        return {
          ...item,
          is_received: false,
          actual_received_date: undefined,
          received_at: undefined
        }
      })
    }

    setPurchase(prev => {
      if (!prev) return prev
      const updatedItems = updateItems(prev.items) || []
      const total = updatedItems.length
      const completed = updatedItems.filter(item => item.is_received).length
      const allReceived = total > 0 && completed === total

      return {
        ...prev,
        items: updatedItems,
        is_received: allReceived,
        received_at: allReceived ? (prev.received_at || nowIso) : undefined
      }
    })

    setEditedPurchase(prev => {
      if (!prev) return prev
      const updatedItems = updateItems(prev.items) || []
      return {
        ...prev,
        items: updatedItems
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
            received_at: nowIso
          }
        }

        return {
          ...item,
          is_received: false,
          actual_received_date: undefined,
          received_at: undefined
        }
      })
    })

    if (!Number.isNaN(purchaseIdNumber)) {
      onOptimisticUpdate?.(purchaseIdNumber, prevPurchase => {
        const updatedItems = updateItems(prevPurchase.items) || prevPurchase.items || []
        const total = updatedItems.length || prevPurchase.items?.length || 0
        const completed = updatedItems.filter(item => item.is_received).length
        const allReceived = total > 0 && completed === total

        return {
          ...prevPurchase,
          items: updatedItems,
          is_received: allReceived,
          received_at: allReceived ? (prevPurchase.received_at || nowIso) : undefined
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
    canPerformAction: canReceiptCheck,
    onUpdate: refreshModalData,
    onOptimisticUpdate: handleActualReceiptOptimisticUpdate
  })
  
  // 날짜 선택 핸들러들
  
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
     purchaseOrderNumber: purchase?.purchase_order_number,
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

  // 칼럼 너비 계산 (텍스트 길이 기반)
  const calculateOptimalColumnWidths = useCallback(() => {
    if (!purchase?.purchase_request_items || purchase.purchase_request_items.length === 0) return []

    const items = purchase.purchase_request_items ?? []

    const columnConfigs = [
      { key: 'item_name', minWidth: 80, maxWidth: 500, baseWidth: 80 },
      { key: 'specification', minWidth: 120, maxWidth: 700, baseWidth: 120 },
      { key: 'quantity', minWidth: 70, maxWidth: 100, baseWidth: 70 },
      { key: 'unit_price', minWidth: 90, maxWidth: 150, baseWidth: 90 },
      { key: 'total_price', minWidth: 100, maxWidth: 180, baseWidth: 100 },
      { key: 'remarks', minWidth: 80, maxWidth: 240, baseWidth: 80 },
      { key: 'status', minWidth: 80, maxWidth: 120, baseWidth: 80 }
    ]

    // 추가 칼럼들 (탭별)
    if (activeTab === 'receipt') {
      columnConfigs.push({ key: 'actual_receipt_date', minWidth: 100, maxWidth: 160, baseWidth: 100 })
    }
    if (activeTab === 'done') {
      columnConfigs.push(
        { key: 'transaction_confirm', minWidth: 100, maxWidth: 160, baseWidth: 100 },
        { key: 'accounting_date', minWidth: 100, maxWidth: 160, baseWidth: 100 },
        { key: 'processor', minWidth: 80, maxWidth: 120, baseWidth: 80 },
        { key: 'utk_confirm', minWidth: 80, maxWidth: 120, baseWidth: 80 }
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
        const baseHeaders = activeTab === 'pending' 
          ? ['품목명', '규격', '수량', '단가', '합계', '비고']
          : ['품목명', '규격', '수량', '단가', '합계', '비고', statusHeader]
        if (activeTab === 'receipt') {
          return [...baseHeaders, '실제입고일']
        } else if (activeTab === 'done') {
          return [...baseHeaders, '거래명세서 확인', '회계상 입고일', '처리자', 'UTK']
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
          case 'item_name':
            cellValue = item.item_name || ''
            break
          case 'specification':
            cellValue = item.specification || ''
            break
          case 'quantity':
            cellValue = item.quantity?.toString() || ''
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
          case 'processor':
            cellValue = item.statement_received_by_name || ''
            break
          case 'utk_confirm':
            cellValue = item.is_utk_checked ? '완료' : '대기'
            break
        }
        
        // 한글/영문 혼합 텍스트 길이 계산 (한글은 1.5배 가중치)
        const adjustedLength = cellValue.split('').reduce((acc, char) => {
          return acc + (/[가-힣]/.test(char) ? 1.5 : 1)
        }, 0)
        
        maxLength = Math.max(maxLength, Math.ceil(adjustedLength))
      })

      // 길이를 픽셀로 변환 (글자당 약 7px + 여백 20px)
      const calculatedWidth = Math.max(
        config.minWidth,
        Math.min(config.maxWidth, maxLength * 7 + 20)
      )

      logger.debug(`Column ${config.key} calculated:`, { 
        maxLength, 
        calculatedWidth, 
        range: `${config.minWidth}-${config.maxWidth}px` 
      })

      return calculatedWidth
    })

    setColumnWidths(calculatedWidths)
    logger.debug('Optimal column widths calculated', { calculatedWidths })
    return calculatedWidths
  }, [purchase, activeTab])

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
    if (columnWidths.length > 0) {
      return columnWidths.map(width => `${width}px`).join(' ')
    }
    
    // 기본값 (데이터 로드 전)
    const baseColumns = ['80px', '120px', '70px', '90px', '100px', '80px', '80px']
    
    // 탭별 추가 칼럼
    if (activeTab === 'receipt') {
      return [...baseColumns, '100px'].join(' ')
    } else if (activeTab === 'done') {
      return [...baseColumns, '100px', '100px', '80px', '80px'].join(' ')
    }
    
    return baseColumns.join(' ')
  }

  // 레거시 measureColumnWidths 함수 (호환성 유지)
  const measureColumnWidths = () => {
    calculateOptimalColumnWidths()
  }

  // View 모드에서 칼럼 너비 계산 (데이터 로드 후)
  useEffect(() => {
    if (purchase && purchase.purchase_request_items && purchase.purchase_request_items.length > 0 && !isEditing) {
      // 즉시 계산 (DOM 측정 불필요)
      calculateOptimalColumnWidths()
    }
  }, [purchase, isEditing, activeTab, calculateOptimalColumnWidths])

  // Edit 모드 전환 시 너비 계산
  const handleEditToggle = (editing: boolean) => {
    if (editing && !isEditing) {
      // Edit 모드로 전환하기 전에 현재 너비 계산
      calculateOptimalColumnWidths()
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
        // 라인넘버 순서대로 정렬
        const sortedItems = (data.purchase_request_items || []).sort((a: any, b: any) => {
          const lineA = a.line_number || 999999;
          const lineB = b.line_number || 999999;
          return lineA - lineB;
        });

        const purchaseData = {
          ...data,
          items: sortedItems,
          vendor: data.vendors || { id: 0, vendor_name: '알 수 없음' },
          vendor_contacts: []
        } as PurchaseRequestWithDetails
        setPurchase(purchaseData)
        setEditedPurchase(purchaseData)
        setEditedItems(sortedItems)
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
        if (item.unit_price_value !== null && item.unit_price_value !== undefined && item.unit_price_value < 0) {
          throw new Error('단가는 0 이상이어야 합니다.');
        }
        if (item.amount_value !== null && item.amount_value !== undefined && item.amount_value < 0) {
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

      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
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
      line_number: maxLineNumber + 1
    }
    
    // 새 아이템 추가 후 라인넘버 순서대로 정렬
    const newItems = [...editedItems, newItem].sort((a, b) => {
      const lineA = a.line_number || 999999;
      const lineB = b.line_number || 999999;
      return lineA - lineB;
    });
    
    setEditedItems(newItems)
  }

  const handleRemoveItem = (index: number) => {
    const item = editedItems[index]
    if (item.id) {
      setDeletedItemIds([...deletedItemIds, item.id])
    }
    const newItems = editedItems.filter((_, i) => i !== index).sort((a, b) => {
      const lineA = a.line_number || 999999;
      const lineB = b.line_number || 999999;
      return lineA - lineB;
    });
    setEditedItems(newItems)
  }

  // 구매완료 처리 함수
  const handlePaymentToggle = async (itemId: number | string, isCompleted: boolean) => {
    if (!canPurchase) {
      toast.error('구매완료 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 해당 품목 정보 찾기
    const targetItem = purchase?.items?.find(item => String(item.id) === itemIdStr)
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
        .eq('id', numericId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          String(item.id) === itemIdStr 
            ? { ...item, is_payment_completed: isCompleted, payment_completed_at: isCompleted ? new Date().toISOString() : null }
            : item
        )
        return { ...prev, items: updatedItems }
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

  // 개별 품목 입고완료 처리 (날짜 선택)
  const handleItemReceiptToggle = async (itemId: number | string, selectedDate: Date) => {
    if (!canReceiptCheck) {
      toast.error('입고 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item =>
            String(item.id) === itemIdStr
              ? {
                  ...item,
                  is_received: true,
                  actual_received_date: selectedDate.toISOString()
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
          is_received: true,
          received_at: new Date().toISOString(),
          actual_received_date: selectedDate.toISOString()
        })
        .eq('id', numericId)

      if (error) throw error

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          String(item.id) === itemIdStr 
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

      applyOptimisticUpdate()
      
      const targetItem = purchase?.items?.find(item => String(item.id) === itemIdStr)
      toast.success(`"${targetItem?.item_name}" 품목이 입고완료 처리되었습니다.`)

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }

      applyOptimisticUpdate()
    } catch (error) {
      toast.error('입고완료 처리 중 오류가 발생했습니다.')
    }
  }

  // 입고완료 취소 처리
  const handleReceiptCancel = async (itemId: number | string) => {
    if (!canReceiptCheck) {
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

      applyOptimisticUpdate()
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

      if (purchase) {
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate?.(purchaseIdNumber, prev => {
            const updatedItems = (prev.items || []).map(item => ({
              ...item,
              is_payment_completed: true
            }))
            return {
              ...prev,
              items: updatedItems,
              is_payment_completed: true,
              payment_completed_at: new Date().toISOString(),
              payment_completed_by_name: currentUserName || prev.payment_completed_by_name
            }
          })
        }
      }
      
      toast.success('모든 품목이 구매완료 처리되었습니다.')

      // 상세 모달 및 리스트 모두 새로고침
      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('전체 구매완료 처리 오류', error);
      toast.error('구매완료 처리 중 오류가 발생했습니다.')
    }
  }

  // UTK 확인 처리 함수
  const handleUtkToggle = async (itemId: number | string, isChecked: boolean) => {
    if (!canReceiptCheck) {
      toast.error('UTK 확인 처리 권한이 없습니다.')
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 해당 품목 정보 찾기
    const targetItem = purchase?.items?.find(item => String(item.id) === itemIdStr)
    if (!targetItem) return

    const itemInfo = `품명: ${targetItem.item_name}
규격: ${targetItem.specification || '미입력'}
수량: ${targetItem.quantity?.toLocaleString() || 0}${targetItem.unit || ''}
단가: ₩${targetItem.unit_price_value?.toLocaleString() || 0}
합계: ₩${targetItem.amount_value?.toLocaleString() || 0}`

    const confirmMessage = isChecked 
      ? `다음 품목을 UTK 확인 처리하시겠습니까?\n\n${itemInfo}` 
      : `다음 품목의 UTK 확인을 취소하시겠습니까?\n\n${itemInfo}`
    
    const confirm = window.confirm(confirmMessage)
    if (!confirm) return

    try {
      const supabase = createClient()
      logger.debug('UTK 확인 처리 시작', { itemId: numericId, isChecked, itemIdStr })
      
      const { data, error } = await supabase
        .from('purchase_request_items')
        .update({
          is_utk_checked: isChecked
        })
        .eq('id', numericId)
        .select()

      if (error) {
        logger.error('UTK 확인 DB 업데이트 실패', { error, itemId: numericId, isChecked })
        throw error
      }
      
      logger.debug('UTK 확인 DB 업데이트 성공', { data })

      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          String(item.id) === itemIdStr 
            ? { ...item, is_utk_checked: isChecked }
            : item
        )
        return { ...prev, items: updatedItems }
      })

      if (purchase) {
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate?.(purchaseIdNumber, prev => {
            const updatedItems = (prev.items || []).map(item =>
              String(item.id) === itemIdStr
                ? { ...item, is_utk_checked: isChecked }
                : item
            )
            const total = updatedItems.length || prev.items?.length || 0
            const checked = updatedItems.filter(item => item.is_utk_checked).length
            const allChecked = total > 0 && checked === total
            return {
              ...prev,
              items: updatedItems,
              is_utk_checked: allChecked
            }
          })
        }
      }

      // 모든 품목이 확인되면 purchase_requests에도 업데이트
      const allChecked = purchase?.items?.every(item => {
        if (String(item.id) === itemIdStr) {
          return isChecked
        }
        return item.is_utk_checked === true
      })

      if (allChecked !== undefined && purchase) {
        logger.debug('purchase_requests 업데이트 시작', { purchaseId: purchase.id, allChecked })
        const { error: updateError } = await supabase
          .from('purchase_requests')
          .update({ is_utk_checked: allChecked })
          .eq('id', purchase.id)
          .select()
        
        if (updateError) {
          logger.error('purchase_requests 업데이트 실패', { error: updateError, purchaseId: purchase.id, allChecked })
        } else {
          logger.debug('purchase_requests 업데이트 성공', { purchaseId: purchase.id, allChecked })
        }
      }
      
      toast.success(isChecked ? 'UTK 확인이 완료되었습니다.' : 'UTK 확인이 취소되었습니다.')

      // 상세 모달 및 상위 리스트 모두 최신 상태로 동기화
      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('UTK 확인 처리 중 오류', error)
      toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
    }
  }

  // 전체 UTK 확인 처리
  const handleCompleteAllUtk = async () => {
    if (!purchase || !canReceiptCheck) return
    
    const confirmMessage = `발주번호: ${purchase.purchase_order_number}\n\n모든 품목을 UTK 확인 처리하시겠습니까?`
    const confirm = window.confirm(confirmMessage)
    if (!confirm) return
    
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_utk_checked: true
        })
        .eq('purchase_request_id', purchase.id)
        .eq('is_utk_checked', false) // 아직 확인되지 않은 항목만
      
      if (error) throw error

      // purchase_requests도 업데이트
      await supabase
        .from('purchase_requests')
        .update({ is_utk_checked: true })
        .eq('id', purchase.id)
      
      // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          !item.is_utk_checked 
            ? { ...item, is_utk_checked: true }
            : item
        )
        return { 
          ...prev, 
          items: updatedItems,
          is_utk_checked: true
        }
      })

      if (purchase) {
        const purchaseIdNumber = Number(purchase.id)
        if (!Number.isNaN(purchaseIdNumber)) {
          onOptimisticUpdate?.(purchaseIdNumber, prev => {
            const updatedItems = (prev.items || []).map(item => ({
              ...item,
              is_utk_checked: true
            }))
            return {
              ...prev,
              items: updatedItems,
              is_utk_checked: true
            }
          })
        }
      }
      
      toast.success('모든 품목의 UTK 확인이 완료되었습니다.')

      // 상세 모달 및 리스트 모두 새로고침
      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('전체 UTK 확인 처리 오류', error);
      toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
    }
  }

  // 전체 거래명세서 확인 처리 (날짜 선택)
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

모든 품목의 회계상 입고일을 ${formattedDate}로 등록하시겠습니까?`
    
    if (!window.confirm(confirmMessage)) {
      return
    }

    const selectedDateIso = selectedDate.toISOString()
    const purchaseIdNumber = purchase ? Number(purchase.id) : NaN

    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({
          is_statement_received: true,
          statement_received_date: selectedDateIso,
          statement_received_by_name: currentUserName || null
        })
        .eq('purchase_request_id', purchase.id)
        .eq('is_statement_received', false) // 아직 확인되지 않은 항목만
      
      if (error) throw error

      // purchase_requests도 업데이트
      await supabase
        .from('purchase_requests')
        .update({ 
          is_statement_received: true,
          statement_received_at: selectedDateIso
        })
        .eq('id', purchase.id)

      // 로컬 상태 즉시 업데이트
      setPurchase(prev => {
        if (!prev) return null
        const updatedItems = prev.items?.map(item => 
          !item.is_statement_received 
            ? { 
                ...item, 
                is_statement_received: true,
                statement_received_date: selectedDateIso,
                statement_received_by_name: currentUserName || null
              }
            : item
        )
        const allCompleted = updatedItems && updatedItems.length > 0 && updatedItems.every(item => item.is_statement_received)
        return { 
          ...prev, 
          items: updatedItems,
          is_statement_received: allCompleted,
          statement_received_at: allCompleted ? selectedDateIso : prev.statement_received_at
        }
      })

      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item => ({
            ...item,
            is_statement_received: true,
            statement_received_date: item.statement_received_date || selectedDateIso,
            statement_received_by_name: item.statement_received_by_name || currentUserName || null
          }))
          return {
            ...prev,
            items: updatedItems,
            is_statement_received: true,
            statement_received_at: selectedDateIso
          }
        })
      }

      toast.success('모든 품목의 회계상 입고일이 등록되었습니다.')

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (error) {
      logger.error('전체 거래명세서 확인 처리 오류', error)
      toast.error('거래명세서 확인 처리 중 오류가 발생했습니다.')
    }
  }

  // 전체 입고완료 처리 (날짜 선택)
  const handleCompleteAllReceipt = async (selectedDate: Date) => {
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

    const applyOptimisticUpdate = () => {
      if (!Number.isNaN(purchaseIdNumber)) {
        onOptimisticUpdate?.(purchaseIdNumber, prev => {
          const updatedItems = (prev.items || []).map(item => ({
            ...item,
            is_received: true,
            actual_received_date: item.actual_received_date || selectedDate.toISOString()
          }))

          return {
            ...prev,
            items: updatedItems,
            is_received: true,
            received_at: new Date().toISOString()
          }
        })
      }
    }

    try {
      const updateData = {
        is_received: true,
        received_at: new Date().toISOString(),
        actual_received_date: selectedDate.toISOString()
      }
      

      const { data, error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('purchase_request_id', purchase.id)
        .is('actual_received_date', null) // 아직 실제 입고되지 않은 항목만
        .select()


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

      applyOptimisticUpdate()

      toast.success('모든 품목이 입고완료 처리되었습니다.')

      await refreshModalData()
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }

      applyOptimisticUpdate()
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
                {(() => {
                  const shouldShow = canApproveMiddle && purchase.middle_manager_status === 'pending';
                  if (purchase?.purchase_order_number === 'F20251105_004') {
                    logger.debug('F20251105_004 1차 승인 버튼 조건', {
                      canApproveMiddle,
                      middleManagerStatus: purchase.middle_manager_status,
                      shouldShow
                    });
                  }
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
                  if (purchase?.purchase_order_number === 'F20251105_004') {
                    logger.debug('F20251105_004 최종 승인 버튼 조건', {
                      canApproveFinal,
                      middleManagerStatus: purchase.middle_manager_status,
                      finalManagerStatus: purchase.final_manager_status,
                      shouldShow
                    });
                  }
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
                    <span className="ml-2 badge-stats bg-gray-500 text-white">
                      {purchase.purchase_request_items?.length || 0}개
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
                      {activeTab === 'done' && canReceiptCheck && (
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
                          <Button
                            size="sm"
                            onClick={handleCompleteAllUtk}
                            className="button-base bg-orange-500 hover:bg-orange-600 text-white"
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            UTK 확인
                          </Button>
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
                <div className="max-h-[50vh] sm:max-h-[40vh] w-full min-w-0 overflow-auto">
                  <div style={{ minWidth: `${tableMinWidth}px` }}>
                    {/* Items Table Header - Sticky inside scroll container */}
                    <div className="bg-gray-50 px-2 sm:px-3 py-1 border-b border-gray-100 sticky top-0 z-10">
                      <div 
                        ref={headerRowRef}
                        className="hidden sm:grid gap-3 modal-label" 
                        style={{
                          gridTemplateColumns: getGridTemplateColumns()
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
                              <>
                                <div className="text-center">실제입고일</div>
                              </>
                            )}
                            {activeTab === 'done' && (
                              <>
                                <div className="text-center">거래명세서 확인</div>
                                <div className="text-center">회계상 입고일</div>
                                <div className="text-center">처리자</div>
                                <div className="text-center">UTK</div>
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
                            {activeTab === 'done' && (
                              <>
                                <div className="text-center">거래명세서 확인</div>
                                <div className="text-center">회계상 입고일</div>
                                <div className="text-center">처리자</div>
                                <div className="text-center">UTK</div>
                              </>
                            )}
                            {activeTab === 'receipt' && (
                              <>
                                <div className="text-center">실제입고일</div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(isEditing ? editedItems : purchase.purchase_request_items)?.map((item, index) => (
                        <div key={index} className="px-2 sm:px-3 py-1.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          {/* Desktop Layout */}
                          <div className={`hidden sm:grid items-center gap-3`} style={{
                            gridTemplateColumns: getGridTemplateColumns()
                          }}>
                            {/* 품목명 */}
                            <div className="min-w-0">
                              {isEditing ? (
                                <Input
                                  value={item.item_name}
                                  onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                                  className="modal-label border-gray-200 rounded-lg w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                  placeholder="품목명"
                                  disabled={canEditLimited && !canEditAll}  // lead buyer는 품목명 수정 불가
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
                                  disabled={canEditLimited && !canEditAll}  // lead buyer는 규격 수정 불가
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
                                  disabled={canEditLimited && !canEditAll}  // lead buyer는 합계 수정 불가 (자동계산)
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
                                  disabled={canEditLimited && !canEditAll}  // lead buyer는 비고 수정 불가
                                  onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                                  className="modal-label border-gray-200 rounded-lg text-center w-full h-5 px-1.5 py-0.5 text-[10px] focus:border-blue-400"
                                  placeholder="비고"
                                />
                              ) : (
                                <span className="modal-subtitle text-center">{item.remark || '-'}</span>
                              )}
                            </div>
                            
                            {/* 상태/액션 - 승인대기탭에서는 제외 */}
                            {activeTab !== 'pending' && (
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
                                            className="button-action-primary"
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
                                            <button className="button-toggle-inactive">
                                              {actualReceivedAction.config.waitingText}
                                            </button>
                                          </DatePickerPopover>
                                        )
                                      ) : (
                                        <span className={`${
                                          actualReceivedAction.isCompleted(item)
                                            ? 'button-action-primary' 
                                            : 'button-waiting-inactive'
                                        }`}>
                                          {actualReceivedAction.isCompleted(item) ? actualReceivedAction.config.completedText : actualReceivedAction.config.waitingText}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* 전체 항목 탭에서는 입고 상태만 표시 (클릭 불가) */}
                                  {activeTab === 'done' && (
                                    <div className="flex justify-center">
                                      <span className={`button-base ${
                                        actualReceivedAction.isCompleted(item)
                                          ? 'bg-green-500 hover:bg-green-600 text-white' 
                                          : 'border border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                                      }`}>
                                        {actualReceivedAction.isCompleted(item) ? '입고완료' : '입고대기'}
                                      </span>
                                    </div>
                                  )}
                                  
                                  {/* 기타 탭에서는 기본 상태 표시 */}
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
                              <div className="text-center flex justify-center items-start pt-1 pl-2">
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

                            {/* 거래명세서 확인 - 전체항목 탭에서만 표시 */}
                            {activeTab === 'done' && (
                              <div className="text-center flex justify-center items-start pt-1">
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
                                      className="button-action-primary hover:bg-green-600 transition-colors"
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

                            {/* 회계상 입고일 - 전체항목 탭에서만 표시 */}
                            {activeTab === 'done' && (
                              <div className="text-center flex justify-center items-start pt-1">
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
                            {/* 처리자 - 전체항목 탭에서만 표시 */}
                            {activeTab === 'done' && (
                              <div className="text-center flex justify-center items-start pt-1">
                                {statementReceivedAction.getCompletedByName(item) ? (
                                  <span className="modal-subtitle text-gray-600">
                                    {statementReceivedAction.getCompletedByName(item)}
                                  </span>
                                ) : (
                                  <span className="modal-subtitle text-gray-400">-</span>
                                )}
                              </div>
                            )}

                            {/* UTK 확인 - 전체항목 탭에서만 표시 (맨 오른쪽 끝) */}
                            {activeTab === 'done' && (
                              <div className="text-center flex justify-center items-start pt-1">
                                {canReceiptCheck ? (
                                  <button
                                    onClick={() => handleUtkToggle(item.id, !item.is_utk_checked)}
                                    className={`button-base transition-colors ${
                                      item.is_utk_checked
                                        ? 'button-toggle-active bg-orange-500 hover:bg-orange-600 text-white'
                                        : 'button-toggle-inactive'
                                    }`}
                                    title={item.is_utk_checked ? 'UTK 확인 취소' : 'UTK 확인 처리'}
                                  >
                                    {item.is_utk_checked ? '완료' : '대기'}
                                  </button>
                                ) : (
                                  <span className={`${
                                    item.is_utk_checked 
                                      ? 'button-toggle-active bg-orange-500 text-white' 
                                      : 'button-waiting-inactive'
                                  }`}>
                                    {item.is_utk_checked ? '완료' : '대기'}
                                  </span>
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
                                    disabled={canEditLimited && !canEditAll}  // lead buyer는 품목명 수정 불가
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
                                    disabled={canEditLimited && !canEditAll}  // lead buyer는 규격 수정 불가
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
                                    disabled={canEditLimited && !canEditAll}  // lead buyer는 합계 수정 불가 (자동계산)
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
                                        </>
                                      )}
                                      
                                      {activeTab === 'done' && (
                                        <>
                                          {/* 전체 항목 탭에서는 입고 상태만 표시 (클릭 불가) */}
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

                            {/* 모바일에서 거래명세서 확인 표시 - 전체항목 탭에서만 */}
                            {!isEditing && activeTab === 'done' && (
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
                                        className="text-xs px-2 py-1 rounded button-action-primary hover:bg-green-600 transition-colors"
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
                                        align="end"
                                        side="bottom"
                                      >
                                        <button 
                                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600"
                                          onClick={() => {}}
                                        >
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

                            {/* 모바일에서 회계상 입고일 표시 - 전체항목 탭에서만 */}
                            {!isEditing && activeTab === 'done' && statementReceivedAction.getCompletedDate(item) && (
                              <div>
                                <span className="text-gray-500 text-xs">회계상 입고일:</span>
                                <div className="mt-1">
                                  <div className="modal-subtitle text-blue-700">
                                    {new Date(statementReceivedAction.getCompletedDate(item)).toLocaleDateString('ko-KR', {
                                      year: 'numeric',
                                      month: '2-digit',
                                      day: '2-digit'
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                            {/* 모바일에서 처리자 표시 - 전체항목 탭에서만 */}
                            {!isEditing && activeTab === 'done' && statementReceivedAction.getCompletedByName(item) && (
                              <div>
                                <span className="text-gray-500 text-xs">처리자:</span>
                                <div className="mt-1">
                                  <div className="modal-subtitle text-gray-600">
                                    {statementReceivedAction.getCompletedByName(item)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* 합계 */}
                <div className="bg-gray-50 px-2 sm:px-3 border-t border-gray-100">
                  <div className="hidden sm:grid items-center gap-3 py-0.5" style={{
                    gridTemplateColumns: getGridTemplateColumns()
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
                          (isEditing ? editedItems : purchase.purchase_request_items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
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
                          (isEditing ? editedItems : purchase.purchase_request_items)?.reduce((sum, item) => sum + (item.amount_value || 0), 0) || 0
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
        className="overflow-hidden bg-white rounded-lg shadow-sm border-0 w-full sm:w-auto max-w-[calc(100vw-48px)] sm:max-w-[calc(100vw-80px)] lg:max-w-[90vw] xl:max-w-[85vw] h-[95vh] sm:h-auto sm:max-h-[90vh] lg:max-h-[85vh] sm:rounded-lg flex flex-col" 
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>발주 상세 정보</DialogTitle>
        </DialogHeader>
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
                        onClick={async () => {
                          if (purchase) {
                            try {
                              logger.debug('발주 삭제 시작', { purchaseOrderNumber: purchase.purchase_order_number });
                              await onDelete(purchase);
                              logger.debug('발주 삭제 완료 - 모달 닫기 및 새로고침 진행');
                              
                              // 삭제 후 모달 닫기 및 새로고침
                              onClose();
                              if (onRefresh) {
                                await onRefresh(true); // 강제 새로고침
                                logger.debug('상위 컴포넌트 새로고침 완료');
                              }
                            } catch (error) {
                              logger.error('발주 삭제 중 오류 발생', error);
                              toast.error('삭제 중 오류가 발생했습니다.');
                            }
                          }
                        }}
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

export default memo(PurchaseDetailModal)