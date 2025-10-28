
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { Employee } from '@/types/purchase'
import { checkPagePermission, PermissionResult } from '@/utils/permissions'
import { toast } from 'sonner'

interface PermissionGuardProps {
  children: React.ReactNode
  _requiredRoles?: string[]
  fallbackPath?: string
  showError?: boolean
}

export default function PermissionGuard({ 
  children, 
  _requiredRoles = [], 
  fallbackPath = '/dashboard',
  showError = true 
}: PermissionGuardProps) {
  const [_employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [permissionResult, setPermissionResult] = useState<PermissionResult>({ allowed: false })
  const navigate = useNavigate()
  const supabase = createClient()

  useEffect(() => {
    const checkUserPermissions = async () => {
      try {
        // 현재 로그인된 사용자 정보 가져오기
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        
        if (userError || !user) {
          setPermissionResult({ 
            allowed: false, 
            message: '로그인이 필요합니다.',
            redirectTo: '/login'
          })
          return
        }

        // 직원 정보 가져오기
        const { data: employeeData, error: employeeError } = await supabase
          .from('employees')
          .select('*')
          .eq('email', user.email)
          .single()

        if (employeeError || !employeeData) {
          setPermissionResult({
            allowed: false,
            message: '직원 정보를 찾을 수 없습니다. 관리자에게 문의하세요.',
            redirectTo: '/login'
          })
          return
        }

        setEmployee(employeeData)

        // 권한 체크
        const result = checkPagePermission(
          window.location.pathname,
          employeeData.purchase_role,
          employeeData.is_active
        )

        setPermissionResult(result)

        // 권한이 없으면 리디렉션
        if (!result.allowed) {
          if (showError && result.message) {
            toast.error(result.message)
          }
          
          setTimeout(() => {
            navigate(result.redirectTo || fallbackPath)
          }, 1000)
        }
      } catch (_error) {
        setPermissionResult({
          allowed: false,
          message: '권한 체크 중 오류가 발생했습니다.',
          redirectTo: fallbackPath
        })
      } finally {
        setLoading(false)
      }
    }

    checkUserPermissions()
  }, [navigate, fallbackPath, showError, supabase])

  // 로딩 중
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-gray-600">권한을 확인하는 중...</p>
        </div>
      </div>
    )
  }

  // 권한 없음
  if (!permissionResult.allowed) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="text-6xl text-gray-300 mb-4">🔒</div>
          <h2 className="text-2xl font-semibold text-gray-700 mb-2">접근 권한이 없습니다</h2>
          <p className="text-gray-600 mb-4">
            {permissionResult.message || '이 페이지에 접근할 권한이 없습니다.'}
          </p>
          <button
            onClick={() => navigate(fallbackPath)}
            className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            대시보드로 이동
          </button>
        </div>
      </div>
    )
  }

  // 권한 있음 - 자식 컴포넌트 렌더링
  return <>{children}</>
}

// 권한별 컴포넌트 표시/숨김을 위한 훅
export function usePermission() {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const getEmployee = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          setLoading(false)
          return
        }

        const { data: employeeData } = await supabase
          .from('employees')
          .select('*')
          .eq('email', user.email)
          .single()

        if (employeeData) {
          setEmployee(employeeData)
        }
      } catch (_error) {
        // 직원 정보 조회 실패는 무시
      } finally {
        setLoading(false)
      }
    }

    getEmployee()
  }, [supabase])

  const hasPermission = (requiredRoles: string[]): boolean => {
    if (!employee) return false
    if (requiredRoles.includes('all')) return true
    return requiredRoles.includes(employee.purchase_role || '')
  }

  const hasAnyRole = (roles: string[]): boolean => {
    if (!employee?.purchase_role) return false
    return roles.includes(employee.purchase_role)
  }

  const isAdmin = (): boolean => {
    return hasAnyRole(['app_admin', 'ceo'])
  }

  return {
    employee,
    loading,
    hasPermission,
    hasAnyRole,
    isAdmin
  }
}