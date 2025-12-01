import { useState, useEffect, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import { logger } from '@/lib/logger'

// 즉시 로딩할 핵심 컴포넌트들 (자주 사용되는 페이지)
import DashboardMain from '@/components/dashboard/DashboardMain'
import PurchaseListMain from '@/components/purchase/PurchaseListMain'

// 필요시에만 lazy loading할 컴포넌트들
import { lazy } from 'react'
const PurchaseNewMain = lazy(() => import('@/components/lazy/LazyPurchaseNewMain'))
const PurchaseDetailMain = lazy(() => import('@/components/purchase/PurchaseDetailMain'))
const VendorMain = lazy(() => import('@/components/vendor/VendorMain'))
const EmployeeMain = lazy(() => import('@/components/employee/EmployeeMain'))
const SupportMain = lazy(() => import('@/components/support/SupportMain'))
const ReceiptsMain = lazy(() => import('@/components/receipts/ReceiptsMain'))

// 매우 빠른 로딩 스피너 (최소한의 UI)
const MinimalLoader = () => (
  <div className="flex items-center justify-center py-2">
    <div className="w-4 h-4 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
  </div>
)

// 즉시 표시할 빈 컨테이너 (프리로드 완료된 페이지용)
const InstantContainer = () => (
  <div className="w-full h-4" />
)

// 경량 스켈레톤 (첫 로드용)
const LightSkeleton = () => (
  <div className="space-y-3 p-3 animate-pulse">
    <div className="h-6 bg-gray-100 rounded w-1/3"></div>
    <div className="h-3 bg-gray-100 rounded w-2/3"></div>
    <div className="h-20 bg-gray-100 rounded"></div>
  </div>
)

export default function OptimizedRoutes() {
  const location = useLocation()
  const [preloadedComponents, setPreloadedComponents] = useState<Set<string>>(new Set())

  // 핵심 페이지들을 즉시 프리로드
  useEffect(() => {
    const corePages = ['/vendor', '/employee', '/purchase/new']
    
    // requestIdleCallback으로 백그라운드에서 프리로드
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        corePages.forEach(async (page) => {
          try {
            switch (page) {
              case '/vendor':
                await import('@/components/vendor/VendorMain')
                break
              case '/employee':
                await import('@/components/employee/EmployeeMain')
                break
              case '/purchase/new':
                await import('@/components/lazy/LazyPurchaseNewMain')
                break
            }
            setPreloadedComponents(prev => new Set([...prev, page]))
          } catch (error) {
            logger.warn(`Failed to preload ${page}`, { error })
          }
        })
      }, { timeout: 1000 })
    }
  }, [])

  // 현재 경로에 따른 적절한 로딩 UI 선택
  const getLoadingComponent = (path: string) => {
    if (preloadedComponents.has(path)) {
      return <InstantContainer />
    }
    return <MinimalLoader />
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        
        {/* 즉시 로딩 페이지들 */}
        <Route path="/dashboard" element={<DashboardMain />} />
        <Route path="/purchase" element={<PurchaseListMain showEmailButton={false} />} />
        <Route path="/purchase/list" element={<PurchaseListMain showEmailButton={false} />} />
        
        {/* Lazy 로딩 페이지들 - 스마트 로딩 UI */}
        <Route 
          path="/purchase/new" 
          element={
            <Suspense fallback={getLoadingComponent('/purchase/new')}>
              <PurchaseNewMain />
            </Suspense>
          } 
        />
        <Route 
          path="/vendor" 
          element={
            <Suspense fallback={getLoadingComponent('/vendor')}>
              <VendorMain />
            </Suspense>
          } 
        />
        <Route 
          path="/employee" 
          element={
            <Suspense fallback={getLoadingComponent('/employee')}>
              <EmployeeMain />
            </Suspense>
          } 
        />
        <Route 
          path="/receipts" 
          element={
            <Suspense fallback={<MinimalLoader />}>
              <ReceiptsMain />
            </Suspense>
          } 
        />
        <Route 
          path="/support" 
          element={
            <Suspense fallback={<MinimalLoader />}>
              <SupportMain />
            </Suspense>
          } 
        />
        <Route 
          path="/purchase/detail/:id" 
          element={
            <Suspense fallback={<LightSkeleton />}>
              <PurchaseDetailMain />
            </Suspense>
          } 
        />
        <Route 
          path="/purchase/requests/:id" 
          element={
            <Suspense fallback={<LightSkeleton />}>
              <PurchaseDetailMain />
            </Suspense>
          } 
        />
        
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}