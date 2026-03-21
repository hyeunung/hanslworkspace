import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { 
  Home, 
  ShoppingCart, 
  Building2, 
  Users, 
  FileText,
  FileCheck,
  X,
  MessageCircle,
  Receipt,
  Package,
  FileEdit
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { supportService } from '@/services/supportService'
import { usePurchaseMemory } from '@/hooks/usePurchaseMemory'
import { countPendingApprovalsForSidebarBadge } from '@/utils/purchaseFilters'
import { useAuth } from '@/contexts/AuthContext'

interface NavigationProps {
  role?: string | string[]
  isOpen?: boolean
  onClose?: () => void
}

const TRIP_APPROVER_ROLES = ["middle_manager", "final_approver", "ceo", "app_admin"]

export default function FixedNavigation({ role, isOpen = false, onClose }: NavigationProps) {
  const location = useLocation()
  const pathname = location.pathname
  const { allPurchases } = usePurchaseMemory()
  const { employee } = useAuth()
  const [isExpanded, setIsExpanded] = useState(false)

  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)
  const [pendingStatementCount, setPendingStatementCount] = useState(0)
  const [pendingApplicationCount, setPendingApplicationCount] = useState(0)

  const roles = Array.isArray(role) ? role : (role ? [role] : [])
  const isAdmin = roles.includes('app_admin')
  const isApplicationApprover = roles.includes('app_admin') || roles.includes('hr')
  const canSeeStatementBadge = roles.includes('app_admin') || roles.includes('lead buyer')

  // 관리자: 미처리(open+in_progress) 건수
  useEffect(() => {
    if (!isAdmin) return

    const loadPendingCount = async () => {
      const result = await supportService.getAllInquiries()
      if (result.success) {
        const pendingCount = result.data.filter(
          inquiry => inquiry.status === 'open' || inquiry.status === 'in_progress'
        ).length
        setPendingInquiryCount(pendingCount)
      }
    }

    loadPendingCount()
    const subscription = supportService.subscribeToInquiries((payload) => {
      loadPendingCount()
    })
    return () => subscription.unsubscribe()
  }, [isAdmin])

  // 사용자: 내 미처리 문의(open+in_progress) 개수
  useEffect(() => {
    if (isAdmin) return

    const supabase = createClient()
    let subscription: { unsubscribe: () => void } | null = null
    let cancelled = false
    let currentUserId = ''

    const loadMyPendingCount = async () => {
      if (!currentUserId) {
        const { data: { user } } = await supabase.auth.getUser()
        currentUserId = user?.id || ''
      }
      if (!currentUserId) return

      const { count } = await supabase
        .from('support_inquires')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUserId)
        .in('status', ['open', 'in_progress'])

      if (!cancelled && typeof count === 'number') {
        setPendingInquiryCount(count)
      }

      if (!subscription) {
        subscription = supportService.subscribeToInquiries((payload) => {
          if (!currentUserId) {
            loadMyPendingCount()
            return
          }
          const newRow = payload?.new as { user_id?: string } | undefined
          const oldRow = payload?.old as { user_id?: string } | undefined
          if (newRow?.user_id !== currentUserId && oldRow?.user_id !== currentUserId) return
          loadMyPendingCount()
        })
      }
    }

    loadMyPendingCount()
    return () => {
      cancelled = true
      if (subscription) subscription.unsubscribe()
    }
  }, [isAdmin])

  const supportBadge = pendingInquiryCount
  const statementBadge = pendingStatementCount
  const [otherPendingCount, setOtherPendingCount] = useState(0)
  const purchaseOnlyBadge = useMemo(
    () => countPendingApprovalsForSidebarBadge(allPurchases, role),
    [allPurchases, role]
  )
  const purchasePendingBadge = purchaseOnlyBadge + otherPendingCount

  useEffect(() => {
    if (!canSeeStatementBadge) return
    const supabase = createClient()
    let cancelled = false
    let subscription: ReturnType<ReturnType<typeof createClient>['channel']> | null = null

    const loadPendingStatements = async () => {
      const { count } = await supabase
        .from('transaction_statements')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'processing', 'extracted'])

      if (!cancelled && typeof count === 'number') {
        setPendingStatementCount(count)
      }
    }

    loadPendingStatements()

    subscription = supabase
      .channel('transaction-statements-badge')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transaction_statements'
        },
        () => {
          loadPendingStatements()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      if (subscription) supabase.removeChannel(subscription)
    }
  }, [canSeeStatementBadge])

  const loadOtherPendingCounts = useCallback(async () => {
    try {
      const supabase = createClient()
      const isCardVehicleApprover = roles.includes('app_admin') || roles.includes('hr')
      const isTripApprover = roles.some((r: string) => TRIP_APPROVER_ROLES.includes(r))

      const [cardRes, vehicleRes, tripRes, myTripRes] = await Promise.all([
        isCardVehicleApprover
          ? supabase.from('card_usages').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isCardVehicleApprover
          ? supabase.from('vehicle_requests').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isTripApprover
          ? supabase.from('business_trips').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        supabase.from('business_trips').select('id', { count: 'exact', head: true })
          .eq('requester_id', employee?.id || '__no_user__')
          .eq('approval_status', 'approved')
          .in('settlement_status', ['draft', 'submitted', 'rejected']),
      ])

      const total =
        (isCardVehicleApprover ? cardRes.count || 0 : 0) +
        (isCardVehicleApprover ? vehicleRes.count || 0 : 0) +
        (isTripApprover ? tripRes.count || 0 : 0) +
        (myTripRes.count || 0)

      setOtherPendingCount(total)
    } catch {
      // 배지 카운트 실패 시 무시
    }
  }, [roles, employee?.id])

  useEffect(() => {
    loadOtherPendingCounts()
    const timer = window.setInterval(loadOtherPendingCounts, 30000)
    return () => window.clearInterval(timer)
  }, [loadOtherPendingCounts])

  // hr, app_admin: 신청서 승인 대기 개수
  useEffect(() => {
    if (!isApplicationApprover) return
    const supabase = createClient()
    let cancelled = false

    const loadPendingApplications = async () => {
      const { count } = await supabase
        .from('ai_service_applications')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending')
      if (!cancelled && typeof count === 'number') {
        setPendingApplicationCount(count)
      }
    }

    loadPendingApplications()
    const subscription = supabase
      .channel('ai-service-applications-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_service_applications' }, loadPendingApplications)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(subscription)
    }
  }, [isApplicationApprover])

  const menuItems = [
    {
      label: '대시보드',
      href: '/dashboard',
      icon: Home,
      roles: ['all']
    },
    {
      label: '새 요청',
      href: '/purchase/new',
      icon: ShoppingCart,
      roles: ['all']
    },
    {
      label: '요청 목록',
      href: '/purchase/list',
      icon: FileText,
      roles: ['all']
    },
    {
      label: '거래명세서 확인',
      href: '/transaction-statement',
      icon: FileCheck,
      roles: ['all']
    },
    {
      label: '영수증',
      href: '/receipts',
      icon: Receipt,
      roles: ['app_admin', 'hr', 'lead buyer']
    },
    {
      label: '업체 관리',
      href: '/vendor',
      icon: Building2,
      roles: ['all']
    },
    {
      label: '직원 관리',
      href: '/employee',
      icon: Users,
      roles: ['all']
    },
    {
      label: 'BOM/좌표 정리',
      href: '/bom-coordinate',
      icon: Package,
      roles: ['all']
    }
  ]

  const filteredMenuItems = menuItems.filter(item => {
    if (item.roles.includes('all')) return true
    
    if (Array.isArray(role)) {
      return item.roles.some(r => role.includes(r))
    } else if (role) {
      return item.roles.includes(role)
    }
    return false
  })

  return (
    <>
      {/* 모바일 오버레이 */}
      {isOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={onClose}
        />
      )}
      
        {/* 데스크톱 네비게이션 - hover 시 확장 */}
        <aside
          className="hidden lg:block"
          style={{
            position: 'fixed',
            left: 0,
            top: '56px',
            width: isExpanded ? '200px' : '56px',
            height: 'calc(100vh - 56px)',
            backgroundColor: 'white',
            borderRight: '1px solid #e5e7eb',
            zIndex: 30,
            transition: 'width 0.2s ease',
            overflow: 'hidden',
          }}
          onMouseEnter={() => setIsExpanded(true)}
          onMouseLeave={() => setIsExpanded(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 메뉴 아이템들 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ul className="p-2 space-y-1">
                {filteredMenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        className={cn(
                          'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap',
                          isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                          isActive
                            ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                        )}
                      >
                        <div className="relative flex-shrink-0">
                          <Icon className="w-4 h-4" />
                          {!isExpanded && item.href === '/purchase/list' && purchasePendingBadge > 0 && (
                            <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                              {purchasePendingBadge > 99 ? '99+' : purchasePendingBadge}
                            </span>
                          )}
                          {!isExpanded && item.href === '/transaction-statement' && canSeeStatementBadge && statementBadge > 0 && (
                            <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                              {statementBadge > 99 ? '99+' : statementBadge}
                            </span>
                          )}
                        </div>
                        {isExpanded && (
                          <>
                            <span className="text-sm font-medium flex-1">{item.label}</span>
                            {item.href === '/purchase/list' && purchasePendingBadge > 0 && (
                              <span className={cn(
                                "text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
                                isActive ? "bg-hansl-200 text-hansl-700" : "bg-red-100 text-red-700"
                              )}>
                                {purchasePendingBadge > 99 ? '99+' : purchasePendingBadge}
                              </span>
                            )}
                            {item.href === '/transaction-statement' && canSeeStatementBadge && statementBadge > 0 && (
                              <span className={cn(
                                "text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
                                isActive ? "bg-hansl-200 text-hansl-700" : "bg-red-100 text-red-700"
                              )}>
                                {statementBadge > 99 ? '99+' : statementBadge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* 신청서 관리 / 문의하기 버튼 - 하단 고정 */}
            <div className="p-2 border-t border-gray-200 space-y-1">
              <Link
                to="/application"
                className={cn(
                  'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap',
                  isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                  pathname === '/application' || pathname.startsWith('/application/')
                    ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                )}
              >
                <div className="relative flex-shrink-0">
                  <FileEdit className="w-4 h-4" />
                  {!isExpanded && isApplicationApprover && pendingApplicationCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                      {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <>
                    <span className="text-sm font-medium flex-1">신청서 관리</span>
                    {isApplicationApprover && pendingApplicationCount > 0 && (
                      <span className={cn(
                        "text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
                        pathname === '/application' || pathname.startsWith('/application/')
                          ? "bg-hansl-200 text-hansl-700" : "bg-red-100 text-red-700"
                      )}>
                        {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                      </span>
                    )}
                  </>
                )}
              </Link>
              <div className="border-t border-gray-200 my-1" />
              <Link
                to="/support"
                className={cn(
                  'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap',
                  isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                  pathname === '/support'
                    ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                )}
              >
                <div className="relative flex-shrink-0">
                  <MessageCircle className="w-4 h-4" />
                  {!isExpanded && supportBadge > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                      {supportBadge > 99 ? '99+' : supportBadge}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <>
                    <span className="text-sm font-medium flex-1">문의하기</span>
                    {supportBadge > 0 && (
                      <span className={cn(
                        "text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
                        pathname === '/support'
                          ? "bg-hansl-200 text-hansl-700" : "bg-red-100 text-red-700"
                      )}>
                        {supportBadge > 99 ? '99+' : supportBadge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            </div>
          </div>
        </aside>

        {/* 모바일 네비게이션 */}
        <nav className={cn(
          "lg:hidden fixed left-0 top-0 h-full bg-white border-r border-gray-200 z-50 transition-transform duration-300 w-64",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="flex items-center justify-between p-4 border-b">
            <span className="text-base font-semibold text-gray-900">메뉴</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <ul className="p-2 space-y-1 flex-1">
            {filteredMenuItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                      isActive
                        ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {/* 신청서 관리 / 문의하기 버튼 - 하단 고정 */}
          <div className="p-2 border-t border-gray-200 space-y-1">
            <Link
              to="/application"
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                pathname === '/application' || pathname.startsWith('/application/')
                  ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <div className="relative">
                <FileEdit className="w-4 h-4" />
                {isApplicationApprover && pendingApplicationCount > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                    {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium">신청서 관리</span>
              {isApplicationApprover && pendingApplicationCount > 0 && (
                <span className="ml-auto badge-stats bg-red-100 text-red-700">
                  {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                </span>
              )}
            </Link>
            <div className="border-t border-gray-200 my-1" />
            <Link
              to="/support"
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                pathname === '/support'
                  ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <div className="relative">
              <MessageCircle className="w-4 h-4" />
                {supportBadge > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                    {supportBadge > 99 ? '99+' : supportBadge}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium">문의하기</span>
            </Link>
          </div>
        </nav>
    </>
  )
}