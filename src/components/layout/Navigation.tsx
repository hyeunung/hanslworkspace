
import { Link } from 'react-router-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Home, 
  ShoppingCart, 
  CheckCircle, 
  Building2, 
  Users, 
  FileText,
  Package,
  Receipt
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavigationProps {
  role?: string | string[]  // hanslwebapp과 동일하게 배열도 지원
}

export default function Navigation({ role }: NavigationProps) {
  const location = useLocation()
  const pathname = location.pathname

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
                <Icon className="w-5 h-5" />
                <span className="header-title">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}