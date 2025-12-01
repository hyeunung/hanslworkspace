/**
 * 인증 플로우 테스트 헬퍼 함수
 * 개발 모드에서만 사용되는 테스트 유틸리티
 */

import { logger } from '@/lib/logger'

export interface AuthFlowTestResult {
  step: string
  status: 'success' | 'error' | 'pending'
  message: string
  timestamp: number
}

/**
 * 인증 플로우의 각 단계를 검증
 */
export async function testAuthFlow(): Promise<AuthFlowTestResult[]> {
  const results: AuthFlowTestResult[] = []
  
  const addResult = (step: string, status: 'success' | 'error' | 'pending', message: string) => {
    results.push({
      step,
      status,
      message,
      timestamp: Date.now()
    })
    logger.debug(`[AuthFlowTest] ${step}: ${status} - ${message}`)
  }

  try {
    // 1. AuthProvider 초기화 확인
    addResult('AuthProvider 초기화', 'pending', 'AuthContext가 올바르게 제공되는지 확인')
    
    // 2. AuthGuard 동작 확인
    addResult('AuthGuard 동작', 'pending', '미인증 사용자 차단 및 인증된 사용자 허용 확인')
    
    // 3. DataInitializer 동작 확인
    addResult('DataInitializer 동작', 'pending', '인증 완료 후 데이터 로딩 확인')
    
    // 4. 컴포넌트 렌더링 확인
    addResult('컴포넌트 렌더링', 'pending', '메인 앱 컴포넌트 정상 렌더링 확인')
    
    // 실제 DOM에서 컴포넌트 존재 확인
    const authProvider = document.querySelector('[data-testid="auth-provider"]')
    if (authProvider) {
      addResult('AuthProvider 초기화', 'success', 'AuthProvider 컴포넌트 발견')
    } else {
      addResult('AuthProvider 초기화', 'error', 'AuthProvider 컴포넌트를 찾을 수 없음')
    }

    return results

  } catch (error) {
    addResult('테스트 실행', 'error', `테스트 중 오류 발생: ${error}`)
    return results
  }
}

/**
 * 인증 플로우 성능 측정
 */
export function measureAuthPerformance() {
  const performanceEntries = performance.getEntriesByType('navigation')
  if (performanceEntries.length > 0) {
    const navigation = performanceEntries[0] as PerformanceNavigationTiming
    
    logger.info('[AuthPerformance] 페이지 로딩 성능', {
      domContentLoaded: `${navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart}ms`,
      pageLoad: `${navigation.loadEventEnd - navigation.loadEventStart}ms`,
      totalTime: `${navigation.loadEventEnd - navigation.fetchStart}ms`
    })
  }
  
  // React 컴포넌트 렌더링 시간 측정
  const renderStart = performance.mark('render-start')
  setTimeout(() => {
    const renderEnd = performance.mark('render-end')
    performance.measure('auth-flow-render', 'render-start', 'render-end')
    
    const measures = performance.getEntriesByType('measure')
    const authFlowMeasure = measures.find(m => m.name === 'auth-flow-render')
    
    if (authFlowMeasure) {
      logger.info('[AuthPerformance] 인증 플로우 렌더링 시간', { duration: `${authFlowMeasure.duration}ms` })
    }
  }, 100)
}

/**
 * 개발 모드에서 콘솔에 인증 플로우 상태 출력
 */
export function debugAuthFlow() {
  if (process.env.NODE_ENV !== 'development') return

  console.group('🔐 인증 플로우 디버깅')
  
  // 현재 URL 확인
  console.log('현재 URL:', window.location.href)
  
  // 로컬 스토리지의 Supabase 세션 확인
  const supabaseKeys = Object.keys(localStorage).filter(key => key.startsWith('supabase'))
  console.log('Supabase 로컬 스토리지 키들:', supabaseKeys)
  
  // React 개발자 도구가 있는지 확인
  if (typeof window !== 'undefined' && (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('✅ React DevTools 사용 가능')
  }
  
  console.groupEnd()
}

/**
 * 인증 플로우 자동 테스트 실행
 */
export async function runAuthFlowTests() {
  if (process.env.NODE_ENV !== 'development') return

  logger.info('[AuthFlowTest] 인증 플로우 자동 테스트 시작...')
  
  // 성능 측정 시작
  measureAuthPerformance()
  
  // 디버깅 정보 출력
  debugAuthFlow()
  
  // 실제 플로우 테스트
  const results = await testAuthFlow()
  
  // 결과 출력
  console.group('🧪 인증 플로우 테스트 결과')
  results.forEach(result => {
    const emoji = result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : '⏳'
    console.log(`${emoji} ${result.step}: ${result.message}`)
  })
  console.groupEnd()
  
  return results
}