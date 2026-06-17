import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import AuthGuard from '@/components/auth/AuthGuard'
import DataInitializer from '@/components/auth/DataInitializer'
import AppLayout from '@/components/layout/AppLayout'
import UpdateNotificationModal from '@/components/common/UpdateNotificationModal'
import ProductAcceptanceCertificatePreview from '@/components/receipts/ProductAcceptanceCertificatePreview'
import { logger } from '@/lib/logger'

/**
 * 애플리케이션 최상위 컴포넌트
 * - AuthProvider로 인증 상태 관리
 * - AuthGuard로 인증되지 않은 사용자 차단
 * - DataInitializer로 인증 후 데이터 초기화
 * - AppLayout으로 메인 애플리케이션 렌더링
 */
export default function App() {
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      logger.error('화면 단 예기치 못한 에러 발생', event.error, {
        source: 'frontend',
        category: 'global_error',
        action: 'uncaught_exception',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logger.error('화면 단 비동기 프라미스 에러 발생', event.reason, {
        source: 'frontend',
        category: 'global_error',
        action: 'unhandled_rejection',
      })
    }

    window.addEventListener('error', handleGlobalError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleGlobalError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])
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
