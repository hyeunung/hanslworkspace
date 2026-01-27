

import { useNavigate } from 'react-router-dom'
import { createClient } from '@/lib/supabase/client'
import { User, Menu, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supportService } from '@/services/supportService'

interface HeaderProps {
  user: any
  onMenuClick?: () => void
}

const getRoleDisplayName = (role: string) => {
  const roleMap: Record<string, string> = {
    app_admin: '시스템 관리자',
    ceo: 'CEO',
    final_approver: '최종 승인자',
    middle_manager: '중간 관리자',
    'lead buyer': '구매 책임자',
    buyer: '구매 담당자',
    requester: '요청자'
  }
  return roleMap[role] || role
}

export default function Header({ user, onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0)

  const roles = Array.isArray(user?.purchase_role)
    ? user.purchase_role
    : (user?.purchase_role ? [user.purchase_role] : [])
  const isAdmin = roles.includes('app_admin')

  // app_admin: 상단 로고 옆에 미처리 문의(open+in_progress) 뱃지 표시
  useEffect(() => {
    if (!isAdmin) return

    const loadPendingCount = async () => {
      try {
        // count-only 쿼리로 가볍게 계산
        const supabase = createClient()
        const { count } = await supabase
          .from('support_inquires')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'in_progress'])

        if (typeof count === 'number') setPendingInquiryCount(count)
      } catch {
        // 상단 배지는 실패해도 UX에 치명적이지 않으므로 무시
      }
    }

    loadPendingCount()

    const isPending = (status?: string | null) => status === 'open' || status === 'in_progress'
    const subscription = supportService.subscribeToInquiries((payload) => {
      // ✅ 즉시 반영(딜레이 체감 제거): realtime payload로 카운트 증감
      const eventType = payload?.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | undefined
      const newRow = payload?.new as { status?: string | null } | undefined
      const oldRow = payload?.old as { status?: string | null } | undefined

      if (eventType === 'INSERT') {
        if (isPending(newRow?.status)) {
          setPendingInquiryCount((prev) => {
            const next = prev + 1
            return next
          })
        }
        return
      }
      if (eventType === 'DELETE') {
        if (isPending(oldRow?.status)) {
          setPendingInquiryCount((prev) => {
            const next = Math.max(0, prev - 1)
            return next
          })
        }
        return
      }
      if (eventType === 'UPDATE') {
        // Supabase realtime payload에 old.status가 안 오는 케이스가 있어(Replica identity 설정/정책 등),
        // 이 경우엔 카운트를 계산할 수 없으니 즉시 감소(보이는 UX) + 즉시 재조회(정확성 보정)로 처리한다.
        if (!oldRow?.status) {
          const isNowPending = isPending(newRow?.status)
          if (!isNowPending) {
            setPendingInquiryCount((prev) => {
              const next = Math.max(0, prev - 1)
              return next
            })
          }
          loadPendingCount()
          return
        }

        const wasPending = isPending(oldRow?.status)
        const isNowPending = isPending(newRow?.status)
        if (wasPending === isNowPending) return
        setPendingInquiryCount((prev) => {
          const next = prev + (isNowPending ? 1 : -1)
          return Math.max(0, next)
        })
      }
    })

    // 탭 전환/포커스 복귀 시 보정(이벤트 누락 대비)
    const onVisibilityChange = () => {
      if (!document.hidden) loadPendingCount()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAdmin])

  // 일반 사용자: 내 미처리 문의(open+in_progress) 건수 표시
  useEffect(() => {
    if (isAdmin) return

    const supabase = createClient()
    let subscription: any
    let cancelled = false
    let currentUserId = ''

    const loadMyPendingCount = async () => {
      if (!currentUserId) {
        const { data: { user: authUser } } = await supabase.auth.getUser()
        currentUserId = authUser?.id || ''
      }
      if (!currentUserId) return

      const { count, error } = await supabase
        .from('support_inquires')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUserId)
        .in('status', ['open', 'in_progress'])

      if (!cancelled) {
        if (!error && typeof count === 'number') setPendingInquiryCount(count)
      }
    }

    loadMyPendingCount()

    // 실시간 구독(문의 변경 시 내 건만 재조회)
    if (!subscription) {
      subscription = supportService.subscribeToInquiries((payload) => {
        if (!currentUserId) {
          loadMyPendingCount()
          return
        }
        const newRow = payload?.new as { user_id?: string } | undefined
        const oldRow = payload?.old as { user_id?: string } | undefined
        if (newRow?.user_id !== currentUserId && oldRow?.user_id !== currentUserId) return
        loadMyPendingCount()
      })
    }

    return () => {
      cancelled = true
      if (subscription) subscription.unsubscribe()
    }
  }, [isAdmin])
  
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50">
      <div className="h-14 px-4 sm:px-6 flex items-center justify-between">
        {/* 모바일 메뉴 버튼 */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded hover:bg-gray-50 transition-colors"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        {/* 로고 */}
        <div className="flex items-center">
          <img
            src="/logo_symbol.svg"
            alt="HANSL Logo"
            className="w-14 h-14"
            style={{ objectFit: 'contain' }}
          />
          <div className="ml-3 leading-none flex flex-col items-start">
            <h1 className="text-[30px] font-bold text-gray-600 leading-none mb-0.5">
              HANSL
            </h1>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide leading-none ml-[1px]">
              Purchase System
            </span>
          </div>

          {/* 로고 오른쪽 문의 뱃지: admin=전체 미처리 / user=내 미처리 */}
          {pendingInquiryCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/support')}
              className="relative ml-3 inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 transition-colors"
              title="미처리 문의 보기"
              aria-label={`문의 알림 ${pendingInquiryCount}건`}
            >
              <MessageCircle className="w-4 h-4 text-gray-600" />
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
                {(pendingInquiryCount > 99) ? '99+' : pendingInquiryCount}
              </span>
            </button>
          )}
        </div>
        
        {/* 사용자 정보 */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {user?.name || '사용자'}
            </span>
            {user?.purchase_role && (
              <span className="text-xs text-gray-500">
                {getRoleDisplayName(user.purchase_role)}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 모바일 사용자 아이콘 */}
        <div className="sm:hidden">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded hover:bg-gray-50 transition-colors"
          >
            <User className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>
    </header>
  )
}