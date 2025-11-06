import { memo, useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2, AlertCircle } from "lucide-react";
import { ProgressiveLoadingState } from '@/hooks/useProgressiveLoading';

interface ProgressiveLoadingIndicatorProps {
  state: ProgressiveLoadingState;
  onLoadMore: () => Promise<void>;
  isNearEnd?: boolean;
  className?: string;
  mode?: 'button' | 'auto' | 'both'; // 로딩 모드
}

const ProgressiveLoadingIndicator = memo<ProgressiveLoadingIndicatorProps>(({
  state,
  onLoadMore,
  isNearEnd = false,
  className = "",
  mode = 'both'
}) => {
  const [autoLoading, setAutoLoading] = useState(false);

  // 자동 로딩 감지
  useEffect(() => {
    if (mode !== 'button' && isNearEnd && state.hasMore && !state.isLoading && !autoLoading) {
      setAutoLoading(true);
      onLoadMore().finally(() => {
        setAutoLoading(false);
      });
    }
  }, [isNearEnd, state.hasMore, state.isLoading, autoLoading, onLoadMore, mode]);

  const getProgressPercentage = (): number => {
    if (state.totalCount === 0) return 0;
    return Math.min(100, Math.round((state.loadedCount / state.totalCount) * 100));
  };

  const getLoadingMessage = (): string => {
    if (state.isLoading) {
      return `데이터 로딩 중... (${state.loadedCount}/${state.totalCount})`;
    }
    
    if (!state.hasMore) {
      return `모든 데이터 로드 완료 (${state.totalCount}개)`;
    }

    const remaining = state.totalCount - state.loadedCount;
    return `${remaining.toLocaleString()}개 더 보기`;
  };

  const getBatchInfo = (): string => {
    const nextBatchSize = Math.min(state.batchSize, state.totalCount - state.loadedCount);
    return nextBatchSize > 0 ? `(다음: ${nextBatchSize}개)` : '';
  };

  // 로딩 중이거나 에러가 있을 때만 표시
  if (!state.hasMore && !state.isLoading && !state.error) {
    return null;
  }

  return (
    <div className={`flex flex-col items-center gap-3 py-6 ${className}`} ref={undefined}>
      {/* 진행률 표시 */}
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-2">
          <span className="card-description">
            {state.loadedCount.toLocaleString()} / {state.totalCount.toLocaleString()}
          </span>
          <span className="card-description">
            {getProgressPercentage()}%
          </span>
        </div>
        
        {/* 진행률 바 */}
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-hansl-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${getProgressPercentage()}%` }}
          />
        </div>
      </div>

      {/* 에러 표시 */}
      {state.error && (
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="w-4 h-4" />
          <span className="card-description">{state.error}</span>
        </div>
      )}

      {/* 로딩 상태 또는 더보기 버튼 */}
      {state.isLoading ? (
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-hansl-500" />
          <div className="text-center">
            <div className="card-subtitle">{getLoadingMessage()}</div>
            <div className="card-description">
              배치 {state.currentBatch} 로딩 중...
            </div>
          </div>
        </div>
      ) : state.hasMore && (mode === 'button' || mode === 'both') ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            onClick={onLoadMore}
            className="button-base border border-hansl-200 bg-white text-hansl-600 hover:bg-hansl-50 hover:border-hansl-300"
            disabled={state.isLoading}
          >
            <ChevronDown className="w-4 h-4 mr-2" />
            {getLoadingMessage()}
            <span className="ml-2 card-description">
              {getBatchInfo()}
            </span>
          </Button>
          
          {mode === 'both' && (
            <div className="card-description text-center">
              또는 스크롤하여 자동 로딩
            </div>
          )}
        </div>
      ) : null}

      {/* 자동 로딩 표시 */}
      {mode !== 'button' && state.hasMore && (
        <div className="card-description text-center">
          {isNearEnd ? '자동 로딩 중...' : '스크롤하여 더 보기'}
        </div>
      )}

      {/* 완료 메시지 */}
      {!state.hasMore && !state.isLoading && (
        <div className="text-center">
          <div className="card-subtitle text-green-600">
            ✅ 모든 데이터 로드 완료
          </div>
          <div className="card-description">
            총 {state.totalCount.toLocaleString()}개 항목을 {state.currentBatch}번의 배치로 로드
          </div>
        </div>
      )}
    </div>
  );
});

ProgressiveLoadingIndicator.displayName = 'ProgressiveLoadingIndicator';

export default ProgressiveLoadingIndicator;