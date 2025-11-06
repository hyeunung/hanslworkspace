import React, { memo, useMemo, useRef } from 'react';
import { Purchase } from '@/hooks/usePurchaseData';
import LazyPurchaseTable from './LazyPurchaseTable';
import VirtualizedPurchaseTable, { VirtualizedTableHandle } from './VirtualizedPurchaseTable';
import { Button } from '@/components/ui/button';
import { Zap, Table, ArrowUp } from 'lucide-react';
import { logger } from '@/lib/logger';

interface AdaptiveTableWrapperProps {
  purchases: Purchase[];
  activeTab: string;
  currentUserRoles: string[];
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => Promise<void> | void;
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void;
  onPaymentComplete?: (id: number) => Promise<void>;
  onReceiptComplete?: (id: number) => Promise<void>;
  
  // 가상화 설정
  virtualizationThreshold?: number; // 이 개수 이상일 때 가상화 사용
  forceVirtualization?: boolean;    // 강제로 가상화 사용
  forceTraditional?: boolean;       // 강제로 전통적 테이블 사용
  virtualizedHeight?: number;       // 가상화 테이블 높이
}

const AdaptiveTableWrapper = memo<AdaptiveTableWrapperProps>(({
  purchases,
  activeTab,
  currentUserRoles,
  onRefresh,
  onOptimisticUpdate,
  onPaymentComplete,
  onReceiptComplete,
  virtualizationThreshold = 200,
  forceVirtualization = false,
  forceTraditional = false,
  virtualizedHeight = 600
}) => {
  
  const virtualTableRef = useRef<VirtualizedTableHandle>(null);

  // 원래 가상화 사용 여부 결정 (현재는 사용 안함 - 디자인 일관성 유지)
  const shouldUseVirtualization = useMemo(() => {
    // 임시로 가상화 비활성화 - 디자인 일관성 문제로 기존 FastPurchaseTable 사용
    return false;
    
    // if (forceTraditional) return false;
    // if (forceVirtualization) return true;
    
    // // 데이터 양 기반 자동 결정
    // const useVirtualization = purchases.length >= virtualizationThreshold;
    
    // if (useVirtualization) {
    //   logger.info('가상화 테이블 활성화', {
    //     itemCount: purchases.length,
    //     threshold: virtualizationThreshold,
    //     activeTab
    //   });
    // }
    
    // return useVirtualization;
  }, [purchases.length, virtualizationThreshold, forceVirtualization, forceTraditional, activeTab]);

  // 성능 메트릭 계산
  const performanceStats = useMemo(() => {
    const itemCount = purchases.length;
    // 모든 테이블이 동일한 FastPurchaseTable 사용
    const estimatedMemoryMB = Math.ceil(itemCount * 0.1);  // 전통적 테이블 메모리 사용량
    
    const estimatedRenderTime = itemCount > 1000 ? '> 2s' : 
                              itemCount > 500 ? '> 1s' : '< 500ms';
    
    return {
      itemCount,
      estimatedMemoryMB,
      estimatedRenderTime,
      mode: 'traditional' // 모든 테이블이 전통적 방식
    };
  }, [purchases.length]);

  // 맨 위로 스크롤
  const scrollToTop = () => {
    if (shouldUseVirtualization) {
      virtualTableRef.current?.scrollToTop();
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-3">
      {/* 성능 정보 표시 (개발 모드 또는 많은 데이터일 때) */}
      {(process.env.NODE_ENV === 'development' || purchases.length > 100) && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-3">
            {shouldUseVirtualization ? (
              <Zap className="w-4 h-4 text-blue-500" />
            ) : (
              <Table className="w-4 h-4 text-blue-500" />
            )}
            
            <div className="text-sm">
              <div className="font-medium text-blue-800">
                {shouldUseVirtualization ? '🚀 고성능 가상화 모드' : '📋 표준 테이블 모드'}
              </div>
              <div className="text-blue-600 text-xs mt-1">
                {performanceStats.itemCount.toLocaleString()}개 항목 • 
                예상 메모리: {performanceStats.estimatedMemoryMB}MB • 
                렌더링: {performanceStats.estimatedRenderTime}
              </div>
            </div>
          </div>

          {shouldUseVirtualization && purchases.length > 20 && (
            <Button
              onClick={scrollToTop}
              className="button-base border border-blue-300 bg-white text-blue-600 hover:bg-blue-50"
            >
              <ArrowUp className="w-4 h-4 mr-1" />
              맨위로
            </Button>
          )}
        </div>
      )}

      {/* 실제 테이블 렌더링 - 가상화 사용하지 않고 기존 디자인 유지 */}
      {shouldUseVirtualization ? (
        <LazyPurchaseTable
          purchases={purchases}
          activeTab={activeTab}
          currentUserRoles={currentUserRoles}
          onRefresh={onRefresh}
          onOptimisticUpdate={onOptimisticUpdate}
          onPaymentComplete={onPaymentComplete}
          onReceiptComplete={onReceiptComplete}
        />
      ) : (
        <LazyPurchaseTable
          purchases={purchases}
          activeTab={activeTab}
          currentUserRoles={currentUserRoles}
          onRefresh={onRefresh}
          onOptimisticUpdate={onOptimisticUpdate}
          onPaymentComplete={onPaymentComplete}
          onReceiptComplete={onReceiptComplete}
        />
      )}

      {/* 성능 팁 (많은 데이터일 때) */}
      {purchases.length > 1000 && !shouldUseVirtualization && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-yellow-800 mb-1">
                성능 최적화 권장
              </div>
              <div className="text-yellow-700">
                {purchases.length.toLocaleString()}개의 항목이 있습니다. 
                더 나은 성능을 위해 필터를 사용하여 결과를 줄이거나 가상화 모드를 활성화하는 것을 권장합니다.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 개발 모드 성능 정보 */}
      {process.env.NODE_ENV === 'development' && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">
            개발 정보 (성능 메트릭)
          </summary>
          <div className="mt-2 space-y-1 ml-4">
            <div>모드: {performanceStats.mode}</div>
            <div>항목 수: {performanceStats.itemCount.toLocaleString()}</div>
            <div>예상 메모리: {performanceStats.estimatedMemoryMB}MB</div>
            <div>예상 렌더링 시간: {performanceStats.estimatedRenderTime}</div>
            <div>가상화 임계값: {virtualizationThreshold.toLocaleString()}</div>
            <div>활성 탭: {activeTab}</div>
          </div>
        </details>
      )}
    </div>
  );
});

AdaptiveTableWrapper.displayName = 'AdaptiveTableWrapper';

export default AdaptiveTableWrapper;