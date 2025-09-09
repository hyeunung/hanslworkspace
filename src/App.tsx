import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import FixedNavigation from '@/components/layout/FixedNavigation'
import ErrorBoundary from '@/components/ErrorBoundary'

// 로그인은 항상 필요하므로 직접 import
import LoginMain from '@/components/auth/LoginMain'

// 페이지 컴포넌트들을 lazy loading으로 변경 (코드 스플리팅)
const DashboardMain = lazy(() => import('@/components/dashboard/DashboardMain'))
const PurchaseNewMain = lazy(() => import('@/components/purchase/PurchaseNewMain'))
const PurchaseListMain = lazy(() => import('@/components/purchase/PurchaseListMain'))
const PurchaseDetailMain = lazy(() => import('@/components/purchase/PurchaseDetailMain'))
const VendorMain = lazy(() => import('@/components/vendor/VendorMain'))
const EmployeeMain = lazy(() => import('@/components/employee/EmployeeMain'))
const SupportMain = lazy(() => import('@/components/support/SupportMain'))

interface Employee {
  id: string
  name: string
  email: string
  purchase_role: string | string[]
}

export default function App() {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  useEffect(() => {
    const loadUser = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          setIsAuthenticated(false)
          setLoading(false)
          return
        }

        setIsAuthenticated(true)

        const { data: employeeData } = await supabase
          .from('employees')
          .select('*')
          .eq('email', user.email)
          .single()

        if (employeeData) {
          setEmployee(employeeData)
        }
      } catch (error) {
        setIsAuthenticated(false)
      } finally {
        setLoading(false)
      }
    }

    loadUser()

    // Supabase auth state listener
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        loadUser()
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false)
        setEmployee(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // 로그인하지 않은 경우
  if (!isAuthenticated) {
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
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
                    <span className="ml-3 text-gray-600">로딩 중...</span>
                  </div>
                }>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/login" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardMain />} />
                    <Route path="/purchase" element={<PurchaseListMain showEmailButton={false} />} />
                    <Route path="/purchase/new" element={<PurchaseNewMain />} />
                    <Route path="/purchase/list" element={<PurchaseListMain showEmailButton={false} />} />
                    <Route path="/purchase/detail/:id" element={<PurchaseDetailMain />} />
                    <Route path="/purchase/requests/:id" element={<PurchaseDetailMain />} />
                    <Route path="/vendor" element={<VendorMain />} />
                    <Route path="/employee" element={<EmployeeMain />} />
                    <Route path="/support" element={<SupportMain />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          
          {/* 모바일 뷰 */}
          <div className="lg:hidden">
            <main className="p-1 sm:p-2">
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
                    <span className="ml-3 text-gray-600">로딩 중...</span>
                  </div>
                }>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/login" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardMain />} />
                    <Route path="/purchase" element={<PurchaseListMain showEmailButton={false} />} />
                    <Route path="/purchase/new" element={<PurchaseNewMain />} />
                    <Route path="/purchase/list" element={<PurchaseListMain showEmailButton={false} />} />
                    <Route path="/purchase/detail/:id" element={<PurchaseDetailMain />} />
                    <Route path="/purchase/requests/:id" element={<PurchaseDetailMain />} />
                    <Route path="/vendor" element={<VendorMain />} />
                    <Route path="/employee" element={<EmployeeMain />} />
                    <Route path="/support" element={<SupportMain />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
    </BrowserRouter>
  )
}