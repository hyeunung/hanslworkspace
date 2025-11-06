import { useRoutePreloader } from '@/hooks/useRoutePreloader'
import OptimizedRoutes from './OptimizedRoutes'

export default function AppContent() {
  // 라우트 프리로더 활성화
  useRoutePreloader()
  
  return <OptimizedRoutes />
}