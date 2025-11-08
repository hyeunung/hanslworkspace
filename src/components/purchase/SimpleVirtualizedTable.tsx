import React, { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Purchase } from '@/types/purchase';
import { formatDateShort } from '@/utils/helpers';

interface SimpleVirtualizedTableProps {
  purchases: Purchase[];
  activeTab: string;
  currentUserRoles: string[];
  onRefresh?: () => void;
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void;
  onPaymentComplete?: (id: number) => Promise<void>;
  onReceiptComplete?: (id: number) => Promise<void>;
  height?: number;
  itemHeight?: number;
}

const SimpleVirtualizedTable = memo<SimpleVirtualizedTableProps>(({
  purchases,
  activeTab,
  currentUserRoles,
  onPaymentComplete,
  onReceiptComplete,
  height = 600,
  itemHeight = 60
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 표시할 항목 범위 계산
  const visibleRange = useMemo(() => {
    const containerHeight = height;
    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight) + 5, // 5개 여유분
      purchases.length
    );
    return { startIndex, endIndex };
  }, [scrollTop, height, itemHeight, purchases.length]);

  // 스크롤 핸들러
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // 권한 체크
  const isLeadBuyer = currentUserRoles?.includes('raw_material_manager') || 
                     currentUserRoles?.includes('consumable_manager') || 
                     currentUserRoles?.includes('purchase_manager');

  // 상태 배지 생성
  const getStatusBadge = useCallback((purchase: Purchase) => {
    if (purchase.is_received) {
      return <span className="badge-stats bg-green-500 text-white">입고완료</span>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <span className="badge-stats bg-blue-500 text-white">구매진행</span>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <span className="badge-stats bg-red-500 text-white">반려</span>;
    } else {
      return <span className="badge-stats bg-yellow-500 text-white">승인대기</span>;
    }
  }, []);

  // 통화 기호 변환
  const getCurrencySymbol = useCallback((currency: string) => {
    if (!currency) return '₩';
    if (['KRW', '원', '₩'].includes(currency)) return '₩';
    if (['USD', '$', '달러'].includes(currency)) return '$';
    return currency;
  }, []);

  // 가격 포맷팅
  const formatAmount = useCallback((amount: number, currency: string = 'KRW') => {
    return `${getCurrencySymbol(currency)}${amount.toLocaleString()}`;
  }, [getCurrencySymbol]);

  // 표시할 항목들
  const visibleItems = purchases.slice(visibleRange.startIndex, visibleRange.endIndex);

  return (
    <div className="virtualized-table-container bg-white rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center bg-gray-50 border-b-2 border-gray-200 px-4 py-3 text-sm font-medium text-gray-700">
        <div className="w-32 min-w-[128px] flex-shrink-0">발주번호</div>
        <div className="w-20 min-w-[80px] flex-shrink-0">요청자</div>
        <div className="w-28 min-w-[112px] flex-shrink-0">업체명</div>
        <div className="w-32 min-w-[128px] flex-shrink-0">품목명</div>
        <div className="w-40 min-w-[160px] flex-shrink-0">규격</div>
        <div className="w-16 min-w-[64px] flex-shrink-0 text-center">수량</div>
        <div className="w-24 min-w-[96px] flex-shrink-0 text-right">단가</div>
        <div className="w-24 min-w-[96px] flex-shrink-0 text-right">총액</div>
        <div className="w-20 min-w-[80px] flex-shrink-0">요청일</div>
        <div className="w-20 min-w-[80px] flex-shrink-0 text-center">상태</div>
        <div className="w-24 min-w-[96px] flex-shrink-0 text-center">액션</div>
      </div>

      {/* 스크롤 컨테이너 */}
      <div 
        ref={containerRef}
        className="relative overflow-auto"
        style={{ height: height }}
        onScroll={handleScroll}
      >
        {/* 전체 높이를 유지하는 spacer */}
        <div style={{ height: purchases.length * itemHeight, position: 'relative' }}>
          {/* 실제 표시되는 항목들 */}
          <div 
            style={{ 
              transform: `translateY(${visibleRange.startIndex * itemHeight}px)`,
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0
            }}
          >
            {visibleItems.map((purchase, index) => (
              <div
                key={purchase.id}
                className="flex items-center border-b border-gray-100 hover:bg-gray-50 transition-colors px-4 py-2"
                style={{ height: itemHeight }}
              >
                {/* 발주번호 */}
                <div className="w-32 min-w-[128px] flex-shrink-0">
                  <div className="card-title truncate">
                    {purchase.purchase_order_number}
                  </div>
                  <div className="card-description">
                    {purchase.purchase_request_items?.length || 1}개 품목
                  </div>
                </div>

                {/* 요청자 */}
                <div className="w-20 min-w-[80px] flex-shrink-0">
                  <div className="card-subtitle truncate">
                    {purchase.requester_name}
                  </div>
                </div>

                {/* 업체명 */}
                <div className="w-28 min-w-[112px] flex-shrink-0">
                  <div className="card-subtitle truncate">
                    {purchase.vendor_name}
                  </div>
                </div>

                {/* 품목명 */}
                <div className="w-32 min-w-[128px] flex-shrink-0">
                  <div className="card-description truncate">
                    {purchase.item_name}
                  </div>
                </div>

                {/* 규격 */}
                <div className="w-40 min-w-[160px] flex-shrink-0">
                  <div className="card-description truncate">
                    {purchase.specification || '-'}
                  </div>
                </div>

                {/* 수량 */}
                <div className="w-16 min-w-[64px] flex-shrink-0 text-center">
                  <div className="card-title">
                    {purchase.quantity}
                  </div>
                </div>

                {/* 단가 */}
                <div className="w-24 min-w-[96px] flex-shrink-0 text-right">
                  <div className="card-amount">
                    {formatAmount(purchase.unit_price_value || 0, purchase.currency)}
                  </div>
                </div>

                {/* 총액 */}
                <div className="w-24 min-w-[96px] flex-shrink-0 text-right">
                  <div className="card-amount font-bold">
                    {formatAmount(purchase.total_amount || 0, purchase.currency)}
                  </div>
                </div>

                {/* 요청일 */}
                <div className="w-20 min-w-[80px] flex-shrink-0">
                  <div className="card-date">
                    {formatDateShort(purchase.request_date)}
                  </div>
                </div>

                {/* 상태 */}
                <div className="w-20 min-w-[80px] flex-shrink-0 text-center">
                  {getStatusBadge(purchase)}
                </div>

                {/* 액션 버튼 */}
                <div className="w-24 min-w-[96px] flex-shrink-0 text-center">
                  {activeTab === 'purchase' && isLeadBuyer && !purchase.is_payment_completed && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPaymentComplete?.(purchase.id);
                      }}
                      className="button-base bg-green-500 hover:bg-green-600 text-white"
                      title="구매완료"
                    >
                      구매
                    </button>
                  )}
                  
                  {activeTab === 'receipt' && isLeadBuyer && !purchase.is_received && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onReceiptComplete?.(purchase.id);
                      }}
                      className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                      title="입고완료"
                    >
                      입고
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 가상화 상태 정보 (개발용) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-2 p-2 bg-green-50 text-green-600 text-xs rounded">
          <span>
            간단한 가상화: {purchases.length.toLocaleString()}개 중 {visibleItems.length}개 렌더링
            (인덱스 {visibleRange.startIndex}-{visibleRange.endIndex})
          </span>
        </div>
      )}
    </div>
  );
});

SimpleVirtualizedTable.displayName = 'SimpleVirtualizedTable';

export default SimpleVirtualizedTable;