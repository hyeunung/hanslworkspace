import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import Header from '@/components/layout/Header'
import FixedNavigation from '@/components/layout/FixedNavigation'
import AppContent from '@/components/layout/AppContent'
import LoginMain from '@/components/auth/LoginMain'

function AppWrapper() {
  const { user, employee, loading } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // 로그인하지 않은 경우
  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginMain />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  // 로그인한 경우
  return (
    <BrowserRouter>
      <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#f9fafb' }}>
        {/* 고정 헤더 */}
        <Header user={employee} onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} />
        
        {/* 고정 네비게이션 */}
        <FixedNavigation 
          role={employee?.purchase_role} 
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        
        {/* 콘텐츠 영역 */}
        <div style={{ paddingTop: '56px', paddingLeft: '0' }}>
          <div style={{ marginLeft: '56px' }} className="lg:block hidden">
            <main className="p-1 sm:p-2 lg:p-3">
              <AppContent />
            </main>
          </div>
          
          {/* 모바일 뷰 */}
          <div className="lg:hidden">
            <main className="p-1 sm:p-2">
              <AppContent />
            </main>
          </div>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default AppWrapper