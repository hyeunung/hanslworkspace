
import { Link, useSearchParams } from 'react-router-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Home,
  ShoppingCart,
  CheckCircle,
  Building2,
  Users,
  FileText,
  FileCheck,
  Package,
  Receipt,
  MessageCircle,
  Truck,
  FileEdit,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supportService } from '@/services/supportService'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { parseRoles } from '@/utils/roleHelper'
import { useRequestBadgeCounts } from '@/hooks/useRequestBadgeCounts'

interface NavigationProps {
  role?: string | string[]
}

export default function Navigation({ role }: NavigationProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)
  const [pendingApplicationCount, setPendingApplicationCount] = useState(0)
  const { employee } = useAuth()
  const { badgeCounts } = useRequestBadgeCounts()

  const roles = parseRoles(role)
  const isAdmin = roles.includes('superadmin')
  const isApplicationApprover = roles.includes('superadmin') || roles.includes('hr')

  // superadmin인 경우 미처리 문의 개수 조회
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
    const subscription = supportService.subscribeToInquiries(() => {
      loadPendingCount()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [isAdmin])

  // 일반 사용자: 내 미처리 문의(open+in_progress) 개수 조회
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

      const { count, error } = await supabase
        .from('support_inquires')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUserId)
        .in('status', ['open', 'in_progress'])

      if (!cancelled) {
        if (!error && typeof count === 'number') setPendingInquiryCount(count)
      }
    }

    loadMyPendingCount()

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

    return () => {
      cancelled = true
      if (subscription) subscription.unsubscribe()
    }
  }, [isAdmin])

  // hr, superadmin: 신청서 승인 대기 개수
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
      .channel('ai-service-applications-badge-nav')
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
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (pathname.startsWith('/purchase/list')) {
      setPurchaseListOpen(true)
    }
  }, [pathname])

  const purchaseSubItems = [
    { key: '발주/구매', label: '발주/구매' },
    { key: '카드사용', label: '카드사용' },
    { key: '출장', label: '출장' },
    { key: '차량', label: '차량' },
    { key: '연차', label: '연차' },
  ] as const

  type MenuItem = {
    label: string
    href: string
    icon: typeof Home
    roles: string[]
    badge?: number
    openInNewTab?: boolean
    hasSubmenu?: boolean
  }

  type MenuSection = {
    type: 'divider'
    label: string
  }

  const menuItems: Array<MenuItem | MenuSection> = [
    { label: '대시보드', href: '/dashboard', icon: Home, roles: ['all'] },
    { label: '택배', href: '/shipping', icon: Truck, roles: ['all'] },
    { label: '새 요청', href: '/purchase/new', icon: ShoppingCart, roles: ['all'] },
    { label: '요청 목록', href: '/purchase/list', icon: FileText, roles: ['all'], hasSubmenu: true },
    { label: '거래명세서 확인', href: '/transaction-statement', icon: FileCheck, roles: ['all'] },
    { label: '영수증', href: '/receipts', icon: Receipt, roles: ['superadmin', 'hr', 'lead buyer'] },
    { label: 'BOM/좌표 정리', href: '/bom-coordinate', icon: Package, roles: ['all'] },
    {
      label: '신청서 관리', href: '/application', icon: FileEdit, roles: ['all'],
      badge: isApplicationApprover && pendingApplicationCount > 0 ? pendingApplicationCount : undefined
    },
    {
      label: '문의하기', href: '/support', icon: MessageCircle, roles: ['all'],
      badge: pendingInquiryCount > 0 ? pendingInquiryCount : undefined
    },
    { type: 'divider', label: '관리' },
    { label: '업체 관리', href: '/vendor', icon: Building2, roles: ['all'] },
    { label: '직원 관리', href: '/employee', icon: Users, roles: ['all'] },
  ]

  const filteredMenuItems = menuItems.filter(item => {
    if ('type' in item && item.type === 'divider') return true
    if (!('href' in item)) return false
    if (item.roles.includes('all')) return true
    return item.roles.some(r => roles.includes(r))
  })

  return (
    <nav className="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)]">
      <ul className="p-4 space-y-2">
        {filteredMenuItems.map((item, index) => {
          if ('type' in item && item.type === 'divider') {
            return (
              <li key={`divider-${index}`} className="pt-3">
                <div className="border-t border-gray-200 mb-2" />
                <span className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">{item.label}</span>
              </li>
            )
          }

          const menuItem = item as MenuItem
          const Icon = menuItem.icon
          const isActive = pathname === menuItem.href || pathname.startsWith(`${menuItem.href}/`)
          const badge = menuItem.badge
          const openInNewTab = menuItem.openInNewTab
          const currentTab = searchParams.get('tab') || '발주/구매'

          // 요청 목록: 아코디언 메뉴
          if (menuItem.hasSubmenu) {
            return (
              <li key={menuItem.href}>
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
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="header-title flex-1 text-left">{menuItem.label}</span>
                  <ChevronDown className={cn(
                    "w-4 h-4 transition-transform",
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
                            className={cn(
                              'flex items-center gap-2 pl-12 pr-4 py-2 rounded-lg transition-all text-sm',
                              isSubActive
                                ? 'bg-primary/10 text-primary font-semibold'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                            )}
                          >
                            <span className="flex-1">{sub.label}</span>
                            {subBadge > 0 && (
                              <span className={cn(
                                "text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none",
                                isSubActive ? "bg-primary/20 text-primary" : "bg-red-100 text-red-700"
                              )}>
                                {subBadge > 99 ? '99+' : subBadge}
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          }

          const linkClass = cn(
            'flex items-center gap-3 px-4 py-3 rounded-lg transition-all',
            isActive
              ? 'bg-primary text-white'
              : 'text-gray-700 hover:bg-gray-100'
          )
          const content = (
            <>
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge !== undefined && badge > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span className="header-title flex-1">{menuItem.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className={cn(
                  "badge-stats",
                  isActive ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                )}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </>
          )
          return (
            <li key={menuItem.href}>
              {openInNewTab ? (
                <a
                  href={menuItem.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {content}
                </a>
              ) : (
                <Link to={menuItem.href} className={linkClass}>
                  {content}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
