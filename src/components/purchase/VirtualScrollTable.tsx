import React, { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Purchase } from '@/types/purchase';
import { ColumnVisibility } from '@/types/columnSettings';

interface VirtualScrollTableProps {
  purchases: Purchase[];
  activeTab?: string;
  onRowClick: (purchase: Purchase) => void;
  isLeadBuyer?: boolean;
  onPaymentComplete?: (purchaseId: number) => Promise<void>;
  onReceiptComplete?: (purchaseId: number) => Promise<void>;
  onExcelDownload?: (purchase: Purchase) => Promise<void>;
  columnVisibility?: ColumnVisibility;
  vendorColumnWidth?: number;
  tableHeader: React.ReactNode;
  TableRowComponent: React.ComponentType<any>;
  height?: number;
  shouldUseFitLayout?: boolean;
  currentUserRoles?: string[];
}

const ITEM_HEIGHT = 30; // 각 행의 고정 높이 (기존 py-1.5 + 텍스트 높이)
const BUFFER_SIZE = 5; // 화면 위아래로 추가로 렌더링할 항목 수

const VirtualScrollTable = memo<VirtualScrollTableProps>(({
  purchases,
  activeTab,
  onRowClick,
  isLeadBuyer,
  onPaymentComplete,
  onReceiptComplete,
  onExcelDownload,
  columnVisibility,
  vendorColumnWidth,
  tableHeader,
  TableRowComponent,
  height = 600,
  shouldUseFitLayout = false,
  currentUserRoles
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(height);
  
  // 동적 화면 높이 계산
  const [dynamicHeight, setDynamicHeight] = useState(height);

  // 표시할 항목 계산
  const { startIndex, endIndex, visibleItems, totalHeight } = useMemo(() => {
    const itemCount = purchases.length;
    const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
    
    const start = Math.floor(scrollTop / ITEM_HEIGHT);
    const end = Math.min(start + visibleCount + BUFFER_SIZE, itemCount);
    const actualStart = Math.max(0, start - BUFFER_SIZE);
    
    return {
      startIndex: actualStart,
      endIndex: end,
      visibleItems: purchases.slice(actualStart, end),
      totalHeight: itemCount * ITEM_HEIGHT
    };
  }, [purchases, scrollTop, containerHeight]);

  // 스크롤 이벤트 처리 - 헤더 높이 고려
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const headerHeight = 30; // 헤더 테이블의 실제 높이 (기존과 동일)
    const adjustedScrollTop = Math.max(0, e.currentTarget.scrollTop - headerHeight);
    setScrollTop(adjustedScrollTop);
  }, []);

  // 동적 높이 계산 및 컨테이너 높이 업데이트
  useEffect(() => {
    const calculateDynamicHeight = () => {
      const windowHeight = window.innerHeight;
      
      // 모니터 크기에 따른 동적 높이 계산
      let calculatedHeight;
      
      if (windowHeight <= 800) {
        // 작은 모니터: 화면의 60% (최대 450px)
        calculatedHeight = Math.min(450, windowHeight * 0.6);
      } else if (windowHeight <= 1080) {
        // 일반 모니터: 화면의 70% (최대 725px)
        calculatedHeight = Math.min(725, windowHeight * 0.7);
      } else if (windowHeight <= 1440) {
        // 큰 모니터: 화면의 75% (최대 1000px)
        calculatedHeight = Math.min(1000, windowHeight * 0.75);
      } else {
        // 매우 큰 모니터: 화면의 80% (최대 1200px)
        calculatedHeight = Math.min(1200, windowHeight * 0.8);
      }
      
      console.log('🔍 동적 높이 계산:', {
        windowHeight,
        calculatedHeight,
        category: windowHeight <= 800 ? '작은모니터' : 
                 windowHeight <= 1080 ? '일반모니터' :
                 windowHeight <= 1440 ? '큰모니터' : '매우큰모니터'
      });
      
      setDynamicHeight(calculatedHeight);
      setContainerHeight(calculatedHeight);
    };

    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerHeight(Math.min(dynamicHeight, rect.height));
      }
    };

    // DOM 로드 후 초기 계산
    const timer = setTimeout(() => {
      calculateDynamicHeight();
      updateHeight();
    }, 100); // 100ms 지연으로 DOM 완전 로드 보장
    
    // 리사이즈 이벤트 리스너
    const handleResize = () => {
      calculateDynamicHeight();
      updateHeight();
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [dynamicHeight]);

  return (
    <div className={shouldUseFitLayout ? 'table-container-fit-left' : 'border rounded-lg'}>
      {/* 통합 가상 스크롤 컨테이너 - x축과 y축 스크롤 모두 처리 */}
      <div
        ref={containerRef}
        className="virtual-scroll-body"
        style={{ 
          height: `${dynamicHeight}px`, 
          overflow: 'auto',
          position: 'relative'
        }}
        onScroll={handleScroll}
      >
        {/* 고정 헤더 - 스크롤과 함께 움직이지 않도록 설정 */}
        <div 
          className="sticky-header-container"
          style={{ 
          position: 'sticky', 
          top: 0, 
            zIndex: 30,
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            willChange: 'transform'
          }}
        >
          <table className={shouldUseFitLayout ? `table-fit-left ${activeTab}-tab` : 'w-full min-w-[1790px] border-collapse'}>
            {tableHeader}
          </table>
        </div>
        
        {/* 가상 스크롤 데이터 영역 */}
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {/* 실제 렌더링되는 항목들 */}
          <div
            style={{
              transform: `translateY(${startIndex * ITEM_HEIGHT}px)`,
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
            }}
          >
            <table className={`${shouldUseFitLayout ? `table-fit-left ${activeTab}-tab` : 'w-full min-w-[1790px] border-collapse'} virtual-scroll-table`}>
              <tbody>
                {visibleItems.map((purchase, index) => (
                  <TableRowComponent
                    key={purchase.id}
                    purchase={purchase}
                    onClick={onRowClick}
                    activeTab={activeTab}
                    isLeadBuyer={isLeadBuyer}
                    onPaymentComplete={onPaymentComplete}
                    onReceiptComplete={onReceiptComplete}
                    onExcelDownload={onExcelDownload}
                    vendorColumnWidth={vendorColumnWidth}
                    columnVisibility={columnVisibility}
                    currentUserRoles={currentUserRoles}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 데이터 없음 표시 */}
        {purchases.length === 0 && (
          <div className="text-center py-12 bg-white">
            <p className="card-subtitle">데이터가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
});

VirtualScrollTable.displayName = 'VirtualScrollTable';

export default VirtualScrollTable;