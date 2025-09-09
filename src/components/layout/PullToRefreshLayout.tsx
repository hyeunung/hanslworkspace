
import { useState, useRef, useEffect, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

interface PullToRefreshLayoutProps {
  children: ReactNode
  onRefresh?: () => Promise<void>
  threshold?: number
  enabled?: boolean
}

export default function PullToRefreshLayout({
  children,
  onRefresh,
  threshold = 80,
  enabled = true
}: PullToRefreshLayoutProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef<number | null>(null)
  const canPullRef = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  // 기본 새로고침 함수 - 전체 데이터 새로고침
  const handleRefresh = async () => {
    if (onRefresh) {
      await onRefresh()
    } else {
      // 페이지별 데이터 새로고침
      if (pathname?.includes('/purchase')) {
        // 발주요청 관리 페이지 - 전체 데이터 새로고침
        window.location.reload()
      } else if (pathname?.includes('/employee')) {
        // 직원 관리 페이지 - 전체 데이터 새로고침
        window.location.reload()
      } else if (pathname?.includes('/vendor')) {
        // 업체 관리 페이지 - 전체 데이터 새로고침
        window.location.reload()
      } else {
        // 기타 페이지 - Next.js 라우터 새로고침
        window.location.reload()
      }
      // 사용자가 새로고침을 인지할 수 있도록 딜레이
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  useEffect(() => {
    if (!enabled) return

    const container = containerRef.current
    if (!container) return

    let rafId: number | null = null

    const handleTouchStart = (e: TouchEvent) => {
      // 스크롤이 최상단에 있을 때만 pull 가능
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      if (scrollTop === 0) {
        startYRef.current = e.touches[0].clientY
        canPullRef.current = true
      } else {
        canPullRef.current = false
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!startYRef.current || !canPullRef.current || isRefreshing) return

      const currentY = e.touches[0].clientY
      const distance = Math.max(0, currentY - startYRef.current)
      
      // 당기기 시작했으면 스크롤 방지
      if (distance > 5) {
        e.preventDefault()
        setIsPulling(true)
        
        // 부드러운 애니메이션을 위해 requestAnimationFrame 사용
        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          // 당기기 거리에 저항감 추가 (더 당길수록 어려워짐)
          const resistance = Math.min(distance * 0.6, threshold * 2)
          setPullDistance(resistance)
        })
      }
    }

    const handleTouchEnd = async () => {
      if (!isPulling) return

      if (rafId) cancelAnimationFrame(rafId)

      if (pullDistance >= threshold) {
        setIsRefreshing(true)
        setPullDistance(threshold) // 새로고침 중에는 threshold 높이 유지
        
        try {
          await handleRefresh()
        } finally {
          setIsRefreshing(false)
          setPullDistance(0)
        }
      } else {
        setPullDistance(0)
      }

      setIsPulling(false)
      startYRef.current = null
      canPullRef.current = false
    }

    // 이벤트 리스너 등록
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [onRefresh, pullDistance, threshold, isPulling, isRefreshing, enabled])

  const getStatusText = () => {
    if (isRefreshing) return '새로고침 중...'
    if (pullDistance >= threshold) return '놓아서 새로고침'
    if (isPulling) return '당겨서 새로고침'
    return ''
  }

  const progress = Math.min((pullDistance / threshold) * 100, 100)

  return (
    <>
      {/* Pull indicator */}
      {enabled && (
        <div
          className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-center bg-white/95 backdrop-blur-sm transition-all duration-200 ease-out overflow-hidden border-b border-gray-100"
          style={{
            height: `${pullDistance}px`,
            opacity: pullDistance > 0 ? 1 : 0,
            transform: `translateY(${pullDistance > 0 ? 0 : -100}%)`,
          }}
        >
          <div className="flex flex-col items-center justify-center">
            <div 
              className={`transition-transform duration-200 ${isRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: `rotate(${isPulling && !isRefreshing ? progress * 3.6 : 0}deg)`,
              }}
            >
              <RefreshCw 
                size={24} 
                className={`transition-colors ${
                  pullDistance >= threshold ? 'text-primary' : 'text-gray-400'
                }`}
              />
            </div>
            <span className="mt-2 text-sm text-gray-600">
              {getStatusText()}
            </span>
            {isPulling && !isRefreshing && (
              <div className="mt-2 h-1 w-20 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content container */}
      <div
        ref={containerRef}
        style={{
          transform: enabled ? `translateY(${pullDistance}px)` : 'none',
          transition: isPulling ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </>
  )
}