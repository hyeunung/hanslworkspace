
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { dashboardService } from '@/services/dashboardService'
import { createClient } from '@/lib/supabase/client'
import { updatePurchaseInMemory, addCacheListener, markPurchaseAsPaymentCompleted } from '@/stores/purchaseMemoryStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Clock, CheckCircle, ArrowRight, X, Package, Truck, ShoppingCart, Download, Search } from 'lucide-react'
import { downloadPurchaseOrderExcel } from '@/utils/excelDownload'

// 모든 카드에서 사용하는 모달 (activeTab에 따라 다른 내용 표시)
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'

import { toast } from 'sonner'
import type { DashboardData, Purchase } from '@/types/purchase'
import { useNavigate } from 'react-router-dom'
import { logger } from '@/lib/logger'

export default function DashboardMain() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([])
  const [undownloadedOrders, setUndownloadedOrders] = useState<any[]>([])
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())
  
  const supabase = createClient()
  
  // PurchaseDetailModal 상태 (모든 카드에서 사용)
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalActiveTab, setModalActiveTab] = useState<string>('pending') // 모달의 activeTab 값
  
  // 검색 상태
  const [searchTerms, setSearchTerms] = useState({
    undownloaded: '',
    pending: '',
    purchase: '',
    delivery: ''
  })
  
  const navigate = useNavigate()
  const { employee, currentUserRoles: userRoles } = useAuth()

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
      setData(dashboardData)
      setCurrentUserRoles(userRoles)
      
      // lead buyer 또는 app_admin인 경우 미다운로드 항목 조회
      if (userRoles.includes('lead buyer') || userRoles.includes('app_admin')) {
        try {
          const undownloaded = await dashboardService.getUndownloadedOrders(employee)
          logger.info('[DashboardMain] 미다운로드 발주서 조회 결과:', { 
            count: undownloaded.length,
            userRoles,
            employeeName: employee.name,
            sampleItems: undownloaded.slice(0, 3).map(item => ({
              purchase_order_number: item.purchase_order_number,
              requester_name: item.requester_name,
              vendor_name: item.vendor_name
            }))
          })
          setUndownloadedOrders(undownloaded)
        } catch (undownloadedError) {
          logger.error('[DashboardMain] 미다운로드 발주서 조회 실패:', undownloadedError)
          toast.error('미다운로드 발주서를 불러오는데 실패했습니다.')
        }
      }
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
  }, [employee, userRoles, data])

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

  const handleQuickApprove = async (requestId: string) => {
    if (!data?.employee) {
      toast.error('사용자 정보를 찾을 수 없습니다.')
      return
    }

    // 승인 확인 메시지
    if (!confirm('정말로 승인하시겠습니까?')) {
      return
    }

    setActionLoading(requestId)
    
    // UI 블로킹 방지를 위해 다음 틱으로 지연
    await new Promise(resolve => setTimeout(resolve, 0))
    
    // Optimistic Update: 즉시 UI에서 제거
    const originalData = data
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        pendingApprovals: prev.pendingApprovals.filter(item => item.id !== requestId),
        stats: {
          ...prev.stats,
          pending: Math.max(0, prev.stats.pending - 1)
        }
      }
    })

    try {
      const result = await dashboardService.quickApprove(requestId, data.employee)
      
      if (result.success) {
        toast.success('승인이 완료되었습니다.')
        // 성공 시 백그라운드에서 데이터 동기화 (UI 깜빡임 없이)
        setTimeout(() => {
          loadDashboardData(false)  // false를 전달하여 로딩 화면 표시 안 함
        }, 1000)
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
  const openPurchaseModal = (item: any, activeTab: string = 'pending') => {
    setSelectedPurchaseId(Number(item.id))
    setModalActiveTab(activeTab)
    setIsModalOpen(true)
  }

  // 검색 필터링 함수
  const filterItems = useCallback((items: any[], searchTerm: string) => {
    if (!searchTerm.trim()) return items
    
    return items.filter(item => {
      const orderNumber = item.purchase_order_number || ''
      const vendorName = item.vendor_name || ''
      const itemsText = (item.purchase_request_items || [])
        .map((pItem: any) => pItem.item_name || '')
        .join(' ')
      
      return [orderNumber, vendorName, itemsText]
        .join(' ')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    })
  }, [])

  // 필터링된 결과 메모이제이션 (입력할 때마다 재계산 방지)
  const filteredUndownloaded = useMemo(() => filterItems(undownloadedOrders, searchTerms.undownloaded), [undownloadedOrders, searchTerms.undownloaded, filterItems])
  const filteredPending = useMemo(() => filterItems(data?.pendingApprovals || [], searchTerms.pending), [data?.pendingApprovals, searchTerms.pending, filterItems])
  const filteredPurchase = useMemo(() => filterItems(data?.myPurchaseStatus?.waitingPurchase || [], searchTerms.purchase), [data?.myPurchaseStatus?.waitingPurchase, searchTerms.purchase, filterItems])
  const filteredDelivery = useMemo(() => filterItems(data?.myPurchaseStatus?.waitingDelivery || [], searchTerms.delivery), [data?.myPurchaseStatus?.waitingDelivery, searchTerms.delivery, filterItems])

  const handleDownloadExcel = async (purchase: any) => {
    try {
      setDownloadingIds(prev => new Set(prev).add(purchase.id))
      
      // UI 블로킹 방지를 위해 다음 틱으로 지연
      await new Promise(resolve => setTimeout(resolve, 0))
      
      // 관리탭과 동일한 Excel 다운로드 함수 호출
      await downloadPurchaseOrderExcel(
        {
          id: purchase.id,
          purchase_order_number: purchase.purchase_order_number,
          vendor_name: purchase.vendor_name,
          vendor_id: purchase.vendor_id,
          contact_id: purchase.contact_id
        },
        currentUserRoles,
        () => {
          // 성공 콜백: UI에서 다운로드 완료된 항목 제거
          setUndownloadedOrders(prev => prev.filter(item => item.id !== purchase.id))
        }
      )
    } catch (error) {
      logger.error('Excel 다운로드 중 오류 발생', error)
    } finally {
      setDownloadingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(purchase.id)
        return newSet
      })
    }
  }

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
  const roles = Array.isArray(data.employee.purchase_role)
    ? (data.employee.purchase_role as any[]).map((r: any) => String(r).trim())
    : (data.employee.purchase_role
        ? String(data.employee.purchase_role)
            .split(',')
            .map((r: string) => r.trim())
            .filter((r: string) => r.length > 0)
        : [])

  const canSeeApprovalBox = roles.some((r: string) => ['middle_manager', 'final_approver', 'app_admin', 'raw_material_manager', 'consumable_manager'].includes(r))

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
          {/* Lead Buyer / App Admin - 미다운로드 발주서 */}
          {(currentUserRoles.includes('lead buyer') || currentUserRoles.includes('app_admin')) && (
            <Card className="w-full col-span-1 row-span-2 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
                <CardTitle className="section-title flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-orange-600" />
                    <span>미다운로드 발주서</span>
                  </div>
                  <span className="badge-stats bg-gray-200 text-gray-700">
                    {undownloadedOrders.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* 검색 입력 */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="발주번호, 업체명, 품목으로 검색..."
                      value={searchTerms.undownloaded}
                      onChange={(e) => setSearchTerms(prev => ({ ...prev, undownloaded: e.target.value }))}
                      className="pl-10 h-8 text-xs"
                    />
                  </div>
                  
                  
                  {/* 항목 리스트 */}
                  <div className="space-y-2 h-[36rem] overflow-y-auto">
                    {filteredUndownloaded.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <Download className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <p className="card-subtitle">미다운로드 발주서가 없습니다</p>
                      </div>
                    ) : (
                      filteredUndownloaded.map((item, index) => {
                        const items = item.purchase_request_items || []
                        const firstItem = items[0] || {}
                        const isAdvance = item.progress_type === '선진행'
                      
                      return (
                        <div 
                          key={`undownloaded-${item.id}`} 
                          className={`border rounded-lg p-2 hover:shadow-sm transition-all cursor-pointer mb-2 ${
                            isAdvance ? 'bg-red-50 border-red-200' : 'hover:bg-orange-50/30'
                          }`}
                          onClick={(e) => {
                            // 버튼 클릭은 무시
                            if ((e.target as HTMLElement).closest('button')) return
                            openPurchaseModal(item, 'pending') // 미다운로드 발주서는 승인대기 탭과 동일
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="card-title">
                                {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                              </span>
                              <span className="card-subtitle truncate">
                                {item.vendor_name || '업체명 없음'}
                              </span>
                              <span className="card-description truncate">
                                {firstItem.item_name || '품목'} 
                                {items.length > 1 && (
                                  <span className="text-gray-400"> 외 {items.length - 1}건</span>
                                )}
                              </span>
                            </div>
                            <Button
                              className="button-base bg-gray-500 hover:bg-gray-600 text-white"
                              onClick={async (e) => {
                                e.stopPropagation()
                                await handleDownloadExcel(item)
                              }}
                              disabled={downloadingIds.has(item.id)}
                            >
                              {downloadingIds.has(item.id) ? (
                                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                "다운로드"
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                      })
                    )}
                    {filteredUndownloaded.length >= 100 && (
                      <div className="text-center text-xs text-gray-500 mt-3 pb-2">
                        표시된 항목: {filteredUndownloaded.length}개
                        <br />
                        더 많은 항목이 있을 수 있습니다. 검색으로 필터링하세요.
                      </div>
                    )}
                    {filteredUndownloaded.length > 0 && (
                      <div className="text-center text-xs text-gray-400 mt-2 pb-2">
                        총 {filteredUndownloaded.length}개 미다운로드 발주서
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}


          {/* 승인 대기 (승인 권한자만 표시) */}
          {canSeeApprovalBox && (
            <Card className="w-full col-span-1 row-span-2">
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
                        const totalAmount = approval.total_amount || items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                        const isAdvance = approval.progress_type === '선진행'
                        
                        return (
                          <div 
                            key={`approval-${approval.id}`} 
                            className={`border rounded-lg p-2 hover:shadow-sm transition-all cursor-pointer mb-2 ${
                              isAdvance ? 'bg-red-50 border-red-200' : 'hover:bg-orange-50/30'
                            }`}
                            onClick={(e) => {
                              // 버튼 클릭은 무시
                              if ((e.target as HTMLElement).closest('button')) return
                              openPurchaseModal(approval, 'pending') // 승인대기 탭
                            }}
                          >
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
          

          {/* 구매 대기중 - Lead Buyer와 App Admin만 표시 */}
          {(currentUserRoles.includes('lead buyer') || currentUserRoles.includes('app_admin')) && (
            <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="h-12 px-4 bg-gray-50 border-b flex items-center">
                <CardTitle className="section-title flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-yellow-600" />
                    <span>구매 대기</span>
                  </div>
                  {data.myPurchaseStatus && data.myPurchaseStatus.waitingPurchase && data.myPurchaseStatus.waitingPurchase.length > 0 && (
                    <span className="badge-stats bg-gray-200 text-gray-700">
                      {data.myPurchaseStatus.waitingPurchase.length}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {!data.myPurchaseStatus || !data.myPurchaseStatus.waitingPurchase || data.myPurchaseStatus.waitingPurchase.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="card-subtitle">구매 대기 항목이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 검색 입력 */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="발주번호, 업체명, 품목으로 검색..."
                        value={searchTerms.purchase}
                        onChange={(e) => setSearchTerms(prev => ({ ...prev, purchase: e.target.value }))}
                        className="pl-10 h-8 text-xs"
                      />
                    </div>
                    
                    {/* 항목 리스트 */}
                    <div className="space-y-2 h-[36rem] overflow-y-auto">
                      {filteredPurchase.map((item) => {
                        const items = item.purchase_request_items || []
                        const firstItem = items[0]
                        const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                        const isSeonJin = (item.progress_type || '').includes('선진행')
                        
                        return (
                          <div 
                            key={item.id} 
                            className={`border rounded-lg p-2 transition-all hover:shadow-sm mb-2 ${
                              isSeonJin ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div 
                                className="flex items-center gap-2 flex-1 cursor-pointer"
                                onClick={(e) => {
                                  // 버튼 클릭은 무시
                                  if ((e.target as HTMLElement).closest('button')) return
                                  openPurchaseModal(item, 'purchase') // 구매현황 탭
                                }}
                              >
                                <span className="card-title">
                                  {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                                </span>
                                <span className="card-subtitle truncate">
                                  {item.vendor_name || '업체명 없음'}
                                </span>
                                <span className="card-description truncate">
                                  {firstItem?.item_name || '품목'} 
                                  {items.length > 1 && (
                                    <span className="text-gray-400"> 외 {items.length - 1}건</span>
                                  )}
                                </span>
                              </div>
                              
                              {/* 구매완료 버튼 - Lead Buyer, App Admin만 표시 */}
                              {(currentUserRoles.includes('lead buyer') || 
                                currentUserRoles.includes('app_admin')) && !item.is_payment_completed && (
                                <Button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!confirm('이 발주를 구매완료 처리하시겠습니까?')) return
                                    
                                    // UI 블로킹 방지를 위해 다음 틱으로 지연
                                    await new Promise(resolve => setTimeout(resolve, 0))
                                    
                                    try {
                                      const { error } = await supabase
                                        .from('purchase_requests')
                                        .update({ 
                                          is_payment_completed: true,
                                          payment_completed_at: new Date().toISOString()
                                        })
                                        .eq('id', item.id)

                                      if (error) throw error
                                      
                                      // 🚀 메모리 캐시 즉시 업데이트 (자동으로 notifyCacheListeners 호출됨)
                                      markPurchaseAsPaymentCompleted(item.id)
                                      
                                      toast.success('구매완료 처리되었습니다.')
                                    } catch (error) {
                                      toast.error('처리 중 오류가 발생했습니다.')
                                    }
                                  }}
                                  className="button-base bg-orange-500 hover:bg-orange-600 text-white"
                                >
                                  구매완료
                                </Button>
                              )}
                              
                              {/* 이미 구매완료된 경우 완료 표시 */}
                              {item.is_payment_completed && (
                                <div className="bg-green-100 text-green-700 px-2 py-1 business-radius-badge badge-text shrink-0">
                                  완료됨
                                </div>
                              )}
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

          {/* 입고 대기중 */}
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
                        const receivedItems = items.filter((i: any) => i.is_received).length
                        const progress = totalItems > 0 ? Math.round((receivedItems / totalItems) * 100) : 0
                        const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
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
      />
    </div>
  )
}