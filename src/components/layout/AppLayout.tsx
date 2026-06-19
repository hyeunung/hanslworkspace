import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import Header from '@/components/layout/Header'
import FixedNavigation from '@/components/layout/FixedNavigation'
import AppRoutes from '@/components/layout/AppRoutes'
import OfficialDocumentApprovedModal from '@/components/official-document/OfficialDocumentApprovedModal'

/**
 * 인증된 사용자를 위한 메인 애플리케이션 레이아웃
 * - 헤더, 네비게이션, 메인 콘텐츠 영역 관리
 * - 사이드바 상태 관리
 */
export default function AppLayout() {
  const { employee } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false)
  const [isHoverEnabled, setIsHoverEnabled] = useState(true)

  const handleExpandChange = (expanded: boolean) => {
    if (expanded) {
      if (isHoverEnabled) {
        setIsSidebarExpanded(true)
      }
    } else {
      setIsSidebarExpanded(false)
      setIsHoverEnabled(false)
    }
  }

  const handleMouseLeave = () => {
    setIsHoverEnabled(true)
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* 워크스페이스 진입 시 미확인 최종 결재 공문 자동 알림 */}
      <OfficialDocumentApprovedModal />

      {/* 고정 헤더 */}
      <Header
        user={employee}
        onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* 고정 네비게이션 */}
      <FixedNavigation
        role={employee?.roles}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isExpanded={isSidebarExpanded}
        onExpandChange={handleExpandChange}
        onMouseLeave={handleMouseLeave}
      />

      {/* 콘텐츠 영역 */}
      <div style={{ paddingTop: '56px', paddingLeft: '0' }}>
        {/* 데스크톱 뷰 - 항상 보이도록 수정 */}
        <div style={{ marginLeft: isSidebarExpanded ? '200px' : '56px', transition: 'margin-left 0.2s ease' }} className="hidden lg:block">
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