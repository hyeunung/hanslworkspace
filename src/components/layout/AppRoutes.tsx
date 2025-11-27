import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'

// 페이지 컴포넌트들을 lazy loading으로 변경 (코드 스플리팅)
const DashboardMain = lazy(() => import('@/components/dashboard/DashboardMain'))
const PurchaseNewMain = lazy(() => import('@/components/purchase/PurchaseNewMain'))
const PurchaseListMain = lazy(() => import('@/components/purchase/PurchaseListMain'))
const PurchaseDetailMain = lazy(() => import('@/components/purchase/PurchaseDetailMain'))
const VendorMain = lazy(() => import('@/components/vendor/VendorMain'))
const EmployeeMain = lazy(() => import('@/components/employee/EmployeeMain'))
const SupportMain = lazy(() => import('@/components/support/SupportMain'))
const ReceiptsMain = lazy(() => import('@/components/receipts/ReceiptsMain'))
const BomCoordinateMain = lazy(() => import('@/components/bom-coordinate/BomCoordinateIntegrated'))

/**
 * 애플리케이션 라우팅 컴포넌트
 * - 인증된 사용자를 위한 모든 라우트 정의
 * - 지연 로딩 및 에러 바운더리 적용
 */
export default function AppRoutes() {
  const location = useLocation()
  
  return (
    <ErrorBoundary>
      <Suspense fallback={
        <div className="flex items-center justify-center py-12" style={{ minHeight: '400px' }}>
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <span className="ml-3 text-gray-600 block mt-4">로딩 중...</span>
            <p className="text-xs text-gray-400 mt-2">경로: {location.pathname}</p>
          </div>
        </div>
      }>
        <Routes>
          {/* 기본 리다이렉트 */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          
          {/* 테스트 라우트 */}
          <Route path="/test" element={<div style={{ padding: '20px', backgroundColor: 'yellow' }}>테스트 라우트 작동 중!</div>} />
          
          {/* 메인 페이지들 */}
          <Route path="/dashboard" element={<DashboardMain />} />
          <Route path="/purchase" element={<PurchaseListMain showEmailButton={false} />} />
          <Route path="/purchase/new" element={<PurchaseNewMain />} />
          <Route path="/purchase/list" element={<PurchaseListMain showEmailButton={false} />} />
          <Route path="/purchase/detail/:id" element={<PurchaseDetailMain />} />
          <Route path="/purchase/requests/:id" element={<PurchaseDetailMain />} />
          <Route path="/vendor" element={<VendorMain />} />
          <Route path="/employee" element={<EmployeeMain />} />
          <Route path="/receipts" element={<ReceiptsMain />} />
          <Route path="/support" element={<SupportMain />} />
          <Route path="/bom-coordinate" element={<BomCoordinateMain />} />
          
          {/* 알 수 없는 경로는 대시보드로 리다이렉트 */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}