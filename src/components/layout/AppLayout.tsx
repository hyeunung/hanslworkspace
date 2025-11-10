import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import Header from '@/components/layout/Header'
import FixedNavigation from '@/components/layout/FixedNavigation'
import AppRoutes from '@/components/layout/AppRoutes'

/**
 * 인증된 사용자를 위한 메인 애플리케이션 레이아웃
 * - 헤더, 네비게이션, 메인 콘텐츠 영역 관리
 * - 사이드바 상태 관리
 */
export default function AppLayout() {
  const { employee } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* 고정 헤더 */}
      <Header 
        user={employee} 
        onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} 
      />
      
      {/* 고정 네비게이션 */}
      <FixedNavigation 
        role={employee?.purchase_role} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      {/* 콘텐츠 영역 */}
      <div style={{ paddingTop: '56px', paddingLeft: '0' }}>
        {/* 데스크톱 뷰 - 항상 보이도록 수정 */}
        <div style={{ marginLeft: '56px' }} className="hidden lg:block">
          <main className="p-1 sm:p-2 lg:p-3" style={{ minHeight: 'calc(100vh - 56px)' }}>
            <AppRoutes />
          </main>
        </div>
        
        {/* 모바일 뷰 */}
        <div className="block lg:hidden">
          <main className="p-1 sm:p-2" style={{ minHeight: 'calc(100vh - 56px)' }}>
            <AppRoutes />
          </main>
        </div>
      </div>
    </div>
  )
}