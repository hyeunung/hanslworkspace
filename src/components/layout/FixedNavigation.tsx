import { Link, useLocation } from 'react-router-dom'
import { 
  Home, 
  ShoppingCart, 
  Building2, 
  Users, 
  FileText,
  X,
  MessageCircle,
  Receipt
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface NavigationProps {
  role?: string | string[]
  isOpen?: boolean
  onClose?: () => void
}

export default function FixedNavigation({ role, isOpen = false, onClose }: NavigationProps) {
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
      roles: ['all']
    },
    {
      label: '직원 관리',
      href: '/employee',
      icon: Users,
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
      
      <TooltipProvider delayDuration={0}>
        {/* 데스크톱 네비게이션 - 절대 고정 */}
        <aside className="hidden lg:block" style={{ position: 'fixed', left: 0, top: '56px', width: '56px', height: 'calc(100vh - 56px)', backgroundColor: 'white', borderRight: '1px solid #e5e7eb', zIndex: 30 }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 메뉴 아이템들 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ul className="p-2 space-y-1">
                {filteredMenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  
                  return (
                    <li key={item.href}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.href}
                            className={cn(
                              'flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
                              isActive
                                ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="ml-2">
                          <p className="font-medium">{item.label}</p>
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  )
                })}
              </ul>
            </div>
            
            {/* 문의하기 버튼 - 하단 고정 */}
            <div className="p-2 border-t border-gray-200">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/support"
                    className={cn(
                      'flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
                      pathname === '/support'
                        ? 'bg-hansl-50 text-hansl-600 border border-hansl-200'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    )}
                  >
                    <MessageCircle className="w-4 h-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="ml-2">
                  <p className="font-medium">문의하기</p>
                </TooltipContent>
              </Tooltip>
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
          {/* 문의하기 버튼 - 하단 고정 */}
          <div className="p-2 border-t border-gray-200">
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
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm font-medium">문의하기</span>
            </Link>
          </div>
        </nav>
      </TooltipProvider>
    </>
  )
}