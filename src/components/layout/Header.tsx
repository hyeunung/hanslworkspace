

import { useNavigate, useLocation } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { User, Menu, X } from 'lucide-react'
import { useState } from 'react'

interface HeaderProps {
  user: any
  onMenuClick?: () => void
}

const getRoleDisplayName = (role: string) => {
  const roleMap: Record<string, string> = {
    app_admin: '시스템 관리자',
    ceo: 'CEO',
    final_approver: '최종 승인자',
    middle_manager: '중간 관리자',
    'lead buyer': '구매 책임자',
    buyer: '구매 담당자',
    requester: '요청자'
  }
  return roleMap[role] || role
}

export default function Header({ user, onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
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

        {/* 로고 */}
        <div className="flex items-center">
          <img
            src="/logo_symbol.svg"
            alt="HANSL Logo"
            className="w-14 h-14"
            style={{ objectFit: 'contain' }}
          />
          <div className="ml-3 leading-none flex flex-col items-start">
            <h1 className="text-[30px] font-bold text-gray-600 leading-none mb-0.5">
              HANSL
            </h1>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide leading-none ml-[1px]">
              Purchase System
            </span>
          </div>
        </div>
        
        {/* 사용자 정보 */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {user?.name || '사용자'}
            </span>
            {user?.purchase_role && (
              <span className="text-xs text-gray-500">
                {getRoleDisplayName(user.purchase_role)}
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