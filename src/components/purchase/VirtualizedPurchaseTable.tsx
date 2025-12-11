import React, { memo, useMemo, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { List } from 'react-window';
import { Purchase } from '@/types/purchase';
import { formatDateShort } from '@/utils/helpers';

// 금액 포매팅 함수
const formatAmount = (amount: number, currency: string = 'KRW') => {
  if (!amount) return `0 ${currency === 'KRW' ? '원' : currency}`;
  return `${amount.toLocaleString()} ${currency === 'KRW' ? '원' : currency}`;
};
import { logger } from '@/lib/logger';
import { useColumnSettings } from '@/hooks/useColumnSettings';
import ColumnSettingsDropdown from './ColumnSettingsDropdown';
import { DoneTabColumnId } from '@/types/columnSettings';

// FastPurchaseTable과 동일한 칼럼 클래스 정의
const COMMON_COLUMN_CLASSES = {
  // 승인대기 탭 전용 컬럼
  approvalStatus: "text-center w-20 min-w-[85px] max-w-[85px]",
  
  // 모든 탭 공통 컬럼들 (고정 너비)
  purchaseOrderNumber: "pl-2 w-[155px] min-w-[155px] max-w-[155px] purchase-order-number-column",
  purchaseOrderNumberCompact: "pl-2 w-36 min-w-[140px] max-w-[140px]",
  paymentCategory: "text-center w-20 min-w-[85px] max-w-[85px]",
  requesterName: "w-12 min-w-[48px] max-w-[48px]",
  requestDate: "text-center px-2 w-16 min-w-[64px] max-w-[68px]",
  vendorName: "pl-3 pr-2 w-32 min-w-[128px] max-w-[128px]",
  contactName: "w-16 min-w-[68px] max-w-[68px]",
  deliveryRequestDate: "w-20 min-w-[85px] max-w-[85px]",
  revisedDeliveryRequestDate: "w-20 min-w-[85px] max-w-[85px]",
  itemName: "w-44 min-w-[176px] max-w-[176px]",
  specification: "w-64 min-w-[260px] max-w-[260px]",
  quantity: "text-center w-14 min-w-[60px] max-w-[60px]",
  receivedQuantity: "text-center w-16 min-w-[70px] max-w-[70px]",
  unitPrice: "text-right w-24 min-w-[100px] max-w-[100px]",
  amount: "text-right w-24 min-w-[100px] max-w-[100px]",
  
  // 탭별 특화 컬럼들 (고정 너비)
  remark: "w-[165px] min-w-[165px] max-w-[165px]",
  paymentSchedule: "w-24 min-w-[100px] max-w-[100px]",
  purchaseStatus: "text-center w-20 min-w-[85px] max-w-[85px]",
  projectVendor: "w-24 min-w-[105px] max-w-[105px]",
  salesOrderNumber: "w-28 min-w-[115px] max-w-[115px]",
  projectItem: "w-44 min-w-[180px] max-w-[180px]",
  receiptProgress: "text-center w-20 min-w-[85px] max-w-[85px]",
  status: "text-center w-20 min-w-[85px] max-w-[85px]",
  receipt: "text-center w-24 min-w-[100px] max-w-[100px]",
  paymentStatus: "text-center w-16 min-w-[70px] max-w-[70px]",
  link: "w-20 min-w-[85px] max-w-[85px]",
  utk: "text-center w-14 min-w-[56px] max-w-[60px]"
};

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
  /**
   * 칼럼 설정 UI 표시 여부 (전체항목 탭에서만 true)
   */
  showColumnSettings?: boolean;
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
  purchases: Purchase[];
  activeTab: string;
  currentUserRoles: string[];
  onPaymentComplete?: (id: number) => Promise<void>;
  onReceiptComplete?: (id: number) => Promise<void>;
  columnVisibility?: any;
}>(({ index, style, purchases, activeTab, currentUserRoles, onPaymentComplete, onReceiptComplete, columnVisibility }) => {
  const purchase = purchases[index];

  // 칼럼 표시 여부 체크 함수 - FastPurchaseTable과 동일
  const isColumnVisible = useCallback((columnId: DoneTabColumnId) => {
    if (!columnVisibility) return true; // columnVisibility가 없으면 모든 칼럼 표시
    return columnVisibility[columnId] !== false;
  }, [columnVisibility]);

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
      <td className={`pl-2 pr-3 py-1.5 card-title whitespace-nowrap text-center overflow-visible text-clip ${COMMON_COLUMN_CLASSES.utk}`}>
        <span className={isChecked ? 'badge-utk-complete' : 'badge-utk-pending'}>
          {isChecked ? '완료' : '대기'}
        </span>
      </td>
    );
  };

  // 거래명세서 진행률 (전체항목 탭용)
  const getStatementProgress = () => {
    if (activeTab !== 'done') return null;
    const isReceived = (purchase as any).is_statement_received;
    return (
      <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
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
      {activeTab === 'done' && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress} ${!isColumnVisible('statement_progress') ? 'column-hidden' : ''}`}>
          <span className={(purchase as any).is_statement_received ? "bg-green-500 text-white" : "bg-yellow-500 text-white"}>
            {(purchase as any).is_statement_received ? "수령" : "대기"}
          </span>
        </td>
      )}
      
      {/* 발주번호 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.purchaseOrderNumber} ${!isColumnVisible('purchase_order_number') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.purchase_order_number}>
          {purchase.purchase_order_number}
        </span>
        <span className="card-description">
          {purchase.purchase_request_items?.length || 1}개 품목
        </span>
      </td>

      {/* 결제종류 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory} ${!isColumnVisible('payment_category') ? 'column-hidden' : ''}`}>
        <span className={
          purchase.payment_category === '현금' ? "bg-green-500 text-white" :
          purchase.payment_category === '카드' ? "badge-primary" :
          purchase.payment_category === '현장결제' ? "bg-gray-500 text-white" : "bg-yellow-500 text-white"
        }>
          {purchase.payment_category || '미정'}
        </span>
      </td>

      {/* 요청자 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.requesterName} ${!isColumnVisible('requester_name') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.requester_name}>
          {purchase.requester_name}
        </span>
      </td>

      {/* 청구일 */}
      <td className={`py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.requestDate} ${!isColumnVisible('request_date') ? 'column-hidden' : ''}`}>
        {formatDateShort(purchase.request_date)}
      </td>

      {/* UTK 확인 - 전체항목 탭만 */}
      {activeTab === 'done' && (
        <td className={`pl-2 pr-3 py-1.5 card-title whitespace-nowrap text-center overflow-visible text-clip ${COMMON_COLUMN_CLASSES.utk} ${!isColumnVisible('utk_status') ? 'column-hidden' : ''}`}>
          <span className={(purchase as any).is_utk_checked ? 'badge-utk-complete' : 'badge-utk-pending'}>
            {(purchase as any).is_utk_checked ? '완료' : '대기'}
          </span>
        </td>
      )}

      {/* 업체 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.vendorName} ${!isColumnVisible('vendor_name') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.vendor_name}>
          {purchase.vendor_name}
        </span>
      </td>

      {/* 담당자 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.contactName} ${!isColumnVisible('contact_name') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.contact_name || undefined}>
          {purchase.contact_name || '-'}
        </span>
      </td>

      {/* 입고요청일 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.deliveryRequestDate} ${!isColumnVisible('delivery_request_date') ? 'column-hidden' : ''}`}>
        {formatDateShort(purchase.delivery_request_date)}
      </td>

      {/* 변경 입고일 - 전체항목 탭만 */}
      {activeTab === 'done' && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.revisedDeliveryRequestDate} ${!isColumnVisible('revised_delivery_date') ? 'column-hidden' : ''}`}>
          {formatDateShort((purchase as any).revised_delivery_request_date) || '-'}
        </td>
      )}

      {/* 품명 */}
      <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.itemName} ${!isColumnVisible('item_name') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.item_name}>
          {purchase.item_name}
        </span>
      </td>

      {/* 규격 */}
      <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.specification} ${!isColumnVisible('specification') ? 'column-hidden' : ''}`}>
        <span className="block truncate" title={purchase.specification}>
          {purchase.specification || '-'}
        </span>
      </td>

      {/* 수량 */}
      <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.quantity} ${!isColumnVisible('quantity') ? 'column-hidden' : ''}`}>
        {purchase.quantity}
      </td>

      {/* 단가 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice} ${!isColumnVisible('unit_price') ? 'column-hidden' : ''}`}>
        {formatAmount(purchase.unit_price_value || 0, purchase.currency)}
      </td>

      {/* 합계 */}
      <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount} ${!isColumnVisible('amount') ? 'column-hidden' : ''}`}>
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
          {/* 비고 */}
          <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.remark} ${!isColumnVisible('remark') ? 'column-hidden' : ''}`}>
            <span className="block truncate" title={purchase.remark}>
              {purchase.remark || '-'}
            </span>
          </td>
          
          {/* 링크 */}
          <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.link} ${!isColumnVisible('link') ? 'column-hidden' : ''}`}>
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
          
          {/* PJ업체 */}
          <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectVendor} ${!isColumnVisible('project_vendor') ? 'column-hidden' : ''}`}>
            <span className="block truncate" title={purchase.project_vendor}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          
          {/* PJ ITEM */}
          <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectItem} ${!isColumnVisible('project_item') ? 'column-hidden' : ''}`}>
            <span className="block truncate" title={purchase.project_item}>
              {purchase.project_item || '-'}
            </span>
          </td>
          
          {/* 수주번호 */}
          <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber} ${!isColumnVisible('sales_order_number') ? 'column-hidden' : ''}`}>
            <span className="block truncate" title={purchase.sales_order_number}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
          
          {/* 구매진행 */}
          <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.status} ${!isColumnVisible('purchase_progress') ? 'column-hidden' : ''}`}>
            {/* 전체항목 탭에서 결제종류가 '구매 요청'이 아닌 건들은 "-" 표시 */}
            {(() => {
              if (purchase.payment_category !== '구매 요청') {
                return <span className="card-title text-gray-500">-</span>;
              }
              
              return (
                <span className={purchase.is_payment_completed ? "bg-orange-500 text-white" : "bg-yellow-500 text-white"}>
                  {purchase.is_payment_completed ? "완료" : "대기"}
                </span>
              );
            })()}
          </td>
          
          {/* 입고진행 */}
          <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receipt} column-progress ${!isColumnVisible('receipt_progress') ? 'column-hidden' : ''}`}>
            <span className={purchase.is_received ? "bg-blue-500 text-white" : "bg-yellow-500 text-white"}>
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
const TableHeader = memo<{ activeTab: string; columnVisibility?: any }>(({ activeTab, columnVisibility }) => {
  // 칼럼 표시 여부 체크 함수
  const isColumnVisible = useCallback((columnId: DoneTabColumnId) => {
    if (!columnVisibility) return true;
    return columnVisibility[columnId] !== false;
  }, [columnVisibility]);

  return (
    <tr className="bg-gray-50">
        {/* 전체항목 탭에서는 거래명세서 진행률을 맨 앞에 */}
        {activeTab === 'done' && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress} ${!isColumnVisible('statement_progress') ? 'column-hidden' : ''}`}>거래명세서</th>
        )}
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber} ${!isColumnVisible('purchase_order_number') ? 'column-hidden' : ''}`}>발주번호</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory} ${!isColumnVisible('payment_category') ? 'column-hidden' : ''}`}>결제종류</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName} ${!isColumnVisible('requester_name') ? 'column-hidden' : ''}`}>요청자</th>
        <th className={`py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.requestDate} ${!isColumnVisible('request_date') ? 'column-hidden' : ''}`}>청구일</th>
        {/* 전체항목 탭에서만 UTK 확인 칼럼 헤더 표시 */}
        {activeTab === 'done' && (
          <th className={`pl-2 pr-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center ${COMMON_COLUMN_CLASSES.utk} ${!isColumnVisible('utk_status') ? 'column-hidden' : ''}`}>UTK</th>
        )}
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.vendorName} ${!isColumnVisible('vendor_name') ? 'column-hidden' : ''}`}>업체</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName} ${!isColumnVisible('contact_name') ? 'column-hidden' : ''}`}>담당자</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate} ${!isColumnVisible('delivery_request_date') ? 'column-hidden' : ''}`}>입고요청일</th>
        {activeTab === 'done' && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.revisedDeliveryRequestDate} ${!isColumnVisible('revised_delivery_date') ? 'column-hidden' : ''}`}>변경 입고일</th>
        )}
        <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.itemName} ${!isColumnVisible('item_name') ? 'column-hidden' : ''}`}>품명</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.specification} ${!isColumnVisible('specification') ? 'column-hidden' : ''}`}>규격</th>
        <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity} ${!isColumnVisible('quantity') ? 'column-hidden' : ''}`}>수량</th>
        <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice} ${!isColumnVisible('unit_price') ? 'column-hidden' : ''}`}>단가</th>
        <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount} ${!isColumnVisible('amount') ? 'column-hidden' : ''}`}>합계</th>
      
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
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark} ${!isColumnVisible('remark') ? 'column-hidden' : ''}`}>비고</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.link} ${!isColumnVisible('link') ? 'column-hidden' : ''}`}>링크</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor} ${!isColumnVisible('project_vendor') ? 'column-hidden' : ''}`}>PJ업체</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem} ${!isColumnVisible('project_item') ? 'column-hidden' : ''}`}>PJ ITEM</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber} ${!isColumnVisible('sales_order_number') ? 'column-hidden' : ''}`}>수주번호</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.status} ${!isColumnVisible('purchase_progress') ? 'column-hidden' : ''}`}>구매진행</th>
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receipt} ${!isColumnVisible('receipt_progress') ? 'column-hidden' : ''}`}>입고진행</th>
        </>
      )}
      </tr>
  );
});

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
  className = "",
  showColumnSettings = false
}, ref) => {
  
  const listRef = useRef<any>(null);
  
  // 칼럼 설정 훅 (전체항목 탭에서만 사용)
  const { columnVisibility, applyColumnSettings, resetToDefault } = useColumnSettings();

  // 외부에서 스크롤 제어할 수 있도록 함수 제공
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align: 'auto' | 'center' | 'end' | 'smart' | 'start' = 'auto') => {
      listRef.current?.scrollToRow({ index, align });
    },
    scrollToTop: () => {
      listRef.current?.scrollToRow({ index: 0, align: 'start' });
    },
    scrollToBottom: () => {
      listRef.current?.scrollToRow({ index: purchases.length - 1, align: 'end' });
    },
  }), [purchases.length]);

  // 데이터 메모이제이션 (rowProps로 전달)
  const rowProps = useMemo(() => ({
    purchases,
    activeTab,
    currentUserRoles,
    onPaymentComplete,
    onReceiptComplete,
    columnVisibility: activeTab === 'done' ? columnVisibility : undefined,
  }), [purchases, activeTab, currentUserRoles, onPaymentComplete, onReceiptComplete, columnVisibility]);

  // 스크롤 이벤트 핸들러
  const handleScroll = useCallback((props: any) => {
    // 스크롤 성능 로깅은 제거됨
  }, []);

  return (
    <div className={`virtualized-table-container bg-white rounded-lg overflow-hidden ${className}`}>
      {/* 칼럼 설정 UI 표시 */}
      {showColumnSettings && activeTab === 'done' && (
        <div className="mb-3 flex justify-end p-3">
          <ColumnSettingsDropdown 
            isVisible={true} 
            className=""
            columnVisibility={columnVisibility}
            applyColumnSettings={applyColumnSettings}
            resetToDefault={resetToDefault}
          />
        </div>
      )}
      
      {/* 완전한 테이블 구조로 복원 - 헤더와 바디가 하나의 테이블 */}
      <div className="virtual-scroll-container overflow-x-auto">
        <table className={activeTab === 'done' ? 'table-fit-left' : 'w-full'}>
          {/* 고정 헤더 */}
          <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
            <TableHeader activeTab={activeTab} columnVisibility={activeTab === 'done' ? columnVisibility : undefined} />
          </thead>
          
          {/* 가상 스크롤 바디 */}
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
              <tr>
                <td colSpan={20} style={{ padding: 0 }}>
                  <List
                    listRef={listRef}
                    defaultHeight={height}
                    rowCount={purchases.length}
                    rowHeight={itemHeight}
                    rowProps={rowProps}
                    rowComponent={(props) => <TableRow {...props} {...rowProps} />}
                    overscanCount={overscanCount}
                    className="virtualized-table-list"
                  />
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      
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