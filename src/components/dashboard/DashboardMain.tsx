
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dashboardService } from '@/services/dashboardService'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AlertTriangle, Clock, CheckCircle, TrendingUp, Zap, Calendar, ArrowRight, Eye, ThumbsUp, X, Package, Truck, ShoppingCart, FileText, Building2, Download } from 'lucide-react'
import ExcelJS from 'exceljs'

// Import modals
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import PurchaseStatusModal from '@/components/dashboard/PurchaseStatusModal'
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
  const [undownloadedOrders, setUndownloadedOrders] = useState<any[]>([])
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())
  const [selectedOrder, setSelectedOrder] = useState<any>(null)
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false)
  
  // 구매/입고 상세 모달 상태
  const [selectedStatusItem, setSelectedStatusItem] = useState<any>(null)
  const [statusModalType, setStatusModalType] = useState<'purchase' | 'delivery' | 'completed' | null>(null)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false)
  
  const navigate = useNavigate()
  const supabase = createClient()

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true)
      } else {
        // 로딩 표시 없이 새로고침할 때는 기존 data를 유지
        // data가 null이 되는 것을 방지
      }
      
      // 캐시 클리어 (임시)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('dashboard-cache')
        sessionStorage.clear()
      }
      
      // 상태 초기화
      setData(null)
      const supabase = createClient()
      
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError) {
        console.error('Auth error:', authError)
        toast.error('인증 정보를 불러올 수 없습니다.')
        return
      }
      
      if (!user) {
        console.error('No user found in auth')
        toast.error('로그인이 필요합니다.')
        return
      }

      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (employeeError || !employee) {
        console.error('Employee fetch error:', employeeError)
        // employee가 없어도 기본값으로 대시보드 표시
        const defaultEmployee = {
          id: user.id,
          name: user.email?.split('@')[0] || 'Guest User',  // 이메일에서 이름 추출
          email: user.email || '',
          purchase_role: null
        }
        
        try {
          const dashboardData = await dashboardService.getDashboardData(defaultEmployee as any)
          setData(dashboardData)
        } catch (err) {
          console.error('❌ 대시보드 데이터 로딩 에러:', err)
        }
        
        setLoading(false)
        return
      }

      console.log('🔍 조회된 Employee 데이터:', {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        employee_number: employee.employee_number,
        employeeID: employee.employeeID,
        purchase_role: employee.purchase_role
      })

      console.log('========== 대시보드 데이터 로딩 시작 ==========')
      console.log('1️⃣ 현재 사용자:', employee.name, '/ Email:', employee.email)
      console.log('2️⃣ Purchase Role:', employee.purchase_role)
      
      try {
        const dashboardData = await dashboardService.getDashboardData(employee)
        
        // 전체 입고대기 건수 조회 추가
        const totalDeliveryWaiting = await dashboardService.getTotalDeliveryWaitingCount()
        
        console.log('3️⃣ 대시보드 데이터 로딩 완료:', {
          hasData: !!dashboardData,
          hasEmployee: !!dashboardData.employee,
          employeeName: dashboardData.employee?.name,
          hasMyPurchaseStatus: !!dashboardData.myPurchaseStatus,
          myPurchaseStatusCount: dashboardData.myPurchaseStatus?.waitingPurchase?.length || 0,
          totalDeliveryWaiting: totalDeliveryWaiting,
          pendingApprovalsCount: dashboardData.pendingApprovals?.length || 0,
          pendingApprovals: dashboardData.pendingApprovals?.map(item => ({
            발주번호: item.purchase_order_number,
            요청자: item.requester_name,
            최종승인: item.final_manager_status
          }))
        })
        
        setData({
          ...dashboardData,
          totalDeliveryWaitingCount: totalDeliveryWaiting
        })
      } catch (err) {
        console.error('❌ 대시보드 데이터 로딩 에러:', err)
        toast.error('대시보드 데이터를 불러오는데 실패했습니다.')
      }
      
      // 사용자 role 설정
      if (employee.purchase_role) {
        const roles = Array.isArray(employee.purchase_role)
          ? employee.purchase_role.map((r: any) => String(r).trim())
          : String(employee.purchase_role)
              .split(',')
              .map((r: string) => r.trim())
              .filter((r: string) => r.length > 0)
        setCurrentUserRoles(roles)
        
        // lead buyer 또는 "lead buyer" (공백 포함)인 경우 미다운로드 항목 조회
        if (roles.includes('lead buyer') || roles.includes('lead buyer')) {
          const undownloaded = await dashboardService.getUndownloadedOrders(employee)
          setUndownloadedOrders(undownloaded)
        }
      }
    } catch (error) {
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }

  const handleQuickApprove = async (requestId: string) => {
    console.log('handleQuickApprove 호출:', {
      requestId: requestId,
      hasData: !!data,
      hasEmployee: !!data?.employee,
      employee: data?.employee
    })
    
    if (!data?.employee) {
      console.error('handleQuickApprove 에러: data.employee가 없음', {
        data: data
      })
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

  const handleDownloadExcel = async (purchase: any) => {
    try {
      setDownloadingIds(prev => new Set(prev).add(purchase.id))
      
      // Excel 파일 생성 (FastPurchaseTable과 동일한 로직)
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('발주서')
      
      // 헤더 설정
      worksheet.columns = [
        { header: '발주번호', key: 'purchase_order_number', width: 20 },
        { header: '업체명', key: 'vendor_name', width: 30 },
        { header: '품목명', key: 'item_name', width: 40 },
        { header: '규격', key: 'specification', width: 30 },
        { header: '수량', key: 'quantity', width: 15 },
        { header: '단가', key: 'unit_price', width: 20 },
        { header: '금액', key: 'amount', width: 20 },
        { header: '요청일', key: 'request_date', width: 15 },
        { header: '진행상태', key: 'progress_type', width: 15 }
      ]
      
      // 데이터 추가
      const items = purchase.purchase_request_items || []
      items.forEach((item: any) => {
        worksheet.addRow({
          purchase_order_number: purchase.purchase_order_number,
          vendor_name: purchase.vendor_name || purchase.vendors?.vendor_name || '',
          item_name: item.item_name || '',
          specification: item.specification || '',
          quantity: item.quantity || 0,
          unit_price: item.unit_price_value || 0,
          amount: item.amount_value || 0,
          request_date: purchase.request_date || '',
          progress_type: purchase.progress_type || ''
        })
      })
      
      // 스타일 적용
      worksheet.getRow(1).font = { bold: true }
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }
      
      // 파일 다운로드
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `발주서_${purchase.purchase_order_number}_${new Date().toISOString().slice(0, 10)}.xlsx`
      link.click()
      window.URL.revokeObjectURL(url)
      
      // lead buyer인 경우 is_po_download를 true로 업데이트
      if (currentUserRoles.includes('lead buyer') || currentUserRoles.includes('lead buyer')) {
        await supabase
          .from('purchase_requests')
          .update({ is_po_download: true })
          .eq('id', purchase.id)
        
        // UI에서 제거
        setUndownloadedOrders(prev => prev.filter(item => item.id !== purchase.id))
      }
      
      toast.success('발주서가 다운로드되었습니다.')
    } catch (error) {
      console.error('Excel download error:', error)
      toast.error('다운로드 중 오류가 발생했습니다.')
    } finally {
      setDownloadingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(purchase.id)
        return newSet
      })
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

  const canSeeApprovalBox = roles.some((r: string) => ['middle_manager', 'final_approver', 'app_admin', 'raw_material_manager', 'consumable_manager'].includes(r))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 lg:px-6">
        {/* 헤더 */}
        <div className="mb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">대시보드</h1>
              <p className="text-xs text-gray-600 mt-0.5">
                {data.employee.name}님, 환영합니다. 📊
              </p>
            </div>
            <div className="flex items-center gap-2">
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
          <Card className="mb-3 border-red-200 bg-red-50">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="flex items-center gap-2 text-red-800 text-sm">
                <AlertTriangle className="w-4 h-4" />
                긴급 처리 필요 ({data.urgentRequests.length}건)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="flex gap-2 overflow-x-auto pb-2">
              {data.urgentRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="bg-white rounded-lg p-2 border border-red-200 min-w-[280px] flex-shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1 mb-1">
                        <Badge className={`${getPriorityColor(request.priority)} text-[10px] h-4 px-1`}>
                          {request.priority === 'high' ? '높음' : request.priority === 'medium' ? '보통' : '낮음'}
                        </Badge>
                        <span className="text-xs font-medium text-gray-900 truncate max-w-[120px]">
                          {request.vendor_name || '업체명 없음'}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {request.daysOverdue}일 지연
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-600">
                        <span>발주: {request.purchase_order_number || request.id.slice(0, 8)}</span>
                        <span className="ml-1">• {request.total_items}개</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                        className="h-6 px-2 text-[10px]"
                      >
                        <Eye className="w-3 h-3 mr-0.5" />
                        보기
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleQuickApprove(request.id)}
                        disabled={actionLoading === request.id}
                        className="bg-red-600 hover:bg-red-700 h-6 px-2 text-[10px]"
                      >
                        <ThumbsUp className="w-3 h-3 mr-0.5" />
                        {actionLoading === request.id ? '처리중' : '승인'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </CardContent>
          </Card>
        )}



        {/* 통합 대시보드 그리드 */}
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-gray-600" />
            전체 현황
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* Lead Buyer - 미다운로드 발주서 */}
          {(currentUserRoles.includes('lead buyer') || currentUserRoles.includes('lead buyer')) && undownloadedOrders.length > 0 && (
            <Card className="w-full col-span-1 row-span-2 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-orange-600" />
                    <span className="text-gray-900">미다운로드 발주서</span>
                  </div>
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 px-2 py-0.5">
                    {undownloadedOrders.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-2">
                  {undownloadedOrders.slice(0, 5).map((item) => {
                    const items = item.purchase_request_items || []
                    const firstItem = items[0] || {}
                    const totalAmount = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.amount_value) || 0)
                    }, 0)
                    const totalQty = items.reduce((sum: number, i: any) => {
                      return sum + (Number(i.quantity) || 0)
                    }, 0)
                    const daysSince = Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24))
                    const isAdvance = item.progress_type === '선진행'
                    
                    return (
                      <div 
                        key={item.id} 
                        className={`border rounded-lg p-3 transition-all cursor-pointer hover:shadow-sm ${
                          isAdvance ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                        }`}
                        onClick={() => {
                          setSelectedOrder(item)
                          setIsOrderModalOpen(true)
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm text-gray-900">
                                {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                              </span>
                              {isAdvance && (
                                <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200 px-1.5 py-0">
                                  선진행
                                </Badge>
                              )}
                              {daysSince > 3 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {daysSince}일 경과
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-gray-600">
                                {item.vendor_name || '업체명 없음'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {firstItem.item_name || '품목'} 
                                {items.length > 1 && (
                                  <span className="text-gray-400"> 외 {items.length - 1}건</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            <div className="text-sm font-bold text-gray-900">
                              ₩{totalAmount.toLocaleString()}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] border-orange-200 hover:bg-orange-50"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownloadExcel(item)
                              }}
                              disabled={downloadingIds.has(item.id)}
                            >
                              {downloadingIds.has(item.id) ? (
                                <div className="w-3 h-3 border border-orange-600 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <Download className="w-3 h-3 mr-1" />
                                  다운로드
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {undownloadedOrders.length > 5 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full text-xs h-8 border-gray-200 hover:bg-gray-50"
                      onClick={() => navigate('/purchase/list?tab=purchase')}
                    >
                      전체보기 ({undownloadedOrders.length}건) →
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 내 승인 진행중 */}
          <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="py-3 px-4 bg-gray-50 border-b">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-600" />
                  <span className="text-gray-900">내 승인 진행중</span>
                </div>
                {data.myRecentRequests.length > 0 && (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-200 px-2 py-0.5">
                    {data.myRecentRequests.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {data.myRecentRequests.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Clock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-medium">승인 진행중인 항목이 없습니다</p>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="mt-3 h-8 text-xs px-4 border-gray-200"
                    onClick={() => navigate('/purchase/new')}
                  >
                    새 요청 작성
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.myRecentRequests.slice(0, 3).map((request) => {
                    const progress = request.middle_manager_status === 'pending' ? 25 : 50
                    
                    return (
                      <div 
                        key={request.id} 
                        className="border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-all cursor-pointer hover:shadow-sm"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm text-gray-900">
                                {request.purchase_order_number || `PO-${request.id.slice(0, 8)}`}
                              </span>
                              <Badge className="text-[10px] bg-purple-100 text-purple-700 border-purple-200 px-1.5 py-0">
                                {progress}% 진행
                              </Badge>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-gray-600">
                                {request.vendor_name || '업체명 없음'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {request.total_items}개 품목
                              </div>
                              <div className="flex items-center gap-2 mt-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-2">
                                  <div 
                                    className="bg-purple-600 h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-600">{progress}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            <div className="text-sm font-bold text-gray-900">
                              ₩{(request.total_amount || 0).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-gray-500">
                              {request.current_step === 'approval' ? '승인 대기' : request.current_step === 'purchase' ? '구매 대기' : '진행중'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {data.myRecentRequests.length > 3 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full text-xs h-8 border-gray-200 hover:bg-gray-50"
                      onClick={() => navigate('/purchase')}
                    >
                      전체보기 ({data.myRecentRequests.length}건) →
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 승인 대기 (승인 권한자만 표시) */}
          {canSeeApprovalBox && (
            <Card className="w-full col-span-1 row-span-2">
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-orange-500" />
                    승인 대기
                    {data.pendingApprovals.length > 0 && (
                      <Badge variant="destructive" className="text-[10px] h-4 px-1">
                        {data.pendingApprovals.length}
                      </Badge>
                    )}
                  </CardTitle>
                  {data.pendingApprovals.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate('/purchase')}
                      className="h-6 px-2"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-3">
                {/* 임시 디버그 */}
                {console.log('🚨 승인 대기 카드 렌더링:', {
                  pendingApprovalsLength: data.pendingApprovals.length,
                  pendingApprovals: data.pendingApprovals.map(item => ({
                    id: item.id,
                    발주번호: item.purchase_order_number,
                    요청자: item.requester_name,
                    최종승인: item.final_manager_status
                  }))
                })}
                {data.pendingApprovals.length === 0 ? (
                  <div className="text-center py-4 text-gray-400">
                    <CheckCircle className="w-6 h-6 mx-auto mb-1" />
                    <p className="text-xs">대기 항목 없음</p>
                  </div>
                  ) : (
                  <div className="space-y-1.5">
                    {data.pendingApprovals.slice(0, 5).map((approval) => {
                      const items = approval.purchase_request_items || []
                      const firstItem = items[0] || {}
                      const totalAmount = approval.total_amount || items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                      const isAdvance = approval.progress_type === '선진행'
                      
                      return (
                        <div 
                          key={approval.id} 
                          className={`border rounded-lg p-2 hover:shadow-sm transition-all cursor-pointer ${
                            isAdvance ? 'bg-red-50 border-red-200' : 'hover:bg-orange-50/30'
                          }`}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button')) return
                            setSelectedApprovalId(Number(approval.id))
                            setIsModalOpen(true)
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 mb-1">
                                <span className="font-medium text-[11px]">
                                  {approval.purchase_order_number}
                                </span>
                                {isAdvance && (
                                  <Badge className="text-[8px] bg-red-100 text-red-800 px-1 h-3.5">
                                    선진행
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-600 space-y-0.5">
                                <div className="truncate">
                                  {firstItem.item_name || '품목'} {items.length > 1 && `외 ${items.length - 1}건`}
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="truncate max-w-[100px]">{approval.vendor_name || '업체'}</span>
                                  <span className="font-semibold text-gray-900">₩{(totalAmount/1000000).toFixed(1)}M</span>
                                </div>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleQuickApprove(approval.id)
                              }}
                              disabled={actionLoading === approval.id}
                              className={`h-7 px-2 text-white text-[10px] shrink-0 ${
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
                )}
              </CardContent>
            </Card>
          )}
          
          {/* 구매 대기중 - 모든 사용자에게 표시 (본인 것만) */}
          <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-yellow-600" />
                    <span className="text-gray-900">구매 대기</span>
                  </div>
                  {data.myPurchaseStatus && data.myPurchaseStatus.waitingPurchase && data.myPurchaseStatus.waitingPurchase.length > 0 && (
                    <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 px-2 py-0.5">
                      {data.myPurchaseStatus.waitingPurchase.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {!data.myPurchaseStatus || !data.myPurchaseStatus.waitingPurchase || data.myPurchaseStatus.waitingPurchase.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium">구매 대기 항목이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.myPurchaseStatus.waitingPurchase.slice(0, 3).map((item) => {
                      const items = item.purchase_request_items || []
                      const firstItem = items[0]
                      const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                      const isSeonJin = (item.progress_type || '').includes('선진행')
                      
                      return (
                        <div 
                          key={item.id} 
                          className={`border rounded-lg p-3 transition-all cursor-pointer hover:shadow-sm ${
                            isSeonJin ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                          }`}
                          onClick={() => handleStatusClick(item, 'purchase')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-gray-900">
                                  {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                                </span>
                                {isSeonJin && (
                                  <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200 px-1.5 py-0">
                                    선진행
                                  </Badge>
                                )}
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs text-gray-600">
                                  {item.vendor_name || '업체명 없음'}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {firstItem?.item_name || '품목'} 
                                  {items.length > 1 && (
                                    <span className="text-gray-400"> 외 {items.length - 1}건</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right space-y-1">
                              <div className="text-sm font-bold text-gray-900">
                                ₩{totalAmount.toLocaleString()}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {new Date(item.request_date).toLocaleDateString('ko-KR')}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {/* Lead Buyer인 경우 구매 처리하기 버튼 표시 */}
                    {(currentUserRoles.includes('lead_buyer') || currentUserRoles.includes('lead buyer')) && (
                      <Button 
                        className="w-full bg-yellow-600 hover:bg-yellow-700 text-xs h-8"
                        onClick={() => navigate('/purchase/list')}
                      >
                        구매 처리하기
                      </Button>
                    )}
                    
                    {/* 일반 사용자 또는 3개 이상인 경우 전체보기 버튼 */}
                    {data.myPurchaseStatus.waitingPurchase.length > 3 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs h-8 border-gray-200 hover:bg-gray-50"
                        onClick={() => navigate('/purchase?tab=purchase')}
                      >
                        전체보기 ({data.myPurchaseStatus.waitingPurchase.length}건) →
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
          </Card>

          {/* 입고 대기중 */}
          <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-blue-600" />
                    <span className="text-gray-900">입고 대기</span>
                  </div>
                  {data.myPurchaseStatus.waitingDelivery.length > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 px-2 py-0.5">
                      {data.myPurchaseStatus.waitingDelivery.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {data.myPurchaseStatus.waitingDelivery.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Truck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium">입고 대기 항목이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.myPurchaseStatus.waitingDelivery.slice(0, 3).map((item) => {
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
                          className={`border rounded-lg p-3 transition-all cursor-pointer hover:shadow-sm ${
                            isSeonJin ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                          }`}
                          onClick={() => handleStatusClick(item, 'delivery')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-gray-900">
                                  {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                                </span>
                                {isSeonJin && (
                                  <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200 px-1.5 py-0">
                                    선진행
                                  </Badge>
                                )}
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs text-gray-600">
                                  {item.vendor_name || '업체명 없음'}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {firstItem?.item_name || '품목'} 
                                  {totalItems > 1 && (
                                    <span className="text-gray-400"> 외 {totalItems - 1}건</span>
                                  )}
                                </div>
                                {item.delivery_request_date && (
                                  <div className="text-xs text-blue-600 font-medium">
                                    납기: {new Date(item.delivery_request_date).toLocaleDateString('ko-KR')}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right space-y-1">
                              <div className="text-sm font-bold text-gray-900">
                                ₩{totalAmount.toLocaleString()}
                              </div>
                              {progress > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-gray-600">
                                    {receivedItems}/{totalItems} 입고 ({progress}%)
                                  </div>
                                  <div className="w-16 bg-gray-200 rounded-full h-1.5">
                                    <div 
                                      className="bg-blue-600 h-1.5 rounded-full"
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {data.myPurchaseStatus.waitingDelivery.length > 3 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs h-8 border-gray-200 hover:bg-gray-50"
                        onClick={() => navigate('/purchase?tab=receipt')}
                      >
                        전체보기 ({data.myPurchaseStatus.waitingDelivery.length}건) →
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
          </Card>

          {/* 최근 완료 */}
          <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-gray-900">최근 완료</span>
                  </div>
                  {data.myPurchaseStatus.recentCompleted.length > 0 && (
                    <Badge className="bg-green-100 text-green-700 border-green-200 px-2 py-0.5">
                      {data.myPurchaseStatus.recentCompleted.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {data.myPurchaseStatus.recentCompleted.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <CheckCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium">최근 완료 항목이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.myPurchaseStatus.recentCompleted.slice(0, 3).map((item) => {
                      const items = item.purchase_request_items || []
                      const firstItem = items[0]
                      const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                      
                      return (
                        <div 
                          key={item.id} 
                          className="border border-green-200 rounded-lg p-3 bg-green-50 hover:bg-green-100 transition-all cursor-pointer hover:shadow-sm"
                          onClick={() => handleStatusClick(item, 'completed')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-gray-900">
                                  {item.purchase_order_number || `PO-${item.id.slice(0, 8)}`}
                                </span>
                                <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 px-1.5 py-0">
                                  완료
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs text-gray-600">
                                  {item.vendor_name || '업체명 없음'}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {firstItem?.item_name || '품목'} 
                                  {items.length > 1 && (
                                    <span className="text-gray-400"> 외 {items.length - 1}건</span>
                                  )}
                                </div>
                                {item.received_at && (
                                  <div className="text-xs text-green-600 font-medium">
                                    입고완료: {new Date(item.received_at).toLocaleDateString('ko-KR')}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right space-y-1">
                              <div className="text-sm font-bold text-gray-900">
                                ₩{totalAmount.toLocaleString()}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {new Date(item.received_at || item.created_at).toLocaleDateString('ko-KR')}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {data.myPurchaseStatus.recentCompleted.length > 3 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs h-8 border-gray-200 hover:bg-gray-50"
                        onClick={() => navigate('/purchase?tab=done')}
                      >
                        전체보기 ({data.myPurchaseStatus.recentCompleted.length}건) →
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
          </Card>
        </div>

        {/* 오늘의 요약 - 상단 통계에 통합 */}
      </div>
      
      {/* 승인 상세보기 모달 */}
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
      
      {/* 구매/입고 상태 상세보기 모달 */}
      <PurchaseStatusModal
          isOpen={isStatusModalOpen}
          onClose={() => {
            setIsStatusModalOpen(false)
            setSelectedStatusItem(null)
            setStatusModalType(null)
          }}
          item={selectedStatusItem}
          type={statusModalType as any}
          onRefresh={() => loadDashboardData(false)}
      />

      {/* Order Detail Modal - PurchaseStatusModal과 동일한 디자인 */}
      {isOrderModalOpen && selectedOrder && (
        <Dialog open={isOrderModalOpen} onOpenChange={() => {
          setIsOrderModalOpen(false)
          setSelectedOrder(null)
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">
                {selectedOrder.purchase_order_number} 상세보기
              </DialogTitle>
              <DialogDescription>
                {selectedOrder.vendor_name || '업체명 없음'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* 기본 정보 */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="font-semibold mb-4 flex items-center text-gray-900">
                  <FileText className="w-5 h-5 mr-2 text-gray-700" />
                  기본 정보
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">요청자</p>
                    <p className="font-medium text-gray-900">{selectedOrder.requester_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">요청일</p>
                    <p className="font-medium text-gray-900">
                      {new Date(selectedOrder.request_date || selectedOrder.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">납기요청일</p>
                    <p className="font-medium text-gray-900">
                      {selectedOrder.delivery_request_date 
                        ? new Date(selectedOrder.delivery_request_date).toLocaleDateString('ko-KR')
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">결제유형</p>
                    <p className="font-medium text-gray-900">{selectedOrder.payment_category || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">진행구분</p>
                    <p className="font-medium text-gray-900">{selectedOrder.progress_type || '일반'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">상태</p>
                    <p className="font-medium">
                      <Badge className="bg-orange-50 text-orange-700 border-orange-200">
                        미다운로드
                      </Badge>
                    </p>
                  </div>
                </div>
              </div>

              {/* 업체 정보 */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="font-semibold mb-4 flex items-center text-gray-900">
                  <Building2 className="w-5 h-5 mr-2 text-gray-700" />
                  업체 정보
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">업체명</p>
                    <p className="font-medium text-gray-900">{selectedOrder.vendor_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">프로젝트 업체</p>
                    <p className="font-medium text-gray-900">{selectedOrder.project_vendor || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">판매주문번호</p>
                    <p className="font-medium text-gray-900">{selectedOrder.sales_order_number || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">프로젝트 품목</p>
                    <p className="font-medium text-gray-900">{selectedOrder.project_item || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">발주서 템플릿</p>
                    <p className="font-medium text-gray-900">{selectedOrder.po_template_type || '일반'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">통화</p>
                    <p className="font-medium text-gray-900">{selectedOrder.currency || 'KRW'}</p>
                  </div>
                </div>
              </div>

              {/* 품목 리스트 */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="font-semibold mb-4 flex items-center text-gray-900">
                  <Package className="w-5 h-5 mr-2 text-gray-700" />
                  품목 리스트
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">품명</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">규격</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">수량</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">단가</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">금액</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">비고</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(selectedOrder.purchase_request_items || []).map((pItem: any, index: number) => {
                        const unitPrice = pItem.quantity > 0 ? (Number(pItem.amount_value) || 0) / pItem.quantity : 0
                        return (
                          <tr key={index} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-gray-900">{pItem.item_name || '품목명 없음'}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm text-gray-600">{pItem.specification || '-'}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-sm font-medium text-gray-900">{pItem.quantity || 0}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-gray-900">₩{unitPrice.toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-semibold text-gray-900">₩{(Number(pItem.amount_value) || 0).toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm text-gray-600">{pItem.remark || '-'}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 총액 */}
                <div className="mt-6 bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-sm text-gray-600">총</span>
                      <span className="ml-1 font-semibold text-gray-900">
                        {(selectedOrder.purchase_request_items || []).reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0)}개
                      </span>
                      <span className="text-sm text-gray-600 ml-1">항목</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-gray-600 block">총액</span>
                      <span className="font-bold text-xl text-gray-900">
                        ₩{(selectedOrder.purchase_request_items || []).reduce((sum: number, i: any) => {
                          return sum + (Number(i.amount_value) || 0)
                        }, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {/* 버튼 영역 */}
              <div className="flex justify-between gap-3 mt-6">
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleDownloadExcel(selectedOrder)}
                    disabled={downloadingIds.has(selectedOrder.id)}
                    className="bg-orange-600 hover:bg-orange-700"
                    size="sm"
                  >
                    {downloadingIds.has(selectedOrder.id) ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    Excel 다운로드
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/purchase/list?tab=purchase`)}
                    size="sm"
                  >
                    발주 목록에서 보기
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsOrderModalOpen(false)
                      setSelectedOrder(null)
                    }}
                    size="sm"
                  >
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}