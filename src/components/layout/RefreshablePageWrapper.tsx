
import { ReactNode } from 'react'
import PullToRefreshLayout from './PullToRefreshLayout'

interface RefreshablePageWrapperProps {
  children: ReactNode
  onRefresh?: () => Promise<void>
}

export default function RefreshablePageWrapper({ 
  children, 
  onRefresh 
}: RefreshablePageWrapperProps) {
  
  // 데이터 새로고침 함수
  const handleRefresh = async () => {
    if (onRefresh) {
      // 커스텀 새로고침 함수가 있으면 실행
      await onRefresh()
    } else {
      // 없으면 전체 페이지 새로고침으로 최신 데이터 가져오기
      window.location.reload()
    }
  }

  return (
    <PullToRefreshLayout onRefresh={handleRefresh}>
      {children}
    </PullToRefreshLayout>
  )
}