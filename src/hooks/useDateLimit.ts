import { useState, useCallback, useMemo } from 'react';

export interface DateLimitOption {
  key: string;
  label: string;
  days: number | null; // null = 전체
  description: string;
}

// 날짜 제한 옵션들
export const DATE_LIMIT_OPTIONS: DateLimitOption[] = [
  { key: '30d', label: '최근 30일', days: 30, description: '최근 30일간 데이터' },
  { key: '60d', label: '최근 60일', days: 60, description: '최근 60일간 데이터' },
  { key: '90d', label: '최근 90일', days: 90, description: '최근 90일간 데이터' },
  { key: '180d', label: '최근 180일', days: 180, description: '최근 180일간 데이터' },
  { key: 'all', label: '전체', days: null, description: '모든 데이터' }
];

export interface UseDateLimitResult {
  currentLimit: DateLimitOption;
  setDateLimit: (option: DateLimitOption) => void;
  getNextLimit: () => DateLimitOption | null;
  hasNextLimit: boolean;
  isFullyLoaded: boolean;
  getDateThreshold: () => string | null;
  getTotalCountMessage: (totalCount: number, filteredCount: number) => string;
}

export const useDateLimit = (initialLimit: string = '60d'): UseDateLimitResult => {
  const [currentLimitKey, setCurrentLimitKey] = useState(initialLimit);

  // 현재 제한 옵션
  const currentLimit = useMemo(() => {
    return DATE_LIMIT_OPTIONS.find(opt => opt.key === currentLimitKey) || DATE_LIMIT_OPTIONS[0];
  }, [currentLimitKey]);

  // 다음 제한 옵션 계산
  const getNextLimit = useCallback((): DateLimitOption | null => {
    const currentIndex = DATE_LIMIT_OPTIONS.findIndex(opt => opt.key === currentLimitKey);
    const nextIndex = currentIndex + 1;
    return nextIndex < DATE_LIMIT_OPTIONS.length ? DATE_LIMIT_OPTIONS[nextIndex] : null;
  }, [currentLimitKey]);

  // 날짜 임계값 계산 (ISO 형식)
  const getDateThreshold = useCallback((): string | null => {
    if (!currentLimit.days) return null;
    
    const now = new Date();
    const threshold = new Date(now.getTime() - currentLimit.days * 24 * 60 * 60 * 1000);
    return threshold.toISOString().split('T')[0];
  }, [currentLimit]);

  // 제한 설정
  const setDateLimit = useCallback((option: DateLimitOption) => {
    setCurrentLimitKey(option.key);
  }, []);

  // 다음 제한이 있는지 확인
  const hasNextLimit = useMemo(() => {
    return getNextLimit() !== null;
  }, [getNextLimit]);

  // 완전히 로드되었는지 (전체 모드인지)
  const isFullyLoaded = useMemo(() => {
    return currentLimit.days === null;
  }, [currentLimit]);

  // 총 개수 메시지 생성
  const getTotalCountMessage = useCallback((totalCount: number, filteredCount: number): string => {
    if (isFullyLoaded) {
      return `총 ${totalCount.toLocaleString()}개`;
    }
    
    if (totalCount === filteredCount) {
      return `${currentLimit.label} (${filteredCount.toLocaleString()}개)`;
    }
    
    return `${currentLimit.label} (${filteredCount.toLocaleString()}개 / 전체 ${totalCount.toLocaleString()}개+)`;
  }, [currentLimit, isFullyLoaded]);

  return {
    currentLimit,
    setDateLimit,
    getNextLimit,
    hasNextLimit,
    isFullyLoaded,
    getDateThreshold,
    getTotalCountMessage
  };
};

// 날짜 기준으로 데이터 필터링하는 유틸리티 함수
export const filterByDateLimit = <T extends { request_date: string }>(
  data: T[],
  threshold: string | null
): T[] => {
  if (!threshold) return data;
  
  return data.filter(item => {
    const itemDate = item.request_date?.split('T')[0];
    return itemDate && itemDate >= threshold;
  });
};