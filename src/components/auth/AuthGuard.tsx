import { ReactNode, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { logger } from '@/lib/logger'
import LoginMain from '@/components/auth/LoginMain'
interface AuthGuardProps {
  children: ReactNode
}

/**
 * 최상위 인증 가드 컴포넌트
 * - 인증되지 않은 사용자는 로그인 화면으로 리다이렉트
 * - 인증된 사용자는 자식 컴포넌트 렌더링
 * - 로딩 중에는 간단한 로딩 표시 (DataInitializer에서 메인 로딩 처리)
 * - /auth/confirm, /auth/reset-password 경로는 인증 없이 접근 가능
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const { user, employee, loading } = useAuth()
  const location = useLocation()

  // 인증이 필요 없는 경로 목록
  const publicAuthPaths = ['/auth/confirm', '/auth/reset-password']
  const isPublicAuthPath = publicAuthPaths.includes(location.pathname)

  // 인증 상태 확인 중 - 간단한 로딩만 표시
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">인증 확인 중...</p>
        </div>
      </div>
    )
  }

  // 인증이 필요 없는 경로는 그대로 통과
  if (isPublicAuthPath) {
    return <>{children}</>
  }

  // 인증되지 않은 경우
  if (!user || !employee) {
    return <LoginMain />
  }

  // 인증 완료 - 자식 컴포넌트 렌더링
  return <>{children}</>
}