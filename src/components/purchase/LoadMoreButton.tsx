import { memo, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronDown, Calendar, RotateCcw, Zap } from "lucide-react";
import { DateLimitOption } from '@/hooks/useDateLimit';
import ProgressiveLoadingIndicator from './ProgressiveLoadingIndicator';
import { ProgressiveLoadingState } from '@/hooks/useProgressiveLoading';

interface LoadMoreButtonProps {
  currentLimit: DateLimitOption;
  nextLimit: DateLimitOption | null;
  totalCount: number;
  displayedCount: number;
  hasNextLimit: boolean;
  isFullyLoaded: boolean;
  onLoadMore: (nextLimit: DateLimitOption) => void;
  onReset?: () => void;
  className?: string;
  
  // 점진적 로딩 관련 (선택적)
  progressiveState?: ProgressiveLoadingState;
  onProgressiveLoadMore?: () => Promise<void>;
  enableProgressive?: boolean;
  isNearEnd?: boolean;
}

const LoadMoreButton = memo<LoadMoreButtonProps>(({
  currentLimit,
  nextLimit,
  totalCount,
  displayedCount,
  hasNextLimit,
  isFullyLoaded,
  onLoadMore,
  onReset,
  className = "",
  
  // 점진적 로딩 관련
  progressiveState,
  onProgressiveLoadMore,
  enableProgressive = false,
  isNearEnd = false
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleLoadMore = async () => {
    if (!nextLimit || isLoading) return;
    
    setIsLoading(true);
    try {
      onLoadMore(nextLimit);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    if (!onReset || isLoading) return;
    
    setIsLoading(true);
    try {
      onReset();
    } finally {
      setIsLoading(false);
    }
  };

  // 표시할 추가 데이터 개수 계산 (추정치)
  const getEstimatedAdditionalCount = (): string => {
    if (isFullyLoaded) return '';
    
    if (displayedCount === totalCount) {
      return '더 많은 데이터';
    }
    
    const remaining = Math.max(0, totalCount - displayedCount);
    return `+${remaining.toLocaleString()}개+`;
  };

  // 점진적 로딩이 활성화된 경우 전용 컴포넌트 사용
  if (enableProgressive && progressiveState && onProgressiveLoadMore) {
    return (
      <div className={className}>
        <ProgressiveLoadingIndicator
          state={progressiveState}
          onLoadMore={onProgressiveLoadMore}
          isNearEnd={isNearEnd}
          mode="both"
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-3 py-6 ${className}`}>
      {/* 날짜 제한 모드 표시 */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="card-subtitle">
            {isFullyLoaded 
              ? `전체 ${totalCount.toLocaleString()}개 표시중`
              : `${currentLimit.label} (${displayedCount.toLocaleString()}개)`
            }
          </span>
          
          {/* 점진적 로딩 가능 표시 */}
          {isFullyLoaded && totalCount > 100 && (
            <div className="flex items-center gap-1 ml-2">
              <Zap className="w-3 h-3 text-hansl-500" />
              <span className="card-description text-hansl-600">스마트 로딩</span>
            </div>
          )}
        </div>
        
        {/* 추가 데이터 정보 */}
        {!isFullyLoaded && (
          <div className="card-description">
            {displayedCount < totalCount && (
              <span>전체 {totalCount.toLocaleString()}개 중 일부 표시</span>
            )}
            {displayedCount === totalCount && hasNextLimit && (
              <span>이전 데이터가 더 있을 수 있습니다</span>
            )}
          </div>
        )}
      </div>

      {/* 버튼들 */}
      <div className="flex items-center gap-2">
        {/* 더보기 버튼 */}
        {hasNextLimit && !isFullyLoaded && (
          <Button
            onClick={handleLoadMore}
            disabled={isLoading}
            className="button-base border border-hansl-200 bg-white text-hansl-600 hover:bg-hansl-50 hover:border-hansl-300"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin mr-2" />
            ) : (
              <ChevronDown className="w-4 h-4 mr-2" />
            )}
            {nextLimit?.label} 보기
            {hasNextLimit && (
              <span className="ml-2 card-description">
                {getEstimatedAdditionalCount()}
              </span>
            )}
          </Button>
        )}

        {/* 초기화 버튼 (30일이 아닐 때만 표시) */}
        {!isLoading && currentLimit.key !== '30d' && onReset && (
          <Button
            onClick={handleReset}
            className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            30일로 돌아가기
          </Button>
        )}
      </div>

      {/* 로딩 상태에서의 추가 정보 */}
      {isLoading && (
        <div className="text-center">
          <div className="card-description">데이터를 불러오는 중...</div>
        </div>
      )}
    </div>
  );
});

LoadMoreButton.displayName = 'LoadMoreButton';

export default LoadMoreButton;