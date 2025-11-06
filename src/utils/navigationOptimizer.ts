// 네비게이션 성능 최적화 유틸리티

interface NavigationCache {
  [key: string]: {
    component: any;
    timestamp: number;
    preloaded: boolean;
  }
}

class NavigationOptimizer {
  private cache: NavigationCache = {}
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5분
  private preloadTimeouts: Map<string, NodeJS.Timeout> = new Map()
  
  // 컴포넌트 캐시 설정
  setCachedComponent(path: string, component: any, preloaded = false) {
    this.cache[path] = {
      component,
      timestamp: Date.now(),
      preloaded
    }
  }
  
  // 캐시된 컴포넌트 조회
  getCachedComponent(path: string) {
    const cached = this.cache[path]
    if (!cached) return null
    
    const isExpired = Date.now() - cached.timestamp > this.CACHE_DURATION
    if (isExpired) {
      delete this.cache[path]
      return null
    }
    
    return cached.component
  }
  
  // 프리로딩 스케줄링
  schedulePreload(path: string, importFn: () => Promise<any>, delay = 100) {
    // 이미 캐시된 경우 스킵
    if (this.cache[path]) return
    
    // 기존 타임아웃 클리어
    const existingTimeout = this.preloadTimeouts.get(path)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    // 새 프리로딩 스케줄
    const timeout = setTimeout(async () => {
      try {
        const module = await importFn()
        this.setCachedComponent(path, module, true)
        this.preloadTimeouts.delete(path)
        console.debug(`✅ Pre-loaded: ${path}`)
      } catch (error) {
        console.warn(`❌ Failed to preload ${path}:`, error)
        this.preloadTimeouts.delete(path)
      }
    }, delay)
    
    this.preloadTimeouts.set(path, timeout)
  }
  
  // 관련 페이지 예측 및 프리로딩
  preloadRelatedPages(currentPath: string) {
    const relatedRoutes = this.getRelatedRoutes(currentPath)
    const routeImporters = this.getRouteImporters()
    
    relatedRoutes.forEach((route, index) => {
      const importer = routeImporters[route]
      if (importer && !this.cache[route]) {
        // 우선순위에 따라 지연 시간 조정
        const delay = index * 150
        this.schedulePreload(route, importer, delay)
      }
    })
  }
  
  // 현재 경로 기준 관련 라우트 반환
  private getRelatedRoutes(currentPath: string): string[] {
    const routes = {
      '/dashboard': ['/purchase/list', '/purchase/new', '/vendor', '/employee'],
      '/purchase': ['/purchase/new', '/dashboard', '/vendor'],
      '/purchase/list': ['/purchase/new', '/dashboard', '/vendor'],
      '/purchase/new': ['/purchase/list', '/vendor', '/dashboard'],
      '/vendor': ['/purchase/new', '/purchase/list', '/dashboard'],
      '/employee': ['/dashboard', '/purchase/list', '/vendor'],
      '/receipts': ['/purchase/list', '/dashboard'],
      '/support': ['/dashboard', '/purchase/list']
    }
    
    return routes[currentPath] || ['/dashboard', '/purchase/list']
  }
  
  // 라우트별 import 함수들
  private getRouteImporters() {
    return {
      '/dashboard': () => import('@/components/dashboard/DashboardMain'),
      '/purchase': () => import('@/components/purchase/PurchaseListMain'),
      '/purchase/list': () => import('@/components/purchase/PurchaseListMain'),
      '/purchase/new': () => import('@/components/lazy/LazyPurchaseNewMain'),
      '/vendor': () => import('@/components/vendor/VendorMain'),
      '/employee': () => import('@/components/employee/EmployeeMain'),
      '/receipts': () => import('@/components/receipts/ReceiptsMain'),
      '/support': () => import('@/components/support/SupportMain')
    }
  }
  
  // 캐시 정리 (메모리 관리)
  cleanupCache() {
    const now = Date.now()
    Object.keys(this.cache).forEach(path => {
      const cached = this.cache[path]
      if (now - cached.timestamp > this.CACHE_DURATION) {
        delete this.cache[path]
      }
    })
  }
  
  // 프리로딩 중단
  cancelPreloading() {
    this.preloadTimeouts.forEach(timeout => clearTimeout(timeout))
    this.preloadTimeouts.clear()
  }
}

// 싱글톤 인스턴스
export const navigationOptimizer = new NavigationOptimizer()

// 주기적 캐시 정리 (5분마다)
setInterval(() => {
  navigationOptimizer.cleanupCache()
}, 5 * 60 * 1000)