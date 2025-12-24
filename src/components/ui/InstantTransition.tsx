interface InstantTransitionProps {
  children: React.ReactNode
}

/**
 * 🚀 즉시 전환 컴포넌트 (로딩 스피너 없음)
 * - Realtime + 메모리 캐시 적용으로 로딩 스피너 불필요
 * - 페이지 전환 시 즉시 새 컨텐츠 표시
 */
export default function InstantTransition({ children }: InstantTransitionProps) {
  // 로딩 스피너 없이 즉시 렌더링
  return <>{children}</>
}