import { memo, useState } from 'react';
import { AlertTriangle, Settings, X, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SmartFilterLimitResult } from '@/hooks/useSmartFilterLimit';

interface SmartFilterWarningProps {
  smartFilter: SmartFilterLimitResult;
  className?: string;
  onConfigChange?: () => void;
}

const SmartFilterWarning = memo<SmartFilterWarningProps>(({
  smartFilter,
  className = "",
  onConfigChange
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const warningMessage = smartFilter.getWarningMessage();

  // 경고가 없거나 사용자가 닫았으면 표시하지 않음
  if (!warningMessage || isDismissed) {
    return null;
  }

  const getWarningLevel = (): 'info' | 'warning' | 'error' => {
    if (smartFilter.isLimited) return 'error';
    if (smartFilter.isOverThreshold) return 'warning';
    return 'info';
  };

  const getWarningStyles = () => {
    const level = getWarningLevel();
    switch (level) {
      case 'error':
        return {
          containerClass: 'bg-red-50 border-red-200',
          iconClass: 'text-red-500',
          textClass: 'text-red-800',
          badgeClass: 'badge-danger'
        };
      case 'warning':
        return {
          containerClass: 'bg-yellow-50 border-yellow-200',
          iconClass: 'text-yellow-500',
          textClass: 'text-yellow-800',
          badgeClass: 'badge-warning'
        };
      default:
        return {
          containerClass: 'bg-blue-50 border-blue-200',
          iconClass: 'text-blue-500',
          textClass: 'text-blue-800',
          badgeClass: 'badge-primary'
        };
    }
  };

  const styles = getWarningStyles();

  return (
    <div className={`rounded-lg border p-4 ${styles.containerClass} ${className}`}>
      <div className="flex items-start gap-3">
        {/* 경고 아이콘 */}
        <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${styles.iconClass}`} />
        
        {/* 메시지 내용 */}
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${styles.textClass} mb-2`}>
            스마트 필터 알림
          </div>
          
          <div className={`text-sm ${styles.textClass} mb-3`}>
            {warningMessage}
          </div>
          
          {/* 상태 정보 */}
          <div className="flex items-center gap-3 mb-3">
            <span className={`badge-stats ${styles.badgeClass}`}>
              {smartFilter.getLimitMessage()}
            </span>
            
            {smartFilter.isLimited && (
              <span className="badge-stats bg-gray-500 text-white">
                제한 모드: {smartFilter.limitConfig.maxResults.toLocaleString()}개
              </span>
            )}
          </div>

          {/* 상세 정보 토글 */}
          <div className="mb-3">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`inline-flex items-center gap-2 text-xs ${styles.textClass} hover:underline`}
            >
              {showDetails ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showDetails ? '상세 정보 숨기기' : '상세 정보 보기'}
            </button>
          </div>

          {/* 상세 정보 */}
          {showDetails && (
            <div className={`text-xs ${styles.textClass} bg-white/50 rounded p-3 mb-3 space-y-2`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="font-medium">총 검색 결과:</span>
                  <span className="ml-2">{smartFilter.totalCount.toLocaleString()}개</span>
                </div>
                <div>
                  <span className="font-medium">표시된 항목:</span>
                  <span className="ml-2">{smartFilter.displayedCount.toLocaleString()}개</span>
                </div>
                <div>
                  <span className="font-medium">제한 임계값:</span>
                  <span className="ml-2">{smartFilter.limitConfig.maxResults.toLocaleString()}개</span>
                </div>
                <div>
                  <span className="font-medium">경고 임계값:</span>
                  <span className="ml-2">{smartFilter.limitConfig.warningThreshold.toLocaleString()}개</span>
                </div>
              </div>
              
              <div className="pt-2 border-t border-white/20">
                <span className="font-medium">권장 사항:</span>
                <ul className="mt-1 space-y-1 list-disc list-inside ml-2">
                  <li>더 구체적인 검색어를 사용하세요</li>
                  <li>날짜 범위를 좁혀보세요</li>
                  <li>추가 필터를 적용하여 결과를 줄이세요</li>
                  {smartFilter.isLimited && (
                    <li>모든 결과를 보려면 더 구체적인 조건을 설정하세요</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* 액션 버튼들 */}
          <div className="flex items-center gap-2">
            {onConfigChange && (
              <Button
                onClick={onConfigChange}
                size="sm"
                className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                <Settings className="w-4 h-4 mr-2" />
                설정
              </Button>
            )}
            
            {smartFilter.isLimited && (
              <Button
                onClick={() => smartFilter.setLimitConfig({ enableAutoLimit: false })}
                size="sm"
                className={`button-base border ${styles.iconClass.includes('red') ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-yellow-300 text-yellow-600 hover:bg-yellow-50'}`}
              >
                제한 해제
              </Button>
            )}
          </div>
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={() => setIsDismissed(true)}
          className={`p-1 hover:bg-white/20 rounded transition-colors ${styles.iconClass}`}
          aria-label="경고 닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

SmartFilterWarning.displayName = 'SmartFilterWarning';

export default SmartFilterWarning;