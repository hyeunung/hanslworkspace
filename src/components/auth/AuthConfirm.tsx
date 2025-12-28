import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import type { EmailOtpType } from '@supabase/supabase-js'

/**
 * 비밀번호 재설정 및 이메일 확인을 처리하는 컴포넌트
 * Supabase Auth의 token_hash를 세션으로 교환
 */
export default function AuthConfirm() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleAuthConfirm = async () => {
      const token_hash = searchParams.get('token_hash')
      const type = searchParams.get('type') as EmailOtpType | null
      const next = searchParams.get('next') || '/dashboard'

      if (!token_hash || !type) {
        setError('유효하지 않은 링크입니다.')
        setLoading(false)
        setTimeout(() => navigate('/'), 3000)
        return
      }

      const supabase = createClient()

      try {
        // token_hash를 세션으로 교환
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type,
          token_hash,
        })

        if (verifyError) {
          setError(`인증 실패: ${verifyError.message}`)
          setLoading(false)
          setTimeout(() => navigate('/'), 3000)
          return
        }

        // 비밀번호 재설정인 경우 비밀번호 변경 페이지로 리다이렉트
        if (type === 'recovery') {
          navigate('/auth/reset-password')
        } else {
          // 다른 타입(이메일 확인 등)은 지정된 페이지로 리다이렉트
          navigate(next)
        }
      } catch (err) {
        setError(`오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
        setLoading(false)
        setTimeout(() => navigate('/'), 3000)
      }
    }

    handleAuthConfirm()
  }, [searchParams, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">인증 처리 중...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">인증 실패</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <p className="text-sm text-gray-500">잠시 후 메인 페이지로 이동합니다...</p>
          </div>
        </div>
      </div>
    )
  }

  return null
}


