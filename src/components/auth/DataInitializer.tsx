import { ReactNode, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { loadAllPurchaseData } from '@/services/purchaseDataLoader'
import { purchaseMemoryCache } from '@/stores/purchaseMemoryStore'
import { logger } from '@/lib/logger'
import InitialLoadingScreen from '@/components/common/InitialLoadingScreen'

interface DataInitializerProps {
  children: ReactNode
}

/**
 * 데이터 초기화 컴포넌트
 * - 인증 완료 후 애플리케이션 데이터를 초기화
 * - 데이터 로딩 중 로딩 화면 표시
 * - 로딩 완료 후 메인 애플리케이션 렌더링
 */
export default function DataInitializer({ children }: DataInitializerProps) {
  const { employee } = useAuth()
  const [dataLoading, setDataLoading] = useState(() => {
    // 더 정확한 초기 상태 결정: 캐시와 사용자 정보 모두 확인
    const hasCache = !!purchaseMemoryCache.allPurchases
    const isSameUser = purchaseMemoryCache.currentUser?.id === employee?.id
    const shouldLoad = !hasCache || !isSameUser
    
    logger.debug('[DataInitializer] Initial state calculation:', {
      hasCache,
      isSameUser,
      shouldLoad,
      employeeId: employee?.id,
      cachedUserId: purchaseMemoryCache.currentUser?.id
    })
    
    return shouldLoad
  })
  const [dataError, setDataError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const initializeAppData = async () => {
      if (!employee?.id) {
        setDataLoading(false)
        return
      }

      // 이미 데이터가 로드되어 있고 같은 사용자인 경우 스킵
      if (purchaseMemoryCache.allPurchases && 
          purchaseMemoryCache.currentUser?.id === employee.id) {
        logger.debug('[DataInitializer] Data already loaded for current user, skipping initialization')
        if (isMounted && dataLoading) {
          setDataLoading(false)
        }
        return
      }

      // 이미 로딩 중인 경우 스킵
      if (purchaseMemoryCache.isLoading) {
        logger.debug('[DataInitializer] Data loading already in progress')
        return
      }

      try {
        logger.info('[DataInitializer] Starting app data initialization...')
        setDataLoading(true)
        setDataError(null)
        purchaseMemoryCache.isLoading = true

        // 사용자 정보를 메모리 캐시에 설정
        purchaseMemoryCache.currentUser = employee

        // 구매 데이터 로드
        await loadAllPurchaseData(String(employee.id))

        if (isMounted) {
          setDataLoading(false)
          purchaseMemoryCache.isLoading = false
          logger.info('[DataInitializer] App data initialization completed')
        }
      } catch (error) {
        logger.error('[DataInitializer] Failed to initialize app data:', error)
        if (isMounted) {
          setDataError(error instanceof Error ? error.message : 'Unknown error')
          setDataLoading(false)
          purchaseMemoryCache.isLoading = false
        }
      }
    }

    initializeAppData()

    return () => {
      isMounted = false
    }
  }, [employee?.id, dataLoading])

  // 데이터 로딩 중 - 로고 포함된 로딩 화면
  if (dataLoading) {
    return <InitialLoadingScreen />
  }

  // 데이터 로딩 실패
  if (dataError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-6 h-6 text-red-600">⚠</div>
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">데이터 로딩 실패</h2>
          <p className="text-sm text-gray-600 mb-4">{dataError}</p>
          <button
            onClick={() => window.location.reload()}
            className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
          >
            새로고침
          </button>
        </div>
      </div>
    )
  }

  // 데이터 로딩 완료 - 메인 앱 렌더링
  return <>{children}</>
}