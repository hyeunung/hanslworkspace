import { ReactNode, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { loadAllPurchaseData } from '@/services/purchaseDataLoader'
import { purchaseMemoryCache } from '@/stores/purchaseMemoryStore'
import { purchaseRealtimeService } from '@/services/purchaseRealtimeService'
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
  
  // 데이터가 이미 메모리에 있는지 확인
  const hasDataInCache = !!purchaseMemoryCache.allPurchases && 
                         purchaseMemoryCache.allPurchases.length > 0 &&
                         employee?.id &&
                         purchaseMemoryCache.currentUser?.id === String(employee.id)
  
  // 데이터가 이미 있으면 로딩 상태를 false로 시작
  const [dataLoading, setDataLoading] = useState(!hasDataInCache)
  const [dataError, setDataError] = useState<string | null>(null)

  // 데이터가 이미 로드되었는지 확인하고 로딩 상태 해제
  useEffect(() => {
    if (dataLoading && purchaseMemoryCache.allPurchases && purchaseMemoryCache.allPurchases.length > 0) {
      // 현재 사용자의 데이터인지 확인
      if (employee?.id && purchaseMemoryCache.currentUser?.id === String(employee.id)) {
        setDataLoading(false)
      }
    }
  }, [dataLoading, employee?.id])

  useEffect(() => {
    let isMounted = true

    const initializeAppData = async (force = false) => {
      // employee가 없으면 대기
      if (!employee?.id) {
        return
      }

      // 강제 로딩이 아니고 이미 데이터가 있으면 스킵
      const hasExistingData = !force && purchaseMemoryCache.allPurchases && 
                              purchaseMemoryCache.allPurchases.length > 0 &&
                              purchaseMemoryCache.currentUser?.id === String(employee.id)
      
      if (hasExistingData) {
        // 데이터가 이미 있으면 로딩 상태를 설정하지 않음
        return
      }

      // 이미 로딩 중인 경우 스킵
      if (purchaseMemoryCache.isLoading) {
        return
      }

      try {
        // 데이터가 없을 때만 로딩 상태 설정
        if (isMounted) {
          setDataLoading(true)
          setDataError(null)
        }
        
        purchaseMemoryCache.isLoading = true
        purchaseMemoryCache.currentUser = employee

        // 구매 데이터 로드
        await loadAllPurchaseData(String(employee.id))

        // 데이터 로딩 완료 - 언마운트 여부와 관계없이 상태 업데이트
        const hasData = !!purchaseMemoryCache.allPurchases && purchaseMemoryCache.allPurchases.length > 0
        
        if (hasData) {
        if (isMounted) {
          setDataLoading(false)
          } else {
            // 언마운트되었지만 데이터는 로드됨 - 약간의 지연 후 상태 업데이트 시도
            setTimeout(() => {
              setDataLoading(false)
            }, 100)
          }
        } else {
          if (isMounted) {
            setDataLoading(false)
            logger.warn('[DataInitializer] Initialization completed but no data loaded')
          }
        }
      } catch (error) {
        logger.error('[DataInitializer] Initialization failed:', error)
        if (isMounted) {
          setDataError(error instanceof Error ? error.message : 'Unknown error')
          setDataLoading(false)
        }
      } finally {
        purchaseMemoryCache.isLoading = false
      }
    }

    // employee가 있을 때만 초기화 실행
    if (employee?.id) {
      // Realtime 구독 상태 보장
      purchaseRealtimeService.ensureSubscribed()
      initializeAppData()
    }

    return () => {
      isMounted = false
    }
  }, [employee?.id])

  // children은 항상 동일한 fragment 위치(index 0)에 두어 React reconciliation이
  // remount하지 않도록 한다. 로딩 화면/에러 화면은 그 뒤에 조건부 오버레이로 추가.
  // (이전 구현은 로딩 상태에 따라 children의 fragment 인덱스가 바뀌어, 데이터 로드 완료 시
  //  AppLayout 전체가 unmount → remount 되며 자식 컴포넌트 state가 모두 날아감)
  return (
    <>
      {children}
      {dataLoading && !hasDataInCache && <InitialLoadingScreen />}
      {dataError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50">
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
      )}
    </>
  )
}