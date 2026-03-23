import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { logger } from '@/lib/logger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MessageCircle, Send, Calendar, Search, CheckCircle, Clock, AlertCircle, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Eye, X, Edit2, Trash2, Save, ImagePlus, Loader2, Plus, ListPlus } from 'lucide-react'
import { supportService, type SupportInquiry, type SupportInquiryType, type SupportAttachment, type SupportInquiryMessage, type SupportInquiryPayload } from '@/services/supportService'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { removePurchaseFromMemory, updatePurchaseInMemory, notifyCacheListeners } from '@/stores/purchaseMemoryStore'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { parseRoles } from '@/utils/roleHelper'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { DatePickerPopover } from '@/components/ui/date-picker-popover'
import { DateRange } from 'react-day-picker'
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import ReactSelect, { type StylesConfig } from 'react-select'

type SupportPurchaseRequest = {
  id: number
  purchase_order_number?: string
  sales_order_number?: string
  requester_name?: string
  vendor_name?: string
  request_date?: string
  created_at?: string
  delivery_request_date?: string
  purchase_request_items?: Array<{
    id: string | number
    line_number?: number
    item_name?: string
    specification?: string
    quantity?: number
    unit_price_value?: number
    unit_price?: number
    amount_value?: number
    remark?: string
    link?: string
  }>
}

type SupportPurchaseItem = {
  id: string | number
  line_number?: number
  item_name?: string
  specification?: string
  quantity?: number
  unit_price_value?: number
  unit_price?: number
  amount_value?: number | string
  remark?: string
  link?: string
}

type QuantityChangeRow = {
  id: string
  itemId: string
  newQuantity: string
}

type QuantityChangePayloadItem = {
  item_id: string
  line_number?: number | null
  item_name: string
  specification?: string | null
  current_quantity?: number | null
  new_quantity: number
}

type ItemAddRow = {
  id: string
  itemName: string
  specification: string
  quantity: string
  unit: string
  unitPrice: string
  remark: string
}

type ItemAddPayloadItem = {
  item_name: string
  specification?: string | null
  quantity: number
  unit: string
  unit_price: number
  remark?: string | null
}

type PriceChangeType = 'unit_price' | 'amount'

type PriceChangeRow = {
  id: string
  itemId: string
  changeType: PriceChangeType
  newValue: string
}

type PriceChangePayloadItem = {
  item_id: string
  line_number?: number | null
  item_name: string
  specification?: string | null
  change_type: PriceChangeType
  current_unit_price?: number | null
  new_unit_price?: number | null
  current_amount?: number | null
  new_amount?: number | null
}

export default function SupportMain() {
  const location = useLocation()
  const navigate = useNavigate()
  const [inquiryType, setInquiryType] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  
  // 첨부파일 관련
  const [attachments, setAttachments] = useState<SupportAttachment[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  
  // 발주요청 선택 관련
  const [showPurchaseSelect, setShowPurchaseSelect] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [purchaseRequests, setPurchaseRequests] = useState<SupportPurchaseRequest[]>([])
  const [selectedPurchase, setSelectedPurchase] = useState<SupportPurchaseRequest | null>(null)
  const [searchingPurchase, setSearchingPurchase] = useState(false)
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState<Date | undefined>()
  const [quantityChangeRows, setQuantityChangeRows] = useState<QuantityChangeRow[]>([])
  const [priceChangeRows, setPriceChangeRows] = useState<PriceChangeRow[]>([])
  const [itemAddRows, setItemAddRows] = useState<ItemAddRow[]>([])
  const purchaseLinkedInquiryTypes = ['modify', 'delete', 'delivery_date_change', 'quantity_change', 'price_change', 'item_add']

  // 직원 선택 관련 (발주번호 조회 시 본인 외 다른 직원 선택 가능)
  const [employeeNames, setEmployeeNames] = useState<string[]>([])
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string>('')
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [deleteType, setDeleteType] = useState<'all' | 'items'>('all')
  const [deleteItemIds, setDeleteItemIds] = useState<string[]>([])
  const purchaseSelectLabel = inquiryType === 'delete' ? '삭제할 발주요청 선택' : '발주요청 선택'
  const messageLabel = inquiryType === 'delete' ? '삭제 사유' : '내용'

  // ✅ 입고 지연 알림(DeliveryDateWarningModal)에서 진입한 경우: 입고일 변경 요청으로 화면 고정
  const [lockedInquiryType, setLockedInquiryType] = useState<string | null>(null)
  const [lockedPurchaseId, setLockedPurchaseId] = useState<number | null>(null)
  const [entrySource, setEntrySource] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState<string | null>(null)

  const createRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  
  // 문의 목록 관련
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([])
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([])
  const [loadingInquiries, setLoadingInquiries] = useState(true)
  const [expandedInquiry, setExpandedInquiry] = useState<number | null>(null)
  
  // 모달 관련
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedInquiryDetail, setSelectedInquiryDetail] = useState<(SupportInquiry & { vendor_name?: string; requester_name?: string; request_date?: string; delivery_request_date?: string; notes?: string; purchase_request_items?: SupportPurchaseItem[] }) | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<{ id: string | number; item_name?: string; specification?: string; quantity?: number; unit_price_value?: number; amount_value?: number | string; remark?: string } | null>(null)

  // 전체항목 탭 상세모달(PurchaseDetailModal) 재사용
  const [purchaseDetailModalOpen, setPurchaseDetailModalOpen] = useState(false)
  const [purchaseDetailId, setPurchaseDetailId] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [purchaseToDelete, setPurchaseToDelete] = useState<{ id: number; purchase_order_number?: string } | null>(null)
  const [purchaseMissingOpen, setPurchaseMissingOpen] = useState(false)
  const [purchaseMissingMessage, setPurchaseMissingMessage] = useState('발주내역이 삭제 되었거나 없습니다.')

  // 채팅(대화) 드롭다운(확장 영역 내)
  const [chatMessages, setChatMessages] = useState<SupportInquiryMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatRefreshing, setChatRefreshing] = useState(false)
  const [chatText, setChatText] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatScrollRestoreRef = useRef<{ atBottom: boolean; prevTop: number } | null>(null)
  const chatFirstLoadInquiryIdRef = useRef<number | null>(null)
  const chatForceBottomOnOpenRef = useRef(false)
  const chatMessagesCacheRef = useRef<Map<number, SupportInquiryMessage[]>>(new Map())

  // 초기 권한/목록 로드는 마운트 1회만 (드롭다운 토글로 재실행되면 깜빡임 발생)
  useEffect(() => {
    checkUserRole()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실시간 구독은 권한/사용자 정보가 준비된 후에만 세팅 (expandedInquiry 변화로는 재구독하지 않음)
  useEffect(() => {
    if (isAdmin === null) return
    // 실시간 구독 설정
    const subscription = supportService.subscribeToInquiries((payload) => {
      const eventType = payload?.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | undefined
      const newRow = payload?.new as SupportInquiry | undefined
      const oldRow = payload?.old as SupportInquiry | undefined

      const isRelevantRow = (row?: SupportInquiry) => {
        if (!row) return false
        if (isAdmin) return true
        return !!currentUserId && row.user_id === currentUserId
      }

      // 이벤트에 따라 inquiries state를 직접 갱신 (페이지 새로고침 없이 실시간 반영)
      if (eventType === 'DELETE') {
        const deletedId = oldRow?.id
        if (!deletedId) return
        setInquiries(prev => {
          const next = prev.filter(i => i.id !== deletedId)
          return next
        })
        if (expandedInquiry === deletedId) {
          setExpandedInquiry(null)
        }
        return
      }

      // INSERT/UPDATE
      const row = newRow
      if (!row?.id) return

      setInquiries(prev => {
        // 비관리자는 내 문의만 유지
        const relevant = isRelevantRow(row)
        const idx = prev.findIndex(i => i.id === row.id)

        // 관련 없는 row면 기존에 있던 것만 제거
        if (!relevant) {
          if (idx === -1) return prev
          const next = prev.filter(i => i.id !== row.id)
          return next
        }

        // upsert
        const next = [...prev]
        if (idx >= 0) {
          next[idx] = row
        } else {
          next.unshift(row)
        }

        // 최신순 정렬 (created_at 내림차순)
        next.sort((a, b) => {
          const at = a.created_at ? new Date(a.created_at).getTime() : 0
          const bt = b.created_at ? new Date(b.created_at).getTime() : 0
          return bt - at
        })
        return next
      })
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [isAdmin, currentUserId])

  // 사용자 권한 확인
  const checkUserRole = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setCurrentUserEmail(user.email || '')
    setCurrentUserId(user.id)

    const { data: employee } = await supabase
      .from('employees')
      .select('roles')
      .eq('email', user.email)
      .single()

    if (employee) {
      const roles = parseRoles(employee.roles)

      setCurrentUserRoles(roles)
      const adminStatus = roles.includes('superadmin')
      setIsAdmin(adminStatus)
      
      // 권한 확인 후 바로 목록 로드
      loadInquiriesWithRole(adminStatus)
    }

    // 직원 목록 로드 (발주번호 선택 시 직원 선택 드롭다운용)
    const empResult = await supportService.getEmployeeNames()
    if (empResult.success) {
      const names = empResult.data.map(e => e.name).filter(Boolean)
      setEmployeeNames(names)
      if (empResult.currentUserName) {
        setCurrentUserName(empResult.currentUserName)
        setSelectedEmployeeName(empResult.currentUserName)
      }
    }
  }
  
  // 역할에 따라 문의 목록 로드 (내부 함수)
  const loadInquiriesWithRole = async (adminStatus: boolean) => {
    setLoadingInquiries(true)
    
    const result = adminStatus 
      ? await supportService.getAllInquiries()
      : await supportService.getMyInquiries()
    
    
    if (result.success) {
      setInquiries(result.data)
    } else {
      toast.error(result.error || '문의 목록 로드 실패')
    }
    
    setLoadingInquiries(false)
  }

  // 문의 목록 로드
  const loadInquiries = async () => {
    // 권한 확인이 완료되지 않았으면 대기
    if (isAdmin === null) {
      return;
    }
    
    setLoadingInquiries(true)
    
    // 관리자면 모든 문의, 아니면 내 문의만
    const result = isAdmin 
      ? await supportService.getAllInquiries()
      : await supportService.getMyInquiries()
    
    
    if (result.success) {
      setInquiries(result.data)
    } else {
      toast.error(result.error || '문의 목록 로드 실패')
    }
    
    setLoadingInquiries(false)
  }

  // 문의 유형 변경 시
  useEffect(() => {
    const needsPurchase = purchaseLinkedInquiryTypes.includes(inquiryType)
    if (needsPurchase) {
      setShowPurchaseSelect(true)
    } else {
      setShowPurchaseSelect(false)
      if (!lockedPurchaseId) {
        setSelectedPurchase(null)
      }
    }

    setRequestedDeliveryDate(undefined)
    setQuantityChangeRows([])
    setPriceChangeRows([])
    setItemAddRows([])
    setDeleteType('all')
    setDeleteItemIds([])
  }, [inquiryType])

  // ✅ URL 파라미터 기반 진입 처리: /support?type=delivery_date_change&purchaseId=123&source=delivery-warning&returnTo=...
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const typeParam = params.get('type')
    const purchaseIdParam = params.get('purchaseId')
    const sourceParam = params.get('source')
    const returnToParam = params.get('returnTo')

    if (returnToParam) setReturnTo(returnToParam)
    if (sourceParam) setEntrySource(sourceParam)

    // 입고 지연 알림에서만 '입고일 변경 요청'으로 고정
    if (sourceParam === 'delivery-warning' && typeParam === 'delivery_date_change') {
      setLockedInquiryType('delivery_date_change')
      setInquiryType('delivery_date_change')
    } else {
      setLockedInquiryType(null)
    }

    if (purchaseIdParam) {
      const n = Number(purchaseIdParam)
      setLockedPurchaseId(Number.isFinite(n) ? n : null)
    } else {
      setLockedPurchaseId(null)
    }
  }, [location.search])

  // ✅ 고정 purchaseId가 있으면 바로 상세를 불러와 자동 선택 + 직원명/기간 자동 설정
  useEffect(() => {
    const run = async () => {
      if (!lockedPurchaseId) return
      if (lockedInquiryType === 'delivery_date_change' && inquiryType !== 'delivery_date_change') return

      const result = await supportService.getPurchaseRequestDetail(String(lockedPurchaseId))
      if (!result.success || !result.data) {
        toast.error(result.error || '발주요청 정보를 불러오지 못했습니다.')
        return
      }

      const purchase = result.data as unknown as SupportPurchaseRequest
      setSelectedPurchase(purchase)
      setPurchaseRequests([purchase])
      setRequestedDeliveryDate(undefined)
      setQuantityChangeRows([])
      setPriceChangeRows([])
      setItemAddRows([])

      if (purchase.requester_name) {
        setSelectedEmployeeName(purchase.requester_name)
      }
      const purchaseDate = new Date(purchase.request_date || purchase.created_at || '')
      const from = new Date(purchaseDate)
      from.setMonth(from.getMonth() - 1)
      const to = new Date()
      setDateRange({ from, to })
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedPurchaseId, lockedInquiryType, inquiryType])

  useEffect(() => {
    setRequestedDeliveryDate(undefined)
    setQuantityChangeRows([])
    setPriceChangeRows([])
    setItemAddRows([])
  }, [selectedPurchase?.id])

  useEffect(() => {
    if (inquiryType === 'quantity_change' && quantityChangeRows.length === 0) {
      setQuantityChangeRows([{ id: createRowId(), itemId: '', newQuantity: '' }])
    }
    if (inquiryType === 'price_change' && priceChangeRows.length === 0) {
      setPriceChangeRows([{ id: createRowId(), itemId: '', changeType: 'unit_price', newValue: '' }])
    }
    if (inquiryType === 'item_add' && itemAddRows.length === 0) {
      setItemAddRows([{ id: createRowId(), itemName: '', specification: '', quantity: '', unit: 'EA', unitPrice: '', remark: '' }])
    }
  }, [inquiryType, quantityChangeRows.length, priceChangeRows.length, itemAddRows.length])

  useEffect(() => {
    if (!showPurchaseSelect) return
    if (!dateRange?.from || !dateRange?.to) return
    searchPurchaseRequests()
  }, [showPurchaseSelect, dateRange?.from, dateRange?.to, selectedEmployeeName])

  // 직원 선택 변경 시 기존 발주 선택 초기화 (URL 파라미터 진입 시에는 skip)
  useEffect(() => {
    if (lockedPurchaseId) return
    setSelectedPurchase(null)
    setRequestedDeliveryDate(undefined)
    setQuantityChangeRows([])
    setPriceChangeRows([])
    setItemAddRows([])
  }, [selectedEmployeeName])

  // 발주요청 검색
  const searchPurchaseRequests = async () => {
    setSearchingPurchase(true)
    
    const startDate = dateRange?.from ? dateRange.from.toISOString().split('T')[0] : undefined
    const endDate = dateRange?.to ? dateRange.to.toISOString().split('T')[0] : undefined
    
    const result = await supportService.getMyPurchaseRequests(startDate, endDate, selectedEmployeeName || undefined)
    
    if (result.success) {
      let data = result.data as unknown as SupportPurchaseRequest[]
      if (selectedPurchase && !data.some((p: { id: number }) => p.id === selectedPurchase.id)) {
        data = [selectedPurchase, ...data]
      }
      setPurchaseRequests(data)
    } else {
      toast.error(result.error || '발주요청 조회 실패')
    }
    
    setSearchingPurchase(false)
  }

  // 기본 기간: 최근 2개월
  useEffect(() => {
    if (!dateRange) {
      const today = new Date()
      const from = new Date()
      from.setMonth(from.getMonth() - 2)
      setDateRange({ from, to: today })
    }
  }, [dateRange])

  const employeeNameOptions = employeeNames.map(name => ({
    value: name,
    label: name === currentUserName ? `${name} (본인)` : name
  }))

  const purchaseOptions = [...purchaseRequests]
    .sort((a, b) => {
      const aTime = a.request_date || a.created_at
      const bTime = b.request_date || b.created_at
      const aValue = aTime ? new Date(aTime).getTime() : 0
      const bValue = bTime ? new Date(bTime).getTime() : 0
      return bValue - aValue
    })
    .map((pr) => {
    const orderNumber = pr.purchase_order_number || '(승인대기)'
    const vendorName = pr.vendor_name || ''
    const firstItem = pr.purchase_request_items?.[0]?.item_name || '품목 없음'
    const extraCount = (pr.purchase_request_items?.length ?? 0) > 1
      ? ` 외 ${(pr.purchase_request_items?.length ?? 0) - 1}건`
      : ''
    const label = `${orderNumber} · ${vendorName} · ${firstItem}${extraCount}`.trim()
    const searchText = `${orderNumber} ${vendorName} ${pr.requester_name || ''} ${firstItem}`.toLowerCase()
    return {
      value: String(pr.id),
      label,
      data: pr,
      searchText
    }
  })

  const inquiryTypeOptions = [
    { value: 'delivery_date_change', label: '입고일 변경 요청' },
    { value: 'quantity_change', label: '수량 변경 요청' },
    { value: 'price_change', label: '단가/합계 금액 변경 요청' },
    { value: 'item_add', label: '품목 추가 요청' },
    { value: 'bug', label: '오류 신고' },
    { value: 'modify', label: '수정 요청' },
    { value: 'delete', label: '삭제 요청' },
    { value: 'other', label: '기타 문의' }
  ]

  const selectedPurchaseItems = Array.isArray(selectedPurchase?.purchase_request_items)
    ? [...selectedPurchase.purchase_request_items].sort((a: { line_number?: number }, b: { line_number?: number }) => {
        const aLine = a.line_number ?? Number.MAX_SAFE_INTEGER
        const bLine = b.line_number ?? Number.MAX_SAFE_INTEGER
        return aLine - bLine
      })
    : []
  const itemOptions = selectedPurchaseItems.map((item: { id: string | number; item_name?: string; specification?: string; quantity?: number; unit_price_value?: number; amount_value?: number | string; line_number?: number }) => ({
    value: String(item.id),
    label: `${item.line_number ? `${item.line_number}.` : ''} ${item.item_name} (${item.specification || '-'})`.trim()
  }))

  const getMeasureFont = () => {
    if (typeof document === 'undefined') {
      return '11px Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif'
    }

    const bodyStyle = window.getComputedStyle(document.body)
    const fontFamily = bodyStyle.fontFamily || 'Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif'
    const fontWeight = bodyStyle.fontWeight || '400'
    return `${fontWeight} 11px ${fontFamily}`
  }

  const measureTextWidthPx = (text: string) => {
    if (typeof document === 'undefined') {
      return text.length * 7
    }

    if (!textMeasureCanvasRef.current) {
      textMeasureCanvasRef.current = document.createElement('canvas')
    }

    const context = textMeasureCanvasRef.current.getContext('2d')
    if (!context) {
      return text.length * 7
    }

    context.font = getMeasureFont()
    return Math.ceil(context.measureText(text).width)
  }

  const getLabelWidthEm = (label: string, padding = 4, min = 12) =>
    Math.max(label.length + padding, min)

  const SELECT_OPTION_PADDING_PX = 24
  const SELECT_INDICATOR_PX = 30
  const SELECT_SCROLLBAR_PX = 14
  const getSelectLabelMaxPx = (options: Array<{ label?: string }>) =>
    options.reduce((max, option) => {
      const label = option.label ?? ''
      return Math.max(max, measureTextWidthPx(label))
    }, 0)
  const getSelectControlWidthPx = (options: Array<{ label?: string }>, placeholder: string) => {
    const maxLabelPx = getSelectLabelMaxPx(options)
    const base = Math.max(maxLabelPx, measureTextWidthPx(placeholder))
    return Math.ceil(base + SELECT_OPTION_PADDING_PX + SELECT_INDICATOR_PX)
  }
  const getMenuWidthPx = (options: Array<{ label?: string }>, placeholder: string) => {
    const maxLabelPx = getSelectLabelMaxPx(options)
    const base = Math.max(maxLabelPx, measureTextWidthPx(placeholder))
    return Math.ceil(base + SELECT_OPTION_PADDING_PX + SELECT_INDICATOR_PX + SELECT_SCROLLBAR_PX)
  }

  const inquiryTypePlaceholder = '문의 유형을 선택해주세요'
  const inquiryTypeControlWidthEm = getLabelWidthEm(inquiryTypePlaceholder, 3, 14)
  const inquiryTypeMenuWidthEm = getLabelWidthEm(
    inquiryTypeOptions.reduce((max, option) => {
      const label = option.label || ''
      return label.length > max.length ? label : max
    }, inquiryTypePlaceholder),
    3,
    inquiryTypeControlWidthEm
  )
  const purchaseSelectPlaceholder = '발주번호 선택/검색'
  const purchaseControlWidthPx = getSelectControlWidthPx(purchaseOptions, purchaseSelectPlaceholder)
  const purchaseMenuWidthPx = getMenuWidthPx(purchaseOptions, purchaseSelectPlaceholder)

  const itemSelectPlaceholder = '품목 선택/검색'
  const itemControlWidthPx = getSelectControlWidthPx(itemOptions, itemSelectPlaceholder) + 16
  const itemMenuWidthPx = getMenuWidthPx(itemOptions, itemSelectPlaceholder)
  const priceChangeTypeOptions = [
    { value: 'unit_price', label: '단가' },
    { value: 'amount', label: '합계액' }
  ]

  const formatNumericInput = (value: string) => {
    if (!value) return ''
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue.toLocaleString('ko-KR') : value
  }

  const normalizeNumericInput = (value: string) => value.replace(/[^\d]/g, '')

  const dateRangeWidthEm = Math.max('발주요청 기간을 선택하세요'.length + 5, 22)

  const getCompactSelectStyles = (controlWidthPx?: number, menuWidthPx?: number) => ({
    control: (base: Record<string, unknown>) => ({
      ...base,
      minHeight: '28px',
      height: '28px',
      fontSize: '11px',
      borderRadius: '8px',
      borderColor: '#e5e7eb',
      boxShadow: 'none',
      flexWrap: 'nowrap' as const
    }),
    container: (base: Record<string, unknown>) => ({
      ...base,
      width: controlWidthPx ? `${controlWidthPx}px` : base.width,
      maxWidth: '100%'
    }),
    valueContainer: (base: Record<string, unknown>) => ({
      ...base,
      padding: '0 8px',
      overflow: 'hidden',
      flexWrap: 'nowrap' as const
    }),
    input: (base: Record<string, unknown>) => ({
      ...base,
      margin: 0,
      padding: 0,
      fontSize: '11px'
    }),
    indicatorsContainer: (base: Record<string, unknown>) => ({
      ...base,
      height: '28px',
      flexShrink: 0
    }),
    indicatorSeparator: () => ({
      display: 'none'
    }),
    option: (base: Record<string, unknown>) => ({
      ...base,
      fontSize: '11px',
      whiteSpace: 'nowrap',
      overflow: 'visible',
      textOverflow: 'clip'
    }),
    placeholder: (base: Record<string, unknown>) => ({
      ...base,
      fontSize: '11px',
      color: '#9ca3af',
      whiteSpace: 'nowrap'
    }),
    singleValue: (base: Record<string, unknown>) => ({
      ...base,
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: 'calc(100% - 8px)'
    }),
    menu: (base: Record<string, unknown>) => ({
      ...base,
      width: menuWidthPx ? `${menuWidthPx}px` : base.width,
      minWidth: menuWidthPx ? `${menuWidthPx}px` : base.minWidth,
      maxWidth: menuWidthPx ? `${menuWidthPx}px` : '90vw'
    }),
    menuList: (base: Record<string, unknown>) => ({
      ...base,
      width: menuWidthPx ? `${menuWidthPx}px` : base.width,
      minWidth: menuWidthPx ? `${menuWidthPx}px` : base.minWidth,
      maxWidth: menuWidthPx ? `${menuWidthPx}px` : base.maxWidth
    })
  })

  const addQuantityRow = () => {
    setQuantityChangeRows(prev => [
      ...prev,
      { id: createRowId(), itemId: '', newQuantity: '' }
    ])
  }

  const addAllQuantityRows = () => {
    if (selectedPurchaseItems.length === 0) return
    const existingItemIds = new Set(quantityChangeRows.map(row => row.itemId))
    const newRows = selectedPurchaseItems
      .filter((item: { id: string | number }) => !existingItemIds.has(String(item.id)))
      .map((item: { id: string | number; item_name?: string; specification?: string; quantity?: number; unit_price_value?: number; amount_value?: number | string; line_number?: number }) => ({
        id: createRowId(),
        itemId: String(item.id),
        newQuantity: ''
      }))
    if (newRows.length === 0) {
      return
    }
    setQuantityChangeRows(prev => [...prev.filter(row => row.itemId), ...newRows])
  }

  const addPriceRow = () => {
    setPriceChangeRows(prev => [
      ...prev,
      { id: createRowId(), itemId: '', changeType: 'unit_price', newValue: '' }
    ])
  }

  const updateQuantityRow = (rowId: string, updates: Partial<QuantityChangeRow>) => {
    setQuantityChangeRows(prev =>
      prev.map(row => row.id === rowId ? { ...row, ...updates } : row)
    )
  }

  const removeQuantityRow = (rowId: string) => {
    setQuantityChangeRows(prev => prev.filter(row => row.id !== rowId))
  }

  const updatePriceRow = (rowId: string, updates: Partial<PriceChangeRow>) => {
    setPriceChangeRows(prev =>
      prev.map(row => row.id === rowId ? { ...row, ...updates } : row)
    )
  }

  const removePriceRow = (rowId: string) => {
    setPriceChangeRows(prev => prev.filter(row => row.id !== rowId))
  }

  const addItemAddRow = () => {
    setItemAddRows(prev => [
      ...prev,
      { id: createRowId(), itemName: '', specification: '', quantity: '', unit: 'EA', unitPrice: '', remark: '' }
    ])
  }

  const updateItemAddRow = (rowId: string, updates: Partial<ItemAddRow>) => {
    setItemAddRows(prev =>
      prev.map(row => row.id === rowId ? { ...row, ...updates } : row)
    )
  }

  const removeItemAddRow = (rowId: string) => {
    setItemAddRows(prev => prev.filter(row => row.id !== rowId))
  }

  // 문의 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const messageOptionalTypes = ['quantity_change', 'price_change', 'item_add', 'delivery_date_change']
    if (!inquiryType || (!message && !messageOptionalTypes.includes(inquiryType))) {
      toast.error('모든 필드를 입력해주세요.')
      return
    }
    
    const requiresPurchase = purchaseLinkedInquiryTypes.includes(inquiryType)
    if (requiresPurchase && !selectedPurchase) {
      toast.error('발주요청을 선택해주세요.')
      return
    }

    setLoading(true)
    
    const subjectText = getInquiryTypeLabel(inquiryType) || inquiryType

    // 발주 정보를 텍스트로 구성
    let finalMessage = message;
    let purchaseInfo = '';
    let inquiryPayload: SupportInquiryPayload | null = null
    const summaryLines: string[] = []

    if (inquiryType === 'delivery_date_change') {
      if (!requestedDeliveryDate) {
        toast.error('변경 입고일을 입력해주세요.')
        setLoading(false)
        return
      }
      const currentDateText = selectedPurchase?.delivery_request_date
        ? format(new Date(selectedPurchase.delivery_request_date), 'yyyy-MM-dd')
        : '-'
      const requestedDateText = format(requestedDeliveryDate, 'yyyy-MM-dd')

      inquiryPayload = {
        requested_date: requestedDateText,
        current_date: selectedPurchase?.delivery_request_date || null
      }
      summaryLines.push(`현재 입고요청일: ${currentDateText}`)
      summaryLines.push(`변경 입고일: ${requestedDateText}`)
    }

    if (inquiryType === 'quantity_change') {
      const activeRows = quantityChangeRows.filter(row => row.itemId || row.newQuantity.trim())
      if (activeRows.length === 0) {
        toast.error('수량 변경할 품목을 추가해주세요.')
        setLoading(false)
        return
      }

      const itemsPayload: QuantityChangePayloadItem[] = []
      for (const row of activeRows) {
        if (!row.itemId || !row.newQuantity.trim()) {
          toast.error('수량 변경 항목을 모두 입력해주세요.')
          setLoading(false)
          return
        }
        const newQuantity = Number(row.newQuantity)
        if (!Number.isFinite(newQuantity)) {
          toast.error('변경 수량이 올바르지 않습니다.')
          setLoading(false)
          return
        }

        const targetItem = selectedPurchaseItems.find((item) => String(item.id) === row.itemId)
        if (!targetItem) {
          toast.error('선택한 품목을 찾을 수 없습니다.')
          setLoading(false)
          return
        }

        itemsPayload.push({
          item_id: String(targetItem.id),
          line_number: targetItem.line_number ?? null,
          item_name: targetItem.item_name || '',
          specification: targetItem.specification ?? null,
          current_quantity: targetItem.quantity ?? null,
          new_quantity: newQuantity
        })
        summaryLines.push(
          `${targetItem.line_number ?? '-'}번 ${targetItem.item_name} (${targetItem.specification || '-'}) ` +
          `${targetItem.quantity ?? 0} → ${newQuantity}`
        )
      }

      inquiryPayload = { items: itemsPayload }
    }

    if (inquiryType === 'price_change') {
      const activeRows = priceChangeRows.filter(row => row.itemId || row.newValue.trim())
      if (activeRows.length === 0) {
        toast.error('단가/합계 금액 변경할 품목을 추가해주세요.')
        setLoading(false)
        return
      }

      const itemsPayload: PriceChangePayloadItem[] = []
      for (const row of activeRows) {
        if (!row.itemId || !row.newValue.trim()) {
          toast.error('단가/합계 금액 변경 항목을 모두 입력해주세요.')
          setLoading(false)
          return
        }
        const newValue = Number(row.newValue)
        if (!Number.isFinite(newValue)) {
          toast.error('변경 값이 올바르지 않습니다.')
          setLoading(false)
          return
        }

        const targetItem = selectedPurchaseItems.find((item) => String(item.id) === row.itemId)
        if (!targetItem) {
          toast.error('선택한 품목을 찾을 수 없습니다.')
          setLoading(false)
          return
        }

        const currentUnitPrice = Number(targetItem.unit_price_value ?? targetItem.unit_price ?? 0)
        const currentAmount = Number(targetItem.amount_value ?? (currentUnitPrice * (targetItem.quantity ?? 0)))
        const quantityValue = Number(targetItem.quantity ?? 0)

        if (row.changeType === 'amount') {
          const newAmount = newValue
          const newUnitPrice = quantityValue > 0 ? newAmount / quantityValue : 0

          itemsPayload.push({
            item_id: String(targetItem.id),
            line_number: targetItem.line_number ?? null,
            item_name: targetItem.item_name || '',
            specification: targetItem.specification ?? null,
            change_type: 'amount',
            current_unit_price: currentUnitPrice,
            new_unit_price: newUnitPrice,
            current_amount: currentAmount,
            new_amount: newAmount
          })
          summaryLines.push(
            `${targetItem.line_number ?? '-'}번 ${targetItem.item_name} (${targetItem.specification || '-'}) ` +
            `합계 ${currentAmount.toLocaleString('ko-KR')} → ${newAmount.toLocaleString('ko-KR')}`
          )
        } else {
          const newUnitPrice = newValue
          const newAmount = quantityValue * newUnitPrice

          itemsPayload.push({
            item_id: String(targetItem.id),
            line_number: targetItem.line_number ?? null,
            item_name: targetItem.item_name || '',
            specification: targetItem.specification ?? null,
            change_type: 'unit_price',
            current_unit_price: currentUnitPrice,
            new_unit_price: newUnitPrice,
            current_amount: currentAmount,
            new_amount: newAmount
          })
          summaryLines.push(
            `${targetItem.line_number ?? '-'}번 ${targetItem.item_name} (${targetItem.specification || '-'}) ` +
            `단가 ${currentUnitPrice.toLocaleString('ko-KR')} → ${newUnitPrice.toLocaleString('ko-KR')} ` +
            `합계 ${currentAmount.toLocaleString('ko-KR')} → ${newAmount.toLocaleString('ko-KR')}`
          )
        }
      }

      inquiryPayload = { items: itemsPayload }
    }

    if (inquiryType === 'item_add') {
      const activeRows = itemAddRows.filter(row => row.itemName.trim() || row.quantity.trim())
      if (activeRows.length === 0) {
        toast.error('추가할 품목을 입력해주세요.')
        setLoading(false)
        return
      }

      const itemsPayload: ItemAddPayloadItem[] = []
      for (const row of activeRows) {
        if (!row.itemName.trim()) {
          toast.error('품목명을 입력해주세요.')
          setLoading(false)
          return
        }
        const quantity = Number(row.quantity)
        if (!row.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
          toast.error('수량을 올바르게 입력해주세요.')
          setLoading(false)
          return
        }
        const unitPrice = Number(normalizeNumericInput(row.unitPrice))
        if (!row.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
          toast.error('단가를 올바르게 입력해주세요.')
          setLoading(false)
          return
        }

        itemsPayload.push({
          item_name: row.itemName.trim(),
          specification: row.specification.trim() || null,
          quantity,
          unit: row.unit.trim() || 'EA',
          unit_price: unitPrice,
          remark: row.remark.trim() || null,
        })
        const amount = quantity * unitPrice
        summaryLines.push(
          `${row.itemName.trim()} (${row.specification.trim() || '-'}) ${quantity}${row.unit || 'EA'} × ${unitPrice.toLocaleString('ko-KR')} = ${amount.toLocaleString('ko-KR')}`
        )
      }

      inquiryPayload = { items: itemsPayload }
    }

    if (inquiryType === 'delete') {
      if (deleteType === 'items') {
        if (deleteItemIds.length === 0) {
          toast.error('삭제할 품목을 선택해주세요.')
          setLoading(false)
          return
        }
        const deleteItemsPayload = deleteItemIds.map(itemId => {
          const targetItem = selectedPurchaseItems.find((item) => String(item.id) === itemId)
          return {
            item_id: itemId,
            line_number: targetItem?.line_number ?? null,
            item_name: targetItem?.item_name ?? '',
            specification: targetItem?.specification ?? null,
          }
        })
        inquiryPayload = { reason: message.trim(), delete_type: 'items' as const, delete_items: deleteItemsPayload }
        summaryLines.push(`[품목별 삭제] ${deleteItemsPayload.map(i =>
          `${i.line_number ?? '-'}번 ${i.item_name} (${i.specification || '-'})`
        ).join(', ')}`)
      } else {
        inquiryPayload = { reason: message.trim(), delete_type: 'all' as const }
        summaryLines.push('[발주 전체 삭제]')
      }
    }
    
    if (selectedPurchase) {
      const items = selectedPurchase.purchase_request_items || [];
      const itemsText = items.map((item, index: number) =>
        `- ${item.line_number ?? index + 1}. ${item.item_name} (${item.specification || '-'}) ${item.quantity}개`
      ).join('\n');
      
      const poNumberText = selectedPurchase.purchase_order_number || '(승인대기)'
      purchaseInfo = `발주번호: ${poNumberText}
업체: ${selectedPurchase.vendor_name}
요청자: ${selectedPurchase.requester_name}
요청일: ${selectedPurchase.request_date || selectedPurchase.created_at || '-'}
품목:
${itemsText}`;
    }

    const messageSections: string[] = []
    if (message.trim()) {
      messageSections.push(message.trim())
    }
    if (summaryLines.length > 0) {
      messageSections.push(`[요청 상세]\n${summaryLines.join('\n')}`)
    }
    if (purchaseInfo) {
      messageSections.push(`[관련 발주 정보]\n${purchaseInfo}`)
    }
    finalMessage = messageSections.join('\n\n') || subjectText

    const result = await supportService.createInquiry({
      inquiry_type: inquiryType as SupportInquiryType,
      subject: subjectText,
      message: finalMessage,
      purchase_request_id: selectedPurchase?.id,
      purchase_info: purchaseInfo,
      purchase_order_number: selectedPurchase?.purchase_order_number,
      attachments: attachments,
      inquiry_payload: inquiryPayload
    })

    if (result.success) {
      // ✅ 입고 지연 알림 경로로 들어온 "입고일 변경 요청"은 차단 해제 플래그도 함께 올림
      if (
        entrySource === 'delivery-warning' &&
        inquiryType === 'delivery_date_change' &&
        selectedPurchase?.id
      ) {
        try {
          const supabase = createClient()
          const nowIso = new Date().toISOString()
          const { data: { user } } = await supabase.auth.getUser()
          const userEmail = user?.email || null

          // 가능한 경우 employees에서 이름 조회 (없으면 기존 selectedPurchase.requester_name fallback)
          let byName: string | null = null
          if (userEmail) {
            const { data: emp } = await supabase
              .from('employees')
              .select('name')
              .eq('email', userEmail)
              .maybeSingle()
            byName = (emp as { name?: string } | null)?.name || null
          }

          const { error } = await supabase
            .from('purchase_requests')
            .update({
              delivery_revision_requested: true,
              delivery_revision_requested_at: nowIso,
              delivery_revision_requested_by: byName || userEmail || 'unknown'
            })
            .eq('id', selectedPurchase.id)

          if (!error) {
            const updated = updatePurchaseInMemory(selectedPurchase.id, (p) => ({
              ...p,
              delivery_revision_requested: true,
              delivery_revision_requested_at: nowIso,
              delivery_revision_requested_by: byName || userEmail || 'unknown'
            }))
            if (updated) notifyCacheListeners()
          }
        } catch {
          // 플래그 업데이트 실패는 문의 접수 자체를 막지 않음
        }
      }

      toast.success('문의가 접수되었습니다.')
      const createdId = result.inquiryId
      // 폼 초기화
      // 고정 타입이면 초기화하지 않음 (뒤로 돌아왔을 때 UX 안정)
      if (!lockedInquiryType) setInquiryType('')
      setMessage('')
      setSelectedPurchase(null)
      setPurchaseRequests([])
      setDateRange(undefined)
      setAttachments([])
      // 목록 새로고침
      loadInquiries()

      // ✅ 생성된 문의를 펼쳐서(드롭다운) 바로 대화창이 보이게
      if (createdId) {
        setExpandedInquiry(createdId)
      }

      // ✅ returnTo가 있으면 해당 화면으로 복귀 (open redirect 방지: 내부 경로만 허용)
      if (returnTo && returnTo.startsWith('/')) {
        navigate(returnTo)
      }
    } else {
      toast.error(result.error || '문의 접수에 실패했습니다.')
    }
    
    setLoading(false)
  }

  // 이미지 첨부 핸들러
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // 최대 5개 제한
    if (attachments.length >= 5) {
      toast.error('첨부파일은 최대 5개까지 가능합니다.')
      return
    }

    const file = files[0]
    
    // 파일 크기 제한 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('파일 크기는 5MB 이하만 가능합니다.')
      return
    }

    // 이미지 타입 확인
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 첨부 가능합니다.')
      return
    }

    setUploadingImage(true)
    const result = await supportService.uploadAttachment(file)
    
    if (result.success && result.data) {
      setAttachments(prev => [...prev, result.data!])
      toast.success('이미지가 첨부되었습니다.')
    } else {
      toast.error(result.error || '이미지 업로드 실패')
    }
    
    setUploadingImage(false)
    
    // input 초기화 (같은 파일 다시 선택 가능하도록)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 첨부파일 삭제 핸들러
  const handleRemoveAttachment = async (index: number) => {
    const attachment = attachments[index]
    
    // Storage에서 삭제
    await supportService.deleteAttachment(attachment.path)
    
    // state에서 제거
    setAttachments(prev => prev.filter((_, i) => i !== index))
    toast.success('첨부파일이 삭제되었습니다.')
  }

  // 문의 상태 업데이트 (관리자용)
  const handleStatusUpdate = async (inquiryId: number, newStatus: 'in_progress' | 'resolved' | 'closed', resolutionNote?: string) => {
    if (newStatus === 'resolved') {
      // ✅ 입력 없이 완료 처리 + 사용자에게 "완료되었습니다" 알림 + 로그 기록(DB 함수)
      const result = await supportService.resolveInquiry(inquiryId)
      if (result.success) {
        toast.success('문의가 완료 처리되었습니다.')
        loadInquiries()
      } else {
        toast.error(result.error || '완료 처리 실패')
      }
    } else {
      const result = await supportService.updateInquiryStatus(inquiryId, newStatus)
      
      if (result.success) {
        toast.success('상태가 업데이트되었습니다.')
        loadInquiries()
      } else {
        toast.error(result.error || '상태 업데이트 실패')
      }
    }
  }

  const expandedInquiryObj = inquiries.find((i) => i.id === expandedInquiry) || null

  // 확장된 문의에 대해 메시지 로드 + 실시간 구독 + (사용자) 알림 읽음 처리
  useEffect(() => {
    if (!expandedInquiryObj?.id) return
    const inquiryId = expandedInquiryObj.id!

    let cancelled = false
    // 드롭다운 첫 오픈 시에는 무조건 맨 아래로
    chatForceBottomOnOpenRef.current = true
    const cached = chatMessagesCacheRef.current.get(inquiryId)
    if (cached && cached.length > 0) {
      // 캐시가 있으면 즉시 표시(깜빡임/빈 화면 없음)
      setChatMessages(cached)
      setChatLoading(false)
      setChatRefreshing(true)
    } else {
      // 캐시가 없으면 초기 로딩 스피너
      setChatMessages([])
      setChatLoading(true)
      setChatRefreshing(false)
    }

    const load = async () => {
      // 캐시가 있을 때는 UI를 유지한 채로 백그라운드 갱신만 표시
      const hasCached = (chatMessagesCacheRef.current.get(inquiryId)?.length ?? 0) > 0
      if (hasCached) setChatRefreshing(true)
      else setChatLoading(true)

      const result = await supportService.getInquiryMessages(inquiryId)
      if (!cancelled) {
        if (result.success) {
          const el = chatScrollRef.current
          const prevTop = el?.scrollTop ?? 0
          const isFirstLoad = chatFirstLoadInquiryIdRef.current !== inquiryId
          chatFirstLoadInquiryIdRef.current = inquiryId

          const atBottom = isFirstLoad
            ? true
            : (el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 80 : true)

          chatScrollRestoreRef.current = { atBottom, prevTop }

          setChatMessages(result.data)
          chatMessagesCacheRef.current.set(inquiryId, result.data)
          setChatLoading(false)
          setChatRefreshing(false)
        } else {
          toast.error(result.error || '대화 내용을 불러오지 못했습니다.')
          setChatLoading(false)
          setChatRefreshing(false)
        }
      }
    }

    // 사용자: 해당 문의 알림(안읽음) 처리
    const markAsRead = async () => {
      if (isAdmin) return
      if (!currentUserEmail) return
      const supabase = createClient()
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_email', currentUserEmail)
        .eq('is_read', false)
        .in('type', ['inquiry_message', 'inquiry_resolved'])
        .eq('data->>inquiryId', String(inquiryId))
    }

    load()
    markAsRead()

    const subscription = supportService.subscribeToInquiryMessages(inquiryId, () => {
      load()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [expandedInquiryObj?.id, isAdmin, currentUserEmail])

  // chatMessages가 DOM에 반영된 직후(useLayoutEffect)에 스크롤을 보정
  // NOTE: expandedInquiryObj 선언 이후에 위치해야 TDZ(초기화 전 참조) 에러가 나지 않음
  useLayoutEffect(() => {
    if (!expandedInquiryObj?.id) return
    const el = chatScrollRef.current
    if (!el) return

    if (chatForceBottomOnOpenRef.current) {
      el.scrollTop = el.scrollHeight
      // 실제 콘텐츠가 렌더된 상태(또는 로딩 종료)에서만 강제 플래그를 내림
      // 너무 일찍 false가 되면, 이후 메시지 DOM이 붙을 때 다시 맨 위로 남는 문제가 생김
      if (chatMessages.length > 0 || !chatLoading) {
        chatForceBottomOnOpenRef.current = false
      }
    } else {
      const restore = chatScrollRestoreRef.current
      if (!restore) return
      if (restore.atBottom) el.scrollTop = el.scrollHeight
      else el.scrollTop = restore.prevTop
    }
  }, [expandedInquiryObj?.id, chatMessages, chatLoading])

  const handleSendChat = async () => {
    if (!expandedInquiryObj?.id) return
    if (!chatText.trim()) {
      toast.error('메시지를 입력해주세요.')
      return
    }
    if (expandedInquiryObj.status === 'resolved' || expandedInquiryObj.status === 'closed') {
      toast.error('완료된 문의에는 메시지를 보낼 수 없습니다.')
      return
    }

    setChatSending(true)
    const result = await supportService.sendInquiryMessage({
      inquiryId: expandedInquiryObj.id!,
      message: chatText.trim(),
      senderRole: isAdmin ? 'admin' : 'user'
    })

    if (result.success) {
      setChatText('')
    } else {
      toast.error(result.error || '메시지 전송 실패')
    }
    setChatSending(false)
  }

  const handleResolveFromChat = async () => {
    if (!expandedInquiryObj?.id) return
    const result = await supportService.resolveInquiry(expandedInquiryObj.id!)
    if (result.success) {
      toast.success('문의가 완료 처리되었습니다.')
      setChatText('')
      setExpandedInquiry(null)
      loadInquiries()
    } else {
      toast.error(result.error || '완료 처리 실패')
    }
  }

  // 문의 삭제
  const handleDeleteInquiry = async (inquiryId: number) => {
    if (!confirm('정말로 이 문의를 삭제하시겠습니까?\n삭제된 문의는 복구할 수 없습니다.')) return

    const result = await supportService.deleteInquiry(inquiryId)
    
    if (result.success) {
      toast.success('문의가 삭제되었습니다.')
      loadInquiries()
    } else {
      toast.error(result.error || '문의 삭제 실패')
    }
  }

  // 문의 상세 보기
  const viewInquiryDetail = (inquiry: SupportInquiry) => {
    setSelectedInquiryDetail(inquiry)
    setShowDetailModal(true)
  }

  const openPurchaseDetailFromInquiry = async (inquiry: SupportInquiry) => {
    try {
      // 1) 가장 정확한 값: purchase_request_id (신규 문의부터 저장됨)
      if (inquiry.purchase_request_id) {
        setPurchaseDetailId(inquiry.purchase_request_id)
        setPurchaseDetailModalOpen(true)
        return
      }

      // 2) 과거 데이터 호환: purchase_order_number로 purchase_requests에서 id 조회
      const orderNumber = inquiry.purchase_order_number?.trim()
      if (!orderNumber) {
        setPurchaseMissingMessage('발주내역이 삭제 되었거나 없습니다.')
        setPurchaseMissingOpen(true)
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('id')
        .eq('purchase_order_number', orderNumber)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      if (!data?.id) {
        setPurchaseMissingMessage('발주내역이 삭제 되었거나 없습니다.')
        setPurchaseMissingOpen(true)
        return
      }

      setPurchaseDetailId(data.id)
      setPurchaseDetailModalOpen(true)
    } catch (e) {
      setPurchaseMissingMessage('발주내역이 삭제 되었거나 없습니다.')
      setPurchaseMissingOpen(true)
    }
  }

  // 품목 수정 시작
  const startEditItem = (item: SupportPurchaseItem) => {
    setEditingItemId(String(item.id))
    setEditingItem({
      id: item.id,
      item_name: item.item_name,
      specification: item.specification,
      quantity: item.quantity,
      unit_price_value: item.unit_price_value,
      remark: item.remark
    })
  }

  // 품목 수정 취소
  const cancelEditItem = () => {
    setEditingItemId(null)
    setEditingItem(null)
  }

  // 품목 수정 저장
  const saveEditItem = async (itemId: string) => {
    if (!editingItem) return

    const totalPrice = (editingItem.quantity || 0) * (editingItem.unit_price_value || 0)
    const result = await supportService.updatePurchaseRequestItem(itemId, {
      item_name: editingItem.item_name,
      specification: editingItem.specification,
      quantity: editingItem.quantity,
      unit_price_value: editingItem.unit_price_value,
      amount_value: totalPrice,
      remark: editingItem.remark
    })

    if (result.success) {
      toast.success('품목이 수정되었습니다.')
      // 목록 새로고침 - 상세 정보가 있다면 다시 로드
      if (selectedInquiryDetail?.id) {
        // Refresh logic can be implemented here if needed
      }
      cancelEditItem()
    } else {
      toast.error(result.error || '품목 수정 실패')
    }
  }

  // 품목 삭제
  const deleteItem = async (itemId: string) => {
    if (!confirm('이 품목을 삭제하시겠습니까?')) return

    const result = await supportService.deletePurchaseRequestItem(itemId)

    if (result.success) {
      toast.success('품목이 삭제되었습니다.')
      // 목록 새로고침 - 상세 정보가 있다면 다시 로드
      if (selectedInquiryDetail?.id) {
        // Refresh logic can be implemented here if needed
      }
    } else {
      toast.error(result.error || '품목 삭제 실패')
    }
  }

  // 발주요청 전체 삭제
  const deletePurchaseRequest = async () => {
    if (!selectedInquiryDetail?.id) return
    if (!confirm('이 발주요청 전체를 삭제하시겠습니까?\n모든 품목이 함께 삭제됩니다.')) return

    const result = await supportService.deletePurchaseRequest(String(selectedInquiryDetail.id))

    if (result.success) {
      // 🚀 메모리 캐시에서 즉시 삭제 (실시간 반영)
      const memoryUpdated = removePurchaseFromMemory(selectedInquiryDetail.id)
      if (!memoryUpdated) {
        logger.warn('[deletePurchaseRequest] 메모리 캐시에서 발주서 삭제 실패', {
          purchaseId: selectedInquiryDetail.id
        })
      } else {
        logger.info('✅ [deletePurchaseRequest] 메모리 캐시에서 발주서 삭제 성공', {
          purchaseId: selectedInquiryDetail.id
        })
      }

      toast.success('발주요청이 삭제되었습니다.')
      setShowDetailModal(false)
      setSelectedInquiryDetail(null)
      // 문의 목록 새로고침
      loadInquiries()
    } else {
      toast.error(result.error || '발주요청 삭제 실패')
    }
  }

  const handleConfirmDeleteFromPurchaseModal = async () => {
    if (!purchaseToDelete?.id) {
      toast.error('삭제할 발주 정보가 없습니다.')
      return
    }

    const supabase = createClient()

    try {
      const purchaseIdForDelete =
        typeof purchaseToDelete.id === 'string' ? parseInt(purchaseToDelete.id, 10) : purchaseToDelete.id

      if (!purchaseIdForDelete || Number.isNaN(purchaseIdForDelete)) {
        toast.error('발주 ID가 올바르지 않습니다.')
        return
      }

      // 1) 문의 기록 보존: support_inquires에서 purchase_request_id만 null로 변경
      const { error: inquiryUpdateError } = await supabase
        .from('support_inquires')
        .update({ purchase_request_id: null })
        .eq('purchase_request_id', purchaseIdForDelete)

      if (inquiryUpdateError) {
        // 여기서 막지 않고 계속 진행하면 FK로 삭제가 실패할 수 있어 중단하는 편이 안전
        throw inquiryUpdateError
      }

      // 2) 품목 삭제
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchaseIdForDelete)
      if (itemsError) throw itemsError

      // 3) 발주요청 삭제
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchaseIdForDelete)
      if (requestError) throw requestError

      // 4) 메모리 캐시 즉시 반영
      removePurchaseFromMemory(purchaseIdForDelete)

      toast.success('발주요청이 삭제되었습니다. (문의 기록은 보존됩니다)')

      // UI 정리
      setDeleteConfirmOpen(false)
      setPurchaseToDelete(null)
      setPurchaseDetailModalOpen(false)
      setPurchaseDetailId(null)

      // 문의 목록 갱신
      loadInquiries()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleteConfirmOpen(false)
      setPurchaseToDelete(null)
    }
  }

  // 상태 배지 스타일
  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'open':
        return <span className="badge-stats bg-yellow-100 text-yellow-800">대기</span>
      case 'in_progress':
        return <span className="badge-stats bg-blue-100 text-blue-800">처리중</span>
      case 'resolved':
        return <span className="badge-stats bg-green-100 text-green-800">완료</span>
      case 'closed':
        return <span className="badge-stats bg-gray-100 text-gray-800">종료</span>
      default:
        return <span className="badge-stats border border-gray-300 bg-white text-gray-600">-</span>
    }
  }

  // 문의 유형 라벨
  const getInquiryTypeLabel = (type: string) => {
    switch (type) {
      case 'bug': return '오류 신고'
      case 'modify': return '수정 요청'
      case 'delivery_date_change': return '입고일 변경 요청'
      case 'quantity_change': return '수량 변경 요청'
      case 'price_change': return '단가/합계 금액 변경 요청'
      case 'item_add': return '품목 추가 요청'
      case 'delete': return '삭제 요청'
      case 'annual_leave': return '연차 문의'
      case 'attendance': return '근태 문의'
      case 'other': return '기타 문의'
      default: return type
    }
  }

  const renderInquiryPayloadSummary = (inquiry: SupportInquiry) => {
    const payload = inquiry.inquiry_payload as SupportInquiryPayload | null
    if (!payload || typeof payload !== 'object') return null

    if (inquiry.inquiry_type === 'delivery_date_change') {
      const p = payload as { requested_date: string; current_date?: string | null }
      return (
        <div>
          <span className="modal-value text-gray-700">입고일 변경 요청:</span>
          <div className="mt-1 text-gray-600">
            <div>현재 입고요청일: {p.current_date || '-'}</div>
            <div>변경 입고일: {p.requested_date || '-'}</div>
          </div>
        </div>
      )
    }

    if (inquiry.inquiry_type === 'quantity_change') {
      const p = payload as { items: Array<{ item_id: string; line_number?: number | null; item_name: string; specification?: string | null; current_quantity?: number | null; new_quantity: number }> }
      const items = Array.isArray(p.items) ? p.items : []
      if (items.length === 0) return null
      return (
        <div>
          <span className="modal-value text-gray-700">수량 변경 요청:</span>
          <div className="mt-1 text-gray-600 space-y-1">
            {items.map((item, index: number) => (
              <div key={`${item.item_id}-${index}`}>
                {item.line_number ?? '-'}번 {item.item_name} ({item.specification || '-'}) {item.current_quantity ?? '-'} &rarr; {item.new_quantity}
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (inquiry.inquiry_type === 'price_change') {
      const p = payload as { items: Array<{ item_id: string; line_number?: number | null; item_name: string; specification?: string | null; change_type?: 'unit_price' | 'amount'; current_unit_price?: number | null; new_unit_price?: number | null; current_amount?: number | null; new_amount?: number | null }> }
      const items = Array.isArray(p.items) ? p.items : []
      if (items.length === 0) return null
      return (
        <div>
          <span className="modal-value text-gray-700">단가/합계 금액 변경 요청:</span>
          <div className="mt-1 text-gray-600 space-y-1">
            {items.map((item, index: number) => (
              <div key={`${item.item_id}-${index}`}>
                {item.line_number ?? '-'}번 {item.item_name} ({item.specification || '-'}){' '}
                {item.change_type === 'amount'
                  ? `합계 ${item.current_amount ?? '-'} → ${item.new_amount ?? '-'}`
                  : `단가 ${item.current_unit_price ?? '-'} → ${item.new_unit_price ?? '-'} 합계 ${item.current_amount ?? '-'} → ${item.new_amount ?? '-'}`}
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (inquiry.inquiry_type === 'item_add') {
      const p = payload as { items: Array<{ item_name: string; specification?: string | null; quantity: number; unit: string; unit_price: number; remark?: string | null }> }
      const items = Array.isArray(p.items) ? p.items : []
      if (items.length === 0) return null
      return (
        <div>
          <span className="modal-value text-gray-700">품목 추가 요청:</span>
          <div className="mt-1 text-gray-600 space-y-1">
            {items.map((item, index: number) => {
              const amount = item.quantity * item.unit_price
              return (
                <div key={`item-add-${index}`}>
                  {item.item_name} ({item.specification || '-'}) {item.quantity}{item.unit} × {item.unit_price.toLocaleString('ko-KR')} = {amount.toLocaleString('ko-KR')}
                  {item.remark ? ` (${item.remark})` : ''}
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    if (inquiry.inquiry_type === 'delete') {
      const p = payload as { reason?: string; delete_type?: 'all' | 'items'; delete_items?: Array<{ item_id: string; line_number?: number | null; item_name: string; specification?: string | null }> }
      if (!p.reason && !p.delete_type) return null
      const isItemDelete = p.delete_type === 'items'
      const deleteItems = Array.isArray(p.delete_items) ? p.delete_items : []
      return (
        <div>
          <div className="flex items-center gap-2">
            <span className="modal-value text-gray-700">삭제 유형:</span>
            <span className={`badge-stats ${isItemDelete ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>
              {isItemDelete ? '품목별 삭제' : '전체 삭제'}
            </span>
          </div>
          {isItemDelete && deleteItems.length > 0 && (
            <div className="mt-1 text-gray-600 space-y-0.5">
              <span className="modal-label text-gray-500">삭제 대상 품목:</span>
              {deleteItems.map((item, index: number) => (
                <div key={`${item.item_id}-${index}`} className="pl-2 card-description">
                  {item.line_number ?? '-'}번 {item.item_name} ({item.specification || '-'})
                </div>
              ))}
            </div>
          )}
          {p.reason && (
            <div className="mt-1">
              <span className="modal-value text-gray-700">삭제 사유:</span>
              <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{p.reason}</p>
            </div>
          )}
        </div>
      )
    }

    return null
  }

  // 권한 확인 중일 때 로딩 표시
  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">권한 확인 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-none mx-0 px-3 sm:px-4 lg:px-5 pb-6">
        {/* 헤더 */}
        <div className="mb-4">
          <h1 className="page-title text-gray-900">문의하기</h1>
          <p className="page-subtitle text-gray-600 mt-1">
            {isAdmin 
              ? '모든 문의를 관리하고 답변할 수 있습니다'
              : '시스템 사용 중 궁금하신 점이나 개선사항을 알려주세요'}
          </p>
        </div>

        <div className={`${isAdmin ? 'w-full' : 'grid grid-cols-1 xl:grid-cols-2 gap-4'}`}>
          {/* 문의 작성 폼 - superadmin이 아닌 경우에만 표시 */}
          {!isAdmin && (
            <Card className="business-radius-card border border-gray-200 shadow-sm">
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="section-title flex items-center gap-2 text-gray-900">
                  <MessageCircle className="w-4 h-4 text-gray-600" />
                  문의 내용
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block modal-label text-gray-700 mb-1">
                    문의 유형 <span className="text-red-500">*</span>
                  </label>
                  <Select value={inquiryType} onValueChange={setInquiryType}>
                    <SelectTrigger
                      size="sm"
                      className="button-base business-radius-input border border-gray-300 bg-white text-gray-700 w-auto !h-7 !px-2.5 !text-[11px]"
                      style={{ width: `${inquiryTypeControlWidthEm}em`, maxWidth: '100%' }}
                    >
                      <SelectValue placeholder={inquiryTypePlaceholder} />
                    </SelectTrigger>
                    <SelectContent
                      className="text-[11px] business-radius-card"
                      style={{ minWidth: `${inquiryTypeMenuWidthEm}em` }}
                    >
                      {inquiryTypeOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          className="text-[11px] py-1.5"
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 발주요청 선택 */}
                {showPurchaseSelect && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">
                      {purchaseSelectLabel}
                    </div>

                    <div>
                      <label className="modal-label text-gray-600 mb-2 block">직원 선택</label>
                      <ReactSelect
                        value={employeeNameOptions.find(o => o.value === selectedEmployeeName) || null}
                        onChange={(option) => setSelectedEmployeeName((option as { value?: string } | null)?.value || '')}
                        options={employeeNameOptions}
                        placeholder="직원 선택"
                        isSearchable
                        styles={getCompactSelectStyles(180, 200) as StylesConfig<{ value: string; label: string }, false>}
                        menuPortalTarget={document.body}
                      />
                    </div>

                    <div>
                      <label className="modal-label text-gray-600 mb-2 block">기간 선택</label>
                      <DateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                        placeholder="발주요청 기간을 선택하세요"
                        className="inline-grid w-fit"
                        style={{ width: `${dateRangeWidthEm}em`, maxWidth: '100%' }}
                        triggerClassName="button-base w-fit justify-start border border-gray-300 bg-white text-gray-700 business-radius-input !h-[28px] !py-0"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="modal-label text-gray-600">
                          발주요청 선택 (총 {purchaseRequests.length}건)
                        </div>
                        {searchingPurchase && (
                          <span className="badge-text text-gray-400">조회 중…</span>
                        )}
                      </div>
                      <ReactSelect
                        value={purchaseOptions.find(option => option.value === String(selectedPurchase?.id)) || null}
                        onChange={(option) => setSelectedPurchase((option as { data?: typeof selectedPurchase } | null)?.data || null)}
                        options={purchaseOptions}
                        placeholder="발주번호 선택/검색"
                        isSearchable
                        isLoading={searchingPurchase}
                        noOptionsMessage={() => '일치하는 발주가 없습니다'}
                        filterOption={(option, inputValue) => {
                          const keyword = inputValue.toLowerCase()
                          const label = option.label.toLowerCase()
                          const searchText = (option.data as { searchText?: string })?.searchText || ''
                          return label.includes(keyword) || searchText.includes(keyword)
                        }}
                        styles={getCompactSelectStyles(purchaseControlWidthPx, purchaseMenuWidthPx) as StylesConfig<{ value: string; label: string; [key: string]: unknown }, false>}
                      />
                      {!searchingPurchase && purchaseRequests.length === 0 && (
                        <div className="card-description text-gray-500">
                          선택한 기간 내 발주요청이 없습니다.
                        </div>
                      )}

                      {selectedPurchase && (
                        <div className="px-3 py-2 bg-white border border-gray-200 business-radius-card">
                          <div className="flex items-center gap-2">
                            <span className="card-title">{selectedPurchase.purchase_order_number || '(승인대기)'}</span>
                            <span className="card-subtitle">{selectedPurchase.vendor_name}</span>
                            <span className="card-date">
                              {(selectedPurchase.request_date || selectedPurchase.created_at) &&
                                format(new Date((selectedPurchase.request_date || selectedPurchase.created_at)!), 'MM/dd')}
                            </span>
                          </div>
                          {selectedPurchaseItems.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <div className="modal-label text-gray-600">품목 상세</div>
                              {selectedPurchaseItems.map((item, index: number) => (
                                <div key={item.id || index} className="flex items-center gap-2 pl-2">
                                  <span className="card-description text-gray-400">{item.line_number ?? index + 1}.</span>
                                  <span className="card-description">{item.item_name}</span>
                                  {item.specification && (
                                    <span className="card-description text-gray-500">({item.specification})</span>
                                  )}
                                  <span className="card-description text-gray-500">- {item.quantity}개</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {inquiryType === 'delivery_date_change' && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">입고일 변경 요청</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="modal-label text-gray-600 mb-1 block">현재 입고요청일</label>
                        <div className="modal-value text-gray-700">
                          {selectedPurchase?.delivery_request_date
                            ? format(new Date(selectedPurchase.delivery_request_date), 'yyyy-MM-dd')
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <label className="modal-label text-gray-600 mb-1 block">변경 입고일</label>
                        <DatePickerPopover
                          onDateSelect={(date) => setRequestedDeliveryDate(date)}
                          placeholder="변경 입고일 선택"
                          align="start"
                          side="bottom"
                        >
                          <Button
                            type="button"
                            className="button-base w-full justify-start border border-gray-300 bg-white text-gray-700 business-radius-input"
                            disabled={!selectedPurchase}
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {requestedDeliveryDate
                              ? format(requestedDeliveryDate, 'yyyy-MM-dd')
                              : '날짜 선택'}
                          </Button>
                        </DatePickerPopover>
                      </div>
                    </div>
                  </div>
                )}

                {inquiryType === 'quantity_change' && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">수량 변경 요청</div>

                    <div className="space-y-2">
                      {quantityChangeRows.map((row) => {
                        const selectedItem = selectedPurchaseItems.find((item) => String(item.id) === row.itemId)

                        return (
                          <div key={row.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex-1">
                              <ReactSelect
                                value={itemOptions.find(option => option.value === row.itemId) || null}
                                onChange={(option) => updateQuantityRow(row.id, { itemId: (option as { value?: string } | null)?.value || '' })}
                                options={itemOptions}
                                placeholder="품목 선택/검색"
                                isSearchable
                                isDisabled={!selectedPurchase}
                                noOptionsMessage={() => '일치하는 품목이 없습니다'}
                                filterOption={(option, inputValue) =>
                                  option.label.toLowerCase().includes(inputValue.toLowerCase())
                                }
                                styles={getCompactSelectStyles(itemControlWidthPx, itemMenuWidthPx) as StylesConfig<{ value: string; label: string }, false>}
                              />
                            </div>
                            <div className="badge-text text-gray-600 sm:w-24 text-right">
                              변경 수량 :
                            </div>
                            <Input
                              type="number"
                              value={row.newQuantity}
                              onChange={(e) => updateQuantityRow(row.id, { newQuantity: e.target.value })}
                              placeholder={`입고 수량 : ${selectedItem?.quantity ?? '-'}`}
                              className="sm:w-28 business-radius-input h-7 !text-[11px] !leading-tight"
                              min={0}
                              disabled={!selectedPurchase}
                            />
                            <button
                              type="button"
                              onClick={() => removeQuantityRow(row.id)}
                              className="button-action-danger"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              삭제
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addQuantityRow}
                        className="button-action-secondary"
                        disabled={!selectedPurchase}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        품목 추가
                      </button>
                      <button
                        type="button"
                        onClick={addAllQuantityRows}
                        className="button-action-secondary"
                        disabled={!selectedPurchase || selectedPurchaseItems.length === 0}
                      >
                        <ListPlus className="w-3.5 h-3.5 mr-1" />
                        전체 품목 추가
                      </button>
                    </div>
                  </div>
                )}

                {inquiryType === 'price_change' && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">단가/합계 금액 변경 요청</div>

                    <div className="space-y-2">
                      {priceChangeRows.map((row) => {
                        const selectedItem = selectedPurchaseItems.find((item) => String(item.id) === row.itemId)
                        const currentUnitPrice = Number(selectedItem?.unit_price_value ?? selectedItem?.unit_price ?? 0)
                        const currentAmount = Number(selectedItem?.amount_value ?? (currentUnitPrice * (selectedItem?.quantity ?? 0)))
                        const currentUnitPriceLabel = selectedItem ? currentUnitPrice.toLocaleString('ko-KR') : '-'
                        const currentAmountLabel = selectedItem ? currentAmount.toLocaleString('ko-KR') : '-'
                        const placeholderText = row.changeType === 'amount'
                          ? `현재 합계액: ${currentAmountLabel}`
                          : `현재 단가: ${currentUnitPriceLabel}`

                        return (
                          <div key={row.id} className="flex flex-col lg:flex-row lg:items-center gap-2">
                            <div className="flex-1">
                              <ReactSelect
                                value={itemOptions.find(option => option.value === row.itemId) || null}
                                onChange={(option) => updatePriceRow(row.id, { itemId: (option as { value?: string } | null)?.value || '' })}
                                options={itemOptions}
                                placeholder="품목 선택/검색"
                                isSearchable
                                isDisabled={!selectedPurchase}
                                noOptionsMessage={() => '일치하는 품목이 없습니다'}
                                filterOption={(option, inputValue) =>
                                  option.label.toLowerCase().includes(inputValue.toLowerCase())
                                }
                                styles={getCompactSelectStyles(itemControlWidthPx, itemMenuWidthPx) as StylesConfig<{ value: string; label: string }, false>}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="badge-text text-gray-600">변경 요청</span>
                              <Select
                                value={row.changeType}
                                onValueChange={(value) =>
                                  updatePriceRow(row.id, { changeType: value as PriceChangeType, newValue: '' })
                                }
                                disabled={!selectedPurchase}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="button-base business-radius-input border border-gray-300 bg-white text-gray-700 w-auto !h-7 !px-2.5 !text-[11px]"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="text-[11px] business-radius-card">
                                  {priceChangeTypeOptions.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      className="text-[11px] py-1.5"
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={formatNumericInput(row.newValue)}
                              onChange={(e) => updatePriceRow(row.id, { newValue: normalizeNumericInput(e.target.value) })}
                              placeholder={placeholderText}
                              className="lg:w-40 business-radius-input h-7 !text-[11px] !leading-tight"
                              min={0}
                              disabled={!selectedPurchase}
                            />
                            <button
                              type="button"
                              onClick={() => removePriceRow(row.id)}
                              className="button-action-danger"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              삭제
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={addPriceRow}
                      className="button-action-secondary"
                      disabled={!selectedPurchase}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      품목 추가
                    </button>
                  </div>
                )}

                {inquiryType === 'item_add' && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">품목 추가 요청</div>

                    <div className="space-y-2">
                      {itemAddRows.map((row) => (
                        <div key={row.id} className="flex flex-col lg:flex-row lg:items-center gap-2">
                          <div className="flex-[2] min-w-0">
                            <Input
                              type="text"
                              value={row.itemName}
                              onChange={(e) => updateItemAddRow(row.id, { itemName: e.target.value })}
                              placeholder="품목명 *"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <div className="flex-[2] min-w-0">
                            <Input
                              type="text"
                              value={row.specification}
                              onChange={(e) => updateItemAddRow(row.id, { specification: e.target.value })}
                              placeholder="규격"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <div className="flex-[1] min-w-0">
                            <Input
                              type="number"
                              value={row.quantity}
                              onChange={(e) => updateItemAddRow(row.id, { quantity: e.target.value })}
                              placeholder="수량 *"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              min={1}
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <div className="flex-[1] min-w-0">
                            <Input
                              type="text"
                              value={row.unit}
                              onChange={(e) => updateItemAddRow(row.id, { unit: e.target.value })}
                              placeholder="단위"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <div className="flex-[1.5] min-w-0">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={formatNumericInput(row.unitPrice)}
                              onChange={(e) => updateItemAddRow(row.id, { unitPrice: normalizeNumericInput(e.target.value) })}
                              placeholder="단가 *"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <div className="flex-[1.5] min-w-0">
                            <Input
                              type="text"
                              value={row.remark}
                              onChange={(e) => updateItemAddRow(row.id, { remark: e.target.value })}
                              placeholder="비고"
                              className="w-full business-radius-input h-7 !text-[11px] !leading-tight"
                              disabled={!selectedPurchase}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItemAddRow(row.id)}
                            className="button-action-danger shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={addItemAddRow}
                      className="button-action-secondary"
                      disabled={!selectedPurchase}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      품목 추가
                    </button>
                  </div>
                )}

                {inquiryType === 'delete' && selectedPurchase && (
                  <div className="space-y-3 p-4 bg-gray-50 business-radius-card border border-gray-200">
                    <div className="modal-section-title text-gray-900">삭제 유형 선택</div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setDeleteType('all'); setDeleteItemIds([]) }}
                        className={`button-base border ${deleteType === 'all'
                          ? 'border-red-400 bg-red-50 text-red-700'
                          : 'border-gray-300 bg-white text-gray-600'}`}
                      >
                        발주 전체 삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteType('items')}
                        className={`button-base border ${deleteType === 'items'
                          ? 'border-red-400 bg-red-50 text-red-700'
                          : 'border-gray-300 bg-white text-gray-600'}`}
                      >
                        품목별 삭제
                      </button>
                    </div>

                    {deleteType === 'items' && selectedPurchaseItems.length > 0 && (
                      <div className="space-y-1.5 mt-2">
                        <div className="modal-label text-gray-600">삭제할 품목 선택</div>
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (deleteItemIds.length === selectedPurchaseItems.length) {
                                setDeleteItemIds([])
                              } else {
                                setDeleteItemIds(selectedPurchaseItems.map((item) => String(item.id)))
                              }
                            }}
                            className="button-base border border-gray-300 bg-white text-gray-600"
                          >
                            {deleteItemIds.length === selectedPurchaseItems.length ? '전체 해제' : '전체 선택'}
                          </button>
                          {deleteItemIds.length > 0 && (
                            <span className="badge-text text-red-600">{deleteItemIds.length}개 선택됨</span>
                          )}
                        </div>
                        {selectedPurchaseItems.map((item, index: number) => {
                          const itemId = String(item.id)
                          const isChecked = deleteItemIds.includes(itemId)
                          return (
                            <label
                              key={itemId}
                              className={`flex items-center gap-2 px-3 py-2 border business-radius-card cursor-pointer transition-colors ${
                                isChecked
                                  ? 'border-red-300 bg-red-50'
                                  : 'border-gray-200 bg-white hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setDeleteItemIds(prev =>
                                    isChecked
                                      ? prev.filter(id => id !== itemId)
                                      : [...prev, itemId]
                                  )
                                }}
                                className="w-3.5 h-3.5 accent-red-500"
                              />
                              <span className="card-description text-gray-400">{item.line_number ?? index + 1}.</span>
                              <span className="card-description">{item.item_name}</span>
                              {item.specification && (
                                <span className="card-description text-gray-500">({item.specification})</span>
                              )}
                              <span className="card-description text-gray-500">- {item.quantity}개</span>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {deleteType === 'all' && (
                      <div className="badge-text text-red-500 bg-red-50 border border-red-200 business-radius-card px-3 py-2">
                        발주요청과 모든 품목이 함께 삭제됩니다.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block modal-label text-gray-700 mb-1">
                    {messageLabel} <span className="text-red-500">*</span>
                  </label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={inquiryType === 'delete' ? '삭제 사유를 입력해주세요' : '문의 내용을 자세히 입력해주세요'}
                    rows={6}
                    maxLength={1000}
                    className="business-radius-input text-[11px]"
                  />
                  <p className="badge-text text-gray-500 mt-1">
                    {message.length}/1000
                  </p>
                </div>

                {/* 사진 첨부 영역 */}
                <div>
                  <label className="block modal-label text-gray-700 mb-2">
                    사진 첨부 <span className="badge-text text-gray-400">(선택, 최대 5개)</span>
                  </label>
                  
                  {/* 첨부된 이미지 미리보기 */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {attachments.map((attachment, index) => (
                        <div key={index} className="relative group">
                          <img
                            src={attachment.url}
                            alt={attachment.name}
                            className="w-20 h-20 object-cover business-radius-card border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(index)}
                            className="button-base absolute -top-2 -right-2 bg-red-500 text-white business-radius-badge opacity-0 group-hover:opacity-100 transition-opacity"
                            title="삭제"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <p className="text-[10px] text-gray-500 mt-1 truncate w-20 text-center">
                            {attachment.name}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* 이미지 추가 버튼 */}
                  {attachments.length < 5 && (
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="button-action-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {uploadingImage ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            업로드 중...
                          </>
                        ) : (
                          <>
                            <ImagePlus className="w-3.5 h-3.5" />
                            사진 추가
                          </>
                        )}
                      </button>
                      <span className="badge-text text-gray-400">
                        {attachments.length}/5
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="button-action-primary"
                    disabled={loading || uploadingImage}
                    onClick={() => {
                    }}
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        전송 중...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        문의 보내기
                      </>
                    )}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
          )}

          {/* 문의 목록 */}
          <Card className="business-radius-card border border-gray-200 shadow-sm">
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="section-title flex items-center justify-between text-gray-900">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  {isAdmin ? '전체 문의 목록' : '내 문의 내역'}
                </span>
                <span className="badge-stats border border-gray-300 bg-white text-gray-600">
                  {inquiries.length}건
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loadingInquiries ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : inquiries.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="card-description text-gray-500">문의 내역이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {inquiries.map((inquiry) => (
                    <div key={inquiry.id!} className="border border-gray-200 business-radius-card overflow-hidden bg-white">
                      {/* 문의 요약 (한 줄) */}
                      <div 
                        className="px-4 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => {
                          setExpandedInquiry(expandedInquiry === inquiry.id ? null : inquiry.id!)
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0 flex-nowrap">
                            <span className="badge-stats border border-gray-300 bg-white text-gray-600 whitespace-nowrap flex-shrink-0">
                              {getInquiryTypeLabel(inquiry.inquiry_type)}
                            </span>
                            <span className="flex-shrink-0">{getStatusBadge(inquiry.status)}</span>
                            <span className="card-title truncate flex-1 min-w-0">
                              {inquiry.purchase_order_number ? (
                                <button
                                  type="button"
                                  className="text-blue-600 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openPurchaseDetailFromInquiry(inquiry)
                                  }}
                                  title="발주 상세 열기"
                                >
                                  {inquiry.purchase_order_number}
                                </button>
                              ) : (
                                inquiry.subject
                              )}
                            </span>
                            {isAdmin && (
                              <span className="badge-text text-gray-500 whitespace-nowrap flex-shrink-0">
                                {inquiry.user_name || inquiry.user_email}
                              </span>
                            )}
                            <span className="badge-text text-gray-400 ml-auto whitespace-nowrap flex-shrink-0">
                              {inquiry.created_at && format(new Date(inquiry.created_at), 'MM/dd HH:mm')}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isAdmin && inquiry.status === 'open' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStatusUpdate(inquiry.id!, 'in_progress')
                                }}
                                className="button-waiting-active"
                              >
                                처리중
                              </button>
                            )}
                            {isAdmin && (inquiry.status === 'open' || inquiry.status === 'in_progress') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStatusUpdate(inquiry.id!, 'resolved')
                                }}
                                className="button-action-success"
                              >
                                완료
                              </button>
                            )}
                            {/* 삭제 버튼 - 관리자는 모든 문의 삭제 가능, 일반 사용자는 본인의 open 상태만 */}
                            {(isAdmin || (inquiry.status === 'open' && !inquiry.resolution_note && inquiry.user_email === currentUserEmail)) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteInquiry(inquiry.id!)
                                }}
                                className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                title="문의 삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="button-action-secondary"
                            >
                              {expandedInquiry === inquiry.id ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* 상세 내역 */}
                      {expandedInquiry === inquiry.id && (
                        <div className="px-3 py-3 bg-gray-50 border-t">
                          <div className="space-y-2">
                            <div>
                              <span className="modal-value text-gray-700">내용:</span>
                              <p className="card-description text-gray-600 mt-1 whitespace-pre-wrap">{inquiry.message}</p>
                            </div>
                            {renderInquiryPayloadSummary(inquiry)}
                            {inquiry.handled_by && (
                              <div>
                                <span className="modal-value text-gray-700">처리자:</span>
                                <span className="text-green-600 ml-2">
                                  {inquiry.handled_by}
                                  {inquiry.processed_at && ` (${format(new Date(inquiry.processed_at), 'yyyy-MM-dd HH:mm')})`}
                                </span>
                              </div>
                            )}
                            {/* 첨부 이미지 */}
                            {inquiry.attachments && inquiry.attachments.length > 0 && (
                              <div>
                                <span className="modal-value text-gray-700">첨부 이미지:</span>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {inquiry.attachments.map((attachment, index) => (
                                    <a
                                      key={index}
                                      href={attachment.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <img
                                        src={attachment.url}
                                        alt={attachment.name}
                                        className="w-24 h-24 object-cover business-radius-card border border-gray-200 hover:border-blue-400 transition-colors cursor-pointer"
                                      />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 대화(드롭다운) */}
                            <div className="mt-3 border-t pt-3">
                              <div className="flex items-center justify-between">
                                <div className="modal-value text-gray-800">대화</div>
                                {isAdmin && inquiry.status !== 'resolved' && inquiry.status !== 'closed' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleResolveFromChat()
                                    }}
                                    className="button-action-success"
                                  >
                                    완료
                                  </button>
                                )}
                              </div>

                              <div className="mt-2 border border-gray-200 business-radius-card bg-white relative">
                                {chatRefreshing && (
                                  <div
                                    className="absolute top-2 right-2 badge-text text-gray-400 bg-white/80 backdrop-blur px-2 py-1 business-radius-badge border pointer-events-none"
                                    aria-hidden="true"
                                  >
                                    업데이트 중…
                                  </div>
                                )}
                                <div ref={chatScrollRef} className="max-h-[260px] overflow-y-auto p-3 space-y-2">
                                  {chatLoading && chatMessages.length === 0 ? (
                                    <div className="flex items-center justify-center py-8">
                                      <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                  ) : chatMessages.length === 0 ? (
                                    <div className="text-center text-gray-500 py-8 card-description">
                                      대화 내용이 없습니다.
                                    </div>
                                  ) : (
                                    chatMessages.map((m) => {
                                      const isSystem = m.sender_role === 'system'
                                      const isMine = !isSystem && m.sender_email === currentUserEmail
                                      return (
                                        <div key={m.id} className={isSystem ? 'text-center' : `flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                          <div className={isSystem ? 'inline-block badge-text text-gray-500 px-3 py-1 business-radius-badge bg-gray-50 border' : `max-w-[80%] business-radius-card px-3 py-2 ${isMine ? 'bg-blue-600 text-white' : 'bg-gray-50 border text-gray-800'}`}>
                                            {!isSystem && (
                                              <div className={`badge-text mb-1 ${isMine ? 'text-white/80' : 'text-gray-500'}`}>
                                                {m.sender_role === 'admin' ? '관리자' : '문의자'}
                                                {m.created_at && ` · ${format(new Date(m.created_at), 'MM/dd HH:mm')}`}
                                              </div>
                                            )}
                                            <div className={`whitespace-pre-wrap text-[10px] ${isMine ? 'text-white' : 'text-gray-800'}`} style={{ letterSpacing: '0.02em' }}>{m.message}</div>
                                            {m.attachments && m.attachments.length > 0 && (
                                              <div className="flex flex-wrap gap-2 mt-2">
                                                {m.attachments.map((a, idx) => (
                                                  <a
                                                    key={idx}
                                                    href={a.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block"
                                                    onClick={(e) => e.stopPropagation()}
                                                  >
                                                    <img
                                                      src={a.url}
                                                      alt={a.name}
                                                      className="w-20 h-20 object-cover business-radius-card border"
                                                    />
                                                  </a>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })
                                  )}
                                </div>

                                <div className="border-t p-2">
                                  {(inquiry.status === 'resolved' || inquiry.status === 'closed') ? (
                                    <div className="card-description text-gray-500 text-center py-1">
                                      완료된 문의입니다. 추가 대화가 필요하면 새 문의를 등록해주세요.
                                    </div>
                                  ) : (
                                    <div className="flex items-end gap-2">
                                      <Textarea
                                        value={chatText}
                                        onChange={(e) => setChatText(e.target.value)}
                                        placeholder="메시지를 입력하세요"
                                        rows={2}
                                        maxLength={1000}
                                        disabled={chatSending}
                                        onClick={(e) => e.stopPropagation()}
                                        className="business-radius-input text-[11px]"
                                      />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleSendChat()
                                        }}
                                        disabled={chatSending || !chatText.trim()}
                                        className="button-action-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {chatSending ? '전송중' : '전송'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 발주요청 상세 모달 */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto business-radius-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between modal-title text-gray-900">
              <div className="flex items-center gap-2">
                <span>발주요청 상세</span>
                {selectedInquiryDetail?.purchase_order_number && (
                  <span className="badge-stats border border-gray-300 bg-white text-gray-600 font-normal">
                    {selectedInquiryDetail.purchase_order_number}
                  </span>
                )}
              </div>
              {isAdmin && selectedInquiryDetail && (
                <Button
                  onClick={deletePurchaseRequest}
                  className="button-action-danger"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  전체 삭제
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {loadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedInquiryDetail && (
            <div className="space-y-6">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 border border-gray-200 business-radius-card">
                <div>
                  <span className="modal-label text-gray-500">발주번호</span>
                  <p className="modal-value mt-1">{selectedInquiryDetail.purchase_order_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="modal-label text-gray-500">업체명</span>
                  <p className="modal-value mt-1">{selectedInquiryDetail.vendor_name}</p>
                </div>
                <div>
                  <span className="modal-label text-gray-500">요청자</span>
                  <p className="modal-value mt-1">{selectedInquiryDetail.requester_name}</p>
                </div>
                <div>
                  <span className="modal-label text-gray-500">요청일</span>
                  <p className="modal-value mt-1">
                    {selectedInquiryDetail.request_date && 
                      format(new Date(selectedInquiryDetail.request_date), 'yyyy-MM-dd')}
                  </p>
                </div>
              </div>

              {/* 품목 목록 - 개선된 디자인 */}
              <div>
                <h3 className="modal-section-title mb-3">품목 상세</h3>
                <div className="border border-gray-200 business-radius-card overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left badge-text modal-value text-gray-700 px-3 py-3 w-12">번호</th>
                        <th className="text-left badge-text modal-value text-gray-700 px-3 py-3 min-w-[180px]">품명</th>
                        <th className="text-left badge-text modal-value text-gray-700 px-3 py-3 min-w-[150px]">규격</th>
                        <th className="text-center badge-text modal-value text-gray-700 px-3 py-3 w-20">수량</th>
                        <th className="text-right badge-text modal-value text-gray-700 px-3 py-3 w-28">단가</th>
                        <th className="text-right badge-text modal-value text-gray-700 px-3 py-3 w-32">금액</th>
                        <th className="text-left badge-text modal-value text-gray-700 px-3 py-3 min-w-[150px]">비고</th>
                        <th className="text-center badge-text modal-value text-gray-700 px-3 py-3 w-16">링크</th>
                        {isAdmin && <th className="text-center badge-text modal-value text-gray-700 px-3 py-3 w-24">작업</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {selectedInquiryDetail.purchase_request_items?.map((item, index: number) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-center modal-value text-gray-600">
                            {item.line_number || index + 1}
                          </td>
                          <td className="px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                value={editingItem?.item_name || ''}
                                onChange={(e) => setEditingItem(editingItem ? {...editingItem, item_name: e.target.value} : null)}
                                className="business-radius-input h-7 text-[11px] w-full"
                                autoFocus
                              />
                            ) : (
                              <span className="modal-value text-gray-900">{item.item_name}</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                value={editingItem?.specification || ''}
                                onChange={(e) => setEditingItem(editingItem ? {...editingItem, specification: e.target.value} : null)}
                                className="business-radius-input h-7 text-[11px] w-full"
                              />
                            ) : (
                              <span className="text-gray-600">{item.specification || '-'}</span>
                            )}
                          </td>
                          <td className="text-center px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                type="number"
                                value={editingItem?.quantity || ''}
                                onChange={(e) => setEditingItem(editingItem ? {...editingItem, quantity: parseInt(e.target.value)} : null)}
                                className="business-radius-input h-7 text-[11px] text-center w-full"
                              />
                            ) : (
                              <span className="modal-value">{item.quantity}</span>
                            )}
                          </td>
                          <td className="text-right px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                type="number"
                                value={editingItem?.unit_price_value || ''}
                                onChange={(e) => setEditingItem(editingItem ? {...editingItem, unit_price_value: parseInt(e.target.value)} : null)}
                                className="business-radius-input h-7 text-[11px] text-right w-full"
                              />
                            ) : (
                              <span className="modal-value">
                                {item.unit_price_value ? `${parseFloat(String(item.unit_price_value)).toLocaleString()}` : '-'}
                              </span>
                            )}
                          </td>
                          <td className="text-right px-3 py-3">
                            {editingItemId === item.id ? (
                              <span className="font-semibold text-blue-600">
                                {((editingItem?.quantity || 0) * (editingItem?.unit_price_value || 0)).toLocaleString()}
                              </span>
                            ) : (
                              <span className="font-semibold text-blue-600">
                                {item.amount_value ? `${parseFloat(String(item.amount_value)).toLocaleString()}` : '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {editingItemId === item.id ? (
                              <Textarea
                                value={editingItem?.remark || ''}
                                onChange={(e) => setEditingItem(editingItem ? {...editingItem, remark: e.target.value} : null)}
                                className="business-radius-input h-7 text-[11px] w-full resize-none"
                                rows={1}
                              />
                            ) : (
                              <span className="text-gray-600 badge-text">{item.remark || '-'}</span>
                            )}
                          </td>
                          <td className="text-center px-3 py-3">
                            {item.link ? (
                              <a 
                                href={item.link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="inline-flex items-center justify-center w-8 h-8 business-radius-badge hover:bg-blue-50 text-blue-600"
                              >
                                <Eye className="w-4 h-4" />
                              </a>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="text-center px-3 py-3">
                              {editingItemId === item.id ? (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    onClick={() => saveEditItem(String(item.id))}
                                      className="button-action-success"
                                  >
                                    <Save className="w-4 h-4 mr-1" />
                                    저장
                                  </Button>
                                  <Button
                                    onClick={cancelEditItem}
                                      className="button-action-secondary"
                                  >
                                    취소
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    onClick={() => startEditItem(item)}
                                      className="button-action-secondary"
                                  >
                                    <Edit2 className="w-4 h-4 text-blue-600" />
                                  </Button>
                                  <Button
                                    onClick={() => deleteItem(String(item.id))}
                                      className="button-action-danger"
                                  >
                                    <Trash2 className="w-4 h-4 text-red-600" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2">
                      <tr>
                        <td colSpan={5} className="modal-value text-right px-3 py-3">
                          합계
                        </td>
                        <td className="modal-value text-right px-3 py-3 text-blue-600">
                          {selectedInquiryDetail.purchase_request_items
                            ?.reduce((sum: number, item: { amount_value?: number | string }) => sum + (parseFloat(String(item.amount_value)) || 0), 0)
                            .toLocaleString()}
                        </td>
                        <td colSpan={isAdmin ? 3 : 2} className="px-3 py-3"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* 비고 */}
              {selectedInquiryDetail.notes && (
                <div>
                  <h3 className="modal-section-title mb-2">비고</h3>
                  <p className="card-description text-gray-600 p-3 bg-gray-50 border border-gray-200 business-radius-card">
                    {selectedInquiryDetail.notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 전체항목 탭 상세모달(재사용) */}
      <PurchaseDetailModal
        purchaseId={purchaseDetailId}
        isOpen={purchaseDetailModalOpen}
        onClose={() => {
          setPurchaseDetailModalOpen(false)
          setPurchaseDetailId(null)
        }}
        currentUserRoles={currentUserRoles}
        activeTab="done"
        onDelete={(purchase) => {
          setPurchaseToDelete({ id: Number(purchase.id), purchase_order_number: purchase.purchase_order_number })
          setDeleteConfirmOpen(true)
        }}
      />

      {/* 삭제 확인 다이얼로그 (PurchaseDetailModal 연동) */}
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open)
          if (!open) setPurchaseToDelete(null)
        }}
      >
        <AlertDialogContent className="business-radius-modal">
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">발주요청 내역 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              발주요청번호 <strong>{purchaseToDelete?.purchase_order_number || '알 수 없음'}</strong>를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="button-action-secondary">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteFromPurchaseModal}
              className="button-action-danger"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 삭제/없음 안내 모달 (문의에서 발주를 못 찾는 경우) */}
      <Dialog open={purchaseMissingOpen} onOpenChange={setPurchaseMissingOpen}>
        <DialogContent
          showCloseButton={false}
          maxWidth="sm:max-w-md"
          className="p-0 overflow-hidden business-radius-modal"
        >
          <div className="px-8 py-10 text-center">
            <div className="modal-title text-gray-900">안내</div>
            <div className="mt-4 modal-value text-gray-700 whitespace-pre-wrap">
              {purchaseMissingMessage}
            </div>
            <div className="mt-6 badge-text text-gray-400">
              화면을 클릭하거나 ESC로 닫을 수 있습니다.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}