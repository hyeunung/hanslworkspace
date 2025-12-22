
import { Link } from 'react-router-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { 
  Home, 
  ShoppingCart, 
  CheckCircle, 
  Building2, 
  Users, 
  FileText,
  Package,
  Receipt,
  MessageCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supportService } from '@/services/supportService'

interface NavigationProps {
  role?: string | string[]  // hanslwebapp과 동일하게 배열도 지원
}

export default function Navigation({ role }: NavigationProps) {
  const location = useLocation()
  const pathname = location.pathname
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)
  
  // role 배열 확인
  const roles = Array.isArray(role) ? role : (role ? [role] : [])
  const isAdmin = roles.includes('app_admin')
  
  // app_admin인 경우 미처리 문의 개수 조회
  useEffect(() => {
    if (!isAdmin) return
    
    const loadPendingCount = async () => {
      const result = await supportService.getAllInquiries()
      if (result.success) {
        // open 또는 in_progress 상태인 문의 개수
        const pendingCount = result.data.filter(
          inquiry => inquiry.status === 'open' || inquiry.status === 'in_progress'
        ).length
        setPendingInquiryCount(pendingCount)
      }
    }
    
    loadPendingCount()
    
    // 실시간 구독으로 문의 개수 업데이트
    const subscription = supportService.subscribeToInquiries(() => {
      loadPendingCount()
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [isAdmin])

  const menuItems = [
    {
      label: '대시보드',
      href: '/dashboard',
      icon: Home,
      roles: ['all']
    },
    {
      label: '새 발주요청',
      href: '/purchase/new',
      icon: ShoppingCart,
      roles: ['all']
    },
    {
      label: '발주요청 목록',
      href: '/purchase/list',
      icon: FileText,
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
      roles: ['all']  // 모든 사용자가 볼 수 있도록 변경
    },
    {
      label: '직원 관리',
      href: '/employee',
      icon: Users,
      roles: ['all']  // hanslwebapp과 동일하게 모든 사용자 접근 가능
    },
    {
      label: 'BOM/좌표 정리',
      href: '/bom-coordinate',
      icon: Package,
      roles: ['all']
    },
    {
      label: '문의하기',
      href: '/support',
      icon: MessageCircle,
      roles: ['all'],
      badge: isAdmin && pendingInquiryCount > 0 ? pendingInquiryCount : undefined
    }
  ]

  const filteredMenuItems = menuItems.filter(item => {
    if (item.roles.includes('all')) return true
    
    // role이 배열인 경우와 문자열인 경우 모두 처리
    if (Array.isArray(role)) {
      return item.roles.some(r => role.includes(r))
    } else if (role) {
      return item.roles.includes(role)
    }
    return false
  })

  return (
    <nav className="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)]">
      <ul className="p-4 space-y-2">
        {filteredMenuItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const badge = (item as any).badge
          
          return (
            <li key={item.href}>
              <Link
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-all',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {badge !== undefined && badge > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
                <span className="header-title flex-1">{item.label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className={cn(
                    "badge-stats",
                    isActive ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                  )}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}