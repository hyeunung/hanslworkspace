import { useState, useCallback, useRef, useEffect } from 'react';
import { Purchase } from '@/types/purchase';
import { logger } from '@/lib/logger';

export interface ProgressiveLoadingState {
  isLoading: boolean;
  hasMore: boolean;
  loadedCount: number;
  totalCount: number;
  error: string | null;
  batchSize: number;
  currentBatch: number;
}

export interface UseProgressiveLoadingOptions {
  initialBatchSize?: number;
  maxBatchSize?: number;
  prefetchThreshold?: number; // 스크롤 끝에서 얼마나 떨어져서 프리페치할지 (0.8 = 80% 지점)
  enablePrefetch?: boolean;
}

export interface UseProgressiveLoadingResult {
  state: ProgressiveLoadingState;
  loadedData: Purchase[];
  loadMore: () => Promise<void>;
  reset: () => void;
  setData: (data: Purchase[]) => void;
  isNearEnd: boolean;
  loadingRef: React.RefObject<HTMLDivElement>;
}

export const useProgressiveLoading = (
  sourceData: Purchase[],
  options: UseProgressiveLoadingOptions = {}
): UseProgressiveLoadingResult => {
  const {
    initialBatchSize = 50,
    maxBatchSize = 200,
    prefetchThreshold = 0.8,
    enablePrefetch = true
  } = options;

  // 상태 관리
  const [state, setState] = useState<ProgressiveLoadingState>({
    isLoading: false,
    hasMore: true,
    loadedCount: 0,
    totalCount: sourceData.length,
    error: null,
    batchSize: initialBatchSize,
    currentBatch: 0
  });

  const [loadedData, setLoadedData] = useState<Purchase[]>([]);
  const [isNearEnd, setIsNearEnd] = useState(false);
  
  // 스크롤 감지를 위한 ref
  const loadingRef = useRef<HTMLDivElement>(null);
  const prefetchingRef = useRef<boolean>(false);

  // 데이터 소스가 변경될 때 상태 업데이트
  useEffect(() => {
    setState(prev => ({
      ...prev,
      totalCount: sourceData.length,
      hasMore: prev.loadedCount < sourceData.length
    }));
  }, [sourceData.length, state.loadedCount]);

  // 초기 데이터 로드
  useEffect(() => {
    if (sourceData.length > 0 && loadedData.length === 0) {
      loadInitialBatch();
    }
  }, [sourceData]);

  // 초기 배치 로드
  const loadInitialBatch = useCallback(() => {
    const initialData = sourceData.slice(0, initialBatchSize);
    setLoadedData(initialData);
    setState(prev => ({
      ...prev,
      loadedCount: initialData.length,
      hasMore: initialData.length < sourceData.length,
      currentBatch: 1,
      isLoading: false,
      error: null
    }));
  }, [sourceData, initialBatchSize]);

  // 더 많은 데이터 로드
  const loadMore = useCallback(async (): Promise<void> => {
    if (state.isLoading || !state.hasMore || sourceData.length === 0) {
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // 가상의 로딩 지연 (실제 API 호출 시뮬레이션)
      await new Promise(resolve => setTimeout(resolve, 300));

      const nextBatch = state.currentBatch;
      const startIndex = state.loadedCount;
      const endIndex = Math.min(startIndex + state.batchSize, sourceData.length);
      
      const newData = sourceData.slice(startIndex, endIndex);
      
      if (newData.length > 0) {
        setLoadedData(prev => [...prev, ...newData]);
        setState(prev => ({
          ...prev,
          loadedCount: prev.loadedCount + newData.length,
          hasMore: prev.loadedCount + newData.length < sourceData.length,
          currentBatch: prev.currentBatch + 1,
          isLoading: false,
          // 적응형 배치 크기 - 성능에 따라 조정
          batchSize: Math.min(prev.batchSize * 1.2, maxBatchSize)
        }));

        logger.debug(`점진적 로딩: ${newData.length}개 항목 추가 로드`, {
          total: startIndex + newData.length,
          batch: nextBatch + 1
        });
      } else {
        setState(prev => ({ ...prev, hasMore: false, isLoading: false }));
      }
    } catch (error) {
      logger.error('점진적 로딩 오류', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: '데이터를 불러오는 중 오류가 발생했습니다.'
      }));
    }
  }, [state, sourceData, maxBatchSize]);

  // 백그라운드 프리페칭
  const prefetchNext = useCallback(async () => {
    if (prefetchingRef.current || !enablePrefetch || !state.hasMore || state.isLoading) {
      return;
    }

    prefetchingRef.current = true;

    try {
      // 백그라운드에서 다음 배치 미리 준비
      const nextStartIndex = state.loadedCount;
      const nextEndIndex = Math.min(nextStartIndex + state.batchSize, sourceData.length);
      
      if (nextStartIndex < sourceData.length) {
        // 실제로는 데이터를 미리 가져오는 로직 (예: API 호출)
        // 여기서는 단순히 로그만 출력
        logger.debug('백그라운드 프리페칭 준비', {
          nextBatch: state.currentBatch + 1,
          range: [nextStartIndex, nextEndIndex]
        });
      }
    } catch (error) {
      logger.error('프리페칭 오류', error);
    } finally {
      prefetchingRef.current = false;
    }
  }, [state, sourceData, enablePrefetch]);

  // 스크롤 위치 감지
  useEffect(() => {
    if (!enablePrefetch || !loadingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const isVisible = entry.isIntersecting;
        const intersectionRatio = entry.intersectionRatio;

        setIsNearEnd(isVisible || intersectionRatio > prefetchThreshold);

        // 화면에 보이면 프리페칭 시작
        if (isVisible && state.hasMore) {
          prefetchNext();
        }
      },
      {
        threshold: [0, prefetchThreshold, 1],
        rootMargin: '100px' // 100px 전에 미리 감지
      }
    );

    observer.observe(loadingRef.current);

    return () => observer.disconnect();
  }, [enablePrefetch, prefetchThreshold, state.hasMore, prefetchNext]);

  // 데이터 재설정
  const reset = useCallback(() => {
    setLoadedData([]);
    setState({
      isLoading: false,
      hasMore: true,
      loadedCount: 0,
      totalCount: sourceData.length,
      error: null,
      batchSize: initialBatchSize,
      currentBatch: 0
    });
    setIsNearEnd(false);
    prefetchingRef.current = false;
  }, [sourceData.length, initialBatchSize]);

  // 외부에서 데이터 설정 (필터링 변경 시 등)
  const setData = useCallback((data: Purchase[]) => {
    setLoadedData(data);
    setState(prev => ({
      ...prev,
      loadedCount: data.length,
      totalCount: data.length,
      hasMore: false, // 외부에서 설정한 데이터는 모두 로드된 것으로 간주
      currentBatch: 1,
      isLoading: false,
      error: null
    }));
  }, []);

  return {
    state,
    loadedData,
    loadMore,
    reset,
    setData,
    isNearEnd,
    loadingRef
  };
};