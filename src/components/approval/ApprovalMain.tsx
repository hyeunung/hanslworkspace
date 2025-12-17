
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { PurchaseRequestWithDetails } from '@/types/purchase'
import { addCacheListener } from '@/stores/purchaseMemoryStore'
import ApprovalCard from '@/components/approval/ApprovalCard'
import ApprovalModal from '@/components/approval/ApprovalModal'
import BatchApprovalButton from '@/components/approval/BatchApprovalButton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertCircle, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'

type ApprovalTab = 'middle' | 'final'

interface TabCounts {
  middle: number
  final: number
}

// 역할 파싱 유틸리티 함수
const parseRoles = (purchaseRole: string | string[] | null | undefined): string[] => {
  if (Array.isArray(purchaseRole)) {
    return purchaseRole
  } else if (typeof purchaseRole === 'string') {
    return purchaseRole.split(',').map((r: string) => r.trim())
  }
  return []
}

export default function ApprovalMain() {
  const { employee, currentUserRoles } = useAuth()
  const [approvals, setApprovals] = useState<PurchaseRequestWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ApprovalTab | null>(null)
  const [selectedApproval, setSelectedApproval] = useState<PurchaseRequestWithDetails | null>(null)
  const [modalType, setModalType] = useState<'approve' | 'reject' | null>(null)
  const [selectedApprovals, setSelectedApprovals] = useState<number[]>([])
  const [tabCounts, setTabCounts] = useState<TabCounts>({ middle: 0, final: 0 })
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc')

  const supabase = createClient()

  useEffect(() => {
    if (employee) {
      loadApprovals()
    }
  }, [employee, refreshTrigger])

  // 🚀 Realtime 이벤트 구독 - DB 변경 시 자동 새로고침
  const isFirstMount = useRef(true)
  useEffect(() => {
    const handleCacheUpdate = () => {
      // 첫 마운트 시에는 무시 (초기 로드와 중복 방지)
      if (isFirstMount.current) {
        isFirstMount.current = false
        return
      }
      // Realtime 이벤트 발생 시 데이터 새로고침
      setRefreshTrigger(prev => prev + 1)
    }

    const unsubscribe = addCacheListener(handleCacheUpdate)
    return () => unsubscribe()
  }, [])

  const loadApprovals = async () => {
    if (!employee) return
    
    try {
      setLoading(true)
      
      // 승인 권한이 있는지 확인
      const approvalRoles = ['middle_manager', 'final_approver', 'ceo', 'app_admin']
      const hasApprovalRole = currentUserRoles.some((role: string) => approvalRoles.includes(role))

      if (!hasApprovalRole) {
        toast.error(`승인 권한이 없습니다. 현재 role: ${employee.purchase_role || '없음'}`)
        setLoading(false)
        return
      }

      // 승인 대기 목록 조회
      await loadApprovalsData(employee)
      
      // 초기 탭 설정
      if (!activeTab) {
        if (currentUserRoles.includes('middle_manager')) {
          setActiveTab('middle')
        } else if (currentUserRoles.some(role => ['final_approver', 'ceo', 'app_admin'].includes(role))) {
          setActiveTab('final')
        }
      }

    } catch (_error) {
      toast.error('데이터 로딩 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  const loadApprovalsData = async (employeeData: any) => {
    try {
      const { data: approvalData, error: approvalError } = await supabase
        .from('purchase_requests')
        .select('*,vendor:vendors(id,vendor_name),vendor_contacts:vendor_contacts(*),items:purchase_request_items(*)')
        .order('created_at', { ascending: false })

      if (approvalError) throw approvalError

      const purchasesWithDetails = (approvalData || []).map((purchase: any) => ({
        ...purchase,
        items: purchase.purchase_request_items || [],
        vendor: purchase.vendor || { id: 0, vendor_name: '알 수 없음' },
        vendor_contacts: purchase.vendor_contacts || []
      })) as PurchaseRequestWithDetails[]

      setApprovals(purchasesWithDetails)

      // 역할별 승인 대기 개수 계산
      const counts = calculateTabCounts(purchasesWithDetails, employeeData)
      setTabCounts(counts)

    } catch (_error) {
      toast.error('승인 목록 로딩 중 오류가 발생했습니다')
    }
  }

  const calculateTabCounts = (purchases: PurchaseRequestWithDetails[], employeeData: any): TabCounts => {
    const counts = { middle: 0, final: 0 }
    
    // purchase_role 처리
    const roles = parseRoles(employeeData.purchase_role)
    
    purchases.forEach(purchase => {
      // 1차 승인 대기 (중간관리자)
      if (purchase.middle_manager_status === 'pending' && 
          roles.includes('middle_manager')) {
        counts.middle++
      }
      
      // 최종 승인 대기 (최종승인자/CEO/app_admin)
      if (purchase.middle_manager_status === 'approved' && 
          purchase.final_manager_status === 'pending' &&
          roles.some((role: string) => ['final_approver', 'ceo', 'app_admin'].includes(role))) {
        counts.final++
      }
      
      // 구매 처리 대기는 제거 (hanslwebapp에서는 별도 탭)
    })
    
    return counts
  }

  const getFilteredApprovals = (): PurchaseRequestWithDetails[] => {
    if (!employee) return []

    // purchase_role 처리
    const roles = parseRoles(employee.purchase_role)
    
    let filtered: PurchaseRequestWithDetails[] = []
    
    // activeTab이 설정되어 있으면 해당 탭의 승인만 표시
    if (activeTab === 'middle') {
      // 1차 승인 대기
      filtered = approvals.filter(approval => 
        approval.middle_manager_status === 'pending'
      )
    } else if (activeTab === 'final') {
      // 최종 승인 대기
      filtered = approvals.filter(approval => 
        approval.middle_manager_status === 'approved' && 
        approval.final_manager_status === 'pending'
      )
    } else {
      // activeTab이 null이면 권한에 따라 자동으로 필터링
      if (roles.includes('middle_manager')) {
        // 1차 승인 대기
        filtered = approvals.filter(approval => 
          approval.middle_manager_status === 'pending'
        )
      } else if (roles.some((role: string) => ['final_approver', 'ceo', 'app_admin'].includes(role))) {
        // 최종 승인 대기
        filtered = approvals.filter(approval => 
          approval.middle_manager_status === 'approved' && 
          approval.final_manager_status === 'pending'
        )
      }
    }

    // 정렬 적용
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
        case 'date-asc':
          return new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime()
        case 'amount-desc':
          return (b.total_amount || 0) - (a.total_amount || 0)
        case 'amount-asc':
          return (a.total_amount || 0) - (b.total_amount || 0)
        default:
          return 0
      }
    })
  }

  const handleApprovalAction = (approval: PurchaseRequestWithDetails, action: 'approve' | 'reject') => {
    setSelectedApproval(approval)
    setModalType(action)
  }

  const handleApprovalSubmit = async (id: number, action: 'approve' | 'reject', _comment?: string) => {
    try {
      
      // Supabase 직접 호출 - hanslwebapp 방식으로 변경
      const roles = parseRoles(employee!.purchase_role)
      
      let updateData: any = {}

      // PurchaseDetailModal과 동일한 방식으로 단순화
      // 실제 DB에 없는 필드들 제거: middle_manager_name, final_manager_name, *_comment
      if (roles.includes('middle_manager')) {
        // 1차 승인 (검증)
        if (action === 'approve') {
          updateData = { 
            middle_manager_status: 'approved'
          }
        } else {
          updateData = { 
            middle_manager_status: 'rejected'
          }
        }
      } else if (roles.some((r: string) => ['final_approver', 'ceo', 'app_admin'].includes(r))) {
        // 최종 승인
        if (action === 'approve') {
          updateData = { 
            final_manager_status: 'approved'
          }
        } else {
          updateData = { 
            final_manager_status: 'rejected',
            // 최종 승인자가 반려하면 중간 승인도 함께 반려
            middle_manager_status: 'rejected'
          }
        }
      } else {
        // 권한이 없는 경우
        throw new Error('승인 권한이 없습니다')
      }

      // Supabase 업데이트 실행
      const { error } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', Number(id))

      if (error) {
        throw error
      }
      
      toast.success(action === 'approve' ? '승인이 완료되었습니다' : '반려되었습니다')
      
      // 모달 닫기를 먼저 하고 데이터 새로고침
      setSelectedApproval(null)
      setModalType(null)
      
      // 약간의 지연 후 데이터 새로고침
      setTimeout(() => {
        setRefreshTrigger(prev => prev + 1)
      }, 500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '승인 처리 중 오류가 발생했습니다')
      throw error
    }
  }

  const handleBatchApproval = async (selectedIds: number[]) => {
    if (selectedIds.length === 0) {
      toast.error('선택된 항목이 없습니다')
      return
    }

    try {
      // Supabase 일괄 처리 - hanslwebapp 방식으로 변경
      const roles = parseRoles(employee!.purchase_role)
      

      let updateData: any = {}

      // PurchaseDetailModal과 동일한 방식으로 단순화
      // 실제 DB에 없는 필드들 제거: middle_manager_name, final_manager_name, *_comment
      if (roles.includes('middle_manager')) {
        updateData = {
          middle_manager_status: 'approved'
        }
      } else if (roles.some((r: string) => ['final_approver', 'ceo', 'app_admin'].includes(r))) {
        updateData = {
          final_manager_status: 'approved'
        }
      } else {
        throw new Error('승인 권한이 없습니다')
      }


      // 일괄 업데이트 실행 - ID를 Number로 변환
      const { error } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .in('id', selectedIds.map(id => Number(id)))

      if (error) {
        throw error
      }
      
      toast.success(`${selectedIds.length}건이 일괄 승인되었습니다`)
      setSelectedApprovals([])
      setRefreshTrigger(prev => prev + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '일괄 승인 중 오류가 발생했습니다')
    }
  }

  const handleSelectionChange = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedApprovals(prev => [...prev, id])
    } else {
      setSelectedApprovals(prev => prev.filter(approvalId => approvalId !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const filteredApprovals = getFilteredApprovals()
      setSelectedApprovals((filteredApprovals as PurchaseRequestWithDetails[]).map(approval => Number(approval.id!)).filter((id): id is number => !isNaN(id)))
    } else {
      setSelectedApprovals([])
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">접근 권한이 없습니다</h2>
          <p className="text-gray-600">승인 권한이 있는 사용자만 접근할 수 있습니다.</p>
          <p className="text-sm text-gray-500 mt-4">
            브라우저 콘솔(F12)을 확인하여 자세한 정보를 보세요.
          </p>
        </div>
      </div>
    )
  }

  const filteredApprovals = getFilteredApprovals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">승인 관리</h1>
        <div className="text-sm text-gray-600">
          {employee.name} ({employee.purchase_role || '권한 없음'})
        </div>
      </div>

      {/* 탭 UI 추가 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {employee && (() => {
            const roles = parseRoles(employee.purchase_role)
            
            const tabs = []
            
            if (roles.includes('middle_manager')) {
              tabs.push(
                <button
                  key="middle"
                  onClick={() => setActiveTab('middle')}
                  className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'middle'
                      ? 'border-hansl-600 text-hansl-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  1차 승인 대기
                  <span className="badge-stats ml-2 bg-gray-100 text-gray-600">
                    {tabCounts.middle}
                  </span>
                </button>
              )
            }
            
            if (roles.some((role: string) => ['final_approver', 'ceo', 'app_admin'].includes(role))) {
              tabs.push(
                <button
                  key="final"
                  onClick={() => setActiveTab('final')}
                  className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'final'
                      ? 'border-hansl-600 text-hansl-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  최종 승인 대기
                  <span className="badge-stats ml-2 bg-gray-100 text-gray-600">
                    {tabCounts.final}
                  </span>
                </button>
              )
            }
            
            
            return tabs
          })()}
        </nav>
      </div>

      <div className="space-y-4">
          {(filteredApprovals as PurchaseRequestWithDetails[]).length > 0 && (
            <div className="flex items-center justify-between">
              <BatchApprovalButton
                selectedCount={selectedApprovals.length}
                totalCount={(filteredApprovals as PurchaseRequestWithDetails[]).length}
                onBatchApproval={() => handleBatchApproval(selectedApprovals)}
                onSelectAll={handleSelectAll}
                allSelected={selectedApprovals.length === (filteredApprovals as PurchaseRequestWithDetails[]).length}
              />
              <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                <SelectTrigger className="w-[200px]">
                  <ArrowUpDown className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="정렬 기준" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">최신 순</SelectItem>
                  <SelectItem value="date-asc">오래된 순</SelectItem>
                  <SelectItem value="amount-desc">금액 많은 순</SelectItem>
                  <SelectItem value="amount-asc">금액 적은 순</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-4">
            {(filteredApprovals as PurchaseRequestWithDetails[]).length === 0 ? (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">승인 대기 항목이 없습니다</h3>
                <p className="text-gray-500">
                  승인 대기 중인 발주가 없습니다.
                </p>
              </div>
            ) : (
              (filteredApprovals as PurchaseRequestWithDetails[]).map((approval: PurchaseRequestWithDetails) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onApprove={() => handleApprovalAction(approval, 'approve')}
                  onReject={() => handleApprovalAction(approval, 'reject')}
                  selected={selectedApprovals.includes(Number(approval.id!))}
                  onSelectionChange={(checked) => handleSelectionChange(Number(approval.id!), checked)}
                  showBuyerActions={false}
                />
              ))
            )}
          </div>
      </div>

      {/* 승인/반려 모달 */}
      {selectedApproval && modalType && (
        <ApprovalModal
          approval={selectedApproval}
          type={modalType}
          open={true}
          onClose={() => {
            setSelectedApproval(null)
            setModalType(null)
          }}
          onSubmit={(comment) => handleApprovalSubmit(Number(selectedApproval.id!), modalType, comment)}
        />
      )}
    </div>
  )
}