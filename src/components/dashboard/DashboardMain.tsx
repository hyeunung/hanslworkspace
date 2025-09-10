
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dashboardService } from '@/services/dashboardService'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Clock, CheckCircle, TrendingUp, Zap, Calendar, ArrowRight, Eye, ThumbsUp, X, Package, Truck, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import type { DashboardData, UrgentRequest, MyRequestStatus } from '@/types/purchase'
import { useNavigate } from 'react-router-dom'

export default function DashboardMain() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      setLoading(true)
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
      console.log('=== Dashboard Debug ===')
      console.log('Employee:', employee)
      console.log('Employee purchase_role:', employee.purchase_role)
      console.log('Dashboard Data:', dashboardData)
      console.log('Pending Approvals:', dashboardData.pendingApprovals)
      console.log('Pending Count:', dashboardData.pendingApprovals?.length || 0)
      console.log('===================')
      setData(dashboardData)
    } catch (error) {
      console.error('Dashboard load error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleQuickApprove = async (requestId: string) => {
    if (!data?.employee) return

    setActionLoading(requestId)
    try {
      const result = await dashboardService.quickApprove(requestId, data.employee)
      
      if (result.success) {
        toast.success('승인이 완료되었습니다.')
        loadDashboardData() // 데이터 새로고침
      } else {
        toast.error(result.error || '승인 처리 중 오류가 발생했습니다.')
      }
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    } finally {
      setActionLoading(null)
    }
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

  const canSeeApprovalBox = roles.some((r: string) => ['middle_manager', 'final_approver', 'app_admin'].includes(r))

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
                <div key={request.id} className="bg-white rounded-lg p-4 border border-red-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={getPriorityColor(request.priority)}>
                          {request.priority === 'high' ? '높음' : request.priority === 'medium' ? '보통' : '낮음'}
                        </Badge>
                        <span className="text-sm font-medium text-gray-900">
                          {request.vendor_name || '업체명 없음'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {request.daysOverdue}일 지연
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        발주요청번호: {request.purchase_order_number || request.id.slice(0, 8)}
                        <span className="ml-2">항목: {request.total_items}개</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        보기
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleQuickApprove(request.id)}
                        disabled={actionLoading === request.id}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        <ThumbsUp className="w-4 h-4 mr-1" />
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
                    {data.pendingApprovals.map((approval) => (
                      <div key={approval.id} className="border rounded-lg p-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm truncate">
                                {approval.requester_name}
                              </span>
                              <Badge 
                                variant="outline" 
                                className={`text-xs h-4 px-1 ${
                                  approval.middle_manager_status === 'approved' 
                                    ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                    : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                }`}
                              >
                                {approval.middle_manager_status === 'approved' ? '최종' : '1차'}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span className="truncate">{approval.vendor_name || '업체 미지정'}</span>
                              <span className="font-medium">{approval.total_amount?.toLocaleString()}원</span>
                              <span>{new Date(approval.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/purchase/requests/${approval.id}`)}
                              className="h-7 w-7 p-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleQuickApprove(approval.id)}
                              disabled={actionLoading === approval.id}
                              className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white"
                            >
                              {actionLoading === approval.id ? (
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <ThumbsUp className="w-3 h-3 mr-1" />
                                  승인
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
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
              <CardContent className="space-y-3">
                {data.myPurchaseStatus.waitingPurchase.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    <ShoppingCart className="w-6 h-6 mx-auto mb-1 text-gray-400" />
                    <p className="text-xs">구매 대기 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.waitingPurchase.slice(0, 5).map((item) => {
                    const items = item.purchase_request_items || []
                    const totalAmount = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.amount_value) || 0)
                    }, 0)
                    const totalQuantity = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.quantity) || 0)
                    }, 0)
                    const firstItem = items[0]
                    
                    return (
                      <div key={item.id} className="border rounded-lg p-2 hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium text-sm truncate">{item.vendor_name || '업체명 없음'}</span>
                          <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 shrink-0">
                            구매 대기
                          </Badge>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          {firstItem && (
                            <>
                              <div className="truncate">품명: {firstItem.item_name || '-'}</div>
                              <div className="truncate">규격: {firstItem.specification || '-'}</div>
                            </>
                          )}
                          <div>품목: {items.length}개 / 수량: {totalQuantity}</div>
                          <div className="font-medium text-gray-900">총액: {totalAmount.toLocaleString()}원</div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full mt-2"
                          onClick={() => navigate(`/purchase?highlight=${item.id}`)}
                        >
                          상세보기 <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
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
              <CardContent className="space-y-3">
                {data.myPurchaseStatus.waitingDelivery.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    <Truck className="w-6 h-6 mx-auto mb-1 text-gray-400" />
                    <p className="text-xs">입고 대기 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.waitingDelivery.slice(0, 5).map((item) => {
                    const totalItems = item.purchase_request_items?.length || 0
                    const receivedItems = item.purchase_request_items?.filter((i: any) => i.is_received).length || 0
                    const partialDelivery = receivedItems > 0 && receivedItems < totalItems
                    
                    return (
                      <div key={item.id} className="border rounded-lg p-2 hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium text-sm truncate">{item.vendor_name || '업체명 없음'}</span>
                          <Badge variant="outline" className={`text-xs shrink-0 ${partialDelivery ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
                            {partialDelivery ? '부분입고' : '입고 대기'}
                          </Badge>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          {item.purchase_request_items?.[0] && (
                            <>
                              <div className="truncate">품명: {item.purchase_request_items[0].item_name || '-'}</div>
                              <div className="truncate">규격: {item.purchase_request_items[0].specification || '-'}</div>
                            </>
                          )}
                          <div>품목: {totalItems}개 / 입고: {receivedItems}/{totalItems}</div>
                          <div className="font-medium text-gray-900">총액: {(item.purchase_request_items?.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0) || 0).toLocaleString()}원</div>
                        </div>
                        {partialDelivery && (
                          <div className="mt-2">
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div 
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${(receivedItems / totalItems) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full mt-2"
                          onClick={() => navigate(`/purchase?highlight=${item.id}`)}
                        >
                          상세보기 <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
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
                  <Package className="w-4 h-4 text-green-600" />
                  최근 완료
                  {data.myPurchaseStatus.recentCompleted.length > 0 && (
                    <Badge variant="outline" className="text-xs bg-green-50">
                      {data.myPurchaseStatus.recentCompleted.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.myPurchaseStatus.recentCompleted.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    <Package className="w-6 h-6 mx-auto mb-1 text-gray-400" />
                    <p className="text-xs">최근 완료 없음</p>
                  </div>
                ) : (
                  data.myPurchaseStatus.recentCompleted.slice(0, 5).map((item) => {
                    const items = item.purchase_request_items || []
                    const totalAmount = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.amount_value) || 0)
                    }, 0)
                    const totalQuantity = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.quantity) || 0)
                    }, 0)
                    const firstItem = items[0]
                    
                    return (
                      <div key={item.id} className="border rounded-lg p-2 hover:shadow-sm transition-shadow bg-green-50/30">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium text-sm truncate">{item.vendor_name || '업체명 없음'}</span>
                          <Badge className="text-xs bg-green-100 text-green-800 shrink-0">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            완료
                          </Badge>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          {firstItem && (
                            <>
                              <div className="truncate">품명: {firstItem.item_name || '-'}</div>
                              <div className="truncate">규격: {firstItem.specification || '-'}</div>
                            </>
                          )}
                          <div>품목: {items.length}개 / 수량: {totalQuantity}</div>
                          <div className="font-medium text-gray-900">총액: {totalAmount.toLocaleString()}원</div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full mt-2"
                          onClick={() => navigate(`/purchase?highlight=${item.id}`)}
                        >
                          상세보기 <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
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
    </div>
  )
}