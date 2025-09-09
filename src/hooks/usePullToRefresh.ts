import { useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

export const usePullToRefresh = ({
  onRefresh,
  threshold = 80,
  maxPull = 150
}: UsePullToRefreshOptions) => {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    let touchStartHandler: (e: TouchEvent) => void;
    let touchMoveHandler: (e: TouchEvent) => void;
    let touchEndHandler: () => void;

    // 터치 시작
    touchStartHandler = (e: TouchEvent) => {
      // 스크롤이 맨 위에 있을 때만 pull-to-refresh 활성화
      if (window.scrollY === 0) {
        startY.current = e.touches[0].clientY;
        setIsPulling(true);
      }
    };

    // 터치 이동
    touchMoveHandler = (e: TouchEvent) => {
      if (!isPulling || isRefreshing) return;

      currentY.current = e.touches[0].clientY;
      const distance = currentY.current - startY.current;

      if (distance > 0) {
        // 아래로 당기는 경우만
        e.preventDefault(); // 기본 스크롤 방지
        const actualDistance = Math.min(distance, maxPull);
        setPullDistance(actualDistance);
      }
    };

    // 터치 종료
    touchEndHandler = async () => {
      if (!isPulling) return;

      setIsPulling(false);

      if (pullDistance >= threshold && !isRefreshing) {
        // 새로고침 실행
        setIsRefreshing(true);
        setPullDistance(threshold); // 로딩 상태 동안 위치 고정
        
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        // 임계값 미달 시 원위치
        setPullDistance(0);
      }
    };

    // 이벤트 리스너 등록
    document.addEventListener('touchstart', touchStartHandler, { passive: false });
    document.addEventListener('touchmove', touchMoveHandler, { passive: false });
    document.addEventListener('touchend', touchEndHandler);

    // 클린업
    return () => {
      document.removeEventListener('touchstart', touchStartHandler);
      document.removeEventListener('touchmove', touchMoveHandler);
      document.removeEventListener('touchend', touchEndHandler);
    };
  }, [isPulling, pullDistance, isRefreshing, onRefresh, threshold, maxPull]);

  return {
    pullDistance,
    isRefreshing,
    isPulling
  };
};