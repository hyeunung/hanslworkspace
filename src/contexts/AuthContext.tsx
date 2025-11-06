import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

interface Employee {
  id: number
  email: string
  name: string
  purchase_role: string | string[]
  [key: string]: any
}

interface AuthContextType {
  user: any
  employee: Employee | null
  currentUserRoles: string[]
  currentUserName: string
  currentUserEmail: string
  currentUserId: string
  loading: boolean
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<any>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  // 역할 파싱 (문자열/배열 정규화)
  const parseRoles = (purchaseRole: string | string[] | null | undefined): string[] => {
    if (!purchaseRole) return []
    
    if (Array.isArray(purchaseRole)) {
      return purchaseRole.filter(role => role && role.trim())
    }
    
    if (typeof purchaseRole === 'string') {
      return purchaseRole.split(',').map(role => role.trim()).filter(Boolean)
    }
    
    return []
  }

  const loadAuthData = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError) {
        logger.error('인증 정보 조회 실패', authError)
        setUser(null)
        setEmployee(null)
        return
      }
      
      setUser(user)
      
      if (!user) {
        setEmployee(null)
        return
      }

      // 직원 정보 조회
      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (employeeError) {
        logger.error('직원 정보 조회 실패', employeeError)
        setEmployee(null)
        return
      }

      if (employeeData) {
        setEmployee(employeeData)
        logger.debug('인증 데이터 로드 완료', { 
          email: employeeData.email, 
          roles: parseRoles(employeeData.purchase_role) 
        })
      }
    } catch (error) {
      logger.error('인증 데이터 로드 중 오류', error)
      setUser(null)
      setEmployee(null)
    } finally {
      setLoading(false)
    }
  }

  const refreshAuth = async () => {
    await loadAuthData()
  }

  useEffect(() => {
    loadAuthData()

    // Supabase auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        loadAuthData()
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setEmployee(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // 계산된 값들
  const currentUserRoles = parseRoles(employee?.purchase_role)
  const currentUserName = employee?.name || ''
  const currentUserEmail = employee?.email || user?.email || ''
  const currentUserId = user?.id || ''

  const value = {
    user,
    employee,
    currentUserRoles,
    currentUserName,
    currentUserEmail,
    currentUserId,
    loading,
    refreshAuth
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}