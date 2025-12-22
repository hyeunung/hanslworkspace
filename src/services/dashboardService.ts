import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import { purchaseMemoryCache, CACHE_DURATION, updatePurchaseInMemory } from '@/stores/purchaseMemoryStore'
import type { 
  DashboardData, 
  DashboardStats, 
  UrgentRequest, 
  MyRequestStatus, 
  QuickAction,
  Employee,
  PurchaseRequestWithDetails,
  Purchase
} from '@/types/purchase'

// 대시보드 데이터 캐시
const dashboardCache = {
  data: null as DashboardData | null,
  lastFetch: 0,
  CACHE_DURATION: 30 * 1000, // 30초 캐시
  employeeId: null as string | null
}

export class DashboardService {
  private supabase = createClient()

  private hasValidPurchaseMemory(employee?: Employee | null): boolean {
    if (!purchaseMemoryCache.allPurchases || purchaseMemoryCache.allPurchases.length === 0) return false
    if (!employee?.id) return false
    
    const now = Date.now()
    const lastFetch = purchaseMemoryCache.lastFetch || 0
    const isFresh = (now - lastFetch) < CACHE_DURATION
    const isSameUser = purchaseMemoryCache.currentUser?.id === String(employee.id)
    
    return isFresh && isSameUser
  }

  // 대시보드 캐시 무효화 (승인/삭제 등 변경 시 강제 새로고침 유도)
  private invalidateDashboardCache() {
    dashboardCache.data = null
    dashboardCache.lastFetch = 0
    dashboardCache.employeeId = null
  }

  // 외부에서 대시보드 캐시를 무효화할 수 있도록 공개 메서드 제공
  public invalidateCache() {
    this.invalidateDashboardCache()
  }

  private getPurchaseMemory(): Purchase[] {
    return (purchaseMemoryCache.allPurchases || []) as Purchase[]
  }

  // 역할 파싱 유틸: 배열/CSV 문자열/단일 문자열을 모두 배열로 정규화
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
  async getDashboardData(employee: Employee, forceRefresh = false): Promise<DashboardData> {
    const now = Date.now()
    const cacheValid = !forceRefresh && 
                       dashboardCache.data && 
                       dashboardCache.employeeId === employee.id &&
                       (now - dashboardCache.lastFetch) < dashboardCache.CACHE_DURATION

    // 캐시가 유효하면 즉시 반환
    if (cacheValid && dashboardCache.data) {
      return dashboardCache.data
    }

    // ✅ 발주요청 관리와 동일한 방식: 메모리 캐시(최근 2000건 + 품목) 기반으로 대시보드 구성
    // - DataInitializer에서 이미 loadAllPurchaseData를 수행하므로 대시보드 진입 시 추가 DB 쿼리를 줄일 수 있음
    // - 메모리가 없으면 기존 Supabase 쿼리 방식으로 폴백
    // - forceRefresh가 true면 메모리 캐시도 무시하고 DB에서 직접 조회
    const useMemory = !forceRefresh && this.hasValidPurchaseMemory(employee)

    const results = await Promise.allSettled([
      useMemory ? this.getDashboardStatsFromMemory(employee) : this.getDashboardStats(employee),
      useMemory ? this.getMyRecentRequestsFromMemory(employee) : this.getMyRecentRequests(employee),
      useMemory ? this.getPendingApprovalsFromMemory(employee) : this.getPendingApprovals(employee),
      useMemory ? this.getQuickActionsFromMemory(employee) : this.getQuickActions(employee),
      useMemory ? this.getTodaySummaryFromMemory(employee) : this.getTodaySummary(employee),
      useMemory ? this.getMyPurchaseStatusFromMemory(employee) : this.getMyPurchaseStatus(employee)
    ])
    
    const statsResult = results[0]
    const myRecentRequestsResult = results[1]
    const pendingApprovalsResult = results[2]
    const quickActionsResult = results[3]
    const todaySummaryResult = results[4]
    const myPurchaseStatusResult = results[5]
    
    const stats: DashboardStats = statsResult.status === 'fulfilled' 
      ? statsResult.value 
      : { total: 0, myRequests: 0, pending: 0, completed: 0, urgent: 0, todayActions: 0 }
    
    const myRecentRequests: MyRequestStatus[] = myRecentRequestsResult.status === 'fulfilled'
      ? myRecentRequestsResult.value
      : []
    
    const pendingApprovals: PurchaseRequestWithDetails[] = pendingApprovalsResult.status === 'fulfilled'
      ? pendingApprovalsResult.value
      : []
    
    const quickActions: QuickAction[] = quickActionsResult.status === 'fulfilled'
      ? quickActionsResult.value
      : []
    
    const todaySummary = todaySummaryResult.status === 'fulfilled'
      ? todaySummaryResult.value
      : { approved: 0, requested: 0, received: 0 }
    
    const myPurchaseStatus = myPurchaseStatusResult.status === 'fulfilled'
      ? myPurchaseStatusResult.value
      : { waitingPurchase: [], waitingDelivery: [], recentCompleted: [] }
    
    // 실패한 항목 로깅
    if (statsResult.status === 'rejected') {
      logger.error('[DashboardService] getDashboardStats 실패:', statsResult.reason)
    }
    if (myRecentRequestsResult.status === 'rejected') {
      logger.error('[DashboardService] getMyRecentRequests 실패:', myRecentRequestsResult.reason)
    }
    if (pendingApprovalsResult.status === 'rejected') {
      logger.error('[DashboardService] getPendingApprovals 실패:', pendingApprovalsResult.reason)
    }
    if (quickActionsResult.status === 'rejected') {
      logger.error('[DashboardService] getQuickActions 실패:', quickActionsResult.reason)
    }
    if (todaySummaryResult.status === 'rejected') {
      logger.error('[DashboardService] getTodaySummary 실패:', todaySummaryResult.reason)
    }
    if (myPurchaseStatusResult.status === 'rejected') {
      logger.error('[DashboardService] getMyPurchaseStatus 실패:', myPurchaseStatusResult.reason)
    }

    const dashboardData: DashboardData = {
      employee,
      stats,
      urgentRequests: [],
      myRecentRequests,
      pendingApprovals,
      quickActions,
      todaySummary,
      myPurchaseStatus
    }

    // 캐시 업데이트
    dashboardCache.data = dashboardData
    dashboardCache.lastFetch = now
    dashboardCache.employeeId = employee.id

    return dashboardData
  }

  // ===== Memory-based implementations (발주요청 관리와 동일: 메모리 캐시 기반) =====

  private isPendingStatus(status: any): boolean {
    return status === 'pending' || status === '대기' || status === '' || status === null || status === undefined
  }

  private toTime(value?: string | null): number {
    if (!value) return 0
    const t = new Date(value).getTime()
    return Number.isFinite(t) ? t : 0
  }

  async getDashboardStatsFromMemory(employee: Employee): Promise<DashboardStats> {
    const purchases = this.getPurchaseMemory()
    const today = new Date().toISOString().split('T')[0]
    const roles = this.parseRoles(employee.purchase_role)

    const requesterName = employee.name || employee.email
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    const total = purchases.length
    const myRequests = purchases.filter(p => (p.requester_name || '') === employee.name).length
    const pending = await this.getPendingCountFromMemory(employee, roles)
    const completed = purchases.filter(p => p.is_received === true && this.toTime(p.received_at) >= this.toTime(monthStart)).length
    const urgent = this.getUrgentCountFromMemory(employee, roles, threeDaysAgo)
    const todayActions = this.getTodayActionsCountFromMemory(employee, today)

    return { total, myRequests, pending, completed, urgent, todayActions }
  }

  async getMyRecentRequestsFromMemory(employee: Employee): Promise<MyRequestStatus[]> {
    const purchases = this.getPurchaseMemory()
    const requesterName = employee.name || employee.email

    const filtered = purchases
      .filter((item: any) => (item.requester_name || '') === requesterName)
      .filter((item: any) => {
        // 승인 진행중인 항목만 (승인 대기는 제외)
        const middleApproved = item.middle_manager_status === 'approved'
        const finalPending = this.isPendingStatus(item.final_manager_status)
        const finalApproved = item.final_manager_status === 'approved'
        const notPaid = !item.is_payment_completed
        return (middleApproved && finalPending) || (finalApproved && notPaid)
      })
      .sort((a: any, b: any) => this.toTime(b.created_at) - this.toTime(a.created_at))
      .slice(0, 5)

    return filtered.map((item: any) => ({
      ...item,
      vendor_name: item.vendor_name,
      total_items: (item.purchase_request_items || []).length,
      progress_percentage: this.calculateProgress(item),
      current_step: this.getCurrentStep(item),
      next_action: this.getNextAction(item),
      estimated_completion: this.estimateCompletion(item)
    })) as MyRequestStatus[]
  }

  async getPendingApprovalsFromMemory(employee: Employee): Promise<PurchaseRequestWithDetails[]> {
    const roles = this.parseRoles(employee.purchase_role)
    if (roles.length === 0) return []

    const purchases = this.getPurchaseMemory()

    // 최신 순 정렬 후 처리 (기존 쿼리: request_date desc, limit 100)
    const sorted = [...purchases].sort((a: any, b: any) => this.toTime(b.request_date) - this.toTime(a.request_date))

    // 승인 대기인 항목만 필터링
    const filteredPending = sorted.filter((item: any) => {
      const middlePending = this.isPendingStatus(item.middle_manager_status)
      const finalPending = this.isPendingStatus(item.final_manager_status)

      // 반려된 경우는 제외
      const middleRejected = item.middle_manager_status === 'rejected'
      const finalRejected = item.final_manager_status === 'rejected'
      if (middleRejected || finalRejected) return false

      return middlePending || finalPending
    })

    // 역할별 권한에 따른 추가 필터링
    let roleFiltered = filteredPending

    if (roles.includes('app_admin')) {
      // all
    } else if (roles.includes('middle_manager')) {
      roleFiltered = filteredPending.filter((item: any) => this.isPendingStatus(item.middle_manager_status))
    } else if (roles.includes('final_approver') || roles.includes('ceo')) {
      roleFiltered = filteredPending.filter((item: any) => item.middle_manager_status === 'approved' && this.isPendingStatus(item.final_manager_status))
    } else if (roles.includes('raw_material_manager') || roles.includes('consumable_manager')) {
      roleFiltered = filteredPending.filter((item: any) => item.middle_manager_status === 'approved' && this.isPendingStatus(item.final_manager_status))
    } else if (roles.includes('lead buyer')) {
      roleFiltered = filteredPending.filter((item: any) => item.final_manager_status === 'approved' && !item.is_payment_completed)
    } else {
      roleFiltered = []
    }

    // 데이터 가공: total_amount 보강
    const enhanced = roleFiltered.slice(0, 100).map((item: any) => {
      const items = item.purchase_request_items || item.items || []
      const total_amount = Number(item.total_amount) || items.reduce((sum: number, i: any) => {
        const amount = Number(i?.amount_value) || (Number(i?.quantity) || 0) * (Number(i?.unit_price_value) || 0)
        return sum + amount
      }, 0)

      return {
        ...item,
        purchase_request_items: items,
        items,
        total_amount,
        vendor_name: item.vendor_name || item.project_vendor || item.vendor?.vendor_name
      }
    })

    return enhanced as PurchaseRequestWithDetails[]
  }

  async getQuickActionsFromMemory(employee: Employee): Promise<QuickAction[]> {
    const roles = this.parseRoles(employee.purchase_role)
    const actions: QuickAction[] = []

    if (roles.includes('app_admin') || roles.includes('middle_manager') || roles.includes('final_approver') || roles.includes('ceo')) {
      const pendingCount = await this.getPendingCountFromMemory(employee, roles)
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

    if (roles.includes('lead buyer') || roles.includes('lead buyer')) {
      const purchases = this.getPurchaseMemory()
      const purchaseCount = purchases.filter((p: any) => p.final_manager_status === 'approved' && p.is_payment_completed === false).length
      if (purchaseCount > 0) {
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

  async getTodaySummaryFromMemory(employee: Employee) {
    const purchases = this.getPurchaseMemory()
    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const inRange = (ts?: string | null) => {
      const t = this.toTime(ts)
      return t >= this.toTime(today) && t < this.toTime(tomorrow)
    }

    const approved = purchases.filter((p: any) => inRange(p.updated_at) && (p.middle_manager_status === 'approved' || p.final_manager_status === 'approved')).length
    const requested = purchases.filter((p: any) => (p.requester_name || '') === employee.name && inRange(p.created_at)).length
    const received = purchases.filter((p: any) => p.is_received === true && inRange(p.received_at)).length

    return { approved, requested, received }
  }

  async getMyPurchaseStatusFromMemory(employee: Employee): Promise<{ waitingPurchase: PurchaseRequestWithDetails[], waitingDelivery: PurchaseRequestWithDetails[], recentCompleted: PurchaseRequestWithDetails[] }> {
    const roles = this.parseRoles(employee.purchase_role)
    const isLeadBuyer = roles.includes('lead buyer') || roles.includes('app_admin')

    const requesterName = employee.name || employee.email
    const purchases = this.getPurchaseMemory()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // lead buyer/app_admin: 전체, 그 외: 본인 것만
    const allMyRequests = isLeadBuyer
      ? purchases
      : purchases.filter((p: any) => (p.requester_name || '') === requesterName)

    const waitingPurchase = allMyRequests.filter((item: any) => {
      const category = (item.payment_category || '').trim()
      const isPurchaseRequest = category === '구매 요청'
      const notPaid = !item.is_payment_completed
      if (!isPurchaseRequest || !notPaid) return false

      const isSeonJin = (item.progress_type || '').includes('선진행')
      if (isSeonJin) return true

      const isIlban = (item.progress_type || '').includes('일반') || !item.progress_type || item.progress_type === ''
      const finalApproved = item.final_manager_status === 'approved'
      return isIlban && finalApproved
    })

    const waitingDelivery = purchases.filter((item: any) => {
      const notReceived = !item.is_received
      const isSeonJin = (item.progress_type || '').includes('선진행')

      // 입고 대기는 항상 본인 것만 (기존 로직)
      if ((item.requester_name || '') !== requesterName) return false

      if (notReceived && isSeonJin) return true

      const finalApproved = item.final_manager_status === 'approved'
      return notReceived && finalApproved
    })

    const recentCompleted = purchases.filter((item: any) => {
      if (item.is_received !== true) return false
      if (!item.received_at) return false
      if ((item.requester_name || '') !== requesterName) return false
      return this.toTime(item.received_at) >= this.toTime(sevenDaysAgo)
    })

    // 대시보드 UI용: 최신순 정렬 (created_at desc)
    const sortDesc = (a: any, b: any) => this.toTime(b.created_at) - this.toTime(a.created_at)

    return {
      waitingPurchase: [...waitingPurchase].sort(sortDesc) as any,
      waitingDelivery: [...waitingDelivery].sort(sortDesc) as any,
      recentCompleted: [...recentCompleted].sort(sortDesc) as any
    }
  }

  private async getPendingCountFromMemory(employee: Employee, roles: string[]): Promise<number> {
    const purchases = this.getPurchaseMemory()

    if (roles.includes('app_admin')) {
      const mid = purchases.filter((p: any) => this.isPendingStatus(p.middle_manager_status)).length
      const fin = purchases.filter((p: any) => p.middle_manager_status === 'approved' && this.isPendingStatus(p.final_manager_status)).length
      const pur = purchases.filter((p: any) => p.final_manager_status === 'approved' && p.is_payment_completed === false).length
      return mid + fin + pur
    }

    if (roles.includes('middle_manager')) {
      return purchases.filter((p: any) => this.isPendingStatus(p.middle_manager_status)).length
    }

    if (roles.includes('final_approver') || roles.includes('ceo')) {
      return purchases.filter((p: any) => p.middle_manager_status === 'approved' && this.isPendingStatus(p.final_manager_status)).length
    }

    if (roles.includes('lead buyer')) {
      return purchases.filter((p: any) => p.final_manager_status === 'approved' && p.is_payment_completed === false).length
    }

    return 0
  }

  private getUrgentCountFromMemory(employee: Employee, roles: string[], threeDaysAgoIso: string): number {
    const purchases = this.getPurchaseMemory()
    const threeDaysAgo = this.toTime(threeDaysAgoIso)

    const base = purchases.filter((p: any) => this.toTime(p.created_at) > 0 && this.toTime(p.created_at) < threeDaysAgo)

    if (roles.includes('app_admin')) {
      return base.filter((p: any) =>
        p.middle_manager_status === 'pending' ||
        p.final_manager_status === 'pending' ||
        p.is_payment_completed === false
      ).length
    }
    if (roles.includes('middle_manager')) {
      return base.filter((p: any) => p.middle_manager_status === 'pending').length
    }
    if (roles.includes('final_approver') || roles.includes('ceo')) {
      return base.filter((p: any) => p.middle_manager_status === 'approved' && p.final_manager_status === 'pending').length
    }
    if (roles.includes('lead buyer')) {
      return base.filter((p: any) => p.final_manager_status === 'approved' && p.is_payment_completed === false).length
    }
    return 0
  }

  private getTodayActionsCountFromMemory(employee: Employee, todayIsoDate: string): number {
    const purchases = this.getPurchaseMemory()
    const tomorrowIsoDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const inRange = (ts?: string | null) => {
      const t = this.toTime(ts)
      return t >= this.toTime(todayIsoDate) && t < this.toTime(tomorrowIsoDate)
    }

    return purchases.filter((p: any) => inRange(p.updated_at) && (p.requester_name || '') === employee.name).length
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

  // 내 최근 요청 상태 (승인 진행중인 항목만 - 승인 대기는 제외) - 이미 JOIN 최적화됨
  async getMyRecentRequests(employee: Employee): Promise<MyRequestStatus[]> {
    const { data } = await this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(id)')
      .eq('requester_name', employee.name)
      // 승인이 진행중인 항목만 (1차 승인됨 + 최종 대기중 OR 모든 승인 완료 + 구매 대기중)
      .or('and(middle_manager_status.eq.approved,final_manager_status.eq.pending),and(final_manager_status.eq.approved,is_payment_completed.eq.false)')
      .order('created_at', { ascending: false })
      .limit(5)

    return (data || []).map((item: any) => ({
      ...item,
      vendor_name: item.vendors?.vendor_name,
      total_items: item.purchase_request_items?.length || 0,
      progress_percentage: this.calculateProgress(item),
      current_step: this.getCurrentStep(item),
      next_action: this.getNextAction(item),
      estimated_completion: this.estimateCompletion(item)
    })) as MyRequestStatus[]
  }

  // 승인 대기 항목 (전체 조회) - JOIN 쿼리로 N+1 문제 해결
  async getPendingApprovals(employee: Employee): Promise<PurchaseRequestWithDetails[]> {
    const roles = this.parseRoles(employee.purchase_role)

    // 역할이 있는 사용자만 승인 대기 항목을 볼 수 있음
    if (roles.length === 0) {
      return []
    }

    logger.debug('🚀 승인 대기 항목 조회 시작', {
      employeeName: employee.name,
      employeeRoles: roles
    })

    // ✅ N+1 문제 해결: JOIN을 사용하여 한 번의 쿼리로 모든 관련 데이터 조회
    const { data: allRequests, error: requestsError } = await this.supabase
      .from('purchase_requests')
      .select(`
        *,
        vendors(vendor_name),
        purchase_request_items(
          id,
          item_name,
          specification,
          quantity,
          unit_price_value,
          amount_value
        )
      `)
      .order('request_date', { ascending: false })
      .limit(100) // 성능 최적화: 100개로 제한

    if (requestsError) {
      logger.error('❌ 승인 대기 항목 조회 실패', requestsError)
      return []
    }

    // 클라이언트 사이드에서 승인 대기 상태 필터링
    let filteredData = allRequests || []

    // pending, 대기, 빈문자열, null 모두 대기로 처리
    const isPending = (status: any) => (
      status === 'pending' || status === '대기' || status === '' || status === null || status === undefined
    )

    logger.debug('🔍 승인 대기 필터링 전 데이터', {
      totalRequests: allRequests?.length || 0
    })
    
    // 승인 대기인 항목만 필터링
    filteredData = filteredData.filter((item: any) => {
      const middlePending = isPending(item.middle_manager_status)
      const finalPending = isPending(item.final_manager_status)
      
      // 반려된 경우는 제외
      const middleRejected = item.middle_manager_status === 'rejected'
      const finalRejected = item.final_manager_status === 'rejected'
      
      if (middleRejected || finalRejected) return false
      
      // 중간승인 대기 또는 최종승인 대기
      return middlePending || finalPending
    })

    // 역할별 권한에 따른 추가 필터링
    let roleFilteredData = filteredData
    
    if (roles.includes('app_admin')) {
      // app_admin은 모든 승인 대기 항목 볼 수 있음 (필터링 없음)
      logger.debug('🔑 app_admin 권한으로 모든 승인대기 항목 표시', {
        totalItems: roleFilteredData.length
      })
    } else if (roles.includes('middle_manager')) {
      // 중간승인자: 중간승인 대기 항목만
      roleFilteredData = filteredData.filter((item: any) => isPending(item.middle_manager_status))
      logger.debug('🔑 middle_manager 권한으로 중간승인 대기 항목만 표시', {
        beforeFilter: filteredData.length,
        afterFilter: roleFilteredData.length
      })
    } else if (roles.includes('final_approver') || roles.includes('ceo')) {
      // 최종승인자: 중간승인 완료 + 최종승인 대기 항목만
      roleFilteredData = filteredData.filter((item: any) => {
        const middleApproved = item.middle_manager_status === 'approved'
        const finalPending = isPending(item.final_manager_status)
        return middleApproved && finalPending
      })
      logger.debug('🔑 final_approver/ceo 권한으로 최종승인 대기 항목만 표시', {
        beforeFilter: filteredData.length,
        afterFilter: roleFilteredData.length
      })
    } else if (roles.includes('raw_material_manager') || roles.includes('consumable_manager')) {
      // 원자재/소모품 매니저: 최종승인자와 동일한 권한
      roleFilteredData = filteredData.filter((item: any) => {
        const middleApproved = item.middle_manager_status === 'approved'
        const finalPending = isPending(item.final_manager_status)
        return middleApproved && finalPending
      })
      logger.debug('🔑 material_manager 권한으로 최종승인 대기 항목만 표시', {
        beforeFilter: filteredData.length,
        afterFilter: roleFilteredData.length
      })
    } else if (roles.includes('lead buyer')) {
      // 구매담당자: 최종승인 완료 + 구매 대기 항목만
      roleFilteredData = filteredData.filter((item: any) => {
        const finalApproved = item.final_manager_status === 'approved'
        const purchasePending = !item.is_payment_completed
        return finalApproved && purchasePending
      })
      logger.debug('🔑 lead buyer 권한으로 구매 대기 항목만 표시', {
        beforeFilter: filteredData.length,
        afterFilter: roleFilteredData.length
      })
    } else {
      // 기타 역할은 승인 권한 없음
      roleFilteredData = []
      logger.debug('🔑 승인 권한 없는 역할', { roles, result: 'empty' })
    }

    // ✅ 데이터 가공: JOIN으로 가져온 데이터를 기반으로 처리
    const enhancedData = roleFilteredData.map((item: any) => {
      // vendor_name 처리 (JOIN 결과 사용)
      const vendor_name = item.vendors?.vendor_name || item.vendor_name || '업체 정보 없음'
      
      // purchase_request_items 처리 (이미 JOIN으로 가져옴)
      const purchase_request_items = item.purchase_request_items || []
      
      // total_amount 계산
      const total_amount = purchase_request_items.reduce((sum: number, i: any) => {
        const amount = Number(i?.amount_value) || (Number(i?.quantity) || 0) * (Number(i?.unit_price_value) || 0)
        return sum + amount
      }, 0)

      return {
        ...item,
        vendor_name,
        purchase_request_items,
        total_amount
      }
    })
    
    logger.debug('✅ 승인 대기 항목 조회 완료 (최적화됨)', {
      finalCount: enhancedData.length,
      performanceNote: 'N+1 문제 해결 - 단일 JOIN 쿼리 사용'
    })

    return enhancedData
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
    if (roles.includes('lead buyer') || roles.includes('lead buyer')) {
      const { count: purchaseCount } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('final_manager_status', 'approved')
        .eq('is_payment_completed', false)

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

  // 내 구매/입고 상태 확인 - JOIN 쿼리로 최적화됨
  async getMyPurchaseStatus(employee: Employee): Promise<{ waitingPurchase: PurchaseRequestWithDetails[], waitingDelivery: PurchaseRequestWithDetails[], recentCompleted: PurchaseRequestWithDetails[] }> {
    
    const roles = this.parseRoles(employee.purchase_role)
    const isLeadBuyer = roles.includes('lead buyer') || roles.includes('app_admin')
    
    // name이 없으면 email 사용
    const requesterName = employee.name || employee.email
    
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // ✅ JOIN을 사용하여 한 번의 쿼리로 모든 관련 데이터 조회
    // lead buyer 또는 app_admin은 모든 항목 조회, 그 외는 본인 것만
    // PurchaseItemsModal과 동일한 데이터 구조를 위해 purchase_request_items 전체 필드 조회
    let query = this.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name),purchase_request_items(*)')
      .order('created_at', { ascending: false })
      .limit(500)  // 충분한 개수로 증가
    
    if (!isLeadBuyer) {
      query = query.eq('requester_name', requesterName)
    }
    
    const myRequests = await query

    if (myRequests.error) {
      logger.error('getMyPurchaseStatus 에러', myRequests.error)
      return {
        waitingPurchase: [],
        waitingDelivery: [],
        recentCompleted: []
      }
    }

    const allMyRequests = myRequests.data || []
    

    // 클라이언트 사이드 필터링 (PurchaseListMain 구매/입고 탭과 동일한 로직)
    
    const waitingPurchase = allMyRequests.filter((item: any) => {
      // 구매 대기: 구매 요청 + 결제 미완료 + (선진행이거나 최종승인완료)
      const category = (item.payment_category || '').trim()
      const isPurchaseRequest = category === '구매 요청'
      const notPaid = !item.is_payment_completed
      
      // 구매 요청이 아니거나 이미 결제 완료된 것은 제외
      if (!isPurchaseRequest || !notPaid) return false
      
      const isSeonJin = (item.progress_type || '').includes('선진행')
      
      // 선진행은 승인 상태와 무관하게 구매 대기
      if (isSeonJin) {
        return true
      }
      
      // 일반은 최종 승인 완료되어야 구매 대기
      const isIlban = (item.progress_type || '').includes('일반') || !item.progress_type || item.progress_type === ''
      const finalApproved = item.final_manager_status === 'approved'
      
      return isIlban && finalApproved
    })


    const waitingDelivery = allMyRequests.filter((item: any) => {
      // 입고 탭 로직: 입고 미완료 + 선진행(승인무관) OR 최종승인
      const notReceived = !item.is_received
      const isSeonJin = (item.progress_type || '').includes('선진행')
      
      // 입고 대기는 항상 본인 것만 (lead buyer도 본인 것만)
      if (item.requester_name !== requesterName) {
        return false
      }
      
      // 선진행은 승인 상태와 무관하게 입고 대기
      if (notReceived && isSeonJin) {
        return true
      }
      
      // 일반은 최종 승인 완료되어야 입고 대기
      const finalApproved = item.final_manager_status === 'approved'
      
      return notReceived && finalApproved
    })


    const recentCompleted = allMyRequests.filter((item: any) => {
      // 입고 완료 && 7일 이내 && 본인 것만
      if (item.is_received !== true) return false
      if (!item.received_at) return false
      if (item.requester_name !== requesterName) return false
      
      const receivedDate = new Date(item.received_at)
      const sevenDaysAgoDate = new Date(sevenDaysAgo)
      return receivedDate >= sevenDaysAgoDate
    })


    return {
      waitingPurchase: waitingPurchase,
      waitingDelivery: waitingDelivery,
      recentCompleted: recentCompleted
    }
  }

  // 원클릭 승인 API
  async quickApprove(
    requestId: string,
    employee: Employee
  ): Promise<{ success: boolean; stage?: 'middle' | 'final'; error?: string }> {
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
      let stage: 'middle' | 'final' | null = null

      // pending, 대기, null, 빈 문자열 모두 대기 상태로 간주
      const isPending = (status: any) =>
        status === 'pending' || status === '대기' || status === '' || status === null || status === undefined

      if (roles.includes('app_admin')) {
        if (isPending(request.middle_manager_status)) {
          updateData = {
            middle_manager_status: 'approved'
          }
          stage = 'middle'
        } else if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
          stage = 'final'
        }
      } else if (roles.includes('middle_manager')) {
        if (isPending(request.middle_manager_status)) {
          updateData = {
            middle_manager_status: 'approved'
          }
          stage = 'middle'
        }
      } else if (roles.includes('final_approver') || roles.includes('ceo')) {
        if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
          stage = 'final'
        }
      } else if (roles.includes('raw_material_manager') || roles.includes('consumable_manager')) {
        // raw_material_manager와 consumable_manager도 최종 승인 권한이 있음
        if (request.middle_manager_status === 'approved' && isPending(request.final_manager_status)) {
          updateData = {
            final_manager_status: 'approved'
          }
          stage = 'final'
        }
      }

      // updateData가 비어있으면 승인할 단계가 없음
      if (!stage || Object.keys(updateData).length === 0) {
        return { success: false, error: '승인할 수 있는 상태가 아닙니다.' }
      }

      const { error } = await this.supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', requestId)

      if (error) {
        // Error details are handled by the caller
        throw error
      }

      // 메모리 캐시 업데이트 (있을 때만)
      updatePurchaseInMemory(requestId, (purchase) => ({
        ...purchase,
        ...updateData
      }))

      // 대시보드 캐시 무효화 → 다음 로드 시 강제 새로고침
      this.invalidateDashboardCache()

      return { success: true, stage }
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
          .eq('is_payment_completed', false)
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

    if (roles.includes('lead buyer')) {
      const { count, error } = await this.supabase
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('final_manager_status', 'approved')
        .eq('is_payment_completed', false)

      if (error) {
        // Count error for lead buyer - will use 0
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
      query = query.or('middle_manager_status.eq.pending,final_manager_status.eq.pending,is_payment_completed.eq.false')
    } else if (roles.includes('middle_manager')) {
      query = query.eq('middle_manager_status', 'pending')
    } else if (roles.includes('final_approver') || roles.includes('ceo')) {
      query = query
        .eq('middle_manager_status', 'approved')
        .eq('final_manager_status', 'pending')
    } else if (roles.includes('lead buyer')) {
      query = query
        .eq('final_manager_status', 'approved')
        .eq('is_payment_completed', false)
    } else {
      return 0
    }

    const { count } = await query
    return count || 0
  }

  private async getTodayActionsCount(employee: Employee, today: string): Promise<number> {
    // middle_manager_id와 final_manager_id 컬럼이 존재하지 않으므로
    // 오늘 업데이트된 요청 중 해당 직원이 요청한 요청만 카운트
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const { count } = await this.supabase
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', today)
      .lt('updated_at', tomorrow)
      .eq('requester_name', employee.name)

    return count || 0
  }

  // 전체 입고대기 건수 조회 (권한에 관계없이 전체 조회)
  async getTotalDeliveryWaitingCount(): Promise<number> {
    const { count } = await this.supabase
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .eq('is_received', false)
      .or('is_payment_completed.eq.true,progress_type.ilike.%선진행%')

    return count || 0
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

  // lead buyer 또는 app_admin을 위한 미다운로드 발주서 목록 조회 - 이미 JOIN 최적화됨
  async getUndownloadedOrders(employee: Employee): Promise<PurchaseRequestWithDetails[]> {
    const roles = this.parseRoles(employee.purchase_role)
    
    // lead buyer 또는 app_admin 권한 체크
    if (!roles.includes('lead buyer') && !roles.includes('app_admin')) {
      logger.info('[DashboardService] 미다운로드 발주서 조회 권한 없음:', { roles })
      return []
    }

    // ✅ 메모리 캐시가 있으면 DB 조회 없이 즉시 계산 (대시보드 체감 속도 개선)
    if (this.hasValidPurchaseMemory(employee)) {
      const purchases = this.getPurchaseMemory()
        .filter((item: any) => item.is_po_download !== true) // NULL/false 포함
        .sort((a: any, b: any) => this.toTime(b.created_at) - this.toTime(a.created_at))
        .slice(0, 500)

      const filteredData = purchases.filter((item: any) => {
        if (item.is_po_download === true) return false
        if (item.progress_type === '선진행') return true
        return item.final_manager_status === 'approved'
      })

      return filteredData as any
    }

    try {
      // 미다운로드 발주서만 먼저 가져오기 (NULL이거나 false인 것들)
      const { data, error } = await this.supabase
        .from('purchase_requests')
        .select(`
          *,
          purchase_request_items(
            id,
            item_name,
            specification,
            quantity,
            unit_price_value,
            amount_value
          )
        `)
        .or('is_po_download.is.null,is_po_download.eq.false')
        .order('created_at', { ascending: false })  // 최신 순으로 정렬
        .limit(500)  // 더 많은 데이터 조회

      if (error) {
        logger.error('[DashboardService] 미다운로드 발주서 조회 쿼리 에러:', error)
        throw error
      }

      // 클라이언트 사이드에서 조건에 맞는 것만 필터링
      const filteredData = (data || []).filter((item: any) => {
        if (item.is_po_download === true) return false
        if (item.progress_type === '선진행') return true
        return item.final_manager_status === 'approved'
      })

      return filteredData
    } catch (error) {
      logger.error('[DashboardService] getUndownloadedOrders 에러:', error)
      throw error // 에러를 상위로 전파
    }
  }
}

export const dashboardService = new DashboardService()