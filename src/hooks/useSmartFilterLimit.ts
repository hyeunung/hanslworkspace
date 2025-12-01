import { useState, useCallback, useMemo } from 'react';
import { Purchase } from '@/types/purchase';
import { FilterRule } from '@/components/purchase/FilterToolbar';

export interface SmartFilterLimitConfig {
  maxResults: number;
  warningThreshold: number; // 경고 표시할 개수 임계값
  enableAutoLimit: boolean;
}

export interface SmartFilterLimitResult {
  limitedData: Purchase[];
  totalCount: number;
  displayedCount: number;
  isLimited: boolean;
  isOverThreshold: boolean;
  limitConfig: SmartFilterLimitConfig;
  setLimitConfig: (config: Partial<SmartFilterLimitConfig>) => void;
  getLimitMessage: () => string;
  getWarningMessage: () => string | null;
  shouldShowWarning: boolean;
  resetLimit: () => void;
}

const DEFAULT_CONFIG: SmartFilterLimitConfig = {
  maxResults: 500,
  warningThreshold: 300,
  enableAutoLimit: true
};

export const useSmartFilterLimit = (
  sourceData: Purchase[],
  hasActiveFilters: boolean,
  activeFilters: FilterRule[] = [],
  searchTerm: string = ''
): SmartFilterLimitResult => {
  
  const [limitConfig, setLimitConfigState] = useState<SmartFilterLimitConfig>(DEFAULT_CONFIG);

  // 필터가 활성화된 경우에만 제한 적용
  const shouldApplyLimit = useMemo(() => {
    return limitConfig.enableAutoLimit && hasActiveFilters && (
      activeFilters.length > 0 || 
      searchTerm.trim().length > 0
    );
  }, [limitConfig.enableAutoLimit, hasActiveFilters, activeFilters.length, searchTerm]);

  // 제한된 데이터 계산
  const limitedData = useMemo(() => {
    if (!shouldApplyLimit) {
      return sourceData;
    }

    if (sourceData.length <= limitConfig.maxResults) {
      return sourceData;
    }

    // 최신순으로 정렬된 상위 데이터만 반환
    return sourceData.slice(0, limitConfig.maxResults);
  }, [sourceData, shouldApplyLimit, limitConfig.maxResults]);

  // 상태 계산
  const totalCount = sourceData.length;
  const displayedCount = limitedData.length;
  const isLimited = shouldApplyLimit && totalCount > limitConfig.maxResults;
  const isOverThreshold = totalCount > limitConfig.warningThreshold;
  const shouldShowWarning = shouldApplyLimit && isOverThreshold;

  // 제한 메시지 생성
  const getLimitMessage = useCallback((): string => {
    if (!isLimited) {
      return `${totalCount.toLocaleString()}개 항목`;
    }

    const hiddenCount = totalCount - displayedCount;
    return `${displayedCount.toLocaleString()}개 표시 (${hiddenCount.toLocaleString()}개 숨김)`;
  }, [isLimited, totalCount, displayedCount]);

  // 경고 메시지 생성
  const getWarningMessage = useCallback((): string | null => {
    if (!shouldShowWarning) {
      return null;
    }

    if (isLimited) {
      const hiddenCount = totalCount - displayedCount;
      return `검색 결과가 많습니다. 성능을 위해 상위 ${displayedCount.toLocaleString()}개만 표시합니다. ${hiddenCount.toLocaleString()}개 항목이 숨겨졌습니다.`;
    }

    if (totalCount > limitConfig.warningThreshold && totalCount <= limitConfig.maxResults) {
      return `검색 결과가 ${totalCount.toLocaleString()}개입니다. 성능을 위해 더 구체적인 필터를 사용하는 것을 권장합니다.`;
    }

    return null;
  }, [shouldShowWarning, isLimited, totalCount, displayedCount, limitConfig.warningThreshold, limitConfig.maxResults]);

  // 설정 업데이트
  const setLimitConfig = useCallback((newConfig: Partial<SmartFilterLimitConfig>) => {
    setLimitConfigState(prev => ({ ...prev, ...newConfig }));
  }, []);

  // 제한 재설정
  const resetLimit = useCallback(() => {
    setLimitConfigState(DEFAULT_CONFIG);
  }, []);

  return {
    limitedData,
    totalCount,
    displayedCount,
    isLimited,
    isOverThreshold,
    limitConfig,
    setLimitConfig,
    getLimitMessage,
    getWarningMessage,
    shouldShowWarning,
    resetLimit
  };
};

// 필터가 활성화되었는지 감지하는 유틸리티 함수
export const hasActiveFiltersDetected = (
  activeFilters: FilterRule[],
  searchTerm: string,
  selectedEmployee?: string
): boolean => {
  return (
    activeFilters.length > 0 ||
    searchTerm.trim().length > 0 ||
    Boolean(selectedEmployee && selectedEmployee !== 'all' && selectedEmployee !== '전체')
  );
};