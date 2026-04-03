import { useState, useEffect, useRef, useCallback } from 'react'
import { serverSearchPurchases } from '@/services/purchaseServerSearch'
import { logger } from '@/lib/logger'
import type { Purchase } from '@/types/purchase'

const DEBOUNCE_MS = 300
const MIN_SEARCH_LENGTH = 2

interface UseServerSearchReturn {
  serverResults: Purchase[]
  isSearching: boolean
  hasSearchedServer: boolean
  serverSearchError: string | null
}

/**
 * 서버 폴백 검색 훅
 * 메모리 검색 결과가 0건이고 검색어가 있을 때 자동으로 서버 검색
 */
export function useServerSearch(
  searchTerm: string,
  memoryResultCount: number,
  activeTab: string
): UseServerSearchReturn {
  const [serverResults, setServerResults] = useState<Purchase[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearchedServer, setHasSearchedServer] = useState(false)
  const [serverSearchError, setServerSearchError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    // 검색어가 없거나 짧으면 초기화
    if (!searchTerm || searchTerm.trim().length < MIN_SEARCH_LENGTH) {
      cleanup()
      setServerResults([])
      setIsSearching(false)
      setHasSearchedServer(false)
      setServerSearchError(null)
      return
    }

    // 메모리에 결과가 있으면 서버 검색 불필요
    if (memoryResultCount > 0) {
      cleanup()
      setServerResults([])
      setIsSearching(false)
      setHasSearchedServer(false)
      setServerSearchError(null)
      return
    }

    // 이전 요청 취소
    cleanup()

    // debounce 후 서버 검색 시작
    setIsSearching(true)
    setHasSearchedServer(false)
    setServerSearchError(null)

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        logger.debug(`[useServerSearch] Starting server search: "${searchTerm}"`)
        const results = await serverSearchPurchases(searchTerm, controller.signal)

        if (!controller.signal.aborted) {
          setServerResults(results)
          setHasSearchedServer(true)
          setIsSearching(false)
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return

        if (!controller.signal.aborted) {
          logger.error('[useServerSearch] Server search failed:', error)
          setServerSearchError(
            error instanceof Error ? error.message : '서버 검색 실패'
          )
          setHasSearchedServer(true)
          setIsSearching(false)
        }
      }
    }, DEBOUNCE_MS)

    return cleanup
  }, [searchTerm, memoryResultCount, cleanup])

  // 탭 변경 시 서버 결과 초기화
  useEffect(() => {
    cleanup()
    setServerResults([])
    setIsSearching(false)
    setHasSearchedServer(false)
    setServerSearchError(null)
  }, [activeTab, cleanup])

  return {
    serverResults,
    isSearching,
    hasSearchedServer,
    serverSearchError,
  }
}
