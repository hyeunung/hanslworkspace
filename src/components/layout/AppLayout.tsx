import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
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
  const location = useLocation()
  const isProductionMode = location.pathname.startsWith('/production')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  // 제작현황(PRODUCTION STATUS) 모드에서는 좌측 메뉴를 접힌 상태로 시작 (기본값)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(!isProductionMode)

  // 시스템 모드가 바뀔 때(제작현황 진입/이탈) 좌측 메뉴 기본 펼침 상태를 재설정
  useEffect(() => {
    setIsSidebarExpanded(!isProductionMode)
  }, [isProductionMode])

  const handleExpandChange = (expanded: boolean) => {
    setIsSidebarExpanded(expanded)
  }

  // 사이드바 실제 폭 — 접힘 상태에서 제작현황 모드는 토글 바만 남기므로 16px (FixedNavigation과 동일하게 유지)
  const collapsedWidth = isProductionMode ? '16px' : '56px'
  const contentMarginLeft = isSidebarExpanded ? '200px' : collapsedWidth

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
      />

      {/* 콘텐츠 영역 */}
      {/* 이전에는 데스크톱/모바일 뷰를 각각 별도 div로 만들어 <AppRoutes />를 두 번 마운트했다
          (CSS로 한쪽만 숨김) — 페이지 전체가 매 상태변경마다 두 벌씩 리렌더되는 원인이었다.
          margin-left만 lg 브레이크포인트에서 다르므로 CSS 변수로 넘기고 인스턴스는 하나만 유지한다. */}
      <div style={{ paddingTop: '56px', paddingLeft: '0' }}>
        <div
          style={{ ['--content-ml' as string]: contentMarginLeft }}
          className="lg:ml-[var(--content-ml)] lg:transition-[margin-left] lg:duration-200 lg:ease"
        >
          <main className="p-1 sm:p-2 lg:p-3" style={{ minHeight: 'calc(100vh - 56px)' }}>
            <AppRoutes />
          </main>
        </div>
      </div>
    </div>
  )
}