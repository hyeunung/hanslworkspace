
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { dashboardService } from '@/services/dashboardService'
import { createClient } from '@/lib/supabase/client'
import { updatePurchaseInMemory, addCacheListener, markPurchaseAsPaymentCompleted } from '@/stores/purchaseMemoryStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Clock, CheckCircle, ArrowRight, X, Package, Truck, ShoppingCart, Search, MessageCircle, Trash2, Car, CreditCard } from 'lucide-react'

// 모든 카드에서 사용하는 모달 (activeTab에 따라 다른 내용 표시)
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import DeliveryDateWarningModal, { useDeliveryWarningCount } from '@/components/purchase/DeliveryDateWarningModal'

import { toast } from 'sonner'
import type { DashboardData, Purchase } from '@/types/purchase'
import { parseRoles } from '@/utils/roleHelper'
import { useNavigate } from 'react-router-dom'
import { logger } from '@/lib/logger'
import { supportService, type SupportInquiry } from '@/services/supportService'
import { format } from 'date-fns'

const DASHBOARD_VEHICLES = [
  { label: "PALISADE", plate: "259누 8222" },
  { label: "STARIA", plate: "715루 7024" },
  { label: "GV80", plate: "330조 1022" },
  { label: "G90", plate: "322모 3801" },
  { label: "F150 Raptor", plate: "8381" },
  { label: "PORTER", plate: "93부 0351" },
]

const DASHBOARD_CARDS = [
  { label: "공용1", number: "8967", value: "공용1 8967" },
  { label: "원자재", number: "4963", value: "원자재 4963" },
  { label: "출장용", number: "5914", value: "출장용 5914" },
  { label: "청송", number: "0948", value: "청송 0948" },
  { label: "공용2", number: "9976", value: "공용2 9976" },
  { label: "기타1", number: "8936", value: "기타1 8936" },
]

const VEHICLE_FIXED_STATUS: Record<string, { status: "away"; driver: string; destination: string }> = {
  "PORTER": { status: "away", driver: "", destination: "청송 출장중" },
}

export default function DashboardMain() {
  const navigate = useNavigate()
  const { employee, currentUserRoles: userRoles, currentUserName } = useAuth()
  
  // 🚀 메모리 캐시 기반 즉시 렌더링: 캐시가 유효하면 로딩 없이 바로 표시
  const hasValidCache = Boolean(
    employee?.id && 
    dashboardService.hasValidCache(employee.id)
  )
  
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(!hasValidCache) // 캐시가 있으면 로딩 스킵
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([])
  // 최종 승인 후 잠시 재등장하는 깜빡임 방지용(서버 응답 지연 대비)
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<Set<string>>(new Set())
  
  // 차량/법인카드 현황
  const [vehicleRequests, setVehicleRequests] = useState<Array<{
    vehicle_info?: string
    start_at: string
    end_at: string
    route?: string
    requester?: { name?: string }
    driver?: { name?: string }
    [key: string]: unknown
  }>>([])
  const [cardUsages, setCardUsages] = useState<Array<{
    card_number?: string
    usage_category?: string
    requester?: { name?: string }
    [key: string]: unknown
  }>>([])
  const [statusNow, setStatusNow] = useState(() => new Date())

  // 문의하기 관련 (superadmin용)
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([])
  const [loadingInquiries, setLoadingInquiries] = useState(false)
  const [expandedInquiryId, setExpandedInquiryId] = useState<number | null>(null)
  
  const supabase = createClient()
  
  // PurchaseDetailModal 상태 (모든 카드에서 사용)
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalActiveTab, setModalActiveTab] = useState<string>('pending') // 모달의 activeTab 값
  
  // 삭제 확인 다이얼로그 상태
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [purchaseToDelete, setPurchaseToDelete] = useState<{ id: string | number; purchase_order_number?: string } | null>(null)
  
  // 입고일정지연알림 모달 상태
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false)
  const hasShownWarningRef = useRef(false)
  
  // 검색 상태
  const [searchTerms, setSearchTerms] = useState({
    pending: '',
    purchase: '',
    delivery: ''
  })

  // 차량/카드 현황 1분마다 갱신
  useEffect(() => {
    const timer = setInterval(() => setStatusNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // 차량/카드 현황 데이터 로딩
  const loadStatusData = useCallback(async () => {
    try {
      const { data: vReqs } = await supabase
        .from('vehicle_requests')
        .select('*, requester:employees!vehicle_requests_requester_id_fkey(name), driver:employees!vehicle_requests_driver_id_fkey(name)')
        .eq('approval_status', 'approved')
      setVehicleRequests(vReqs || [])

      const { data: cUsages } = await supabase
        .from('card_usages')
        .select('*, requester:employees!card_usages_requester_id_fkey(name)')
        .in('approval_status', ['approved', 'settled'])
        .eq('card_returned', false)
      setCardUsages(cUsages || [])
    } catch (err) {
      logger.error('[DashboardMain] 차량/카드 현황 로딩 실패:', err)
    }
  }, [supabase])

  useEffect(() => {
    loadStatusData()
  }, [loadStatusData])

  const vehicleStatusMap = useMemo(() => {
    const map: Record<string, { status: "standby" | "away"; driver: string; destination: string }> = {}
    for (const v of DASHBOARD_VEHICLES) {
      const fixed = VEHICLE_FIXED_STATUS[v.label]
      if (fixed) { map[v.label] = fixed; continue }
      const activeReq = vehicleRequests.find(
        (r) =>
          r.vehicle_info?.startsWith(v.label) &&
          new Date(r.start_at) <= statusNow &&
          new Date(r.end_at) >= statusNow
      )
      if (activeReq) {
        map[v.label] = {
          status: "away",
          driver: activeReq.driver?.name || activeReq.requester?.name || "",
          destination: activeReq.route || "",
        }
      } else {
        map[v.label] = { status: "standby", driver: "", destination: "" }
      }
    }
    return map
  }, [vehicleRequests, statusNow])

  const cardStatusMap = useMemo(() => {
    const map: Record<string, { inUse: boolean; user: string; category: string }> = {}
    for (const card of DASHBOARD_CARDS) {
      const active = cardUsages.find(u => u.card_number === card.value)
      if (active) {
        map[card.value] = { inUse: true, user: active.requester?.name || "-", category: active.usage_category || "" }
      } else {
        map[card.value] = { inUse: false, user: "", category: "" }
      }
    }
    return map
  }, [cardUsages])

  const vehicleAwayCount = useMemo(() => DASHBOARD_VEHICLES.filter(v => vehicleStatusMap[v.label]?.status === "away").length, [vehicleStatusMap])
  const cardInUseCount = useMemo(() => DASHBOARD_CARDS.filter(c => cardStatusMap[c.value]?.inUse).length, [cardStatusMap])

  const loadDashboardData = useCallback(async (showLoading = true, forceRefresh = false) => {
    if (!employee) {
      logger.error('[DashboardMain] No employee data available')
      if (showLoading) {
        setLoading(false)
      }
      return
    }

    try {
      if (showLoading && !forceRefresh && !data) {
        setLoading(true)
      }
      
      const dashboardData = await dashboardService.getDashboardData(employee, forceRefresh)

      // 최종 승인으로 로컬에서 제거된 항목이 서버 지연으로 재등장하지 않도록 필터
      const filteredPending = dashboardData.pendingApprovals.filter(
        (item) => !dismissedApprovalIds.has(String(item.id))
      )
      const removedCount = dashboardData.pendingApprovals.length - filteredPending.length
      const adjustedStats = dashboardData.stats
        ? { ...dashboardData.stats, pending: Math.max(0, dashboardData.stats.pending - removedCount) }
        : dashboardData.stats

      // 서버 응답에 해당 항목이 사라졌다면 set에서 제거해 메모리 누적 방지
      if (removedCount > 0) {
        setDismissedApprovalIds((prev) => {
          const next = new Set(prev)
          filteredPending.forEach((item) => next.delete(String(item.id)))
          return next
        })
      }

      setData({
        ...dashboardData,
        pendingApprovals: filteredPending,
        stats: adjustedStats
      })
      setCurrentUserRoles(userRoles)
      
    } catch (error) {
      logger.error('[DashboardMain] Failed to load dashboard data:', error)
      toast.error('대시보드 데이터를 불러오는데 실패했습니다.')
      // 에러 발생 시에도 로딩 상태 해제
      setLoading(false)
      // 빈 데이터라도 설정해서 UI가 렌더링되도록
      setData(null)
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [employee, userRoles, dismissedApprovalIds])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  // 🚀 Realtime 이벤트 구독 - DB 변경 시 자동 새로고침
  const isFirstMount = useRef(true)
  useEffect(() => {
    const handleCacheUpdate = () => {
      // 첫 마운트 시에는 무시 (초기 로드와 중복 방지)
      if (isFirstMount.current) {
        isFirstMount.current = false
        return
      }
      // Realtime 이벤트 발생 시 백그라운드 새로고침
      loadDashboardData(false, true)
    }

    const unsubscribe = addCacheListener(handleCacheUpdate)
    return () => unsubscribe()
  }, [loadDashboardData])

  // 문의 목록 초기 로드 (superadmin만)
  useEffect(() => {
    if (!currentUserRoles.includes('superadmin')) return

    const loadInquiries = async () => {
      try {
        setLoadingInquiries(true)
        const inquiryResult = await supportService.getAllInquiries()
        if (inquiryResult.success) {
          // 미처리 문의만 필터링 (open, in_progress)
          const pendingInquiries = inquiryResult.data.filter(
            inq => inq.status === 'open' || inq.status === 'in_progress'
          )
          setInquiries(pendingInquiries)
        }
      } catch (inquiryError) {
        logger.error('[DashboardMain] 문의 목록 조회 실패:', inquiryError)
      } finally {
        setLoadingInquiries(false)
      }
    }

    loadInquiries()
  }, [currentUserRoles])

  // 문의 목록 실시간 구독 (superadmin만)
  useEffect(() => {
    if (!currentUserRoles.includes('superadmin')) return

    const subscription = supportService.subscribeToInquiries((payload) => {
      const eventType = payload?.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | undefined
      const newRow = payload?.new as SupportInquiry | undefined
      const oldRow = payload?.old as SupportInquiry | undefined

      // DELETE 이벤트: 목록에서 제거
      if (eventType === 'DELETE') {
        const deletedId = oldRow?.id
        if (!deletedId) return
        setInquiries(prev => {
          const next = prev.filter(i => i.id !== deletedId)
          return next
        })
        if (expandedInquiryId === deletedId) {
          setExpandedInquiryId(null)
        }
        return
      }

      // INSERT/UPDATE 이벤트: 미처리 문의만 유지하며 업데이트
      const row = newRow
      if (!row?.id) return

      setInquiries(prev => {
        // 미처리 문의가 아니면 제거
        const isPending = row.status === 'open' || row.status === 'in_progress'
        const idx = prev.findIndex(i => i.id === row.id)

        if (!isPending) {
          // 처리 완료된 문의는 목록에서 제거
          if (idx === -1) return prev
          return prev.filter(i => i.id !== row.id)
        }

        // 미처리 문의는 upsert
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
  }, [currentUserRoles, expandedInquiryId])

  // 발주 상세 모달 열기 (문의에서 발주번호 클릭 시)
  const openPurchaseDetailFromInquiry = async (inquiry: SupportInquiry) => {
    try {
      // 1) 가장 정확한 값: purchase_request_id (신규 문의부터 저장됨)
      if (inquiry.purchase_request_id) {
        setSelectedPurchaseId(inquiry.purchase_request_id)
        setModalActiveTab('done')  // 문의에서 열린 발주는 'done' 탭으로 설정 (품목 삭제 등 전체 기능 사용 가능)
        setIsModalOpen(true)
        return
      }

      // 2) 과거 데이터 호환: purchase_order_number로 purchase_requests에서 id 조회
      const orderNumber = inquiry.purchase_order_number?.trim()
      if (!orderNumber) {
        toast.error('발주내역이 삭제 되었거나 없습니다.')
        return
      }

      const { data, error } = await supabase
        .from('purchase_requests')
        .select('id')
        .eq('purchase_order_number', orderNumber)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      if (!data?.id) {
        toast.error('발주내역이 삭제 되었거나 없습니다.')
        return
      }

      setSelectedPurchaseId(data.id)
      setModalActiveTab('done')  // 문의에서 열린 발주는 'done' 탭으로 설정 (품목 삭제 등 전체 기능 사용 가능)
      setIsModalOpen(true)
    } catch (error) {
      logger.error('[DashboardMain] 발주 상세 조회 실패:', error)
      toast.error('발주 상세를 불러오는데 실패했습니다.')
    }
  }

  // 문의 삭제 (superadmin)
  const handleDeleteInquiry = async (inquiryId: number) => {
    if (!confirm('정말로 이 문의를 삭제하시겠습니까?\n삭제된 문의는 복구할 수 없습니다.')) return

    const result = await supportService.deleteInquiry(inquiryId)
    
    if (result.success) {
      toast.success('문의가 삭제되었습니다.')
      // 목록에서 제거
      setInquiries(prev => prev.filter(inq => inq.id !== inquiryId))
      setExpandedInquiryId(null)
    } else {
      toast.error(result.error || '문의 삭제 실패')
    }
  }

  // 발주 삭제 확인 처리 (PurchaseDetailModal에서 삭제 버튼 클릭 시)
  const handleConfirmDeletePurchase = async () => {
    if (!purchaseToDelete?.id) {
      toast.error('삭제할 발주 정보가 없습니다.')
      return
    }

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
        throw inquiryUpdateError
      }

      // 2) 품목 삭제
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchaseIdForDelete)

      if (itemsError) throw itemsError

      // 3) 발주 삭제
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchaseIdForDelete)

      if (requestError) throw requestError

      toast.success('발주요청이 삭제되었습니다.')
      setDeleteConfirmOpen(false)
      setPurchaseToDelete(null)
      setIsModalOpen(false)
      setSelectedPurchaseId(null)

      // 로컬 상태에서 즉시 제거하여 입고 대기 카드에 바로 반영
      setData((prev) => {
        if (!prev) return prev
        const targetId = String(purchaseIdForDelete)
        const removeById = <T extends { id?: string | number }>(list: T[] = []) => list.filter((item) => String(item.id) !== targetId)
        
        const nextMyStatus = prev.myPurchaseStatus
          ? {
              ...prev.myPurchaseStatus,
              waitingDelivery: removeById(prev.myPurchaseStatus.waitingDelivery),
              waitingPurchase: removeById(prev.myPurchaseStatus.waitingPurchase),
              recentCompleted: removeById(prev.myPurchaseStatus.recentCompleted)
            }
          : prev.myPurchaseStatus

        return {
          ...prev,
          pendingApprovals: removeById(prev.pendingApprovals),
          myRecentRequests: removeById(prev.myRecentRequests),
          myPurchaseStatus: nextMyStatus
        }
      })

      // 캐시 무효화 후 강제 새로고침
      dashboardService.invalidateCache()
      loadDashboardData(false, true)
    } catch (error) {
      logger.error('[DashboardMain] 발주 삭제 실패:', error)
      toast.error('발주 삭제에 실패했습니다.')
    }
  }

  const handleQuickApprove = async (requestId: string | number) => {
    const normalizedId = String(requestId)

    if (!data?.employee) {
      toast.error('사용자 정보를 찾을 수 없습니다.')
      return
    }

    const applyOptimisticUpdate = (stage: 'middle' | 'final') => {
      setData((prev) => {
        if (!prev) return prev

        if (stage === 'middle') {
          return {
            ...prev,
            pendingApprovals: prev.pendingApprovals.map((item) =>
              String(item.id) === normalizedId ? { ...item, middle_manager_status: 'approved' as const } : item
            )
          }
        }

        // 최종 승인 → 목록에서 제거 + pending 카운트 감소
        setDismissedApprovalIds((prev) => {
          const next = new Set(prev)
          next.add(normalizedId)
          return next
        })
        const nextPending = Math.max(0, (prev.stats?.pending || 0) - 1)
        return {
          ...prev,
          pendingApprovals: prev.pendingApprovals.filter((item) => String(item.id) !== normalizedId),
          stats: prev.stats ? { ...prev.stats, pending: nextPending } : prev.stats
        }
      })
    }

    // 승인 확인 메시지
    if (!confirm('정말로 승인하시겠습니까?')) {
      return
    }

    setActionLoading(normalizedId)
    
    // 원본 데이터 백업 (롤백용)
    const originalData = data

    try {
      const result = await dashboardService.quickApprove(normalizedId, data.employee)

      if (result.success && result.stage) {
        // 1) 대시보드 로컬 상태 즉시 반영
        applyOptimisticUpdate(result.stage)

        // 2) 메모리 캐시도 동기화 → 다른 화면/리스너 실시간 반영
        updatePurchaseInMemory(normalizedId, (purchase) => {
          if (result.stage === 'middle') {
            return { ...purchase, middle_manager_status: 'approved' as const }
          }
          return { ...purchase, final_manager_status: 'approved' as const }
        })

        toast.success('승인이 완료되었습니다.')

        // 3) 백그라운드 새로고침 (캐시 무효화와 함께 정합성 보강)
        setTimeout(() => loadDashboardData(false, true), 500)
      } else {
        // 실패 시 원래 데이터로 롤백
        setData(originalData)
        toast.error(result.error || '승인 처리 중 오류가 발생했습니다.')
      }
    } catch (error) {
      // 에러 시 원래 데이터로 롤백
      setData(originalData)
      toast.error('승인 처리 중 오류가 발생했습니다.')
    } finally {
      setActionLoading(null)
    }
  }

  // 모달 열기 헬퍼 함수 (PurchaseDetailModal 사용, activeTab 전달)
  const openPurchaseModal = (item: { id: string | number }, activeTab: string = 'pending') => {
    setSelectedPurchaseId(Number(item.id))
    setModalActiveTab(activeTab)
    setIsModalOpen(true)
  }

  // 검색 필터링 함수
  const filterItems = useCallback(<T extends { purchase_order_number?: string; vendor_name?: string; purchase_request_items?: Array<{ item_name?: string }> }>(items: T[], searchTerm: string): T[] => {
    if (!searchTerm.trim()) return items

    return items.filter(item => {
      const orderNumber = item.purchase_order_number || ''
      const vendorName = item.vendor_name || ''
      const itemsText = (item.purchase_request_items || [])
        .map((pItem) => pItem.item_name || '')
        .join(' ')
      
      return [orderNumber, vendorName, itemsText]
        .join(' ')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    })
  }, [])

  // 필터링된 결과 메모이제이션 (입력할 때마다 재계산 방지)
  const filteredPending = useMemo(() => filterItems(data?.pendingApprovals || [], searchTerms.pending), [data?.pendingApprovals, searchTerms.pending, filterItems])
  const filteredPurchase = useMemo(() => filterItems(data?.myPurchaseStatus?.waitingPurchase || [], searchTerms.purchase), [data?.myPurchaseStatus?.waitingPurchase, searchTerms.purchase, filterItems])
  const filteredDelivery = useMemo(() => filterItems(data?.myPurchaseStatus?.waitingDelivery || [], searchTerms.delivery), [data?.myPurchaseStatus?.waitingDelivery, searchTerms.delivery, filterItems])
  
  // 입고일정지연알림: waitingDelivery 데이터를 Purchase 타입으로 변환하여 경고 항목 계산
  const deliveryPurchases = useMemo(() => {
    if (!data?.myPurchaseStatus?.waitingDelivery) return []
    return data.myPurchaseStatus.waitingDelivery.map(item => ({
      ...item,
      id: typeof item.id === 'string' ? parseInt(item.id) || 0 : item.id,
      purchase_request_items: item.purchase_request_items || []
    })) as unknown as Purchase[]
  }, [data?.myPurchaseStatus?.waitingDelivery])
  
  const deliveryWarningCount = useDeliveryWarningCount(deliveryPurchases, currentUserName)
  
  // 로딩 완료 후 경고 모달 자동 표시 (마운트당 1회)
  useEffect(() => {
    if (hasShownWarningRef.current) return
    
    if (!loading && deliveryWarningCount > 0 && deliveryPurchases.length > 0) {
      const timer = setTimeout(() => {
        if (!hasShownWarningRef.current) {
          hasShownWarningRef.current = true
          setIsWarningModalOpen(true)
        }
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [loading, deliveryWarningCount, deliveryPurchases.length])


  const getStepColor = (step: string) => {
    switch (step) {
      case 'approval': return 'bg-yellow-100 text-yellow-800'
      case 'purchase': return 'bg-blue-100 text-blue-800'
      case 'delivery': return 'bg-purple-100 text-purple-800'
      case 'completed': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '400px', backgroundColor: '#f9fafb' }}>
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-hansl-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 card-subtitle">대시보드를 불러오고 있습니다...</p>
          <p className="text-xs text-gray-400 mt-2">Employee: {employee?.name || '없음'}</p>
        </div>
      </div>
    )
  }

  if (!data?.employee) {
    logger.warn('[DashboardMain] 데이터 없음', { 
      hasData: !!data, 
      hasEmployee: !!employee,
      employeeName: employee?.name,
      loading 
    })
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '400px', backgroundColor: '#f9fafb' }}>
        <div className="text-center bg-white p-8 rounded-lg border border-gray-200 shadow-sm">
          <h3 className="modal-subtitle mb-2">사용자 정보를 찾을 수 없습니다</h3>
          <p className="card-subtitle mb-4">로그인을 다시 시도해주세요.</p>
          <div className="text-xs text-gray-400 space-y-1">
            <p>Employee: {employee?.name || '없음'}</p>
            <p>Loading: {loading ? 'true' : 'false'}</p>
            <p>Has Data: {data ? 'true' : 'false'}</p>
          </div>
        </div>
      </div>
    )
  }

  // 권한 파싱 및 표시 여부 결정
  const roles = parseRoles(data.employee.roles)

  const canSeeApprovalBox = roles.some((r: string) => ['middle_manager', 'final_approver', 'superadmin', 'raw_material_manager', 'consumable_manager'].includes(r))

  // 결제/요청 유형별 색상 매핑 (payment_category 기준)
  const getTypeColorClass = (paymentCategory: string | null | undefined) => {
    const normalized = (paymentCategory || '').toLowerCase().replace(/\s+/g, '')
    const isOnsitePayment = normalized.includes('현장결제')
    const isOrder = normalized.includes('발주')
    const isPurchaseRequest = normalized.includes('구매')

    if (isOnsitePayment) return 'bg-gray-500'
    if (isOrder) return 'bg-green-500'
    if (isPurchaseRequest) return 'bg-blue-500'
    return 'bg-gray-300'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 lg:px-6">
        {/* 헤더 */}
        <div className="mb-3">
          <div>
            <h1 className="page-title">대시보드</h1>
            <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Dashboard</p>
          </div>
        </div>

        {/* 통합 대시보드 그리드 */}
        <div className="mb-2">
          <h2 className="section-title mb-2 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-gray-600" />
            전체 현황
            <span className="badge-stats border border-gray-300 bg-white text-gray-600 ml-2">
              {new Date().toLocaleDateString('ko-KR', { 
                month: 'long', 
                day: 'numeric',
                weekday: 'short'
              })}
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* 1. 승인 대기 (승인 권한자만 표시) */}
          {canSeeApprovalBox && (
            <Card className="w-full col-span-1">
              <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
                <CardTitle className="section-title flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-orange-500" />
                    <span>승인 대기</span>
                  </div>
                  {data.pendingApprovals.length > 0 && (
                    <span className="badge-stats bg-gray-200 text-gray-700">
                      {data.pendingApprovals.length}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {data.pendingApprovals.length === 0 ? (
                  <div className="text-center py-4 text-gray-400">
                    <CheckCircle className="w-6 h-6 mx-auto mb-1" />
                    <p className="card-description">대기 항목 없음</p>
                  </div>
                  ) : (
                  <div className="space-y-3">
                    {/* 검색 입력 */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="발주번호, 업체명, 품목으로 검색..."
                        value={searchTerms.pending}
                        onChange={(e) => setSearchTerms(prev => ({ ...prev, pending: e.target.value }))}
                        className="pl-10 h-8 text-xs"
                      />
                    </div>
                    
                    {/* 항목 리스트 */}
                    <div className="space-y-2 h-[36rem] overflow-y-auto">
                      {filteredPending.slice(0, 10).map((approval, index) => {
                        const items = approval.purchase_request_items || []
                        const firstItem = items[0] || {}
                        const totalAmount = approval.total_amount || items.reduce((sum: number, i: { amount_value?: number | string }) => sum + (Number(i.amount_value) || 0), 0)
                        const isAdvance = approval.progress_type === '선진행'
                        const typeColorClass = getTypeColorClass(approval.payment_category)
                        
                        return (
                          <div 
                            key={`approval-${approval.id}`} 
                            className={`relative border rounded-lg p-2 hover:shadow-sm transition-all cursor-pointer mb-2 pl-3 ${
                              isAdvance ? 'bg-red-50 border-red-200' : 'hover:bg-orange-50/30'
                            }`}
                            onClick={(e) => {
                              // 버튼 클릭은 무시
                              if ((e.target as HTMLElement).closest('button')) return
                              openPurchaseModal(approval, 'pending') // 승인대기 탭
                            }}
                          >
                            {/* 좌측 세로 타입 바 */}
                            <div className={`absolute inset-y-1 left-1 w-1 rounded-full ${typeColorClass}`} />
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="card-title">
                                  {approval.purchase_order_number}
                                </span>
                                <span className="card-subtitle truncate">{approval.vendor_name || '업체'}</span>
                                <span className="card-description truncate">
                                  {firstItem.item_name || '품목'} {items.length > 1 && `외 ${items.length - 1}건`}
                                </span>
                              </div>
                              <Button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  await handleQuickApprove(approval.id)
                                }}
                                disabled={actionLoading === approval.id}
                                className={`button-base text-white ${
                                  approval.middle_manager_status === 'approved' 
                                    ? 'bg-blue-600 hover:bg-blue-700' 
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                {actionLoading === approval.id ? (
                                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    {approval.middle_manager_status === 'approved' ? '최종' : '1차'} 승인
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 2. 문의하기 내역 - App Admin만 표시 */}
          {currentUserRoles.includes('superadmin') && (
            <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
                <CardTitle className="section-title flex items-center w-full">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-purple-600" />
                    <span>미처리 문의</span>
                    {inquiries.length > 0 && (
                      <span className="badge-stats bg-red-100 text-red-700">
                        {inquiries.length}
                      </span>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {loadingInquiries ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : inquiries.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <CheckCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="card-subtitle">미처리 문의가 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[20rem] overflow-y-auto">
                    {inquiries.slice(0, 10).map((inquiry) => {
                      const isExpanded = expandedInquiryId === inquiry.id
                      
                      return (
                        <div 
                          key={inquiry.id} 
                          className="border rounded-lg overflow-hidden hover:shadow-sm transition-all"
                        >
                          {/* 문의 요약 */}
                          <div 
                            className="p-2 hover:bg-purple-50/30 cursor-pointer"
                            onClick={() => setExpandedInquiryId(isExpanded ? null : inquiry.id!)}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`badge-stats ${
                                inquiry.status === 'open' 
                                  ? 'bg-yellow-100 text-yellow-800' 
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {inquiry.status === 'open' ? '대기' : '처리중'}
                              </span>
                              <span className="card-title truncate flex-1">
                                {inquiry.subject}
                              </span>
                              <span className="card-description whitespace-nowrap">
                                {inquiry.user_name}
                              </span>
                              <span className="card-date whitespace-nowrap">
                                {inquiry.created_at && format(new Date(inquiry.created_at), 'MM/dd HH:mm')}
                              </span>
                            </div>
                          </div>
                          
                          {/* 상세 내용 */}
                          {isExpanded && (
                            <div className="px-3 py-2 bg-gray-50 border-t text-xs space-y-2">
                              {/* 발주번호 */}
                              {inquiry.purchase_order_number && (
                                <div>
                                  <span className="modal-label text-gray-500">발주번호:</span>
                                  <button
                                    className="text-blue-600 underline ml-2 hover:text-blue-800"
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
                              <div>
                                <span className="modal-label text-gray-500">내용:</span>
                                <p className="text-gray-600 mt-1 whitespace-pre-wrap">{inquiry.message}</p>
                              </div>
                              {/* 첨부 이미지 */}
                              {inquiry.attachments && inquiry.attachments.length > 0 && (
                                <div>
                                  <span className="modal-label text-gray-500">첨부 이미지:</span>
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {inquiry.attachments.map((attachment, index) => (
                                      <a
                                        key={index}
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <img
                                          src={attachment.url}
                                          alt={attachment.name}
                                          className="w-16 h-16 object-cover rounded border border-gray-200 hover:border-blue-400"
                                        />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="flex justify-end gap-2 pt-2">
                                <button
                                  className="button-action-danger"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteInquiry(inquiry.id!)
                                  }}
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  삭제
                                </button>
                                <button
                                  className="button-action-primary"
                                  onClick={async () => {
                                    // ✅ 입력 없이 완료 처리 + 사용자에게 "완료되었습니다" 알림 + 로그 기록
                                    const result = await supportService.resolveInquiry(inquiry.id!)
                                    if (result.success) {
                                      toast.success('문의가 완료 처리되었습니다.')
                                      // 목록에서 제거
                                      setInquiries(prev => prev.filter(inq => inq.id !== inquiry.id))
                                      setExpandedInquiryId(null)
                                    } else {
                                      toast.error(result.error || '완료 처리 실패')
                                    }
                                  }}
                                >
                                  완료 처리
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {inquiries.length > 10 && (
                      <div className="text-center pt-2">
                        <button
                          className="button-action-secondary"
                          onClick={() => navigate('/support')}
                        >
                          전체 보기 ({inquiries.length}건)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 3. 입고 대기중 */}
          <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
                <CardTitle className="section-title flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-blue-600" />
                    <span>입고 대기</span>
                  </div>
                  {data.myPurchaseStatus.waitingDelivery.length > 0 && (
                    <span className="badge-stats bg-gray-200 text-gray-700">
                      {data.myPurchaseStatus.waitingDelivery.length}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {data.myPurchaseStatus.waitingDelivery.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Truck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="card-subtitle">입고 대기 항목이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 검색 입력 */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="발주번호, 업체명, 품목으로 검색..."
                        value={searchTerms.delivery}
                        onChange={(e) => setSearchTerms(prev => ({ ...prev, delivery: e.target.value }))}
                        className="pl-10 h-8 text-xs"
                      />
                    </div>
                    
                    {/* 항목 리스트 */}
                    <div className="space-y-2 h-[36rem] overflow-y-auto">
                      {filteredDelivery.slice(0, 10).map((item) => {
                        const items = item.purchase_request_items || []
                        const firstItem = items[0]
                        const totalItems = items.length
                        const receivedItems = items.filter((i: { is_received?: boolean }) => i.is_received).length
                        const progress = totalItems > 0 ? Math.round((receivedItems / totalItems) * 100) : 0
                        const totalAmount = items.reduce((sum: number, i: { amount_value?: number | string }) => sum + (Number(i.amount_value) || 0), 0)
                        const isSeonJin = (item.progress_type || '').includes('선진행')
                        
                        return (
                          <div 
                            key={item.id} 
                            className={`border rounded-lg p-2 transition-all cursor-pointer hover:shadow-sm mb-2 ${
                              isSeonJin ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                            }`}
                            onClick={(e) => {
                              // 버튼 클릭은 무시
                              if ((e.target as HTMLElement).closest('button')) return
                              openPurchaseModal(item, 'receipt') // 입고현황 탭
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="card-title">
                                {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                              </span>
                              <span className="card-subtitle truncate">
                                {item.vendor_name || '업체명 없음'}
                              </span>
                              <span className="card-description truncate">
                                {firstItem?.item_name || '품목'} 
                                {totalItems > 1 && (
                                  <span className="text-gray-400"> 외 {totalItems - 1}건</span>
                                )}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
          </Card>


        </div>

        {/* 차량 / 법인카드 현황 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          {/* 차량 현황 */}
          <Card className="border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('/purchase/list?tab=차량')}>
            <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
              <CardTitle className="section-title flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Car className="w-3.5 h-3.5 text-gray-600" />
                  <span>차량 현황</span>
                </div>
                <span className="badge-stats bg-gray-200 text-gray-700">
                  {vehicleAwayCount > 0 ? `${vehicleAwayCount}대 출타중` : '전체 대기'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-3 gap-2">
                {DASHBOARD_VEHICLES.map((v) => {
                  const info = vehicleStatusMap[v.label]
                  const isAway = info?.status === "away"
                  return (
                    <div
                      key={v.label}
                      className={`border business-radius-card px-3 py-2 ${isAway ? "border-orange-200 bg-orange-50/50" : "border-gray-100 bg-gray-50/50"}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-semibold text-gray-900">{v.label}</span>
                        <span className={`badge-stats ${isAway ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500"}`}>
                          {isAway ? "출타중" : "대기중"}
                        </span>
                      </div>
                      {isAway && info ? (
                        <div>
                          {info.driver && <p className="text-[9px] text-gray-600 truncate">{info.driver}</p>}
                          <p className="text-[9px] text-gray-500 truncate">{info.destination}</p>
                        </div>
                      ) : (
                        <p className="text-[9px] text-gray-400">배차 가능</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 법인카드 현황 */}
          <Card className="border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('/purchase/list?tab=카드사용')}>
            <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
              <CardTitle className="section-title flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-3.5 h-3.5 text-gray-600" />
                  <span>법인카드 현황</span>
                </div>
                <span className="badge-stats bg-gray-200 text-gray-700">
                  {cardInUseCount > 0 ? `${cardInUseCount}장 사용중` : '전체 보관중'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-2">
                {DASHBOARD_CARDS.map((card) => {
                  const status = cardStatusMap[card.value]
                  return (
                    <div
                      key={card.value}
                      className={`border business-radius-card px-3 py-2 ${status?.inUse ? "border-blue-200 bg-blue-50/50" : "border-gray-100 bg-gray-50/50"}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-semibold text-gray-900">
                          {card.label}
                          <span className="ml-1 text-[8px] font-normal text-gray-400">{card.number}</span>
                        </span>
                        <span className={`badge-stats ${status?.inUse ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"}`}>
                          {status?.inUse ? "사용중" : "보관중"}
                        </span>
                      </div>
                      {status?.inUse ? (
                        <p className="text-[9px] text-blue-600 truncate">{status.user} · {status.category}</p>
                      ) : (
                        <p className="text-[9px] text-gray-400">사용 가능</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 오늘의 요약 - 상단 통계에 통합 */}
      </div>
      
      {/* PurchaseDetailModal - 모든 카드에서 사용 (activeTab에 따라 다른 내용 표시) */}
      <PurchaseDetailModal
        purchaseId={selectedPurchaseId}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedPurchaseId(null)
          setModalActiveTab('pending')
        }}
        currentUserRoles={currentUserRoles}
        activeTab={modalActiveTab}
        onRefresh={() => {
          loadDashboardData(false)
          setIsModalOpen(false)
          setSelectedPurchaseId(null)
          setModalActiveTab('pending')
        }}
        onOptimisticUpdate={(purchaseId: number, updater: (prev: Purchase) => Purchase) => {
          updatePurchaseInMemory(purchaseId, updater)
          loadDashboardData(false)
        }}
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
              onClick={handleConfirmDeletePurchase}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* 입고 일정 지연 경고 모달 */}
      <DeliveryDateWarningModal
        isOpen={isWarningModalOpen}
        onClose={() => {
          setIsWarningModalOpen(false)
          // 모달 닫고 데이터 새로고침
          loadDashboardData(false, true)
        }}
        purchases={deliveryPurchases}
        currentUserName={currentUserName}
        onRefresh={() => loadDashboardData(false, true)}
      />
    </div>
  )
}