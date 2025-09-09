import React, { ReactNode } from 'react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useLocation } from 'react-router-dom';

interface PullToRefreshWrapperProps {
  children: ReactNode;
}

export const PullToRefreshWrapper: React.FC<PullToRefreshWrapperProps> = ({ children }) => {
  const location = useLocation();
  
  const handleRefresh = async () => {
    // 현재 경로에 따라 다른 새로고침 동작 수행
    // 간단하게 페이지를 새로고침
    window.location.reload();
    
    // 또는 특정 경로에서 특정 동작을 수행하고 싶다면:
    // if (location.pathname.includes('/purchase')) {
    //   // 발주 데이터 새로고침
    // } else if (location.pathname.includes('/attendance')) {
    //   // 출퇴근 데이터 새로고침
    // }
  };
  
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
    maxPull: 150
  });

  return (
    <div className="relative min-h-screen">
      {/* Pull-to-Refresh Indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div 
          className="fixed top-0 left-0 right-0 flex justify-center items-center bg-gradient-to-b from-hansl-100 to-transparent z-[100] transition-all duration-300"
          style={{ 
            height: `${Math.min(pullDistance, 80)}px`,
            opacity: Math.min(pullDistance / 80, 1)
          }}
        >
          <div className="flex flex-col items-center">
            {isRefreshing ? (
              <>
                <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
                <span className="mt-2 text-sm text-hansl-600 font-medium">새로고침 중...</span>
              </>
            ) : (
              <>
                <svg 
                  className={`w-6 h-6 text-hansl-600 transition-transform duration-300 ${
                    pullDistance >= 80 ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="mt-1 text-xs text-hansl-600">
                  {pullDistance >= 80 ? '놓으면 새로고침' : '아래로 당기세요'}
                </span>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Main Content - Push down when pulling */}
      <div 
        className="transition-transform duration-200"
        style={{ 
          transform: `translateY(${Math.min(pullDistance, 80)}px)`
        }}
      >
        {children}
      </div>
    </div>
  );
};