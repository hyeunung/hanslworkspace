import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

interface InstantTransitionProps {
  children: React.ReactNode
}

export default function InstantTransition({ children }: InstantTransitionProps) {
  const location = useLocation()
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [displayContent, setDisplayContent] = useState(children)

  useEffect(() => {
    // 페이지 변경 시 즉시 전환 처리
    setIsTransitioning(true)
    
    // 매우 빠른 전환을 위해 10ms 후 새 컨텐츠 표시
    const timer = setTimeout(() => {
      setDisplayContent(children)
      setIsTransitioning(false)
    }, 10)

    return () => clearTimeout(timer)
  }, [location.pathname, children])

  if (isTransitioning) {
    // 전환 중 최소한의 UI만 표시
    return (
      <div className="min-h-[200px] flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{displayContent}</>
}