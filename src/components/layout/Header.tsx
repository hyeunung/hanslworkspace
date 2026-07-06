

import { useNavigate, useLocation, Link } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { User, Menu, MessageCircle, FileText, FileCheck, FileEdit, Clock, ScrollText, Database, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { supportService } from '@/services/supportService'
import { usePurchaseMemory } from '@/hooks/usePurchaseMemory'
import { countPendingApprovalsForSidebarBadge } from '@/utils/purchaseFilters'
import { parseRoles } from '@/utils/roleHelper'

interface HeaderProps {
  user: {
    id?: string
    name?: string
    roles?: string | string[]
  } | null
  onMenuClick?: () => void
}

const getRoleDisplayName = (role: string) => {
  const roleMap: Record<string, string> = {
    superadmin: '시스템 관리자',
    ceo: 'CEO',
    final_approver: '최종 승인자',
    middle_manager: '중간 관리자',
    'lead buyer': '구매 책임자',
    buyer: '구매 담당자',
    requester: '요청자'
  }
  return roleMap[role] || role
}

const TRIP_APPROVER_ROLES = ["middle_manager", "final_approver", "ceo", "superadmin"]

export default function Header({ user, onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname
  const [isSystemDropdownOpen, setIsSystemDropdownOpen] = useState(false)

  const isClientOrders = pathname.startsWith('/client-orders')
  const isProduction = pathname.startsWith('/production')

  let currentSystemKey: 'purchase' | 'client-orders' | 'production' = 'purchase'
  let currentSystemLabel = 'PURCHASE SYSTEM'

  if (isClientOrders) {
    currentSystemKey = 'client-orders'
    currentSystemLabel = 'CLIENT ORDERS'
  } else if (isProduction) {
    currentSystemKey = 'production'
    currentSystemLabel = 'PRODUCTION STATUS'
  }

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)
  // lead buyer: 미처리 업체등록 요청 건수 (배지 클릭 시 관리자 모드 직행 판단용)
  const [pendingVendorRequestCount, setPendingVendorRequestCount] = useState(0)
  const [pendingStatementCount, setPendingStatementCount] = useState(0)
  const [pendingApplicationCount, setPendingApplicationCount] = useState(0)
  const [otherPendingCount, setOtherPendingCount] = useState(0)
  const { allPurchases } = usePurchaseMemory()
  
  const { currentUserId, currentUserEmail } = useAuth()
  const [defaultLanding, setDefaultLanding] = useState<string>('purchase')

  useEffect(() => {
    if (!currentUserEmail) return
    const loadPref = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('user_ui_settings')
        .select('setting_value')
        .eq('user_email', currentUserEmail)
        .eq('setting_type', 'general')
        .eq('setting_key', 'default_landing_system')
        .maybeSingle()
      if (!error && data?.setting_value) {
        const val = data.setting_value as { system?: string }
        if (val.system) {
          setDefaultLanding(val.system)
        }
      }
    }
    loadPref()
  }, [currentUserEmail])

  const handleSetDefaultLanding = async (e: React.MouseEvent, systemKey: 'purchase' | 'client-orders' | 'production') => {
    e.stopPropagation()
    setDefaultLanding(systemKey)
    const supabase = createClient()
    try {
      const { error } = await supabase
        .from('user_ui_settings')
        .upsert({
          user_email: currentUserEmail,
          setting_type: 'general',
          setting_key: 'default_landing_system',
          setting_value: { system: systemKey }
        }, {
          onConflict: 'user_email,setting_type,setting_key'
        })
      if (error) throw error
      toast.success('기본 페이지로 설정되었습니다.')
    } catch (err) {
      logger.error('Failed to save default landing page preference', err)
      toast.error('설정 저장에 실패했습니다.')
    }
  }

  const roles = parseRoles(user?.roles)
  const isAdmin = roles.includes('superadmin')
  const isApplicationApprover = roles.includes('superadmin') || roles.includes('hr')
  const isLeadBuyer = roles.includes('lead buyer')
  const purchaseOnlyCount = useMemo(
    () => countPendingApprovalsForSidebarBadge(allPurchases, user?.roles),
    [allPurchases, user?.roles]
  )
  const pendingPurchaseCount = purchaseOnlyCount + otherPendingCount

  // superadmin: 상단 로고 옆에 미처리 문의(open+in_progress) 뱃지 표시
  useEffect(() => {
    if (!isAdmin) return

    const loadPendingCount = async () => {
      try {
        // count-only 쿼리로 가볍게 계산
        const supabase = createClient()
        const { count } = await supabase
          .from('support_inquires')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'in_progress'])

        if (typeof count === 'number') setPendingInquiryCount(count)
      } catch {
        // 상단 배지는 실패해도 UX에 치명적이지 않으므로 무시
      }
    }

    loadPendingCount()

    const isPending = (status?: string | null) => status === 'open' || status === 'in_progress'
    const subscription = supportService.subscribeToInquiries((payload) => {
      // ✅ 즉시 반영(딜레이 체감 제거): realtime payload로 카운트 증감
      const eventType = payload?.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | undefined
      const newRow = payload?.new as { status?: string | null } | undefined
      const oldRow = payload?.old as { status?: string | null } | undefined

      if (eventType === 'INSERT') {
        if (isPending(newRow?.status)) {
          setPendingInquiryCount((prev) => {
            const next = prev + 1
            return next
          })
        }
        return
      }
      if (eventType === 'DELETE') {
        if (isPending(oldRow?.status)) {
          setPendingInquiryCount((prev) => {
            const next = Math.max(0, prev - 1)
            return next
          })
        }
        return
      }
      if (eventType === 'UPDATE') {
        // Supabase realtime payload에 old.status가 안 오는 케이스가 있어(Replica identity 설정/정책 등),
        // 이 경우엔 카운트를 계산할 수 없으니 즉시 감소(보이는 UX) + 즉시 재조회(정확성 보정)로 처리한다.
        if (!oldRow?.status) {
          const isNowPending = isPending(newRow?.status)
          if (!isNowPending) {
            setPendingInquiryCount((prev) => {
              const next = Math.max(0, prev - 1)
              return next
            })
          }
          loadPendingCount()
          return
        }

        const wasPending = isPending(oldRow?.status)
        const isNowPending = isPending(newRow?.status)
        if (wasPending === isNowPending) return
        setPendingInquiryCount((prev) => {
          const next = prev + (isNowPending ? 1 : -1)
          return Math.max(0, next)
        })
      }
    })

    // 탭 전환/포커스 복귀 시 보정(이벤트 누락 대비)
    const onVisibilityChange = () => {
      if (!document.hidden) loadPendingCount()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAdmin])

  // 일반 사용자: 내 미처리 문의(open+in_progress) 건수 표시
  // lead buyer: 내 미처리 문의 + 미처리 업체등록 요청(전체) 합산 표시
  useEffect(() => {
    if (isAdmin) return

    const supabase = createClient()
    let subscription: { unsubscribe: () => void } | null = null
    let cancelled = false
    let currentUserId = ''

    const loadMyPendingCount = async () => {
      if (!currentUserId) {
        const { data: { user: authUser } } = await supabase.auth.getUser()
        currentUserId = authUser?.id || ''
      }
      if (!currentUserId) return

      let query = supabase
        .from('support_inquires')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'in_progress'])

      if (isLeadBuyer) {
        // 내 문의 + 업체등록 요청(전체) — or 조건이라 중복 카운트 없음
        query = query.or(`user_id.eq.${currentUserId},inquiry_type.eq.new_vendor`)
      } else {
        query = query.eq('user_id', currentUserId)
      }

      const { count, error } = await query

      if (!cancelled) {
        if (!error && typeof count === 'number') setPendingInquiryCount(count)
      }

      // lead buyer: 관리자 모드 직행 판단용 업체등록 요청 건수
      if (isLeadBuyer) {
        const { count: vendorCount, error: vendorError } = await supabase
          .from('support_inquires')
          .select('id', { count: 'exact', head: true })
          .eq('inquiry_type', 'new_vendor')
          .in('status', ['open', 'in_progress'])

        if (!cancelled && !vendorError && typeof vendorCount === 'number') {
          setPendingVendorRequestCount(vendorCount)
        }
      }
    }

    loadMyPendingCount()

    // 실시간 구독(문의 변경 시 내 건 + (lead buyer면) 업체등록 요청 재조회)
    if (!subscription) {
      subscription = supportService.subscribeToInquiries((payload) => {
        if (!currentUserId) {
          loadMyPendingCount()
          return
        }
        const newRow = payload?.new as { user_id?: string; inquiry_type?: string } | undefined
        const oldRow = payload?.old as { user_id?: string; inquiry_type?: string } | undefined
        const isVendorRow = newRow?.inquiry_type === 'new_vendor' || oldRow?.inquiry_type === 'new_vendor'
        if (isLeadBuyer && isVendorRow) {
          loadMyPendingCount()
          return
        }
        if (newRow?.user_id !== currentUserId && oldRow?.user_id !== currentUserId) return
        loadMyPendingCount()
      })
    }

    return () => {
      cancelled = true
      if (subscription) subscription.unsubscribe()
    }
  }, [isAdmin, isLeadBuyer])

  // 거래명세서 배지 카운트 - 역할별로 쿼리가 다름 (FixedNavigation과 동일 규칙)
  // - superadmin: status IN ('failed','rejected')
  // - lead buyer: status='extracted' 전체
  // - 담당자(uploaded_by=본인): status='extracted' AND quantity_match_confirmed_at IS NULL
  useEffect(() => {
    if (!isAdmin && !isLeadBuyer && !currentUserId) {
      setPendingStatementCount(0)
      return
    }
    const supabase = createClient()
    let cancelled = false
    let subscription: ReturnType<ReturnType<typeof createClient>['channel']> | null = null

    const loadPendingStatements = async () => {
      let query = supabase
        .from('transaction_statements')
        .select('id', { count: 'exact', head: true })

      if (isAdmin) {
        query = query.in('status', ['failed', 'rejected'])
      } else if (isLeadBuyer) {
        query = query.eq('status', 'extracted')
      } else {
        query = query
          .eq('uploaded_by', currentUserId)
          .eq('status', 'extracted')
          .is('quantity_match_confirmed_at', null)
      }

      const { count } = await query
      if (!cancelled && typeof count === 'number') {
        setPendingStatementCount(count)
      }
    }

    loadPendingStatements()

    subscription = supabase
      .channel('transaction-statements-header-badge')
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
  }, [isAdmin, isLeadBuyer, currentUserId])

  const loadOtherPendingCounts = useCallback(async () => {
    try {
      const supabase = createClient()
      const isCardVehicleApprover = roles.includes('superadmin') || roles.includes('hr')
      const isTripApprover = roles.some((r: string) => TRIP_APPROVER_ROLES.includes(r))

      const [cardRes, vehicleRes, tripRes, myTripRes] = await Promise.all([
        isCardVehicleApprover
          ? supabase.from('card_usages').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isCardVehicleApprover
          ? supabase.from('vehicle_requests').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isTripApprover
          ? supabase.from('business_trips').select('id', { count: 'exact', head: true }).or('approval_status.eq.pending,modification_status.eq.extension_pending')
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        supabase.from('business_trips').select('id', { count: 'exact', head: true })
          .eq('requester_id', user?.id || '__no_user__')
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
  }, [roles, user?.id])

  useEffect(() => {
    loadOtherPendingCounts()
    const timer = window.setInterval(loadOtherPendingCounts, 30000)
    return () => window.clearInterval(timer)
  }, [loadOtherPendingCounts])

  // hr, superadmin: 신청서 승인 대기 개수
  useEffect(() => {
    if (!isApplicationApprover) return
    const supabase = createClient()
    let cancelled = false

    const loadPendingApplications = async () => {
      const { count } = await supabase
        .from('ai_service_applications')
        .select('id', { count: 'exact', head: true })
        .in('approval_status', ['pending', 'reviewed'])
      if (!cancelled && typeof count === 'number') {
        setPendingApplicationCount(count)
      }
    }

    loadPendingApplications()
    const subscription = supabase
      .channel('ai-service-applications-header-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_service_applications' }, loadPendingApplications)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(subscription)
    }
  }, [isApplicationApprover])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50">
      <div className="h-14 px-4 sm:px-6 flex items-center justify-between">
        {/* 모바일 메뉴 버튼 */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded hover:bg-gray-50 transition-colors"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        {/* 로고 및 통합 시스템 스위처 */}
        <div className="flex items-center">
          <Link
            to={
              defaultLanding === 'client-orders'
                ? '/client-orders'
                : defaultLanding === 'production'
                ? '/production'
                : '/dashboard'
            }
            className="flex items-center hover:opacity-90 transition-opacity"
          >
            <img
              src="/logo_symbol.svg"
              alt="HANSL Logo"
              className="w-14 h-14"
              style={{ objectFit: 'contain' }}
            />
          </Link>
          
          <div className="relative ml-3">
            <button
              type="button"
              onClick={() => setIsSystemDropdownOpen(!isSystemDropdownOpen)}
              className="leading-none flex flex-col items-start text-left hover:opacity-80 transition-opacity"
            >
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <h1 className="text-[30px] font-bold text-gray-600 leading-none">
                  HANSL
                </h1>
                <span className="text-[10px] text-gray-400 leading-none">
                  v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''}
                </span>
              </div>
              <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide leading-none ml-[1px]">
                {currentSystemLabel}
              </span>
            </button>

            {/* 드롭다운 메뉴 */}
            {isSystemDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsSystemDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1 w-[340px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div
                    className={`w-full grid grid-cols-[210px_1fr] items-center text-xs font-bold transition-colors ${
                      currentSystemKey === 'purchase'
                        ? 'bg-hansl-50 text-hansl-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsSystemDropdownOpen(false)
                        navigate('/dashboard')
                      }}
                      className="text-left px-3 py-2.5 w-full"
                    >
                      PURCHASE SYSTEM <span className="font-normal text-gray-500">(발주시스템)</span>
                    </button>
                    <div className="flex items-center gap-2 text-left pl-1">
                      <button
                        type="button"
                        onClick={(e) => handleSetDefaultLanding(e, 'purchase')}
                        className={`${
                          defaultLanding === 'purchase'
                            ? 'badge-stats bg-hansl-600 text-white font-bold'
                            : 'badge-utk-pending'
                        } cursor-pointer text-[9px]`}
                      >
                        {defaultLanding === 'purchase' ? 'Main' : 'Set Main'}
                      </button>
                      {currentSystemKey === 'purchase' && <span className="w-1.5 h-1.5 rounded-full bg-hansl-600 flex-shrink-0" />}
                    </div>
                  </div>

                  <div
                    className={`w-full grid grid-cols-[210px_1fr] items-center text-xs font-bold transition-colors ${
                      currentSystemKey === 'client-orders'
                        ? 'bg-hansl-50 text-hansl-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsSystemDropdownOpen(false)
                        navigate('/client-orders')
                      }}
                      className="text-left px-3 py-2.5 w-full"
                    >
                      CLIENT ORDERS <span className="font-normal text-gray-500">(발주통합)</span>
                    </button>
                    <div className="flex items-center gap-2 text-left pl-1">
                      <button
                        type="button"
                        onClick={(e) => handleSetDefaultLanding(e, 'client-orders')}
                        className={`${
                          defaultLanding === 'client-orders'
                            ? 'badge-stats bg-hansl-600 text-white font-bold'
                            : 'badge-utk-pending'
                        } cursor-pointer text-[9px]`}
                      >
                        {defaultLanding === 'client-orders' ? 'Main' : 'Set Main'}
                      </button>
                      {currentSystemKey === 'client-orders' && <span className="w-1.5 h-1.5 rounded-full bg-hansl-600 flex-shrink-0" />}
                    </div>
                  </div>

                  <div
                    className={`w-full grid grid-cols-[210px_1fr] items-center text-xs font-bold transition-colors ${
                      currentSystemKey === 'production'
                        ? 'bg-hansl-50 text-hansl-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsSystemDropdownOpen(false)
                        navigate('/production')
                      }}
                      className="text-left px-3 py-2.5 w-full"
                    >
                      PRODUCTION STATUS <span className="font-normal text-gray-500">(제작현황)</span>
                    </button>
                    <div className="flex items-center gap-2 text-left pl-1">
                      <button
                        type="button"
                        onClick={(e) => handleSetDefaultLanding(e, 'production')}
                        className={`${
                          defaultLanding === 'production'
                            ? 'badge-stats bg-hansl-600 text-white font-bold'
                            : 'badge-utk-pending'
                        } cursor-pointer text-[9px]`}
                      >
                        {defaultLanding === 'production' ? 'Main' : 'Set Main'}
                      </button>
                      {currentSystemKey === 'production' && <span className="w-1.5 h-1.5 rounded-full bg-hansl-600 flex-shrink-0" />}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 공문 페이지 진입 버튼 (항상 표시) */}
          <button
            type="button"
            onClick={() => navigate('/official-document')}
            className="group ml-3 inline-flex items-center justify-center h-9 rounded-lg hover:bg-gray-50 transition-colors px-2 min-w-[36px]"
            title="공문"
            aria-label="공문 페이지 열기"
          >
            <ScrollText className="w-4 h-4 text-gray-600 group-hover:hidden" />
            <span className="hidden group-hover:inline text-xs font-medium text-gray-600">공문</span>
          </button>

          {/* 문의하기 진입 버튼 (항상 표시, 미처리 문의 배지 포함)
              lead buyer + 미처리 업체등록 요청이 있으면 관리자 모드로 직행 */}
          <button
            type="button"
            onClick={() => navigate(isLeadBuyer && pendingVendorRequestCount > 0 ? '/support?tab=vendor_admin' : '/support')}
            className="group relative ml-1 inline-flex items-center justify-center h-9 rounded-lg hover:bg-gray-50 transition-colors px-2 min-w-[36px]"
            title="문의하기"
            aria-label={pendingInquiryCount > 0 ? `문의하기 (미처리 ${pendingInquiryCount}건)` : '문의하기 페이지 열기'}
          >
            <MessageCircle className="w-4 h-4 text-gray-600 group-hover:hidden" />
            <span className="hidden group-hover:inline text-xs font-medium text-gray-600">문의하기</span>
            {pendingInquiryCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                {(pendingInquiryCount > 99) ? '99+' : pendingInquiryCount}
              </span>
            )}
          </button>

          {/* 로고 오른쪽 알림 배지 */}
          {pendingStatementCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/transaction-statement')}
              className="relative ml-2 inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 transition-colors"
              title="미확정 거래명세서 보기"
              aria-label={`거래명세서 알림 ${pendingStatementCount}건`}
            >
              <FileCheck className="w-4 h-4 text-gray-500" />
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                {(pendingStatementCount > 99) ? '99+' : pendingStatementCount}
              </span>
            </button>
          )}
          {isApplicationApprover && pendingApplicationCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/application?tab=approval')}
              className="relative ml-2 inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 transition-colors"
              title="신청서 승인 대기 보기"
              aria-label={`신청서 승인대기 알림 ${pendingApplicationCount}건`}
            >
              <FileEdit className="w-4 h-4 text-gray-500" />
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
              </span>
            </button>
          )}
          {pendingPurchaseCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/purchase/list?tab=pending')}
              className="relative ml-2 inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 transition-colors"
              title="승인대기 발주요청 보기"
              aria-label={`발주 승인대기 알림 ${pendingPurchaseCount}건`}
            >
              <FileText className="w-4 h-4 text-gray-500" />
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                {(pendingPurchaseCount > 99) ? '99+' : pendingPurchaseCount}
              </span>
            </button>
          )}
        </div>
        
        {/* 사용자 정보 */}
        <div className="hidden sm:flex items-center gap-4">
          {(roles.includes('superadmin') || roles.includes('hr')) && (
            <button
              type="button"
              onClick={() => navigate('/logs')}
              className="group inline-flex items-center justify-center h-9 rounded-lg hover:bg-gray-50 transition-all duration-200 px-2"
              title="시스템 로그"
              aria-label="시스템 로그"
            >
              <Database className="w-4 h-4 text-gray-500 group-hover:hidden" />
              <span className="hidden group-hover:inline text-xs font-medium text-gray-600">시스템 로그</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/attendance')}
            className="group inline-flex items-center justify-center h-9 rounded-lg hover:bg-gray-50 transition-all duration-200 px-2"
            title="근태 현황"
            aria-label="근태 현황"
          >
            <Clock className="w-4 h-4 text-gray-500 group-hover:hidden" />
            <span className="hidden group-hover:inline text-xs font-medium text-gray-600">근태 현황</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {user?.name || '사용자'}
            </span>
            {roles.length > 0 && (
              <span className="text-xs text-gray-500">
                {getRoleDisplayName(roles[0])}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 모바일 사용자 아이콘 */}
        <div className="sm:hidden">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded hover:bg-gray-50 transition-colors"
          >
            <User className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>
    </header>
  )
}