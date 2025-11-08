import React, { memo, useMemo, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { FixedSizeList } from 'react-window';
import { Purchase } from '@/types/purchase';
import { formatDateShort } from '@/utils/helpers';
import { logger } from '@/lib/logger';

interface VirtualizedPurchaseTableProps {
  purchases: Purchase[];
  activeTab: string;
  currentUserRoles: string[];
  onRefresh?: () => void;
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void;
  onPaymentComplete?: (id: number) => Promise<void>;
  onReceiptComplete?: (id: number) => Promise<void>;
  height?: number;
  itemHeight?: number;
  overscanCount?: number;
  className?: string;
}

export interface VirtualizedTableHandle {
  scrollToItem: (index: number, align?: 'auto' | 'smart' | 'center' | 'end' | 'start') => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
}

// 행 컴포넌트 - table 기반으로 FastPurchaseTable과 동일하게
const TableRow = memo<{
  index: number;
  style: React.CSSProperties;
  data: {
    purchases: Purchase[];
    activeTab: string;
    currentUserRoles: string[];
    onPaymentComplete?: (id: number) => Promise<void>;
    onReceiptComplete?: (id: number) => Promise<void>;
  };
}>(({ index, style, data }) => {
  const { purchases, activeTab, currentUserRoles, onPaymentComplete, onReceiptComplete } = data;
  const purchase = purchases[index];

  // 권한 체크
  const isLeadBuyer = currentUserRoles?.includes('raw_material_manager') || 
                     currentUserRoles?.includes('consumable_manager') || 
                     currentUserRoles?.includes('purchase_manager');

  // 상태 배지 생성 - FastPurchaseTable과 동일
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

  // UTK 상태 표시 (전체항목 탭용)
  const getUtkStatus = () => {
    if (activeTab !== 'done') return null;
    const isChecked = (purchase as any).is_utk_checked;
    return (
      <td className="px-2 py-1.5 text-center">
        <span className={isChecked ? "bg-green-500 text-white" : "bg-yellow-500 text-white"}>
          {isChecked ? "완료" : "대기"}
        </span>
      </td>
    );
  };

  // 거래명세서 진행률 (전체항목 탭용)
  const getStatementProgress = () => {
    if (activeTab !== 'done') return null;
    const isReceived = (purchase as any).is_statement_received;
    return (
      <td className="px-2 py-1.5 text-center">
        <span className={isReceived ? "bg-green-500 text-white" : "bg-yellow-500 text-white"}>
          {isReceived ? "수령" : "대기"}
        </span>
      </td>
    );
  };

  if (!purchase) {
    return (
      <tr style={style}>
        <td colSpan={20} className="text-center py-4 card-subtitle">데이터 없음</td>
      </tr>
    );
  }

  return (
    <tr
      style={style}
      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
    >
      {/* 거래명세서 진행률 - 전체항목 탭 맨 앞 */}
      {getStatementProgress()}
      
      {/* 발주번호 */}
      <td className="px-2 py-1.5 card-title text-left">
        <span className="block truncate" title={purchase.purchase_order_number}>
          {purchase.purchase_order_number}
        </span>
        <span className="card-description">
          {purchase.purchase_request_items?.length || 1}개 품목
        </span>
      </td>

      {/* 결제종류 */}
      <td className="px-2 py-1.5 card-title">
        <span className={
          purchase.payment_category === '현금' ? "bg-green-500 text-white" :
          purchase.payment_category === '카드' ? "badge-primary" :
          purchase.payment_category === '현장결제' ? "bg-gray-500 text-white" : "bg-yellow-500 text-white"
        }>
          {purchase.payment_category || '미정'}
        </span>
      </td>

      {/* 요청자 */}
      <td className="px-2 py-1.5 card-title text-left">
        <span className="block truncate" title={purchase.requester_name}>
          {purchase.requester_name}
        </span>
      </td>

      {/* 청구일 */}
      <td className="px-2 py-1.5 card-date text-left">
        <span className="block truncate">
          {formatDateShort(purchase.request_date)}
        </span>
      </td>

      {/* UTK 확인 - 전체항목 탭만 */}
      {getUtkStatus()}

      {/* 업체 */}
      <td className="px-2 py-1.5 card-title text-left">
        <span className="block truncate" title={purchase.vendor_name}>
          {purchase.vendor_name}
        </span>
      </td>

      {/* 담당자 */}
      <td className="px-2 py-1.5 card-title text-left">
        <span className="block truncate" title={purchase.contact_name || undefined}>
          {purchase.contact_name || '-'}
        </span>
      </td>

      {/* 입고요청일 */}
      <td className="px-2 py-1.5 card-date text-left">
        <span className="block truncate">
          {formatDateShort(purchase.delivery_request_date)}
        </span>
      </td>

      {/* 변경 입고일 - 전체항목 탭만 */}
      {activeTab === 'done' && (
        <td className="px-2 py-1.5 card-date text-left">
          <span className="block truncate">
            {formatDateShort((purchase as any).revised_delivery_request_date) || '-'}
          </span>
        </td>
      )}

      {/* 품명 */}
      <td className="px-2 py-1.5 card-title text-left">
        <span className="block truncate" title={purchase.item_name}>
          {purchase.item_name}
        </span>
      </td>

      {/* 규격 */}
      <td className="px-2 py-1.5 card-description text-left">
        <span className="block truncate" title={purchase.specification}>
          {purchase.specification || '-'}
        </span>
      </td>

      {/* 수량 */}
      <td className="px-2 py-1.5 card-title text-center">
        {purchase.quantity}
      </td>

      {/* 단가 */}
      <td className="px-2 py-1.5 card-amount text-right">
        {formatAmount(purchase.unit_price_value || 0, purchase.currency)}
      </td>

      {/* 합계 */}
      <td className="px-2 py-1.5 card-amount-large text-right">
        {formatAmount(purchase.total_amount || 0, purchase.currency)}
      </td>

      {/* 탭별 추가 칼럼들 */}
      {activeTab === 'purchase' && (
        <>
          <td className="px-2 py-1.5 card-description text-left">
            <span className="block truncate" title={purchase.remark}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            {purchase.link ? (
              <a 
                href={purchase.link} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-blue-600 hover:text-blue-800 underline"
                title={purchase.link}
              >
                링크 보기
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </td>
          <td className="px-2 py-1.5 card-date text-left">
            <span className="block truncate">
              {(purchase as any).vendor_payment_schedule || '-'}
            </span>
          </td>
        </>
      )}

      {activeTab === 'receipt' && (
        <>
          <td className="px-2 py-1.5 card-description text-left">
            <span className="block truncate" title={purchase.remark}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.project_vendor}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.project_item}>
              {purchase.project_item || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.sales_order_number}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
        </>
      )}

      {activeTab === 'done' && (
        <>
          <td className="px-2 py-1.5 card-description text-left">
            <span className="block truncate" title={purchase.remark}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            {purchase.link ? (
              <a 
                href={purchase.link} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-blue-600 hover:text-blue-800 underline"
                title={purchase.link}
              >
                링크 보기
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.project_vendor}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.project_item}>
              {purchase.project_item || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-title text-left">
            <span className="block truncate" title={purchase.sales_order_number}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 card-date text-left">
            <span className="block truncate">
              {(purchase as any).vendor_payment_schedule || '-'}
            </span>
          </td>
          <td className="px-2 py-1.5 text-center">
            <span className={purchase.is_payment_completed ? "bg-green-500 text-white" : "bg-yellow-500 text-white"}>
              {purchase.is_payment_completed ? "완료" : "대기"}
            </span>
          </td>
          <td className="px-2 py-1.5 text-center">
            <span className={purchase.is_received ? "bg-green-500 text-white" : "bg-yellow-500 text-white"}>
              {purchase.is_received ? "완료" : "대기"}
            </span>
          </td>
        </>
      )}
    </tr>
  );
});

TableRow.displayName = 'VirtualizedTableRow';

// 헤더 컴포넌트 - FastPurchaseTable 스타일 적용
const TableHeader = memo<{ activeTab: string }>(({ activeTab }) => (
  <thead className="bg-gray-50">
    <tr>
      {/* 전체항목 탭에서는 거래명세서 진행률을 맨 앞에 */}
      {activeTab === 'done' && (
        <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-24">거래명세서</th>
      )}
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-32">발주번호</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-16">결제종류</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-20">요청자</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-20">청구일</th>
      {/* 전체항목 탭에서만 UTK 확인 칼럼 헤더 표시 */}
      {activeTab === 'done' && (
        <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-16">UTK</th>
      )}
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-28">업체</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-20">담당자</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">입고요청일</th>
      {activeTab === 'done' && (
        <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">변경 입고일</th>
      )}
      <th className="px-2 py-1.5 modal-label text-gray-900 text-left w-32">품명</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 text-left w-40">규격</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-16">수량</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-24">단가</th>
      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-24">합계</th>
      
      {/* 탭별 추가 칼럼들 */}
      {activeTab === 'purchase' && (
        <>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-32">비고</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-20">링크</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">지출예정일</th>
        </>
      )}
      
      {activeTab === 'receipt' && (
        <>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-32">비고</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-28">PJ업체</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">PJ ITEM</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">수주번호</th>
        </>
      )}
      
      {activeTab === 'done' && (
        <>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-32">비고</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-20">링크</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-28">PJ업체</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">PJ ITEM</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">수주번호</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-24">지출예정일</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-20">구매진행</th>
          <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap w-20">입고진행</th>
        </>
      )}
    </tr>
  </thead>
));

TableHeader.displayName = 'VirtualizedTableHeader';

// 메인 가상화 테이블 컴포넌트
const VirtualizedPurchaseTable = forwardRef<VirtualizedTableHandle, VirtualizedPurchaseTableProps>(({
  purchases,
  activeTab,
  currentUserRoles,
  onRefresh,
  onOptimisticUpdate,
  onPaymentComplete,
  onReceiptComplete,
  height = 600,
  itemHeight = 60,
  overscanCount = 10,
  className = ""
}, ref) => {
  
  const listRef = useRef<any>(null);

  // 외부에서 스크롤 제어할 수 있도록 함수 제공
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align = 'auto') => {
      listRef.current?.scrollToItem(index, align);
    },
    scrollToTop: () => {
      listRef.current?.scrollToItem(0, 'start');
    },
    scrollToBottom: () => {
      listRef.current?.scrollToItem(purchases.length - 1, 'end');
    },
  }), [purchases.length]);

  // 데이터 메모이제이션
  const itemData = useMemo(() => ({
    purchases,
    activeTab,
    currentUserRoles,
    onPaymentComplete,
    onReceiptComplete,
  }), [purchases, activeTab, currentUserRoles, onPaymentComplete, onReceiptComplete]);

  // 스크롤 이벤트 핸들러
  const handleScroll = useCallback((props: any) => {
    // 스크롤 성능 로깅 (개발용)
    if (process.env.NODE_ENV === 'development') {
      logger.debug('가상화 테이블 스크롤', { 
        scrollTop: props.scrollTop,
        scrollHeight: props.scrollHeight 
      });
    }
  }, []);

  return (
    <div className={`virtualized-table-container bg-white rounded-lg overflow-hidden ${className}`}>
      {/* 테이블 형태로 변경 */}
      <table className="w-full">
        <TableHeader activeTab={activeTab} />
        {purchases.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={20} className="text-center py-12">
                <div className="card-subtitle">표시할 데이터가 없습니다</div>
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            <FixedSizeList
              ref={listRef}
              height={height}
              width="100%"
              itemCount={purchases.length}
              itemSize={itemHeight}
              itemData={itemData}
              overscanCount={overscanCount}
              onScroll={handleScroll}
              className="virtualized-table-list"
            >
              {TableRow}
            </FixedSizeList>
          </tbody>
        )}
      </table>
      
      {/* 가상화 상태 정보 (개발용) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-2 p-2 bg-blue-50 text-blue-600 text-xs rounded">
          <span>가상화 모드: {purchases.length.toLocaleString()}개 항목, 렌더링 최적화 적용</span>
        </div>
      )}
    </div>
  );
});

VirtualizedPurchaseTable.displayName = 'VirtualizedPurchaseTable';

export default VirtualizedPurchaseTable;