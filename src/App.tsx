import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import AuthGuard from '@/components/auth/AuthGuard'
import DataInitializer from '@/components/auth/DataInitializer'
import AppLayout from '@/components/layout/AppLayout'
import UpdateNotificationModal from '@/components/common/UpdateNotificationModal'
import ProductAcceptanceCertificatePreview from '@/components/receipts/ProductAcceptanceCertificatePreview'

/**
 * 애플리케이션 최상위 컴포넌트
 * - AuthProvider로 인증 상태 관리
 * - AuthGuard로 인증되지 않은 사용자 차단
 * - DataInitializer로 인증 후 데이터 초기화
 * - AppLayout으로 메인 애플리케이션 렌더링
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 프리뷰 라우트 (AuthGuard 바깥) */}
        <Route path="/preview/acceptance" element={<ProductAcceptanceCertificatePreview />} />

        {/* 그 외 모든 경로: 기존 인증 흐름 */}
        <Route
          path="/*"
          element={
            <AuthProvider>
              <AuthGuard>
                <DataInitializer>
                  <AppLayout />
                </DataInitializer>
              </AuthGuard>
            </AuthProvider>
          }
        />
      </Routes>
      <UpdateNotificationModal />
    </BrowserRouter>
  )
}
