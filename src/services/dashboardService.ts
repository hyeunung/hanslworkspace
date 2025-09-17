import { createClient } from '@/lib/supabase/client'
import type { 
  DashboardData, 
  DashboardStats, 
  UrgentRequest, 
  MyRequestStatus, 
  QuickAction,
  Employee,
  PurchaseRequestWithDetails 
} from '@/types/purchase'

export class DashboardService {
  private supabase = createClient()

  // 역할 파싱 유틸: 배열/CSV 문자열/단일 문자열을 모두 배열로 정규화
  // usePurchaseData.ts와 동일한 로직 사용
  private parseRoles(purchaseRole: string | string[] | null | undefined): string[] {
    let roles: string[] = []
    
    if (purchaseRole) {
      if (Array.isArray(purchaseRole)) {
        // 배열인 경우
        roles = purchaseRole.map((r: any) => String(r).trim())
      } else {
        // 문자열인 경우 (일반적)
        const roleString = String(purchaseRole)
        // 쉼표로 분할하고 공백 제거
        roles = roleString
          .split(',')
          .map((r: string) => r.trim())
          .filter((r: string) => r.length > 0)
      }
    }
    
    return roles
  }

  // 메인 대시보드 데이터 로드
  async getDashboardData(employee: Employee): Promise<DashboardData> {
    const [
      stats,
      urgentRequests,
      myRecentRequests,
      pendingApprovals,
      quickActions,
      todaySummary,
      myPurchaseStatus
    ] = await Promise.all([
      this.getDashboardStats(employee),
      this.getUrgentRequests(employee),
      this.getMyRecentRequests(employee),
      this.getPendingApprovals(employee),
      this.getQuickActions(employee),
      this.getTodaySummary(employee),
      this.getMyPurchaseStatus(employee)
    ])

    return {
      employee,
      stats,
      urgentRequests,
      myRecentRequests,
      pendingApprovals,
      quickActions,
      todaySummary,
      myPurchaseStatus
    }
  }

  // 통계 정보 (우선순위 재정렬)
  async getDashboardStats(employee: Employee): Promise<DashboardStats> {
    const today = new Date().toISOString().split('T')[0]
    const roles = this.parseRoles(employee.purchase_role)


    // 병렬 쿼리로 성능 최적화
    const [
      totalResult,
      myRequestsResult,
      pendingResult,
      completedResult,
      urgentResult,
      todayActionsResult
    ] = await Promise.all([
      // 전체 요청 수
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true }),

      // 내 요청 수
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('requester_name', employee.name),

      // 내가 처리해야 할 승인 대기
      this.getPendingCount(employee, roles),

      // 이번 달 완료된 요청 수  
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('is_received', true)
        .gte('received_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),

      // 긴급 요청 수 (3일 이상 대기)
      this.getUrgentCount(employee, roles),

      // 오늘 처리한 액션 수
      this.getTodayActionsCount(employee, today)
    ])

    const stats = {
      total: totalResult.count || 0,
      myRequests: myRequestsResult.count || 0,
      pending: pendingResult,
      completed: completedResult.count || 0,
      urgent: urgentResult,
      todayActions: todayActionsResult
    }

    return stats
  }

  // 긴급 요청 목록 (우선순위 최상위)
  async getUrgentRequests(employee: Employee): Promise<UrgentRequest[]> {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const roles = this.parseRoles(employee.purchase_role)

    // 역할이 없으면 긴급 요청도 없음
    if (roles.length === 0) {
      return []
    }

    let query = this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(id)')
      .lt('created_at', threeDaysAgo)

    // 역할별 긴급 요청 필터링
    if (roles.includes('app_admin')) {
      query = query.or('middle_manager_status.eq.pending,final_manager_status.eq.pending,purchase_status.eq.pending')
    } else if (roles.includes('middle_manager')) {
      query = query.eq('middle_manager_status', 'pending')
    } else if (roles.includes('final_approver') || roles.includes('ceo')) {
      query = query
        .eq('middle_manager_status', 'approved')
        .eq('final_manager_status', 'pending')
    } else if (roles.includes('lead_buyer')) {
      query = query
        .eq('final_manager_status', 'approved')
        .eq('purchase_status', 'pending')
    } else {
      // 다른 역할은 긴급 요청 없음
      return []
    }

    const { data } = await query
      .order('created_at', { ascending: true })
      .limit(5)

    return (data || []).map(item => ({
      ...item,
      vendor_name: item.vendors?.vendor_name,
      total_items: item.purchase_request_items?.length || 0,
      daysOverdue: Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)),
      priority: this.calculatePriority(item),
      urgentReason: this.getUrgentReason(item, roles)
    })) as UrgentRequest[]
  }

  // 내 최근 요청 상태 (승인 단계 요청만)
  async getMyRecentRequests(employee: Employee): Promise<MyRequestStatus[]> {
    const { data } = await this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(id)')
      .eq('requester_name', employee.name)
      // 승인이 완료되지 않은 항목만 (승인 진행 중인 것들)
      .or('middle_manager_status.eq.pending,final_manager_status.eq.pending')
      .order('created_at', { ascending: false })
      .limit(5)

    return (data || []).map(item => ({
      ...item,
      vendor_name: item.vendors?.vendor_name,
      total_items: item.purchase_request_items?.length || 0,
      progress_percentage: this.calculateProgress(item),
      current_step: this.getCurrentStep(item),
      next_action: this.getNextAction(item),
      estimated_completion: this.estimateCompletion(item)
    })) as MyRequestStatus[]
  }

  // 승인 대기 항목 (전체 조회) - 발주 리스트와 동일한 방식
  async getPendingApprovals(employee: Employee): Promise<PurchaseRequestWithDetails[]> {
    const roles = this.parseRoles(employee.purchase_role)

    // 먼저 모든 발주요청을 가져옴 (발주 리스트와 동일)
    // 스키마에 맞춰 item 단가/금액 컬럼 수정 (unit_price_value, amount_value)
    let allRequests: any[] | null = null
    let baseError: any = null

    const firstTry = await this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(item_name,quantity,unit_price_value,amount_value)')
      .order('request_date', { ascending: false })
      .limit(100) // 최적화: 100개로 제한

    if (firstTry.error) {
      // 관계 조회 실패 시 최소 컬럼으로 재시도하여 리스트 자체는 표시되도록 함
      baseError = firstTry.error
      const fallback = await this.supabase
        .from('purchase_requests')
        .select('*')
        .order('request_date', { ascending: false })
        .limit(100) // 최적화: 100개로 제한
      if (fallback.error) {
        // Fallback query also failed - will return empty array
        return []
      }
      allRequests = fallback.data || []
    } else {
      allRequests = firstTry.data || []
    }

    // 클라이언트 사이드에서 역할별 필터링
    let filteredData = allRequests || []

    // 역할별 필터링 로직 - 실제 "내가 승인해야 할" 항목만
    // pending, 대기, 빈문자열, null 모두 대기로 처리
    const isPending = (status: any) => (
      status === 'pending' || status === '대기' || status === '' || status === null || status === undefined
    )

    if (roles.includes('app_admin')) {
      // app_admin은 중간/최종 승인 대기를 모두 본다
      filteredData = filteredData.filter(item => (
        isPending(item.middle_manager_status) ||
        (item.middle_manager_status === 'approved' && isPending(item.final_manager_status))
      ))
    } else if (roles.includes('middle_manager')) {
      // middle_manager는 모든 중간 승인 대기 항목을 본다
      filteredData = filteredData.filter(item => isPending(item.middle_manager_status))
    } else if (roles.includes('raw_material_manager')) {
      // raw_material_manager는 발주 카테고리의 최종 승인 대기만
      filteredData = filteredData.filter(item => 
        item.middle_manager_status === 'approved' && 
        isPending(item.final_manager_status) &&
        item.payment_category === '발주요청'
      )
    } else if (roles.includes('consumable_manager')) {
      // consumable_manager는 구매 카테고리의 최종 승인 대기만
      filteredData = filteredData.filter(item => 
        item.middle_manager_status === 'approved' && 
        isPending(item.final_manager_status) &&
        item.payment_category === '구매요청'
      )
    } else if (roles.some(r => ['final_approver','ceo'].includes(r))) {
      // 최종 승인 대기 (중간 승인 완료)
      filteredData = filteredData.filter(item => 
        item.middle_manager_status === 'approved' && isPending(item.final_manager_status)
      )
    } else if (roles.includes('lead_buyer')) {
      // 구매 책임자는 승인 대상이 아님 → 이 리스트에서는 제외
      filteredData = []
    } else {
      return []
    }

    // 총 금액 계산 추가 (amount_value가 우선, 없으면 quantity*unit_price_value 사용)
    return filteredData.map(item => ({
      ...item,
      vendor_name: item.vendors?.vendor_name,
      purchase_request_items: item.purchase_request_items || item.items || [],
      total_amount: (item.purchase_request_items || item.items || []).reduce((sum: number, i: any) => {
        const amount = Number(i?.amount_value) || (Number(i?.quantity) || 0) * (Number(i?.unit_price_value) || 0)
        return sum + amount
      }, 0)
    }))
  }

  // 빠른 액션 버튼 데이터
  async getQuickActions(employee: Employee): Promise<QuickAction[]> {
    const roles = this.parseRoles(employee.purchase_role)

    const actions: QuickAction[] = []

    // 승인 권한이 있는 경우
    if (roles.includes('app_admin') || roles.includes('middle_manager') || roles.includes('final_approver') || roles.includes('ceo')) {
      const pendingCount = await this.getPendingCount(employee, roles)
      if (pendingCount > 0) {
        actions.push({
          id: 'approve',
          type: 'approve',
          label: '승인 대기',
          description: `${pendingCount}건의 승인 대기 중`,
          count: pendingCount,
          color: 'red'
        })
      }
    }

    // 구매 권한이 있는 경우
    if (roles.includes('lead_buyer')) {
      const { count: purchaseCount } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('final_manager_status', 'approved')
        .eq('purchase_status', 'pending')

      if (purchaseCount && purchaseCount > 0) {
        actions.push({
          id: 'purchase',
          type: 'purchase',
          label: '구매 처리',
          description: `${purchaseCount}건의 구매 대기 중`,
          count: purchaseCount,
          color: 'yellow'
        })
      }
    }

    return actions
  }

  // 오늘 요약 정보
  async getTodaySummary(employee: Employee) {
    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const [approvedResult, requestedResult, receivedResult] = await Promise.all([
      // 오늘 내가 승인한 건수
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .gte('updated_at', today)
        .lt('updated_at', tomorrow)
        .or('middle_manager_status.eq.approved,final_manager_status.eq.approved'),

      // 오늘 내가 요청한 건수
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('requester_name', employee.name)
        .gte('created_at', today)
        .lt('created_at', tomorrow),

      // 오늘 입고 처리한 건수
      this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('is_received', true)
        .gte('received_at', today)
        .lt('received_at', tomorrow)
    ])

    return {
      approved: approvedResult.count || 0,
      requested: requestedResult.count || 0,
      received: receivedResult.count || 0
    }
  }

  // 내 구매/입고 상태 확인
  async getMyPurchaseStatus(employee: Employee): Promise<{ waitingPurchase: PurchaseRequestWithDetails[], waitingDelivery: PurchaseRequestWithDetails[], recentCompleted: PurchaseRequestWithDetails[] }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // 먼저 모든 내 요청을 가져온 다음 클라이언트에서 필터링
    const myRequests = await this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(item_name,quantity,specification,amount_value)')
      .eq('requester_name', employee.name)
      .order('created_at', { ascending: false })
      .limit(100)

    if (myRequests.error) {
      console.error('getMyPurchaseStatus 에러:', myRequests.error)
      return {
        waitingPurchase: [],
        waitingDelivery: [],
        recentCompleted: []
      }
    }

    const allMyRequests = myRequests.data || []

    // 클라이언트 사이드 필터링 (PurchaseListMain 구매/입고 탭과 동일한 로직)
    
    const waitingPurchase = allMyRequests.filter(item => {
      // 구매 탭 로직: 구매/발주 요청 카테고리 + 결제 미완료 + 선진행(승인무관) OR 일반&최종승인
      const isRequest = item.payment_category === '구매 요청' || item.payment_category === '구매요청' || item.payment_category === '발주 요청' || item.payment_category === '발주요청'
      const notPaid = !item.is_payment_completed
      const isSeonJin = (item.progress_type || '').includes('선진행')
      
      // 선진행은 승인 상태와 무관하게 구매 대기
      if (isRequest && notPaid && isSeonJin) {
        return true
      }
      
      // 일반은 최종 승인 완료되어야 구매 대기
      const isIlban = (item.progress_type || '').includes('일반') || !item.progress_type || item.progress_type === ''
      const finalApproved = item.final_manager_status === 'approved'
      
      return isRequest && notPaid && isIlban && finalApproved
    }).slice(0, 10)


    const waitingDelivery = allMyRequests.filter(item => {
      // 입고 탭 로직: 입고 미완료 + 선진행(승인무관) OR 최종승인
      const notReceived = !item.is_received
      const isSeonJin = (item.progress_type || '').includes('선진행')
      
      // 선진행은 승인 상태와 무관하게 입고 대기
      if (notReceived && isSeonJin) {
        return true
      }
      
      // 일반은 최종 승인 완료되어야 입고 대기
      const finalApproved = item.final_manager_status === 'approved'
      
      return notReceived && finalApproved
    }).slice(0, 10)


    const recentCompleted = allMyRequests.filter(item => {
      // 입고 완료 && 7일 이내
      if (item.is_received !== true) return false
      if (!item.received_at) return false
      const receivedDate = new Date(item.received_at)
      const sevenDaysAgoDate = new Date(sevenDaysAgo)
      return receivedDate >= sevenDaysAgoDate
    }).slice(0, 10)

    return {
      waitingPurchase: waitingPurchase,
      waitingDelivery: waitingDelivery,
      recentCompleted: recentCompleted
    }
  }

  // 원클릭 승인 API
  async quickApprove(requestId: string, employee: Employee): Promise<{success: boolean, error?: string}> {
    
    try {
      const roles = this.parseRoles(employee.purchase_role)

      // 먼저 현재 요청의 상태를 확인
      const { data: request } = await this.supabase
        .from('purchase_requests')
        .select('middle_manager_status, final_manager_status')
        .eq('id', requestId)
        .single()

      if (!request) {
        return { success: false, error: '요청을 찾을 수 없습니다.' }
      }
      

      let updateData: any = {}

      // pending, 대기, null, 빈 문자열 모두 대기 상태로 간주
      const isPending = (status: any) => (
        status === 'pending' || status === '대기' || status === '' || status === null || status === undefined
      )

      // app_admin은 현재 필요한 승인 단계를 처리
      if (roles.includes('app_admin')) {
        if (isPending(request.middle_manager_status)) {
          updateData = {
            middle_manager_status: 'approved'
          }
        } else if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
        }
      } else if (roles.includes('middle_manager')) {
        if (isPending(request.middle_manager_status)) {
          updateData = {
            middle_manager_status: 'approved'
          }
        }
      } else if (roles.includes('final_approver') || roles.includes('ceo')) {
        if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
        }
      } else if (roles.includes('raw_material_manager') || roles.includes('consumable_manager')) {
        // raw_material_manager와 consumable_manager도 최종 승인 권한이 있음
        if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
        }
      }

      // updateData가 비어있으면 승인할 단계가 없음
      if (Object.keys(updateData).length === 0) {
        return { success: false, error: '승인할 수 있는 상태가 아닙니다.' }
      }
      

      const { data: updatedData, error } = await this.supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', requestId)
        .select()
        .single()

      if (error) {
        // Error details are handled by the caller
        throw error
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // Helper methods
  private async getPendingCount(employee: Employee, roles: string[]): Promise<number> {
    // 공통: '대기', null, 빈 문자열도 대기 상태로 간주
    const pendingClause = (col: string) => (
      `${col}.in.(pending,대기),${col}.is.null`
    )

    // 역할별 카운트 쿼리 구성
    if (roles.includes('app_admin')) {
      // 1) 중간 승인 대기 + 2) 최종 승인 대기(중간 승인 완료) + 3) 구매 대기(최종 승인 완료)
      const [mid, fin, pur] = await Promise.all([
        this.supabase
          .from('purchase_requests')
          .select('id', { count: 'exact', head: true })
          .or(`middle_manager_status.in.(pending,대기),middle_manager_status.is.null`),
        this.supabase
          .from('purchase_requests')
          .select('id', { count: 'exact', head: true })
          .eq('middle_manager_status', 'approved')
          .or(`final_manager_status.in.(pending,대기),final_manager_status.is.null`),
        this.supabase
          .from('purchase_requests')
          .select('id', { count: 'exact', head: true })
          .eq('final_manager_status', 'approved')
          .or(`purchase_status.in.(pending,대기),purchase_status.is.null`)
      ])

      const total = (mid.count || 0) + (fin.count || 0) + (pur.count || 0)
      return total
    }

    if (roles.includes('middle_manager')) {
      const { count, error } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .or(`middle_manager_status.in.(pending,대기),middle_manager_status.is.null`)

      if (error) {
        // Count error for middle_manager - will use 0
        return 0
      }
      return count || 0
    }

    if (roles.includes('final_approver') || roles.includes('ceo')) {
      const { count, error } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('middle_manager_status', 'approved')
        .or(`final_manager_status.in.(pending,대기),final_manager_status.is.null`)

      if (error) {
        // Count error for final_approver/ceo - will use 0
        return 0
      }
      return count || 0
    }

    if (roles.includes('lead_buyer')) {
      const { count, error } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('final_manager_status', 'approved')
        .or(`purchase_status.in.(pending,대기),purchase_status.is.null`)

      if (error) {
        // Count error for lead_buyer - will use 0
        return 0
      }
      return count || 0
    }

    return 0
  }

  private async getUrgentCount(employee: Employee, roles: string[]): Promise<number> {
    // 역할이 없으면 긴급 요청 카운트도 0
    if (roles.length === 0) {
      return 0
    }

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    
    let query = this.supabase
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .lt('created_at', threeDaysAgo)

    if (roles.includes('app_admin')) {
      query = query.or('middle_manager_status.eq.pending,final_manager_status.eq.pending,purchase_status.eq.pending')
    } else if (roles.includes('middle_manager')) {
      query = query.eq('middle_manager_status', 'pending')
    } else if (roles.includes('final_approver') || roles.includes('ceo')) {
      query = query
        .eq('middle_manager_status', 'approved')
        .eq('final_manager_status', 'pending')
    } else if (roles.includes('lead_buyer')) {
      query = query
        .eq('final_manager_status', 'approved')
        .eq('purchase_status', 'pending')
    } else {
      return 0
    }

    const { count } = await query
    return count || 0
  }

  private async getTodayActionsCount(employee: Employee, today: string): Promise<number> {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const { count } = await this.supabase
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', today)
      .lt('updated_at', tomorrow)
      .or(`middle_manager_id.eq.${employee.id},final_manager_id.eq.${employee.id}`)

    return count || 0
  }

  private calculatePriority(request: any): 'high' | 'medium' | 'low' {
    const daysPending = Math.floor((Date.now() - new Date(request.created_at).getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysPending >= 7) return 'high'
    if (daysPending >= 5) return 'medium'
    return 'low'
  }

  private getUrgentReason(request: any, roles: string[]): 'overdue_approval' | 'delivery_delay' | 'payment_pending' {
    if (roles.includes('middle_manager') && request.middle_manager_status === 'pending') {
      return 'overdue_approval'
    }
    if ((roles.includes('final_approver') || roles.includes('ceo')) && request.final_manager_status === 'pending') {
      return 'overdue_approval'
    }
    if (!request.is_received) {
      return 'delivery_delay'
    }
    return 'payment_pending'
  }

  private calculateProgress(request: any): number {
    let progress = 0
    
    if (request.middle_manager_status === 'approved') progress += 25
    if (request.final_manager_status === 'approved') progress += 25
    if (request.is_payment_completed) progress += 25
    if (request.is_received) progress += 25
    
    return progress
  }

  private getCurrentStep(request: any): 'approval' | 'purchase' | 'delivery' | 'payment' | 'completed' {
    if (request.is_received) return 'completed'
    if (request.is_payment_completed) return 'delivery'
    if (request.final_manager_status === 'approved') return 'purchase'
    return 'approval'
  }

  private getNextAction(request: any): string {
    if (request.middle_manager_status === 'pending') return '중간 승인 대기 중'
    if (request.final_manager_status === 'pending') return '최종 승인 대기 중'
    if (!request.is_payment_completed) return '구매 처리 대기 중'
    if (!request.is_received) return '입고 대기 중'
    return '완료'
  }

  private estimateCompletion(request: any): string {
    const created = new Date(request.created_at)
    const today = new Date()
    const daysPassed = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
    
    // 평균 처리 시간을 기반으로 예상 완료일 계산
    let estimatedDays = 7 // 기본 7일
    if (request.progress_type === '긴급') estimatedDays = 3
    
    const estimatedCompletion = new Date(created.getTime() + estimatedDays * 24 * 60 * 60 * 1000)
    return estimatedCompletion.toLocaleDateString('ko-KR')
  }

  // lead_buyer를 위한 미다운로드 발주서 목록 조회
  async getUndownloadedOrders(employee: Employee): Promise<PurchaseRequestWithDetails[]> {
    const roles = this.parseRoles(employee.purchase_role)
    
    // lead_buyer 또는 "lead buyer" (공백 포함) 권한 체크
    if (!roles.includes('lead_buyer') && !roles.includes('lead buyer')) {
      return []
    }

    // 먼저 모든 발주서를 가져온 다음 클라이언트에서 필터링
    const { data, error } = await this.supabase
      .from('purchase_requests')
      .select('*,purchase_request_items(id,item_name,specification,quantity,unit_price_value,amount_value)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Failed to fetch undownloaded orders:', error)
      return []
    }

    // 클라이언트 사이드 필터링
    // 조건: (선진행이거나 최종승인 완료) AND (is_po_download가 false 또는 null)
    const filteredData = (data || []).filter(item => {
      // 다운로드 가능 조건 체크
      const isDownloadable = item.progress_type === '선진행' || 
        (item.middle_manager_status === 'approved' && item.final_manager_status === 'approved')
      
      // 아직 다운로드 안 된 것만
      const notDownloaded = !item.is_po_download || item.is_po_download === false || item.is_po_download === null
      
      return isDownloadable && notDownloaded
    })

    // 오래된 순으로 정렬 (created_at 기준 오름차순)
    filteredData.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    return filteredData.slice(0, 10) // 상위 10개만 반환
  }
}

export const dashboardService = new DashboardService()