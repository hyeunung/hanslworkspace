import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
  FileEdit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Truck,
  Database
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { supportService } from '@/services/supportService'
import { useAuth } from '@/contexts/AuthContext'
import { parseRoles } from '@/utils/roleHelper'
import { useRequestBadgeCounts } from '@/hooks/useRequestBadgeCounts'

interface NavigationProps {
  role?: string | string[]
  isOpen?: boolean
  onClose?: () => void
  isExpanded?: boolean
  onExpandChange?: (expanded: boolean) => void
  onMouseLeave?: () => void
}

export default function FixedNavigation({ role, isOpen = false, onClose, isExpanded = false, onExpandChange, onMouseLeave }: NavigationProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname
  const { currentUserId } = useAuth()
  const { badgeCounts } = useRequestBadgeCounts()

  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)
  const [pendingStatementCount, setPendingStatementCount] = useState(0)
  const [pendingApplicationCount, setPendingApplicationCount] = useState(0)

  const isClientOrdersMode = pathname.startsWith('/client-orders')
  const isProductionMode = pathname.startsWith('/production')
  const isPurchaseMode = !isClientOrdersMode && !isProductionMode

  const roles = parseRoles(role)
  const isAdmin = roles.includes('superadmin')
  const isApplicationApprover = roles.includes('superadmin') || roles.includes('hr')
  const isLeadBuyer = roles.includes('lead buyer')

  // 총 배지 합계 (접힌 상태에서 아이콘에 표시)
  const totalPurchaseBadge = Object.values(badgeCounts).reduce((a, b) => a + b, 0)

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

  // 거래명세서 배지 카운트 - 역할별로 쿼리가 다름 (우선순위: superadmin > lead buyer > 담당자)
  // - superadmin: status IN ('failed','rejected') (빨간색만)
  // - lead buyer: status='extracted' 전체
  // - 담당자(uploaded_by=본인): status='extracted' AND quantity_match_confirmed_at IS NULL
  useEffect(() => {
    // 어떤 분기에도 해당 안 되면 배지 자체 비활성
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
        // 담당자: 본인이 업로드 + 확인필요 + 수량일치 미완료
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
  }, [isAdmin, isLeadBuyer, currentUserId])

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
      .channel('ai-service-applications-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_service_applications' }, loadPendingApplications)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(subscription)
    }
  }, [isApplicationApprover])

  const [purchaseListOpen, setPurchaseListOpen] = useState(
    pathname.startsWith('/purchase/list')
  )
  const [shippingMenuOpen, setShippingMenuOpen] = useState(
    pathname.startsWith('/shipping')
  )
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (pathname.startsWith('/purchase/list')) {
      setPurchaseListOpen(true)
    }
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith('/shipping')) {
      setShippingMenuOpen(true)
    }
  }, [pathname])

  const purchaseSubItems = [
    { key: '발주/구매', label: '발주/구매' },
    { key: '카드사용', label: '카드사용' },
    { key: '출장', label: '출장' },
    { key: '차량', label: '차량' },
    { key: '연차', label: '연차' },
  ] as const

  const shippingSubItems = [
    { key: 'shipping', label: '택배', href: '/shipping' },
    { key: 'acceptance', label: '인수증', href: '/shipping/acceptance' },
  ] as const

  type MenuItem = {
    label: string
    href: string
    icon: typeof Home
    roles: string[]
    hasSubmenu?: 'purchase'
  }

  const menuItems: Array<MenuItem> = useMemo(() => {
    if (isClientOrdersMode) {
      return [
        { label: '수주 통합 목록', href: '/client-orders', icon: FileText, roles: ['all'] },
        { label: '업체관리', href: '/vendor', icon: Building2, roles: ['all'] },
      ]
    }
    if (isProductionMode) {
      return [
        { label: '제작 현황', href: '/production', icon: Package, roles: ['all'] },
        { label: '업체관리', href: '/vendor', icon: Building2, roles: ['all'] },
      ]
    }
    return [
      { label: '대시보드', href: '/dashboard', icon: Home, roles: ['all'] },
      { label: '새 요청', href: '/purchase/new', icon: ShoppingCart, roles: ['all'] },
      { label: '요청 목록', href: '/purchase/list', icon: FileText, roles: ['all'], hasSubmenu: 'purchase' as const },
      { label: '거래명세서 확인', href: '/transaction-statement', icon: FileCheck, roles: ['all'] },
      { label: '영수증', href: '/receipts', icon: Receipt, roles: ['superadmin', 'hr', 'lead buyer'] },
      { label: '업체관리', href: '/vendor', icon: Building2, roles: ['all'] },
    ]
  }, [isClientOrdersMode, isProductionMode])

  const filteredMenuItems = menuItems.filter(item => {
    if (item.roles.includes('all')) return true
    return item.roles.some(r => roles.includes(r))
  })

  const renderBadge = (count: number, isActive: boolean) => {
    if (count <= 0) return null
    return (
      <span className={cn(
        "text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none",
        isActive ? "bg-hansl-200 text-hansl-700" : "bg-red-100 text-red-700"
      )}>
        {count > 99 ? '99+' : count}
      </span>
    )
  }

  const renderIconBadge = (count: number) => {
    if (count <= 0) return null
    return (
      <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
        {count > 99 ? '99+' : count}
      </span>
    )
  }

  return (
    <>
      {/* 모바일 오버레이 */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={onClose}
        />
      )}

        {/* 데스크톱 네비게이션 - 수동 클릭 방식 */}
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
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            {/* 우측 세로 끝 접기/펼치기 바 버튼 */}
            {isExpanded ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onExpandChange?.(false)
                }}
                className="absolute right-0 top-0 bottom-0 w-3 hover:w-4 bg-gray-50/50 hover:bg-gray-200 border-l border-gray-200 transition-all duration-150 flex items-center justify-center group cursor-pointer z-50"
                title="메뉴 접기"
                style={{ height: '100%' }}
              >
                <ChevronLeft className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform group-hover:-translate-x-[1px]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onExpandChange?.(true)
                }}
                className="absolute right-0 top-0 bottom-0 w-3 hover:w-4 bg-gray-50/50 hover:bg-gray-200 border-l border-gray-200 transition-all duration-150 flex items-center justify-center group cursor-pointer z-50"
                title="메뉴 펼치기"
                style={{ height: '100%' }}
              >
                <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform group-hover:translate-x-[1px]" />
              </button>
            )}
            {/* 메뉴 아이템들 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ul className={cn("pl-2 pt-2 pb-2 space-y-1", isExpanded ? "pr-5" : "pr-2")}>
                {filteredMenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  const currentTab = searchParams.get('tab') || '발주/구매'

                  // 아코디언 서브메뉴
                  if (item.hasSubmenu === 'purchase') {
                    return (
                      <li
                        key={item.href}
                        onMouseEnter={() => { if (isExpanded) setPurchaseListOpen(true) }}
                        onMouseLeave={() => { if (!pathname.startsWith('/purchase/list')) setPurchaseListOpen(false) }}
                      >
                        <button
                          onClick={() => {
                            if (!purchaseListOpen) {
                              setPurchaseListOpen(true)
                              navigate('/purchase/list?tab=' + encodeURIComponent('발주/구매'))
                            } else {
                              setPurchaseListOpen(false)
                            }
                          }}
                          className={cn(
                            'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap w-full',
                            isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                            isActive
                              ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                          )}
                        >
                          <div className="relative flex-shrink-0">
                            <Icon className="w-4 h-4" />
                            {!isExpanded && renderIconBadge(totalPurchaseBadge)}
                          </div>
                          {isExpanded && (
                            <>
                              <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                              {!purchaseListOpen && totalPurchaseBadge > 0 && renderBadge(totalPurchaseBadge, isActive)}
                              <ChevronDown className={cn(
                                "w-3.5 h-3.5 transition-transform flex-shrink-0",
                                purchaseListOpen ? "rotate-180" : ""
                              )} />
                            </>
                          )}
                        </button>
                        {isExpanded && purchaseListOpen && (
                          <ul className="mt-1 space-y-0.5">
                            {purchaseSubItems.map((sub) => {
                              const isSubActive = isActive && currentTab === sub.key
                              const subBadge = badgeCounts[sub.key] || 0
                              return (
                                <li key={sub.key}>
                                  <Link
                                    to={`/purchase/list?tab=${encodeURIComponent(sub.key)}`}
                                    className={cn(
                                      'flex items-center h-8 pl-10 pr-3 rounded-lg transition-colors whitespace-nowrap text-[13px]',
                                      isSubActive
                                        ? 'bg-hansl-50 text-hansl-600 font-semibold'
                                        : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                    )}
                                  >
                                    <span className="flex-1">{sub.label}</span>
                                    {renderBadge(subBadge, isSubActive)}
                                  </Link>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  }



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
                          {!isExpanded && item.href === '/transaction-statement' && statementBadge > 0 && renderIconBadge(statementBadge)}
                        </div>
                        {isExpanded && (
                          <>
                            <span className="text-sm font-medium flex-1">{item.label}</span>
                            {item.href === '/transaction-statement' && statementBadge > 0 && (
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

            {/* 택배/인수증 + 관리 메뉴 + 신청서/문의 - 하단 고정 */}
            {isPurchaseMode && (
              <div className={cn("pl-2 pt-2 pb-2 border-t border-gray-200 space-y-1", isExpanded ? "pr-5" : "pr-2")}>
                {(() => {
                  const isShippingActive = pathname === '/shipping' || pathname.startsWith('/shipping/')
                  return (
                    <div
                      onMouseEnter={() => { if (isExpanded) setShippingMenuOpen(true) }}
                      onMouseLeave={() => { if (!pathname.startsWith('/shipping')) setShippingMenuOpen(false) }}
                    >
                      <button
                        onClick={() => {
                          if (!shippingMenuOpen) {
                            setShippingMenuOpen(true)
                            navigate('/shipping')
                          } else {
                            setShippingMenuOpen(false)
                          }
                        }}
                        className={cn(
                          'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap w-full',
                          isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                          isShippingActive
                            ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                        )}
                      >
                        <div className="relative flex-shrink-0">
                          <Truck className="w-4 h-4" />
                        </div>
                        {isExpanded && (
                          <>
                            <span className="text-sm font-medium flex-1 text-left">택배/인수증</span>
                            <ChevronDown className={cn(
                              "w-3.5 h-3.5 transition-transform flex-shrink-0",
                              shippingMenuOpen ? "rotate-180" : ""
                            )} />
                          </>
                        )}
                      </button>
                      {isExpanded && shippingMenuOpen && (
                        <ul className="mt-1 space-y-0.5">
                          {shippingSubItems.map((sub) => {
                            const isSubActive = pathname === sub.href
                            return (
                              <li key={sub.key}>
                                <Link
                                  to={sub.href}
                                  className={cn(
                                    'flex items-center h-8 pl-10 pr-3 rounded-lg transition-colors whitespace-nowrap text-[13px]',
                                    isSubActive
                                      ? 'bg-hansl-50 text-hansl-600 font-semibold'
                                      : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                  )}
                                >
                                  <span className="flex-1">{sub.label}</span>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })()}
                <div className="border-t border-gray-200 my-1" />
                {isExpanded && (
                  <span className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">관리</span>
                )}
                {[
                  { label: '직원 관리', href: '/employee', icon: Users },
                ].map((mgmtItem) => {
                  const MgmtIcon = mgmtItem.icon
                  const isMgmtActive = pathname === mgmtItem.href || pathname.startsWith(`${mgmtItem.href}/`)
                  return (
                    <Link
                      key={mgmtItem.href}
                      to={mgmtItem.href}
                      className={cn(
                        'flex items-center h-10 rounded-lg transition-colors whitespace-nowrap',
                        isExpanded ? 'px-3 gap-3' : 'justify-center w-10',
                        isMgmtActive
                          ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                      )}
                    >
                      <div className="relative flex-shrink-0">
                        <MgmtIcon className="w-4 h-4" />
                      </div>
                      {isExpanded && (
                        <span className="text-sm font-medium flex-1">{mgmtItem.label}</span>
                      )}
                    </Link>
                  )
                })}
                <div className="border-t border-gray-200 my-1" />
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
                    {!isExpanded && isApplicationApprover && renderIconBadge(pendingApplicationCount)}
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
                    {!isExpanded && renderIconBadge(supportBadge)}
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
            )}
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
              const currentTab = searchParams.get('tab') || '발주/구매'

              if (item.hasSubmenu === 'purchase') {
                return (
                  <li key={item.href}>
                    <button
                      onClick={() => {
                        if (!purchaseListOpen) {
                          setPurchaseListOpen(true)
                          navigate('/purchase/list?tab=' + encodeURIComponent('발주/구매'))
                        } else {
                          setPurchaseListOpen(false)
                        }
                      }}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors w-full',
                        isActive
                          ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                      <ChevronDown className={cn(
                        "w-3.5 h-3.5 transition-transform",
                        purchaseListOpen ? "rotate-180" : ""
                      )} />
                    </button>
                    {purchaseListOpen && (
                      <ul className="mt-1 space-y-0.5">
                        {purchaseSubItems.map((sub) => {
                          const isSubActive = isActive && currentTab === sub.key
                          const subBadge = badgeCounts[sub.key] || 0
                          return (
                            <li key={sub.key}>
                              <Link
                                to={`/purchase/list?tab=${encodeURIComponent(sub.key)}`}
                                onClick={onClose}
                                className={cn(
                                  'flex items-center h-9 pl-11 pr-4 rounded-lg transition-colors text-[13px]',
                                  isSubActive
                                    ? 'bg-hansl-50 text-hansl-600 font-semibold'
                                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                )}
                              >
                                <span className="flex-1">{sub.label}</span>
                                {renderBadge(subBadge, isSubActive)}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              }



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
          {/* 택배/인수증 + 관리 메뉴 + 신청서/문의 - 하단 고정 */}
          {isPurchaseMode && (
            <div className="p-2 border-t border-gray-200 space-y-1">
              {(() => {
                const isShippingActive = pathname === '/shipping' || pathname.startsWith('/shipping/')
                return (
                  <div>
                    <button
                      onClick={() => {
                        if (!shippingMenuOpen) {
                          setShippingMenuOpen(true)
                          navigate('/shipping')
                          onClose?.()
                        } else {
                          setShippingMenuOpen(false)
                        }
                      }}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors w-full',
                        isShippingActive
                          ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      )}
                    >
                      <Truck className="w-4 h-4" />
                      <span className="text-sm font-medium flex-1 text-left">택배/인수증</span>
                      <ChevronDown className={cn(
                        "w-3.5 h-3.5 transition-transform",
                        shippingMenuOpen ? "rotate-180" : ""
                      )} />
                    </button>
                    {shippingMenuOpen && (
                      <ul className="mt-1 space-y-0.5">
                        {shippingSubItems.map((sub) => {
                          const isSubActive = pathname === sub.href
                          return (
                            <li key={sub.key}>
                              <Link
                                to={sub.href}
                                onClick={onClose}
                                className={cn(
                                  'flex items-center h-9 pl-11 pr-4 rounded-lg transition-colors text-[13px]',
                                  isSubActive
                                    ? 'bg-hansl-50 text-hansl-600 font-semibold'
                                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                )}
                              >
                                <span className="flex-1">{sub.label}</span>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })()}
              <div className="border-t border-gray-200 my-1" />
              <span className="px-4 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">관리</span>
              {[
                { label: '직원 관리', href: '/employee', icon: Users },
              ].map((mgmtItem) => {
                const MgmtIcon = mgmtItem.icon
                const isMgmtActive = pathname === mgmtItem.href || pathname.startsWith(`${mgmtItem.href}/`)
                return (
                  <Link
                    key={mgmtItem.href}
                    to={mgmtItem.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                      isMgmtActive
                        ? 'bg-hansl-50 text-hansl-600 border-l-2 border-hansl-500'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <MgmtIcon className="w-4 h-4" />
                    <span className="text-sm font-medium">{mgmtItem.label}</span>
                  </Link>
                )
              })}
              <div className="border-t border-gray-200 my-1" />
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
          )}
        </nav>
    </>
  )
}
