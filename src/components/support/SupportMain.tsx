import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MessageCircle, Send, Calendar, Search, CheckCircle, Clock, AlertCircle, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Eye, X, Edit2, Trash2, Save } from 'lucide-react'
import { supportService, type SupportInquiry } from '@/services/supportService'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { removePurchaseFromMemory } from '@/stores/purchaseMemoryStore'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
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
import { DateRange } from 'react-day-picker'
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'

export default function SupportMain() {
  const [inquiryType, setInquiryType] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  
  // 발주요청 선택 관련
  const [showPurchaseSelect, setShowPurchaseSelect] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([])
  const [selectedPurchase, setSelectedPurchase] = useState<any>(null)
  const [searchingPurchase, setSearchingPurchase] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null)
  const itemsPerPage = 5
  
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
  const [selectedInquiryDetail, setSelectedInquiryDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<any>(null)

  // 전체항목 탭 상세모달(PurchaseDetailModal) 재사용
  const [purchaseDetailModalOpen, setPurchaseDetailModalOpen] = useState(false)
  const [purchaseDetailId, setPurchaseDetailId] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [purchaseToDelete, setPurchaseToDelete] = useState<any>(null)
  const [purchaseMissingOpen, setPurchaseMissingOpen] = useState(false)
  const [purchaseMissingMessage, setPurchaseMissingMessage] = useState('발주내역이 삭제 되었거나 없습니다.')

  // 초기 데이터 로드
  useEffect(() => {
    const init = async () => {
      await checkUserRole()
    }
    init()
    
    // 실시간 구독 설정
    const subscription = supportService.subscribeToInquiries((payload) => {
      // isAdmin 확인 전에는 처리하지 않음
      if (isAdmin === null) return

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
  }, [isAdmin, currentUserId, expandedInquiry])

  // 사용자 권한 확인
  const checkUserRole = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setCurrentUserEmail(user.email || '')
    setCurrentUserId(user.id)

    const { data: employee } = await supabase
      .from('employees')
      .select('purchase_role')
      .eq('email', user.email)
      .single()

    if (employee) {
      const roles = Array.isArray(employee.purchase_role)
        ? employee.purchase_role
        : employee.purchase_role?.split(',').map((r: string) => r.trim()) || []
      
      setCurrentUserRoles(roles)
      const adminStatus = roles.includes('app_admin')
      setIsAdmin(adminStatus)
      
      // 권한 확인 후 바로 목록 로드
      loadInquiriesWithRole(adminStatus)
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
    }
    
    setLoadingInquiries(false)
  }

  // 문의 유형 변경 시
  useEffect(() => {
    if (inquiryType === 'modify' || inquiryType === 'delete') {
      setShowPurchaseSelect(true)
    } else {
      setShowPurchaseSelect(false)
      setSelectedPurchase(null)
    }
  }, [inquiryType])

  // 발주요청 검색
  const searchPurchaseRequests = async () => {
    setSearchingPurchase(true)
    setCurrentPage(1) // 검색 시 첫 페이지로 리셋
    
    const startDate = dateRange?.from ? dateRange.from.toISOString().split('T')[0] : undefined
    const endDate = dateRange?.to ? dateRange.to.toISOString().split('T')[0] : undefined
    
    const result = await supportService.getMyPurchaseRequests(startDate, endDate)
    
    if (result.success) {
      setPurchaseRequests(result.data)
    } else {
      toast.error(result.error || '발주요청 조회 실패')
    }
    
    setSearchingPurchase(false)
  }

  // 페이지네이션 계산
  const totalPages = Math.ceil(purchaseRequests.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentPurchaseRequests = purchaseRequests.slice(startIndex, endIndex)

  // 문의 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!inquiryType || !subject || !message) {
      toast.error('모든 필드를 입력해주세요.')
      return
    }
    
    // 수정/삭제 요청인데 발주를 선택하지 않은 경우
    if ((inquiryType === 'modify' || inquiryType === 'delete') && !selectedPurchase) {
      toast.error('수정/삭제할 발주요청을 선택해주세요.')
      return
    }

    setLoading(true)
    
    // 발주 정보를 텍스트로 구성
    let finalMessage = message;
    let purchaseInfo = '';
    
    if (selectedPurchase) {
      const items = selectedPurchase.purchase_request_items || [];
      const itemsText = items.map((item: any) => 
        `- ${item.item_name} (${item.specification}) ${item.quantity}개`
      ).join('\n');
      
      const poNumberText = selectedPurchase.purchase_order_number || '(승인대기)'
      purchaseInfo = `발주번호: ${selectedPurchase.purchase_order_number}
업체: ${selectedPurchase.vendor_name}
요청자: ${selectedPurchase.requester_name}
요청일: ${selectedPurchase.request_date}
품목:
${itemsText}`;
      purchaseInfo = `발주번호: ${poNumberText}
업체: ${selectedPurchase.vendor_name}
요청자: ${selectedPurchase.requester_name}
요청일: ${selectedPurchase.request_date || selectedPurchase.created_at || '-'}
품목:
${itemsText}`;

      finalMessage = `${message}

[관련 발주 정보]
${purchaseInfo}`;
    }

    const result = await supportService.createInquiry({
      inquiry_type: inquiryType as any,
      subject,
      message: finalMessage,
      purchase_request_id: selectedPurchase?.id,
      purchase_info: purchaseInfo,
      purchase_order_number: selectedPurchase?.purchase_order_number
    })

    if (result.success) {
      toast.success('문의가 접수되었습니다.')
      // 폼 초기화
      setInquiryType('')
      setSubject('')
      setMessage('')
      setSelectedPurchase(null)
      setPurchaseRequests([])
      setDateRange(undefined)
      // 목록 새로고침
      loadInquiries()
    } else {
      toast.error(result.error || '문의 접수에 실패했습니다.')
    }
    
    setLoading(false)
  }

  // 문의 상태 업데이트 (관리자용)
  const handleStatusUpdate = async (inquiryId: number, newStatus: 'in_progress' | 'resolved' | 'closed', resolutionNote?: string) => {
    // resolved 상태로 변경 시 답변 내용 확인
    if (newStatus === 'resolved') {
      const note = resolutionNote || prompt('처리 완료 답변을 입력해주세요:')
      if (!note || note.trim() === '') {
        toast.error('답변 내용을 입력해야 완료 처리할 수 있습니다.')
        return
      }
      
      const result = await supportService.updateInquiryStatus(inquiryId, newStatus, note.trim())
      
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
  const startEditItem = (item: any) => {
    setEditingItemId(item.id)
    setEditingItem({
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

    const result = await supportService.deletePurchaseRequest(selectedInquiryDetail.id)

    if (result.success) {
      // 🚀 메모리 캐시에서 즉시 삭제 (실시간 반영)
      const memoryUpdated = removePurchaseFromMemory(selectedInquiryDetail.id)
      if (!memoryUpdated) {
        console.warn('[deletePurchaseRequest] 메모리 캐시에서 발주서 삭제 실패', { 
          purchaseId: selectedInquiryDetail.id 
        })
      } else {
        console.info('✅ [deletePurchaseRequest] 메모리 캐시에서 발주서 삭제 성공', { 
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
      case 'delete': return '삭제 요청'
      case 'other': return '기타 문의'
      default: return type
    }
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
      <div className="w-full">
        {/* 헤더 */}
        <div className="mb-4">
          <h1 className="page-title text-gray-900">문의하기</h1>
          <p className="page-subtitle text-gray-600 mt-1">
            {isAdmin 
              ? '모든 문의를 관리하고 답변할 수 있습니다'
              : '시스템 사용 중 궁금하신 점이나 개선사항을 알려주세요'}
          </p>
        </div>

        <div className={`${isAdmin ? 'max-w-4xl' : 'grid grid-cols-1 xl:grid-cols-2 gap-4'}`}>
          {/* 문의 작성 폼 - app_admin이 아닌 경우에만 표시 */}
          {!isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  문의 내용
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block modal-label text-gray-700 mb-1">
                    문의 유형 <span className="text-red-500">*</span>
                  </label>
                  <Select value={inquiryType} onValueChange={setInquiryType}>
                    <SelectTrigger>
                      <SelectValue placeholder="문의 유형을 선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bug">오류 신고</SelectItem>
                      <SelectItem value="modify">수정 요청</SelectItem>
                      <SelectItem value="delete">삭제 요청</SelectItem>
                      <SelectItem value="other">기타 문의</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 수정/삭제 요청 시 발주요청 선택 */}
                {showPurchaseSelect && (
                  <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="modal-label text-blue-900">
                      수정/삭제할 발주요청 선택
                    </div>
                    
                    <div>
                      <label className="modal-label text-gray-600 mb-2 block">기간 선택</label>
                      <DateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                        placeholder="발주요청 기간을 선택하세요"
                        className="w-full"
                      />
                    </div>
                    
                    <Button
                      type="button"
                      onClick={searchPurchaseRequests}
                      disabled={searchingPurchase}
                      className="w-full h-9"
                      variant="outline"
                    >
                      {searchingPurchase ? (
                        <>
                          <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-2" />
                          검색 중...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          발주요청 검색
                        </>
                      )}
                    </Button>
                    
                    {purchaseRequests.length > 0 && (
                      <div className="space-y-3">
                        <div className="modal-label text-gray-600">
                          발주요청 선택 (총 {purchaseRequests.length}건)
                        </div>
                        
                        {/* 발주요청 리스트 */}
                        <div className="space-y-1">
                          {currentPurchaseRequests.map((pr) => (
                            <div key={pr.id} className="border rounded overflow-hidden">
                              <div
                                onClick={() => setSelectedPurchase(pr)}
                                className={`px-3 py-2 cursor-pointer transition-all badge-text ${
                                  selectedPurchase?.id === pr.id
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="modal-value whitespace-nowrap">
                                      {pr.purchase_order_number || '(승인대기)'}
                                    </span>
                                    {(pr.final_manager_status && pr.final_manager_status !== 'approved') && (
                                      <span
                                        className={`badge-stats whitespace-nowrap ${
                                          pr.final_manager_status === 'rejected' || pr.middle_manager_status === 'rejected'
                                            ? 'bg-red-100 text-red-800'
                                            : 'bg-yellow-100 text-yellow-800'
                                        }`}
                                      >
                                        {pr.final_manager_status === 'rejected' || pr.middle_manager_status === 'rejected'
                                          ? '반려'
                                          : '승인대기'}
                                      </span>
                                    )}
                                    <span className="text-gray-600 truncate">
                                      {pr.vendor_name}
                                    </span>
                                    <span className="text-gray-500">
                                      {pr.purchase_request_items?.[0]?.item_name || '품목 없음'}
                                      {pr.purchase_request_items?.length > 1 && (
                                        <span className="modal-value text-blue-600">
                                          {` 외 ${pr.purchase_request_items.length - 1}건`}
                                        </span>
                                      )}
                                    </span>
                                    <span className="text-gray-400 whitespace-nowrap ml-auto">
                                      {(pr.request_date || pr.created_at) && format(new Date(pr.request_date || pr.created_at), 'MM/dd')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {selectedPurchase?.id === pr.id && (
                                      <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                    )}
                                    {pr.purchase_request_items?.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setExpandedPurchase(expandedPurchase === pr.id ? null : pr.id)
                                        }}
                                        className="p-1 hover:bg-gray-200 rounded"
                                      >
                                        {expandedPurchase === pr.id ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* 상세 품목 목록 */}
                              {expandedPurchase === pr.id && pr.purchase_request_items?.length > 0 && (
                                <div className="px-3 py-2 bg-gray-50 border-t badge-text">
                                  <div className="space-y-1">
                                    <div className="modal-value text-gray-700 mb-1">품목 상세</div>
                                    {pr.purchase_request_items.map((item: any, index: number) => (
                                      <div key={index} className="flex items-center gap-2 text-gray-600 pl-2">
                                        <span className="text-gray-400">{index + 1}.</span>
                                        <span>{item.item_name}</span>
                                        {item.specification && (
                                          <span className="text-gray-500">({item.specification})</span>
                                        )}
                                        <span className="text-gray-500">- {item.quantity}개</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        
                        {/* 페이지네이션 */}
                        {totalPages > 1 && (
                          <div className="flex justify-center items-center gap-1 pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                              disabled={currentPage === 1}
                              className="h-8 w-8 p-0"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                              <Button
                                key={page}
                                type="button"
                                variant={currentPage === page ? "default" : "outline"}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                                className="h-8 w-8 p-0"
                              >
                                {page}
                              </Button>
                            ))}
                            
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                              disabled={currentPage === totalPages}
                              className="h-8 w-8 p-0"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block modal-label text-gray-700 mb-1">
                    제목 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="문의 제목을 입력해주세요"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block modal-label text-gray-700 mb-1">
                    내용 <span className="text-red-500">*</span>
                  </label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="문의 내용을 자세히 입력해주세요"
                    rows={6}
                    maxLength={1000}
                  />
                  <p className="badge-text text-gray-500 mt-1">
                    {message.length}/1000
                  </p>
                </div>

                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={loading}
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
                </Button>
              </form>
            </CardContent>
          </Card>
          )}

          {/* 문의 목록 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                  {isAdmin ? '전체 문의 목록' : '내 문의 내역'}
                </span>
                <span className="badge-stats border border-gray-300 bg-white text-gray-600">
                  {inquiries.length}건
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingInquiries ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : inquiries.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm">문의 내역이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {inquiries.map((inquiry) => (
                    <div key={inquiry.id} className="border rounded overflow-hidden">
                      {/* 문의 요약 (한 줄) */}
                      <div 
                        className="px-3 py-2 hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => {
                          setExpandedInquiry(expandedInquiry === inquiry.id ? null : inquiry.id!)
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="badge-stats border border-gray-300 bg-white text-gray-600 badge-text whitespace-nowrap">
                              {getInquiryTypeLabel(inquiry.inquiry_type)}
                            </span>
                            {getStatusBadge(inquiry.status)}
                            <span className="modal-label truncate">
                              {inquiry.subject}
                            </span>
                            {isAdmin && (
                              <span className="badge-text text-gray-500">
                                {inquiry.user_name || inquiry.user_email}
                              </span>
                            )}
                            {inquiry.purchase_order_number && (
                              <button
                                type="button"
                                className="badge-text text-blue-600 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPurchaseDetailFromInquiry(inquiry)
                                }}
                                title="발주 상세 열기"
                              >
                                [{inquiry.purchase_order_number}]
                              </button>
                            )}
                            <span className="badge-text text-gray-400 ml-auto whitespace-nowrap">
                              {inquiry.created_at && format(new Date(inquiry.created_at), 'MM/dd HH:mm')}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {isAdmin && inquiry.status === 'open' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStatusUpdate(inquiry.id!, 'in_progress')
                                }}
                                className="h-6 badge-text px-2"
                              >
                                처리중
                              </Button>
                            )}
                            {isAdmin && (inquiry.status === 'open' || inquiry.status === 'in_progress') && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStatusUpdate(inquiry.id!, 'resolved')
                                }}
                                className="h-6 badge-text px-2 bg-green-600 hover:bg-green-700"
                              >
                                완료
                              </Button>
                            )}
                            {/* 삭제 버튼 - 관리자는 모든 문의 삭제 가능, 일반 사용자는 본인의 open 상태만 */}
                            {(isAdmin || (inquiry.status === 'open' && !inquiry.resolution_note && inquiry.user_email === currentUserEmail)) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteInquiry(inquiry.id!)
                                }}
                                className="h-6 w-6 p-0 hover:bg-red-50"
                                title="문의 삭제"
                              >
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            )}
                            <button
                              type="button"
                              className="p-1 hover:bg-gray-200 rounded"
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
                        <div className="px-3 py-3 bg-gray-50 border-t text-sm">
                          <div className="space-y-2">
                            <div>
                              <span className="modal-value text-gray-700">내용:</span>
                              <p className="text-gray-600 mt-1 whitespace-pre-wrap">{inquiry.message}</p>
                            </div>
                            {inquiry.purchase_order_number && (
                              <div>
                                <span className="modal-value text-gray-700">관련 발주번호:</span>
                                <button
                                  type="button"
                                  className="text-blue-600 ml-2 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openPurchaseDetailFromInquiry(inquiry)
                                  }}
                                  title="발주 상세 열기"
                                >
                                  {inquiry.purchase_order_number}
                                </button>
                              </div>
                            )}
                            {inquiry.handled_by && (
                              <div>
                                <span className="modal-value text-gray-700">처리자:</span>
                                <span className="text-green-600 ml-2">
                                  {inquiry.handled_by}
                                  {inquiry.processed_at && ` (${format(new Date(inquiry.processed_at), 'yyyy-MM-dd HH:mm')})`}
                                </span>
                              </div>
                            )}
                            {inquiry.resolution_note && (
                              <div>
                                <span className="modal-value text-gray-700">처리 내용:</span>
                                <p className="text-gray-600 mt-1">{inquiry.resolution_note}</p>
                              </div>
                            )}
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
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-lg">
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
                  variant="destructive"
                  size="sm"
                  onClick={deletePurchaseRequest}
                  className="h-8 px-3"
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <span className="badge-text text-gray-500 uppercase tracking-wider">발주번호</span>
                  <p className="font-semibold text-sm mt-1">{selectedInquiryDetail.purchase_order_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="badge-text text-gray-500 uppercase tracking-wider">업체명</span>
                  <p className="font-semibold text-sm mt-1">{selectedInquiryDetail.vendor_name}</p>
                </div>
                <div>
                  <span className="badge-text text-gray-500 uppercase tracking-wider">요청자</span>
                  <p className="font-semibold text-sm mt-1">{selectedInquiryDetail.requester_name}</p>
                </div>
                <div>
                  <span className="badge-text text-gray-500 uppercase tracking-wider">요청일</span>
                  <p className="font-semibold text-sm mt-1">
                    {selectedInquiryDetail.request_date && 
                      format(new Date(selectedInquiryDetail.request_date), 'yyyy-MM-dd')}
                  </p>
                </div>
              </div>

              {/* 품목 목록 - 개선된 디자인 */}
              <div>
                <h3 className="font-semibold text-base mb-3">품목 상세</h3>
                <div className="border rounded-lg overflow-x-auto">
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
                      {selectedInquiryDetail.purchase_request_items?.map((item: any, index: number) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="text-sm px-3 py-3 text-center modal-value text-gray-600">
                            {item.line_number || index + 1}
                          </td>
                          <td className="text-sm px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                value={editingItem?.item_name || ''}
                                onChange={(e) => setEditingItem({...editingItem, item_name: e.target.value})}
                                className="h-9 text-sm w-full"
                                autoFocus
                              />
                            ) : (
                              <span className="modal-value text-gray-900">{item.item_name}</span>
                            )}
                          </td>
                          <td className="text-sm px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                value={editingItem?.specification || ''}
                                onChange={(e) => setEditingItem({...editingItem, specification: e.target.value})}
                                className="h-9 text-sm w-full"
                              />
                            ) : (
                              <span className="text-gray-600">{item.specification || '-'}</span>
                            )}
                          </td>
                          <td className="text-sm text-center px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                type="number"
                                value={editingItem?.quantity || ''}
                                onChange={(e) => setEditingItem({...editingItem, quantity: parseInt(e.target.value)})}
                                className="h-9 text-sm text-center w-full"
                              />
                            ) : (
                              <span className="modal-value">{item.quantity}</span>
                            )}
                          </td>
                          <td className="text-sm text-right px-3 py-3">
                            {editingItemId === item.id ? (
                              <Input
                                type="number"
                                value={editingItem?.unit_price_value || ''}
                                onChange={(e) => setEditingItem({...editingItem, unit_price_value: parseInt(e.target.value)})}
                                className="h-9 text-sm text-right w-full"
                              />
                            ) : (
                              <span className="modal-value">
                                {item.unit_price_value ? `${parseFloat(item.unit_price_value).toLocaleString()}` : '-'}
                              </span>
                            )}
                          </td>
                          <td className="text-sm text-right px-3 py-3">
                            {editingItemId === item.id ? (
                              <span className="font-semibold text-blue-600">
                                {((editingItem?.quantity || 0) * (editingItem?.unit_price_value || 0)).toLocaleString()}
                              </span>
                            ) : (
                              <span className="font-semibold text-blue-600">
                                {item.amount_value ? `${parseFloat(item.amount_value).toLocaleString()}` : '-'}
                              </span>
                            )}
                          </td>
                          <td className="text-sm px-3 py-3">
                            {editingItemId === item.id ? (
                              <Textarea
                                value={editingItem?.remark || ''}
                                onChange={(e) => setEditingItem({...editingItem, remark: e.target.value})}
                                className="h-9 text-sm w-full resize-none"
                                rows={1}
                              />
                            ) : (
                              <span className="text-gray-600 badge-text">{item.remark || '-'}</span>
                            )}
                          </td>
                          <td className="text-sm text-center px-3 py-3">
                            {item.link ? (
                              <a 
                                href={item.link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-blue-50 text-blue-600"
                              >
                                <Eye className="w-4 h-4" />
                              </a>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="text-sm text-center px-3 py-3">
                              {editingItemId === item.id ? (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    size="sm"
                                    onClick={() => saveEditItem(item.id)}
                                    className="h-8 px-2 bg-green-600 hover:bg-green-700"
                                  >
                                    <Save className="w-4 h-4 mr-1" />
                                    저장
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={cancelEditItem}
                                    className="h-8 px-2"
                                  >
                                    취소
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => startEditItem(item)}
                                    className="h-8 w-8 p-0 hover:bg-blue-50"
                                  >
                                    <Edit2 className="w-4 h-4 text-blue-600" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => deleteItem(item.id)}
                                    className="h-8 w-8 p-0 hover:bg-red-50"
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
                        <td colSpan={5} className="text-sm font-semibold text-right px-3 py-3">
                          합계
                        </td>
                        <td className="text-sm font-bold text-right px-3 py-3 text-blue-600">
                          {selectedInquiryDetail.purchase_request_items
                            ?.reduce((sum: number, item: any) => sum + (parseFloat(item.amount_value) || 0), 0)
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
                  <h3 className="modal-value mb-2">비고</h3>
                  <p className="page-subtitle text-gray-600 p-3 bg-gray-50 rounded-lg">
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
          setPurchaseToDelete(purchase)
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>발주요청 내역 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              발주요청번호 <strong>{purchaseToDelete?.purchase_order_number || '알 수 없음'}</strong>를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteFromPurchaseModal}
              className="bg-red-600 hover:bg-red-700"
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
          className="p-0 overflow-hidden"
        >
          <div className="px-8 py-10 text-center">
            <div className="text-xl font-semibold text-gray-900">안내</div>
            <div className="mt-4 text-base text-gray-700 whitespace-pre-wrap">
              {purchaseMissingMessage}
            </div>
            <div className="mt-6 text-sm text-gray-400">
              화면을 클릭하거나 ESC로 닫을 수 있습니다.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}