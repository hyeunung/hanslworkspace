
import { useState, useEffect, lazy, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dashboardService } from '@/services/dashboardService'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Clock, CheckCircle, TrendingUp, Zap, Calendar, ArrowRight, Eye, ThumbsUp, X, Package, Truck, ShoppingCart, FileText, Building2 } from 'lucide-react'

// Lazy load modals for better performance
const PurchaseDetailModal = lazy(() => import('@/components/purchase/PurchaseDetailModal'))
const PurchaseStatusModal = lazy(() => import('@/components/dashboard/PurchaseStatusModal'))
import { toast } from 'sonner'
import type { DashboardData, UrgentRequest, MyRequestStatus } from '@/types/purchase'
import { useNavigate } from 'react-router-dom'

export default function DashboardMain() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [selectedApprovalId, setSelectedApprovalId] = useState<number | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([])
  
  // 구매/입고 상세 모달 상태
  const [selectedStatusItem, setSelectedStatusItem] = useState<any>(null)
  const [statusModalType, setStatusModalType] = useState<'purchase' | 'delivery' | 'completed' | null>(null)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false)
  
  const navigate = useNavigate()

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true)
      }
      const supabase = createClient()
      
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (!employee) return

      const dashboardData = await dashboardService.getDashboardData(employee)
      
      setData(dashboardData)
      
      // 사용자 role 설정
      if (employee.purchase_role) {
        const roles = Array.isArray(employee.purchase_role)
          ? employee.purchase_role.map((r: any) => String(r).trim())
          : String(employee.purchase_role)
              .split(',')
              .map((r: string) => r.trim())
              .filter((r: string) => r.length > 0)
        setCurrentUserRoles(roles)
      }
    } catch (error) {
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }

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

  const handleStatusClick = (item: any, type: 'purchase' | 'delivery' | 'completed') => {
    setSelectedStatusItem(item)
    setStatusModalType(type)
    setIsStatusModalOpen(true)
  }

  const getPriorityColor = (priority: 'high' | 'medium' | 'low') => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-green-100 text-green-800 border-green-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
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
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-hansl-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-sm text-gray-600">대시보드를 불러오고 있습니다...</p>
        </div>
      </div>
    )
  }

  if (!data?.employee) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center bg-white p-8 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">사용자 정보를 찾을 수 없습니다</h3>
          <p className="text-sm text-gray-600">로그인을 다시 시도해주세요.</p>
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
      <div className="w-full">
        {/* 헤더 */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
              <p className="text-sm text-gray-600 mt-1">
                {data.employee.name}님, 환영합니다. 📊
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs">
                {new Date().toLocaleDateString('ko-KR', { 
                  month: 'long', 
                  day: 'numeric',
                  weekday: 'short'
                })}
              </Badge>
            </div>
          </div>
        </div>

        {/* 긴급 알림 섹션 */}
        {data.urgentRequests.length > 0 && (
          <Card className="mb-4 border-red-200 bg-red-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-red-800">
                <AlertTriangle className="w-5 h-5" />
                긴급 처리 필요 ({data.urgentRequests.length}건)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.urgentRequests.slice(0, 3).map((request) => (
                <div key={request.id} className="bg-white rounded-lg p-3 sm:p-4 border border-red-200">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge className={getPriorityColor(request.priority)}>
                          {request.priority === 'high' ? '높음' : request.priority === 'medium' ? '보통' : '낮음'}
                        </Badge>
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[150px] sm:max-w-none">
                          {request.vendor_name || '업체명 없음'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {request.daysOverdue}일 지연
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600">
                        <span className="block sm:inline">발주번호: {request.purchase_order_number || request.id.slice(0, 8)}</span>
                        <span className="block sm:inline sm:ml-2">항목: {request.total_items}개</span>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                        className="text-xs sm:text-sm"
                      >
                        <Eye className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                        보기
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleQuickApprove(request.id)}
                        disabled={actionLoading === request.id}
                        className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm"
                      >
                        <ThumbsUp className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                        {actionLoading === request.id ? '처리중...' : '승인'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}


        {/* 메인 콘텐츠 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* 내 승인 진행중 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">{data.employee.name}님의 승인 진행중</CardTitle>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => navigate('/purchase')}
                >
                  전체보기 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.myRecentRequests.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-xs">승인 진행중 없음</p>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={() => navigate('/purchase/new')}
                  >
                    새 요청
                  </Button>
                </div>
              ) : (
                data.myRecentRequests.slice(0, 5).map((request) => (
                  <div key={request.id} className="border rounded-lg p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{request.vendor_name}</span>
                        <Badge className="bg-yellow-100 text-yellow-800" variant="outline">
                          {request.middle_manager_status === 'pending' ? '중간 승인 대기' : '최종 승인 대기'}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(request.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                    
                    <div className="mb-2">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">승인 진행률</span>
                        <span className="font-medium">
                          {request.middle_manager_status === 'pending' ? '25%' : '50%'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: request.middle_manager_status === 'pending' ? '25%' : '50%' }}
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">{request.next_action}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                      >
                        상세보기 <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* 승인 대기 (승인 권한자만 표시) */}
          {canSeeApprovalBox && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-500" />
                    승인 대기
                    {data.pendingApprovals.length > 0 && (
                      <Badge variant="destructive" className="text-xs h-5 px-1.5">
                        {data.pendingApprovals.length}
                      </Badge>
                    )}
                  </CardTitle>
                  {data.pendingApprovals.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate('/purchase')}
                      className="text-xs"
                    >
                      전체보기
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.pendingApprovals.length === 0 ? (
                  <div className="text-center py-4 text-gray-400">
                    <CheckCircle className="w-6 h-6 mx-auto mb-1" />
                    <p className="text-xs">대기 항목 없음</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2">
                    {data.pendingApprovals.map((approval) => {
                      // 첫 번째 품목 정보 가져오기
                      const firstItem = approval.purchase_request_items?.[0]
                      const totalItems = approval.purchase_request_items?.length || 0
                      const isAdvance = approval.progress_type?.includes('선진행')
                      
                      return (
                        <div 
                          key={approval.id} 
                          className="border rounded-lg p-2 sm:p-2.5 hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={(e) => {
                            // 버튼 클릭시에는 카드 클릭 이벤트 무시
                            if ((e.target as HTMLElement).closest('button')) return
                            setSelectedApprovalId(Number(approval.id))
                            setIsModalOpen(true)
                          }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {/* 첫번째 줄: 요청자, 뱃지들 */}
                              <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mb-1">
                                <span className="font-medium text-xs sm:text-sm">
                                  {approval.requester_name}
                                </span>
                                <Badge 
                                  variant="outline" 
                                  className={`text-[9px] sm:text-[10px] h-3 sm:h-3.5 px-1 ${
                                    approval.middle_manager_status === 'approved' 
                                      ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                      : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                  }`}
                                >
                                  {approval.middle_manager_status === 'approved' ? '최종' : '1차'}
                                </Badge>
                                {isAdvance && (
                                  <Badge 
                                    variant="outline"
                                    className="text-[9px] sm:text-[10px] h-3 sm:h-3.5 px-1 bg-red-50 text-red-700 border-red-200"
                                  >
                                    선진행
                                  </Badge>
                                )}
                                <span className="text-[9px] sm:text-[10px] text-gray-500">
                                  {new Date(approval.request_date || approval.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                </span>
                              </div>
                              
                              {/* 두번째 줄: 발주번호, 업체, 품목 */}
                              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] text-gray-600 mb-1">
                                {approval.purchase_order_number && (
                                  <>
                                    <span className="font-medium text-gray-700">{approval.purchase_order_number}</span>
                                    <span className="text-gray-400 hidden sm:inline">•</span>
                                  </>
                                )}
                                <span className="truncate max-w-[120px] sm:max-w-[100px]">{approval.vendor_name || '업체 미지정'}</span>
                                {firstItem && (
                                  <>
                                    <span className="text-gray-400 hidden sm:inline">•</span>
                                    <span className="truncate max-w-[120px] sm:max-w-[150px]">
                                      {firstItem.item_name}
                                      {totalItems > 1 && <span className="text-hansl-600"> 외 {totalItems - 1}</span>}
                                    </span>
                                  </>
                                )}
                              </div>
                              
                              {/* 모바일: 금액 표시 */}
                              <div className="sm:hidden">
                                <span className="text-xs font-semibold text-gray-900">
                                  ₩{approval.total_amount?.toLocaleString() || '0'}
                                </span>
                              </div>
                            </div>
                            
                            {/* 데스크톱: 금액 + 버튼 / 모바일: 버튼만 */}
                            <div className="flex items-center gap-2 justify-end">
                              <span className="hidden sm:block text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                                ₩{approval.total_amount?.toLocaleString() || '0'}
                              </span>
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleQuickApprove(approval.id)
                                }}
                                disabled={actionLoading === approval.id}
                                className={`h-5 sm:h-6 px-2 text-white text-[10px] sm:text-xs ${
                                  approval.middle_manager_status === 'approved' 
                                    ? 'bg-blue-600 hover:bg-blue-700' 
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                {actionLoading === approval.id ? (
                                  <div className="w-2 sm:w-2.5 h-2 sm:h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  approval.middle_manager_status === 'approved' ? '최종승인' : '1차승인'
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 구매/입고 추적 섹션 */}
        <div className="mt-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-600" />
            {data.employee.name}님의 발주 처리 현황
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 구매 대기중 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-yellow-600" />
                  구매 대기
                  {data.myPurchaseStatus.waitingPurchase.length > 0 && (
                    <Badge variant="outline" className="text-xs bg-yellow-50">
                      {data.myPurchaseStatus.waitingPurchase.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.myPurchaseStatus.waitingPurchase.length === 0 ? (
                  <div className="text-center py-6 text-gray-500">
                    <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-xs">구매 대기 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.waitingPurchase.slice(0, 4).map((item) => {
                    const items = item.purchase_request_items || []
                    const totalAmount = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.amount_value) || 0)
                    }, 0)
                    
                    return (
                      <div 
                        key={item.id} 
                        className="border rounded-lg p-2.5 sm:p-3 hover:shadow-md transition-all cursor-pointer hover:bg-gray-50"
                        onClick={() => handleStatusClick(item, 'purchase')}
                      >
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="font-medium text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">{item.vendor_name || '업체명 없음'}</span>
                          <Badge variant="outline" className="text-[10px] sm:text-xs bg-yellow-50 text-yellow-700 shrink-0">
                            구매대기
                          </Badge>
                        </div>
                        <div className="text-[10px] sm:text-xs text-gray-600 space-y-0.5">
                          <div>품목 {items.length}개</div>
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-900 text-xs sm:text-sm">₩{totalAmount.toLocaleString()}</span>
                            <span className="text-[10px] sm:text-xs text-gray-400">
                              {new Date(item.created_at).toLocaleDateString('ko-KR', { 
                                month: 'short', 
                                day: 'numeric' 
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            {/* 입고 대기중 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-600" />
                  입고 대기
                  {data.myPurchaseStatus.waitingDelivery.length > 0 && (
                    <Badge variant="outline" className="text-xs bg-blue-50">
                      {data.myPurchaseStatus.waitingDelivery.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.myPurchaseStatus.waitingDelivery.length === 0 ? (
                  <div className="text-center py-6 text-gray-500">
                    <Truck className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-xs">입고 대기 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.waitingDelivery.slice(0, 4).map((item) => {
                    const totalItems = item.purchase_request_items?.length || 0
                    const receivedItems = item.purchase_request_items?.filter((i: any) => i.is_received).length || 0
                    const partialDelivery = receivedItems > 0 && receivedItems < totalItems
                    const totalAmount = item.purchase_request_items?.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0) || 0
                    
                    return (
                      <div 
                        key={item.id} 
                        className="border rounded-lg p-2.5 sm:p-3 hover:shadow-md transition-all cursor-pointer hover:bg-gray-50"
                        onClick={() => handleStatusClick(item, 'delivery')}
                      >
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="font-medium text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">{item.vendor_name || '업체명 없음'}</span>
                          <Badge variant="outline" className={`text-[10px] sm:text-xs shrink-0 ${partialDelivery ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
                            {partialDelivery ? '부분입고' : '입고대기'}
                          </Badge>
                        </div>
                        <div className="text-[10px] sm:text-xs text-gray-600 space-y-0.5">
                          <div>품목 {totalItems}개 • 입고 {receivedItems}/{totalItems}</div>
                          {partialDelivery && (
                            <div className="w-full bg-gray-200 rounded-full h-1 sm:h-1.5 my-0.5 sm:my-1">
                              <div 
                                className="bg-blue-500 h-1 sm:h-1.5 rounded-full"
                                style={{ width: `${(receivedItems / totalItems) * 100}%` }}
                              />
                            </div>
                          )}
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-900 text-xs sm:text-sm">₩{totalAmount.toLocaleString()}</span>
                            <span className="text-[10px] sm:text-xs text-gray-400">
                              {new Date(item.created_at).toLocaleDateString('ko-KR', { 
                                month: 'short', 
                                day: 'numeric' 
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            {/* 최근 완료 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  최근 완료 (7일)
                  {data.myPurchaseStatus.recentCompleted.length > 0 && (
                    <Badge variant="outline" className="text-xs bg-green-50">
                      {data.myPurchaseStatus.recentCompleted.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.myPurchaseStatus.recentCompleted.length === 0 ? (
                  <div className="text-center py-6 text-gray-500">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-xs">최근 완료 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.recentCompleted.slice(0, 4).map((item) => {
                    const items = item.purchase_request_items || []
                    const totalAmount = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.amount_value) || 0)
                    }, 0)
                    
                    return (
                      <div 
                        key={item.id} 
                        className="border rounded-lg p-2.5 sm:p-3 hover:shadow-md transition-all cursor-pointer hover:bg-green-50/50 bg-green-50/20"
                        onClick={() => handleStatusClick(item, 'completed')}
                      >
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="font-medium text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">{item.vendor_name || '업체명 없음'}</span>
                          <Badge className="text-[10px] sm:text-xs bg-green-100 text-green-800 shrink-0">
                            완료
                          </Badge>
                        </div>
                        <div className="text-[10px] sm:text-xs text-gray-600 space-y-0.5">
                          <div>품목 {items.length}개</div>
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-900 text-xs sm:text-sm">₩{totalAmount.toLocaleString()}</span>
                            <span className="text-[10px] sm:text-xs text-gray-400">
                              {new Date(item.received_at || item.created_at).toLocaleDateString('ko-KR', { 
                                month: 'short', 
                                day: 'numeric' 
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 오늘의 요약 - 상단 통계에 통합 */}
      </div>
      
      {/* 승인 상세보기 모달 */}
      <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>}>
        <PurchaseDetailModal
        purchaseId={selectedApprovalId}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedApprovalId(null)
        }}
        currentUserRoles={currentUserRoles}
        onRefresh={() => {
          loadDashboardData()
          setIsModalOpen(false)
          setSelectedApprovalId(null)
          }}
        />
      </Suspense>
      
      {/* 구매/입고 상태 상세보기 모달 */}
      <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>}>
        <PurchaseStatusModal
        isOpen={isStatusModalOpen}
        onClose={() => {
          setIsStatusModalOpen(false)
          setSelectedStatusItem(null)
          setStatusModalType(null)
        }}
        item={selectedStatusItem}
          type={statusModalType as any}
        />
      </Suspense>
    </div>
  )
}