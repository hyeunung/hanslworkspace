import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import { purchaseRealtimeService } from '@/services/purchaseRealtimeService'
import type { Employee } from '@/types/purchase'

interface AuthContextType {
  user: any
  employee: Employee | null
  currentUserRoles: string[]
  currentUserName: string
  currentUserEmail: string
  currentUserId: string
  loading: boolean
  refreshing: boolean
  refreshAuth: (options?: { background?: boolean }) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<any>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const initialLoadCompleteRef = useRef(false)

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

  const loadAuthData = async (options?: { background?: boolean }) => {
    const isBackground = options?.background ?? false

    if (isBackground) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      logger.debug('[AuthContext] Starting auth data load...', { background: isBackground })
      
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError) {
        logger.error('[AuthContext] 인증 정보 조회 실패', authError)
        setUser(null)
        setEmployee(null)
        return
      }
      
      setUser(user)
      
      if (!user) {
        logger.debug('[AuthContext] No authenticated user found')
        setEmployee(null)
        return
      }

      logger.debug('[AuthContext] Authenticated user found, loading employee data...')

      // 직원 정보 조회
      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (employeeError) {
        logger.error('[AuthContext] 직원 정보 조회 실패', employeeError)
        setEmployee(null)
        return
      }

      if (employeeData) {
        // DB에서 받은 데이터에 id를 string으로 변환
        const employeeWithStringId = {
          ...employeeData,
          id: String(employeeData.id)
        }
        setEmployee(employeeWithStringId)
        logger.info('[AuthContext] 인증 데이터 로드 완료', { 
          email: employeeData.email, 
          roles: parseRoles(employeeData.purchase_role) 
        })

        // 🚀 Realtime 구독 시작 (로그인 성공 시)
        purchaseRealtimeService.subscribe()
        logger.info('[AuthContext] Realtime 구독 시작됨')
      }
    } catch (error) {
      logger.error('[AuthContext] 인증 데이터 로드 중 오류', error)
      setUser(null)
      setEmployee(null)
    } finally {
      if (isBackground) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
      if (!initialLoadComplete) {
        setInitialLoadComplete(true)
        initialLoadCompleteRef.current = true
      }
    }
  }

  const refreshAuth = async (options?: { background?: boolean }) => {
    const isBackground = options?.background ?? true
    await loadAuthData({ background: isBackground })
  }

  useEffect(() => {
    initialLoadCompleteRef.current = initialLoadComplete
  }, [initialLoadComplete])

  useEffect(() => {
    loadAuthData({ background: false })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, _session: any) => {
      logger.debug('[AuthContext] Auth state changed:', { event })

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (initialLoadCompleteRef.current) {
          loadAuthData({ background: true })
        } else {
          loadAuthData({ background: false })
        }
      } else if (event === 'SIGNED_OUT') {
        logger.info('[AuthContext] User signed out')
        
        // 🚀 Realtime 구독 해제 (로그아웃 시)
        purchaseRealtimeService.unsubscribe()
        logger.info('[AuthContext] Realtime 구독 해제됨')
        
        setUser(null)
        setEmployee(null)
        setLoading(false)
        setRefreshing(false)
        setInitialLoadComplete(false)
        initialLoadCompleteRef.current = false
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
    refreshing,
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