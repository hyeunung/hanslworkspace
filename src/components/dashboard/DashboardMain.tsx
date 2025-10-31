
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dashboardService } from '@/services/dashboardService'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AlertTriangle, Clock, CheckCircle, ArrowRight, Eye, ThumbsUp, X, Package, Truck, ShoppingCart, Download, Search } from 'lucide-react'
import ExcelJS from 'exceljs'

// Import modals
import PurchaseDetailModal from '@/components/purchase/PurchaseDetailModal'
import PurchaseStatusModal from '@/components/dashboard/PurchaseStatusModal'
import { toast } from 'sonner'
import type { DashboardData } from '@/types/purchase'
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
  
  // 검색 상태
  const [searchTerms, setSearchTerms] = useState({
    undownloaded: '',
    pending: '',
    purchase: '',
    delivery: ''
  })
  
  const navigate = useNavigate()
  const supabase = createClient()

  const loadDashboardData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true)
      } else {
        // 로딩 표시 없이 새로고침할 때는 기존 data를 유지
        // data가 null이 되는 것을 방지
      }
      
      const supabase = createClient()
      
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError) {
        toast.error('인증 정보를 불러올 수 없습니다.')
        return
      }
      
      if (!user) {
        toast.error('로그인이 필요합니다.')
        return
      }

      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (employeeError || !employee) {
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
        } catch (_err) {
          // 대시보드 데이터 로딩 실패 시 빈 상태 유지
        }
        
        setLoading(false)
        return
      }


      
      try {
        const dashboardData = await dashboardService.getDashboardData(employee)
        
        // 디버깅: 승인대기 데이터 확인
        console.log('🔍 대시보드 데이터 로딩 완료', {
          employeeName: employee.name,
          employeeEmail: employee.email,
          purchaseRole: employee.purchase_role,
          pendingApprovalsCount: dashboardData.pendingApprovals?.length || 0,
          pendingApprovals: dashboardData.pendingApprovals?.map(item => ({
            id: item.id,
            purchase_order_number: item.purchase_order_number,
            middle_manager_status: item.middle_manager_status,
            final_manager_status: item.final_manager_status,
            vendor_name: item.vendor_name
          })) || []
        })
        
        // 전체 입고대기 건수 조회 추가
        const _totalDeliveryWaiting = await dashboardService.getTotalDeliveryWaitingCount()
        
        
        setData(dashboardData)
      } catch (_err) {
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
    } catch (_error) {
      // 전체 대시보드 로딩 실패
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  const handleQuickApprove = async (requestId: string) => {
    console.log('Quick approve:', {
      requestId: requestId,
      hasData: !!data,
      hasEmployee: !!data?.employee,
      employee: data?.employee
    })
    
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

  // 검색 필터링 함수
  const filterItems = (items: any[], searchTerm: string) => {
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
          <p className="mt-4 card-subtitle">대시보드를 불러오고 있습니다...</p>
        </div>
      </div>
    )
  }

  if (!data?.employee) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center bg-white p-8 rounded-lg border border-gray-200">
          <h3 className="modal-subtitle mb-2">사용자 정보를 찾을 수 없습니다</h3>
          <p className="card-subtitle">로그인을 다시 시도해주세요.</p>
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
              <h1 className="header-title">대시보드</h1>
              <p className="header-subtitle mt-0.5">
                {data.employee.name}님, 환영합니다. 📊
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="badge-text">
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
              <CardTitle className="flex items-center gap-2 text-red-800 card-title">
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
                        <Badge className={`${getPriorityColor(request.priority)} badge-text h-4 px-1`}>
                          {request.priority === 'high' ? '높음' : request.priority === 'medium' ? '보통' : '낮음'}
                        </Badge>
                        <span className="card-subtitle truncate max-w-[120px]">
                          {request.vendor_name || '업체명 없음'}
                        </span>
                        <span className="card-date">
                          {request.daysOverdue}일 지연
                        </span>
                      </div>
                      <div className="card-description">
                        <span>발주: {request.purchase_order_number || request.id.slice(0, 8)}</span>
                        <span className="ml-1">• {request.total_items}개</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/purchase?highlight=${request.id}`)}
                        className="h-6 px-2 badge-text"
                      >
                        <Eye className="w-3 h-3 mr-0.5" />
                        보기
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleQuickApprove(request.id)}
                        disabled={actionLoading === request.id}
                        className="bg-red-600 hover:bg-red-700 h-6 px-2 badge-text"
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
          <h2 className="section-title mb-2 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-gray-600" />
            전체 현황
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* Lead Buyer - 미다운로드 발주서 */}
          {(currentUserRoles.includes('lead buyer') || currentUserRoles.includes('lead buyer')) && undownloadedOrders.length > 0 && (
            <Card className="w-full col-span-1 row-span-2 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="section-title flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-orange-600" />
                    <span>미다운로드 발주서</span>
                  </div>
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 px-2 py-0.5">
                    {undownloadedOrders.length}
                  </Badge>
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
                    {filterItems(undownloadedOrders, searchTerms.undownloaded).slice(0, 10).map((item) => {
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
                          className={`border rounded-lg p-2 transition-all cursor-pointer hover:shadow-sm ${
                            isAdvance ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                          }`}
                          onClick={() => {
                            setSelectedOrder(item)
                            setIsOrderModalOpen(true)
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
                              {daysSince > 3 && (
                                <Badge variant="outline" className="badge-text px-1.5 py-0 flex-shrink-0">
                                  {daysSince}일
                                </Badge>
                              )}
                            </div>
                            <div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 badge-text border-orange-200 hover:bg-orange-50"
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
                  </div>
                </div>
              </CardContent>
            </Card>
          )}


          {/* 승인 대기 (승인 권한자만 표시) */}
          {canSeeApprovalBox && (
            <Card className="w-full col-span-1 row-span-2">
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="section-title flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-orange-500" />
                    승인 대기
                    {data.pendingApprovals.length > 0 && (
                      <Badge variant="destructive" className="badge-text h-4 px-1">
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
                    <div className="space-y-1.5 h-[36rem] overflow-y-auto">
                      {console.log('필터링 전:', data.pendingApprovals)}
                      {console.log('검색어:', searchTerms.pending)}
                      {console.log('필터링 후:', filterItems(data.pendingApprovals, searchTerms.pending))}
                      {filterItems(data.pendingApprovals, searchTerms.pending).slice(0, 10).map((approval, index) => {
                        console.log(`렌더링 중 ${index + 1}번째 항목:`, approval.purchase_order_number)
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
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleQuickApprove(approval.id)
                                }}
                                disabled={actionLoading === approval.id}
                                className={`h-7 px-2 text-white badge-text shrink-0 ${
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
          

          {/* 구매 대기중 - Lead Buyer만 표시 */}
          {currentUserRoles.includes('lead buyer') && (
            <Card className="w-full col-span-1 border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="section-title flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-yellow-600" />
                    <span>구매 대기</span>
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
                      {filterItems(data.myPurchaseStatus.waitingPurchase, searchTerms.purchase).slice(0, 10).map((item) => {
                        const items = item.purchase_request_items || []
                        const firstItem = items[0]
                        const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0)
                        const isSeonJin = (item.progress_type || '').includes('선진행')
                        
                        return (
                          <div 
                            key={item.id} 
                            className={`border rounded-lg p-3 transition-all hover:shadow-sm ${
                              isSeonJin ? 'bg-red-50 hover:bg-red-100 border-red-200' : 'bg-white hover:bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div 
                                className="flex items-center gap-2 flex-1 cursor-pointer"
                                onClick={() => handleStatusClick(item, 'purchase')}
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
                                  size="sm"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!confirm('이 발주를 구매완료 처리하시겠습니까?')) return
                                    
                                    try {
                                      const { error } = await supabase
                                        .from('purchase_requests')
                                        .update({ 
                                          is_payment_completed: true,
                                          payment_completed_at: new Date().toISOString()
                                        })
                                        .eq('id', item.id)

                                      if (error) throw error
                                      
                                      toast.success('구매완료 처리되었습니다.')
                                      loadDashboardData(false) // 데이터 새로고침
                                    } catch (error) {
                                      toast.error('처리 중 오류가 발생했습니다.')
                                    }
                                  }}
                                  className="bg-yellow-600 hover:bg-yellow-700 text-white h-7 px-2 badge-text shrink-0"
                                >
                                  구매완료
                                </Button>
                              )}
                              
                              {/* 이미 구매완료된 경우 완료 표시 */}
                              {item.is_payment_completed && (
                                <div className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-medium shrink-0">
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
              <CardHeader className="py-3 px-4 bg-gray-50 border-b">
                <CardTitle className="section-title flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-blue-600" />
                    <span>입고 대기</span>
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
                      {filterItems(data.myPurchaseStatus.waitingDelivery, searchTerms.delivery).slice(0, 10).map((item) => {
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

      {/* Order Detail Modal - Apple-inspired Design */}
      {isOrderModalOpen && selectedOrder && (
        <Dialog open={isOrderModalOpen} onOpenChange={() => {
          setIsOrderModalOpen(false)
          setSelectedOrder(null)
        }}>
          <DialogContent 
            className="overflow-hidden bg-white rounded-3xl shadow-2xl border-0"
            style={{ maxWidth: '1280px', width: '90vw', maxHeight: '50vh' }}
            showCloseButton={false}
          >
            {/* Apple-style Header */}
            <div className="relative px-6 pt-6 pb-4">
              <button
                onClick={() => {
                  setIsOrderModalOpen(false)
                  setSelectedOrder(null)
                }}
                className="absolute right-6 top-6 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all duration-200"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
              
              <div className="pr-16">
                <div className="flex items-start gap-4 mb-2">
                  <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <Download className="w-6 h-6 text-orange-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="modal-title mb-1">
                      {selectedOrder.purchase_order_number || 'PO번호 없음'}
                    </h1>
                    <p className="modal-subtitle">{selectedOrder.vendor_name || '업체명 없음'}</p>
                  </div>
                  <div className={`px-3 py-1.5 rounded-full badge-text bg-orange-50 text-orange-700 border-orange-200`}>
                    미다운로드
                  </div>
                </div>
              </div>
            </div>

            {/* Apple-style Content */}
            <div className="overflow-y-auto max-h-[calc(50vh-160px)] px-6 pb-4 space-y-3">
              
              {/* Dense Basic Information Grid */}
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
                  <div><span className="text-gray-500">요청자:</span> <span className="font-medium">{selectedOrder.requester_name}</span></div>
                  <div><span className="text-gray-500">요청일:</span> <span className="font-medium">{new Date(selectedOrder.request_date || selectedOrder.created_at).toLocaleDateString('ko-KR')}</span></div>
                  <div><span className="text-gray-500">납기요청일:</span> <span className="font-medium">{selectedOrder.delivery_request_date ? new Date(selectedOrder.delivery_request_date).toLocaleDateString('ko-KR') : '미지정'}</span></div>
                  
                  <div><span className="text-gray-500">업체명:</span> <span className="font-medium">{selectedOrder.vendor_name || '-'}</span></div>
                  <div><span className="text-gray-500">결제유형:</span> <span className="font-medium">{selectedOrder.payment_category || '일반'}</span></div>
                  <div><span className="text-gray-500">진행구분:</span> <span className="font-medium">{selectedOrder.progress_type || '일반'}</span></div>
                  
                  <div><span className="text-gray-500">프로젝트업체:</span> <span className="font-medium">{selectedOrder.project_vendor || '-'}</span></div>
                  <div><span className="text-gray-500">판매주문번호:</span> <span className="font-medium">{selectedOrder.sales_order_number || '-'}</span></div>
                  <div><span className="text-gray-500">배송지:</span> <span className="font-medium">{selectedOrder.shipping_address || '본사'}</span></div>
                  
                  <div><span className="text-gray-500">통화:</span> <span className="font-medium">{selectedOrder.currency || 'KRW'}</span></div>
                  <div><span className="text-gray-500">템플릿:</span> <span className="font-medium">{selectedOrder.po_template_type || '일반'}</span></div>
                  {selectedOrder.revised_delivery_request_date && (
                    <div><span className="text-orange-500">변경입고일:</span> <span className="font-medium text-orange-900">{new Date(selectedOrder.revised_delivery_request_date).toLocaleDateString('ko-KR')}</span></div>
                  )}
                </div>
              </div>

              {/* Compact Items Table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
                  <h3 className="text-sm font-medium text-gray-700">주문 품목 ({(selectedOrder.purchase_request_items || []).length}개, 총 ₩{(selectedOrder.purchase_request_items || []).reduce((sum: number, i: any) => sum + (Number(i.amount_value) || 0), 0).toLocaleString()})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs table-fixed">
                    <colgroup>
                      <col className="w-[30%]" />
                      <col className="w-[25%]" />
                      <col className="w-[10%]" />
                      <col className="w-[15%]" />
                      <col className="w-[20%]" />
                    </colgroup>
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left p-2 font-medium text-gray-600">품목명</th>
                        <th className="text-left p-2 font-medium text-gray-600">규격</th>
                        <th className="text-right p-2 font-medium text-gray-600">수량</th>
                        <th className="text-right p-2 font-medium text-gray-600">단가</th>
                        <th className="text-right p-2 font-medium text-gray-600">금액</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(selectedOrder.purchase_request_items || []).map((pItem: any, index: number) => {
                        const unitPrice = pItem.quantity > 0 ? (Number(pItem.amount_value) || 0) / pItem.quantity : 0
                        return (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="p-2">
                              <div className="font-medium text-gray-900">{pItem.item_name || '품목명 없음'}</div>
                              {pItem.remark && (
                                <div className="text-xs text-amber-600 mt-1">비고: {pItem.remark}</div>
                              )}
                            </td>
                            <td className="p-2 text-gray-600">{pItem.specification || '-'}</td>
                            <td className="p-2 text-right font-medium">{pItem.quantity || 0}</td>
                            <td className="p-2 text-right">₩{unitPrice.toLocaleString()}</td>
                            <td className="p-2 text-right font-medium">₩{(Number(pItem.amount_value) || 0).toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Apple-style Action Bar */}
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-6">
              <div className="flex items-center justify-between gap-6">
                <Button
                  onClick={() => handleDownloadExcel(selectedOrder)}
                  disabled={downloadingIds.has(selectedOrder.id)}
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white px-8 py-4 rounded-2xl shadow-lg transition-all duration-200 modal-subtitle"
                >
                  {downloadingIds.has(selectedOrder.id) ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                  ) : (
                    <Download className="w-5 h-5 mr-3" />
                  )}
                  Excel 다운로드
                </Button>

                <div className="flex items-center gap-4 ml-auto">
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigate(`/purchase/list?tab=purchase`)
                      setIsOrderModalOpen(false)
                      setSelectedOrder(null)
                    }}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 px-8 py-4 rounded-2xl modal-subtitle transition-all duration-200"
                  >
                    발주 목록에서 보기
                    <ArrowRight className="w-5 h-5 ml-3" />
                  </Button>
                  <Button 
                    onClick={() => {
                      setIsOrderModalOpen(false)
                      setSelectedOrder(null)
                    }} 
                    className="bg-gray-900 hover:bg-gray-800 text-white px-10 py-4 rounded-2xl modal-subtitle transition-all duration-200 shadow-lg"
                  >
                    완료
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