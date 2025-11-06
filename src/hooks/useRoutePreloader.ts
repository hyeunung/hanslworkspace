import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { navigationOptimizer } from '@/utils/navigationOptimizer'

export const useRoutePreloader = () => {
  const location = useLocation()
  
  useEffect(() => {
    // requestIdleCallback을 사용해 메인 스레드를 블로킹하지 않도록 함
    const schedulePreloading = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          navigationOptimizer.preloadRelatedPages(location.pathname)
        }, { timeout: 2000 })
      } else {
        // requestIdleCallback 미지원 브라우저용 폴백
        setTimeout(() => {
          navigationOptimizer.preloadRelatedPages(location.pathname)
        }, 100)
      }
    }
    
    schedulePreloading()
    
    // 페이지 이탈 시 불필요한 프리로딩 취소
    return () => {
      navigationOptimizer.cancelPreloading()
    }
  }, [location.pathname])
  
  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      navigationOptimizer.cancelPreloading()
    }
  }, [])
}