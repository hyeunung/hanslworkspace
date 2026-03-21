import { memo, useMemo, useState, useCallback, useEffect } from "react";
import PurchaseDetailModal from "./PurchaseDetailModal";
import MobilePurchaseCard from "./MobilePurchaseCard";
import VirtualScrollTable from "./VirtualScrollTable";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";
import { formatDateShort } from "@/utils/helpers";
import { logger } from "@/lib/logger";
import { usePurchaseMemory } from "@/hooks/usePurchaseMemory";
import { removePurchaseFromMemory, updatePurchaseInMemory } from '@/stores/purchaseMemoryStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Purchase, PurchaseRequestItem, PurchaseRequestWithDetails } from "@/types/purchase";
import { DoneTabColumnId, ColumnVisibility } from "@/types/columnSettings";
import { RESTRICTED_COLUMNS, AUTHORIZED_ROLES, UTK_AUTHORIZED_ROLES } from "@/constants/columnSettings";

interface FastPurchaseTableProps {
  purchases: Purchase[];
  activeTab?: string; // 현재 활성 탭
  currentUserRoles?: string[];
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>;
  onOptimisticUpdate?: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void;
  onPaymentComplete?: (purchaseId: number) => Promise<void>;
  onReceiptComplete?: (purchaseId: number) => Promise<void>;
  columnVisibility?: ColumnVisibility; // 칼럼 가시성 설정
}

// 상태 배지 컴포넌트 (더 빠르게)
const StatusBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const status = purchase.is_received 
    ? 'completed'
    : (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved')
    ? 'inProgress'
    : (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected')
    ? 'rejected'
    : 'pending';
  
  const config = {
    completed: { text: '입고완료', className: 'badge-success' },
    inProgress: { text: '구매진행', className: 'badge-primary' },
    rejected: { text: '반려', className: 'badge-danger' },
    pending: { text: '승인대기', className: 'badge-warning' }
  };
  
  const { text, className } = config[status];
  return <span className={`badge-stats ${className}`}>{text}</span>;
});

StatusBadge.displayName = 'StatusBadge';

// 통화 코드를 기호로 변환하는 함수
const getCurrencySymbol = (currency: string) => {
  if (!currency) return '₩';
  if (['KRW', '원', '₩'].includes(currency)) return '₩';
  if (['USD', '$', '달러'].includes(currency)) return '$';
  if (['EUR', '€'].includes(currency)) return '€';
  if (['JPY', '엔', '¥'].includes(currency)) return '¥';
  if (['CNY', '위안', '元'].includes(currency)) return '¥';
  return currency;
};

// 🎯 실제 DB 데이터 1,979건 정밀 분석 기반 최적 컬럼 너비 설정 (2025-10-28)
// 📊 데이터 샘플: 90일 이내 발주요청 전체 아이템 분석 결과
// ✂️ min-width = max-width로 고정 너비 설정, truncate로 긴 텍스트 자르기
const COMMON_COLUMN_CLASSES = {
  // 승인대기 탭 전용 컬럼
  approvalStatus: "text-center w-20 min-w-[85px] max-w-[85px]",
  
  // 모든 탭 공통 컬럼들 (고정 너비)
  purchaseOrderNumber: "pl-2 w-[155px] min-w-[155px] max-w-[155px] purchase-order-number-column",      // 발주번호 + 품목갯수 + 엑셀아이콘
  purchaseOrderNumberCompact: "pl-2 w-36 min-w-[140px] max-w-[140px]", // 구매현황 탭용 (추가 컬럼 보상)
  paymentCategory: "text-center w-20 min-w-[85px] max-w-[85px]",
  requesterName: "w-12 min-w-[48px] max-w-[48px]",                    // 한글 이름 2-3자 기준 (김용희, 한화 등)
  requestDate: "text-center px-2 w-16 min-w-[64px] max-w-[68px]",
  vendorName: "pl-3 pr-2 w-32 min-w-[128px] max-w-[128px]",           // 업체명 최대 길이 대응 (95% 커버리지)
  contactName: "w-16 min-w-[68px] max-w-[68px]",
  deliveryRequestDate: "w-20 min-w-[85px] max-w-[85px]",
  revisedDeliveryRequestDate: "w-20 min-w-[85px] max-w-[85px]",
  itemName: "w-44 min-w-[176px] max-w-[176px]",                       // 품명 공간 더 늘림: 160px → 176px
  specification: "w-64 min-w-[260px] max-w-[260px]",                  // 평균 15.5자 + 여유 (조금 더 길게)
  quantity: "text-center w-14 min-w-[60px] max-w-[60px]",
  receivedQuantity: "text-center w-16 min-w-[70px] max-w-[70px]",
  unitPrice: "text-right w-24 min-w-[100px] max-w-[100px]",
  amount: "text-right w-24 min-w-[100px] max-w-[100px]",
  
  // 탭별 특화 컬럼들 (고정 너비)
  remark: "w-[165px] min-w-[165px] max-w-[165px]",                         // 평균 1.8자, 대부분 비어있음
  paymentSchedule: "w-24 min-w-[100px] max-w-[100px]",
  purchaseStatus: "text-center w-20 min-w-[85px] max-w-[85px]",
  projectVendor: "w-24 min-w-[105px] max-w-[105px]",                  // 평균 6.6자
  salesOrderNumber: "w-28 min-w-[115px] max-w-[115px]",               // 평균 8.6자
  projectItem: "w-44 min-w-[180px] max-w-[180px]",                    // 평균 11.1자 + 여유 (조금 더 길게)
  receiptProgress: "text-center w-20 min-w-[85px] max-w-[85px]",
  status: "text-center w-24 min-w-[100px] max-w-[100px]",
  receipt: "text-center w-24 min-w-[100px] max-w-[100px]",           // 진행바 + 퍼센트 표시
  paymentStatus: "text-center w-16 min-w-[70px] max-w-[70px]",
  link: "w-20 min-w-[85px] max-w-[85px]",
  utk: "text-center w-14 min-w-[56px] max-w-[60px]"  // UTK 칼럼 전용 (핏하게)
};

// 승인 상태 상세 표시 컴포넌트 (승인대기 탭용)
// 🚀 메모리 캐시 변경 감지를 위해 usePurchaseMemory 훅 사용
const ApprovalStatusBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory(); // 메모리 캐시 변경 감지용
  
  // 메모리에서 최신 데이터 조회 (실시간 업데이트 보장)
  const memoryPurchase = allPurchases?.find(p => p.id === purchase.id) || purchase;
  
  const middleApproved = memoryPurchase.middle_manager_status === 'approved';
  const middleRejected = memoryPurchase.middle_manager_status === 'rejected';
  const finalApproved = memoryPurchase.final_manager_status === 'approved';
  const finalRejected = memoryPurchase.final_manager_status === 'rejected';

  // 전체 상태 결정
  if (middleRejected || finalRejected) {
    // 하나라도 반려면 반려 표시
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5">
          <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
        </div>
        <span className="badge-stats bg-red-500 text-white">
          반려
        </span>
      </div>
    );
  }
  
  if (middleApproved && finalApproved) {
    // 둘 다 승인이면 완료
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
        </div>
        <span className="badge-stats bg-green-500 text-white">
          승인완료
        </span>
      </div>
    );
  }
  
  if (middleApproved && !finalApproved && !finalRejected) {
    // 중간승인만 완료
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
          <div className="w-3 h-0.5 bg-gray-300"></div>
          <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
        </div>
        <span className="badge-stats bg-yellow-500 text-white">
          1차 승인
        </span>
      </div>
    );
  }
  
  // 둘 다 대기
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
        <div className="w-3 h-0.5 bg-gray-300"></div>
        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
      </div>
      <span className="badge-stats bg-gray-500 text-white">
        승인대기
      </span>
    </div>
  );
});

ApprovalStatusBadge.displayName = 'ApprovalStatusBadge';

// 구매완료 진행률 컴포넌트 (구매현황 탭용)
// 🚀 메모리 캐시 변경 감지를 위해 usePurchaseMemory 훅 사용
const PaymentProgressBar = memo(({ purchase, activeTab }: { purchase: Purchase; activeTab?: string }) => {
  const { allPurchases } = usePurchaseMemory(); // 메모리 캐시 변경 감지용
  
  // 메모리에서 최신 데이터 조회 (실시간 업데이트 보장)
  const memoryPurchase = allPurchases?.find(p => p.id === purchase.id) || purchase;

  // 전체항목 탭에서 결제종류가 '구매 요청'이 아닌 경우 "-" 표시
  if (activeTab === 'done') {
    if (memoryPurchase.payment_category !== '구매 요청') {
      return (
        <div className="flex items-center justify-center">
          <span className="card-title text-gray-500">-</span>
        </div>
      );
    }
  }
  
  // purchase_requests 테이블의 is_payment_completed 필드 우선 체크
  if (memoryPurchase.is_payment_completed) {
    const progress = { completed: 1, total: 1, percentage: 100 };
    return (
      <div className="flex items-center justify-center gap-1">
        <div className="bg-gray-200 rounded-full h-1.5 w-8">
          <div 
            className="h-1.5 rounded-full bg-orange-500"
            style={{ width: '100%' }}
          />
        </div>
        <span className="card-title text-gray-600">100%</span>
      </div>
    );
  }
  
  // items 배열이 없으면 전체 미완료로 처리
  if (!memoryPurchase.purchase_request_items || memoryPurchase.purchase_request_items.length === 0) {
    const progress = { completed: 0, total: 1, percentage: 0 };
    return (
      <div className="flex items-center justify-center gap-1">
        <div className="bg-gray-200 rounded-full h-1.5 w-8">
          <div 
            className="h-1.5 rounded-full bg-gray-300"
            style={{ width: '0%' }}
          />
        </div>
        <span className="card-title text-gray-600">0%</span>
      </div>
    );
  }
  
  // 개별 아이템 구매완료 상태 계산
  const total = memoryPurchase.purchase_request_items.length;
  const completed = memoryPurchase.purchase_request_items.filter((item: PurchaseRequestItem) =>
    item.is_payment_completed === true
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  

  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-gray-200 rounded-full h-1.5 w-8">
        <div 
          className={`h-1.5 rounded-full ${
            percentage === 100 ? 'bg-orange-500' : 
            percentage > 0 ? 'bg-orange-400' : 'bg-gray-300'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="card-title text-gray-600">{percentage}%</span>
    </div>
  );
});

PaymentProgressBar.displayName = 'PaymentProgressBar';

// 입고완료 진행률 컴포넌트 (입고현황 탭용)  
// 🚀 메모리 캐시 변경 감지를 위해 usePurchaseMemory 훅 사용
const ReceiptProgressBar = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory(); // 메모리 캐시 변경 감지용
  
  // 메모리에서 최신 데이터 조회 (실시간 업데이트 보장)
  const memoryPurchase = allPurchases?.find(p => p.id === purchase.id) || purchase;
  
  // items 배열이 없으면 전체 미입고로 처리
  if (!memoryPurchase.purchase_request_items || memoryPurchase.purchase_request_items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-1">
        <div className="bg-gray-200 rounded-full h-1.5 w-8">
          <div 
            className="h-1.5 rounded-full bg-gray-300"
            style={{ width: '0%' }}
          />
        </div>
        <span className="card-title text-gray-600">0%</span>
      </div>
    );
  }
  
  // 개별 아이템 실제 입고 상태 계산 (is_received 기준)
  const total = memoryPurchase.purchase_request_items.length;
  const received = memoryPurchase.purchase_request_items.filter((item: PurchaseRequestItem) =>
    item.is_received === true
  ).length;
  const percentage = total > 0 ? Math.round((received / total) * 100) : 0;

  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-gray-200 rounded-full h-1.5 w-8">
        <div 
          className={`h-1.5 rounded-full ${
            percentage === 100 ? 'bg-blue-500' : 
            percentage > 0 ? 'bg-blue-400' : 'bg-gray-300'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="card-title text-gray-600">{percentage}%</span>
    </div>
  );
});

ReceiptProgressBar.displayName = 'ReceiptProgressBar';

// 거래명세서 진행률 컴포넌트 (전체항목 탭용)  
// 🚀 메모리 캐시 변경 감지를 위해 usePurchaseMemory 훅 사용
const StatementProgressBar = memo(({ purchase }: { purchase: Purchase }) => {
  const { allPurchases } = usePurchaseMemory(); // 메모리 캐시 변경 감지용
  
  // 🚀 메모리에서 최신 데이터 가져오기 (실시간 업데이트 반영)
  const currentPurchase = useMemo(() => {
    if (!allPurchases) return purchase;
    const memoryPurchase = allPurchases.find(p => p.id === purchase.id);
    return memoryPurchase || purchase;
  }, [allPurchases, purchase.id, purchase]);

  // 거래명세서 완료 현황 계산
  const statementProgress = useMemo(() => {
    const items = currentPurchase.purchase_request_items || currentPurchase.items || [];
    if (items.length === 0) {
      return { completed: 0, total: 1, percentage: 0 };
    }
    
    const total = items.length;
    const completed = items.filter((item: PurchaseRequestItem) => item.is_statement_received === true).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return { completed, total, percentage };
  }, [currentPurchase]);

  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-gray-200 rounded-full h-1.5 w-8">
        <div 
          className={`h-1.5 rounded-full ${
            statementProgress.percentage === 100 ? 'bg-green-500' : 
            statementProgress.percentage > 0 ? 'bg-green-400' : 'bg-gray-300'
          }`}
          style={{ width: `${statementProgress.percentage}%` }}
        />
      </div>
      <span className="card-title text-gray-600">
        {statementProgress.percentage}%
      </span>
    </div>
  );
});

StatementProgressBar.displayName = 'StatementProgressBar';



// 선진행 구분 배지
const ProgressTypeBadge = memo(({ type }: { type?: string }) => {
  const isAdvance = type === '선진행' || type?.includes('선진행');
  
  if (isAdvance) {
    return (
      <span className="badge-stats bg-red-500 text-white">
        선진행
      </span>
    );
  }
  
  return (
    <span className="badge-stats bg-gray-500 text-white">
      일반
    </span>
  );
});

ProgressTypeBadge.displayName = 'ProgressTypeBadge';

// 테이블 행 컴포넌트 메모화
const TableRow = memo(({ purchase, onClick, activeTab, isLeadBuyer, onPaymentComplete, onReceiptComplete, onExcelDownload, onToggleUtkCheck, columnVisibility, vendorColumnWidth, currentUserRoles }: { 
  purchase: Purchase; 
  onClick: (purchase: Purchase) => void;
  activeTab?: string;
  isLeadBuyer?: boolean;
  onPaymentComplete?: (purchaseId: number) => Promise<void>;
  onReceiptComplete?: (purchaseId: number) => Promise<void>;
  onExcelDownload?: (purchase: Purchase) => Promise<void>;
  onToggleUtkCheck?: (purchase: Purchase) => Promise<void>;
  columnVisibility?: ColumnVisibility;
  vendorColumnWidth?: number;
  currentUserRoles?: string[];
}) => {
  const isAdvance = purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행');
  
  // 칼럼 가시성 헬퍼 함수
  const isVisible = (columnId: DoneTabColumnId) => {
    // 전체항목 탭이 아니면 모든 칼럼 표시
    if (!columnVisibility) return true;
    
    // 전체항목 탭인 경우 권한 체크
    if (activeTab === 'done' && RESTRICTED_COLUMNS.includes(columnId)) {
      // 권한 있는 역할이 있는지 확인
      const hasPermission = columnId === 'utk_status'
        ? currentUserRoles?.some(role => UTK_AUTHORIZED_ROLES.includes(role))
        : currentUserRoles?.some(role => AUTHORIZED_ROLES.includes(role));
      if (!hasPermission) return false;
    }
    
    return columnVisibility[columnId] !== false;
  };

  // UTK 확인(처리) 권한 (상세모달과 동일)
  const canUtkCheck = currentUserRoles?.some(role => UTK_AUTHORIZED_ROLES.includes(role)) ?? false;
  
  return (
    <tr 
      className={`border-b hover:bg-gray-100 cursor-pointer transition-colors ${isAdvance ? 'bg-red-50 hover:bg-red-100' : ''}`}
      onClick={() => onClick(purchase)}
    >
      {/* 승인대기 탭에서는 승인상태를 맨 앞에 표시 */}
      {activeTab === 'pending' && (
        <td className={`px-2 py-1.5 whitespace-nowrap ${COMMON_COLUMN_CLASSES.approvalStatus}`}>
          <ApprovalStatusBadge purchase={purchase} />
        </td>
      )}
      {/* 구매현황 탭에서는 구매진행을 맨 앞에 표시 */}
      {activeTab === 'purchase' && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
          <PaymentProgressBar purchase={purchase} activeTab={activeTab} />
        </td>
      )}
      {/* 입고현황 탭에서는 입고진행을 맨 앞에 표시 */}
      {activeTab === 'receipt' && isVisible('receipt_progress') && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
          <ReceiptProgressBar purchase={purchase} />
        </td>
      )}
      {/* 거래명세서 진행률 칼럼 */}
      {activeTab === 'done' && isVisible('statement_progress') && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
          <StatementProgressBar purchase={purchase} />
        </td>
      )}
      {/* 발주번호 칼럼 */}
      {isVisible('purchase_order_number') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>
        <div className="flex items-center gap-1">
          {/* 엑셀 다운로드 아이콘 - 항상 표시, 조건에 따라 활성화/비활성화 */}
          {onExcelDownload && (
            <img
              src="/excels-icon.svg"
              alt="엑셀 다운로드"
              width="16"
              height="16"
              className={`inline-block align-middle transition-transform p-0.5 rounded
                ${purchase.is_po_download ? 'border border-gray-400' : ''}
                ${(purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행') ||
                  (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved'))
                  ? (purchase.is_po_download ? 'cursor-pointer' : 'cursor-pointer hover:scale-110')
                  : 'opacity-40 grayscale cursor-not-allowed'}`}
              onClick={async (e: React.MouseEvent) => {
                if (purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행') ||
                    (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved')) {
                  e.stopPropagation();
                  await onExcelDownload(purchase);
                }
              }}
              style={{
                pointerEvents: (purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행') ||
                  (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved'))
                  ? 'auto' : 'none'
              }}
              title={purchase.is_po_download ? '다운로드 완료' : '엑셀 발주서 다운로드'}
            />
          )}
          <span className="block truncate" title={purchase.purchase_order_number || ''}>
            {purchase.purchase_order_number || '-'}
            {purchase.purchase_request_items && purchase.purchase_request_items.length > 1 && (
              <span className="text-gray-500 ml-0.5">({purchase.purchase_request_items.length})</span>
            )}
          </span>
        </div>
        </td>
      )}
      {/* 결제종류 칼럼 */}
      {isVisible('payment_category') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>
          <span className={`badge-stats ${
            purchase.payment_category === '구매요청' || purchase.payment_category === '구매 요청' ? 'bg-blue-500 text-white' :
            purchase.payment_category === '발주' ? 'bg-green-500 text-white' :
            purchase.payment_category === '현장결제' || purchase.payment_category === '현장 결제' ? 'bg-gray-500 text-white' :
            purchase.payment_category === '경비 청구' ? 'bg-gray-500 text-white' :
            'bg-gray-500 text-white'
          }`}>
            {(() => {
              // 표시 텍스트 통일
              if (purchase.payment_category === '발주') return '발주요청';
              if (purchase.payment_category === '구매 요청') return '구매요청';
              if (purchase.payment_category === '현장 결제') return '현장결제';
              return purchase.payment_category || '-';
            })()}
          </span>
        </td>
      )}
      {/* 요청자 칼럼 */}
      {isVisible('requester_name') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.requesterName}`}>
          <span className="block truncate" title={purchase.requester_name || ''}>
            {purchase.requester_name || '-'}
          </span>
        </td>
      )}
      {/* 청구일 칼럼 */}
      {isVisible('request_date') && (
        <td className={`py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.requestDate}`}>
          {formatDateShort(purchase.request_date)}
        </td>
      )}
      {/* UTK 확인 칼럼 */}
      {activeTab === 'done' && isVisible('utk_status') && (
        <td className={`pl-2 pr-3 py-1.5 card-title whitespace-nowrap text-center overflow-visible text-clip ${COMMON_COLUMN_CLASSES.utk}`}>
          {canUtkCheck ? (
            <button
              type="button"
              onClick={async (e: React.MouseEvent) => {
                e.stopPropagation();
                await onToggleUtkCheck?.(purchase);
              }}
              className={`${purchase.is_utk_checked ? 'badge-utk-complete' : 'badge-utk-pending'} mx-auto cursor-pointer`}
              title={purchase.is_utk_checked ? 'UTK 확인 취소' : 'UTK 확인'}
            >
              {purchase.is_utk_checked ? '완료' : '대기'}
            </button>
          ) : (
            <span className={purchase.is_utk_checked ? 'badge-utk-complete' : 'badge-utk-pending'}>
              {purchase.is_utk_checked ? '완료' : '대기'}
            </span>
          )}
        </td>
      )}
      {/* 업체 칼럼 */}
      {isVisible('vendor_name') && (
        <td 
          className={`pl-3 pr-2 py-1.5 card-title ${activeTab === 'done' ? COMMON_COLUMN_CLASSES.vendorName : 'vendor-dynamic-column'}`}
          style={activeTab === 'done' ? undefined : { 
            width: `${vendorColumnWidth || 80}px`, 
            minWidth: `${vendorColumnWidth || 80}px`, 
            maxWidth: `${vendorColumnWidth || 80}px` 
          }}
        >
          <span className="block truncate" title={purchase.vendor_name || ''}>
            {purchase.vendor_name || '-'}
          </span>
        </td>
      )}
      {/* 담당자 칼럼 */}
      {isVisible('contact_name') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.contactName}`}>
          <span className="block truncate" title={purchase.contact_name || ''}>
            {purchase.contact_name || '-'}
          </span>
        </td>
      )}
      {/* 입고요청일 칼럼 */}
      {isVisible('delivery_request_date') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.deliveryRequestDate} ${
          purchase.revised_delivery_request_date ? 'text-gray-400' : ''
        }`}>
          {formatDateShort(purchase.delivery_request_date)}
        </td>
      )}
      {/* 변경입고일 칼럼 */}
      {(activeTab === 'receipt' || activeTab === 'done') && isVisible('revised_delivery_date') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.revisedDeliveryRequestDate}`}>
          {formatDateShort(purchase.revised_delivery_request_date)}
        </td>
      )}
      {/* 품명 칼럼 */}
      {isVisible('item_name') && (
        <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.itemName}`}>
          <span className="block truncate" title={purchase.purchase_request_items?.[0]?.item_name || ''}>
            {purchase.purchase_request_items?.[0]?.item_name || '-'}
          </span>
        </td>
      )}
      {/* 규격 칼럼 */}
      {isVisible('specification') && (
        <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.specification}`}>
          <span className="block truncate" title={purchase.purchase_request_items?.[0]?.specification || ''}>
            {purchase.purchase_request_items?.[0]?.specification || '-'}
          </span>
        </td>
      )}
      {/* 수량 칼럼 */}
      {isVisible('quantity') && (
        (() => {
          // 모든 품목의 수량 합계 계산
          const quantity = purchase.purchase_request_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0
          const receivedQuantity = purchase.purchase_request_items?.reduce((sum, item) => sum + (item.received_quantity || 0), 0) || 0
          const isFullyReceived = quantity === receivedQuantity && receivedQuantity > 0
          const shouldWrap = (activeTab === 'receipt' || activeTab === 'done') && (quantity >= 100 || receivedQuantity >= 100) && !isFullyReceived
          
          return (
            <td className={`px-2 card-title ${COMMON_COLUMN_CLASSES.quantity} ${shouldWrap ? 'py-0.5' : 'py-1.5'}`}>
              {(activeTab === 'receipt' || activeTab === 'done') ? (
                (() => {
                  // 완전 입고 완료 시 실제 입고 수량만 검정색으로 표시
                  if (isFullyReceived) {
                    return <span className="text-gray-900">{receivedQuantity}</span>
                  }
                  
                  // 완전 입고되지 않은 경우 원래 색상 로직 유지
                  const hasReceived = receivedQuantity > 0
                  
                  if (shouldWrap) {
                    return (
                      <div className="flex flex-col items-center justify-center gap-px leading-tight text-[10px]">
                        <div className={hasReceived ? 'text-gray-400' : ''}>{quantity}</div>
                        <div className={hasReceived ? '' : 'text-gray-400'}>/{receivedQuantity}</div>
                      </div>
                    )
                  } else {
                    return (
                      <span className="whitespace-nowrap">
                        <span className={hasReceived ? 'text-gray-400' : ''}>{quantity}</span>
                        <span className={hasReceived ? '' : 'text-gray-400'}>/{receivedQuantity}</span>
                      </span>
                    )
                  }
                })()
              ) : (
                quantity || 0
              )}
            </td>
          )
        })()
      )}
      {/* 단가 칼럼 */}
      {isVisible('unit_price') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>
          {(() => {
            const itemCount = purchase.purchase_request_items?.length || 0
            
            // 품목이 2개 이상이면 '-' 표시
            if (itemCount > 1) {
              return '-'
            }
            
            // 품목이 1개면 단가 표시
            const unitPrice = purchase.purchase_request_items?.[0]?.unit_price_value || 0
            const currency = purchase.purchase_request_items?.[0]?.unit_price_currency || 'KRW'
            return `${unitPrice.toLocaleString()} ${getCurrencySymbol(currency)}`
          })()}
        </td>
      )}
      {/* 합계 칼럼 */}
      {isVisible('amount') && (
        <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>
          {(() => {
            // 모든 품목의 금액 합계 계산
            // 발주 카테고리인 경우 세액도 포함
            const totalAmount = purchase.purchase_request_items?.reduce((sum, item) => {
              const baseAmount = item.amount_value || 0
              const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0
              return sum + baseAmount + taxAmount
            }, 0) || 0
            const currency = purchase.purchase_request_items?.[0]?.amount_currency || purchase.currency || 'KRW'
            return `${totalAmount.toLocaleString()} ${getCurrencySymbol(currency)}`
          })()}
        </td>
      )}
      
      {/* 탭별 다른 칼럼 표시 */}
      {(activeTab === 'pending' || activeTab === 'purchase') && (
        <>
          {isVisible('remark') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.remark}`}>
              <span className="block truncate" title={purchase.purchase_request_items?.[0]?.remark || ''}>
                {purchase.purchase_request_items?.[0]?.remark || '-'}
              </span>
            </td>
          )}
          {activeTab === 'purchase' && isVisible('link') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.link}`}>
              {purchase.purchase_request_items?.[0]?.link ? (
                <a 
                  href={purchase.purchase_request_items?.[0]?.link} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-600 hover:text-blue-800 underline truncate block"
                  title={purchase.purchase_request_items?.[0]?.link}
                >
                  링크 보기
                </a>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </td>
          )}
          {isVisible('project_vendor') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectVendor}`}>
              <span className="block truncate" title={purchase.project_vendor || ''}>
                {purchase.project_vendor || '-'}
              </span>
            </td>
          )}
          {isVisible('project_item') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectItem}`}>
              <span className="block truncate" title={purchase.project_item || ''}>
                {purchase.project_item || '-'}
              </span>
            </td>
          )}
          {isVisible('sales_order_number') && (
            <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
              <span className="block truncate" title={purchase.sales_order_number || ''}>
                {purchase.sales_order_number || '-'}
              </span>
            </td>
          )}
        </>
      )}
      
      
      {activeTab === 'receipt' && (
        <>
          {isVisible('remark') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.remark}`}>
              <span className="block truncate" title={purchase.purchase_request_items?.[0]?.remark || ''}>
                {purchase.purchase_request_items?.[0]?.remark || '-'}
              </span>
            </td>
          )}
          {isVisible('project_vendor') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectVendor}`}>
              <span className="block truncate" title={purchase.project_vendor || ''}>
                {purchase.project_vendor || '-'}
              </span>
            </td>
          )}
          {isVisible('project_item') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectItem}`}>
              <span className="block truncate" title={purchase.project_item || ''}>
                {purchase.project_item || '-'}
              </span>
            </td>
          )}
          {isVisible('sales_order_number') && (
            <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
              <span className="block truncate" title={purchase.sales_order_number || ''}>
                {purchase.sales_order_number || '-'}
              </span>
            </td>
          )}
        </>
      )}
      
      {(activeTab === 'done' || !activeTab) && (
        <>
          {/* 비고 칼럼 */}
          {isVisible('remark') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.remark}`}>
              <span className="block truncate" title={purchase.purchase_request_items?.[0]?.remark || ''}>
                {purchase.purchase_request_items?.[0]?.remark || '-'}
              </span>
            </td>
          )}
          {/* 링크 칼럼 */}
          {isVisible('link') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.link}`}>
              {purchase.purchase_request_items?.[0]?.link ? (
                <a 
                  href={purchase.purchase_request_items?.[0]?.link} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-600 hover:text-blue-800 underline truncate block"
                  title={purchase.purchase_request_items?.[0]?.link}
                >
                  링크 보기
                </a>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </td>
          )}
          {/* PJ업체 칼럼 */}
          {isVisible('project_vendor') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectVendor}`}>
              <span className="block truncate" title={purchase.project_vendor || ''}>
                {purchase.project_vendor || '-'}
              </span>
            </td>
          )}
          {/* PJ ITEM 칼럼 */}
          {isVisible('project_item') && (
            <td className={`px-2 py-1.5 card-title ${COMMON_COLUMN_CLASSES.projectItem}`}>
              <span className="block truncate" title={purchase.project_item || ''}>
                {purchase.project_item || '-'}
              </span>
            </td>
          )}
          {/* 수주번호 칼럼 */}
          {isVisible('sales_order_number') && (
            <td className={`px-2 py-1.5 card-title whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
              <span className="block truncate" title={purchase.sales_order_number || ''}>
                {purchase.sales_order_number || '-'}
              </span>
            </td>
          )}
          {/* 구매진행 칼럼 */}
          {isVisible('purchase_progress') && activeTab !== 'purchase' && (
            <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.status}`}>
              <PaymentProgressBar purchase={purchase} activeTab={activeTab} />
            </td>
          )}
          {/* 입고진행 칼럼 */}
          {isVisible('receipt_progress') && (
            <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receipt} ${activeTab === 'done' ? 'column-progress' : ''}`}>
              <ReceiptProgressBar purchase={purchase} />
            </td>
          )}
        </>
      )}
      
    </tr>
  );
});

TableRow.displayName = 'TableRow';

// 메인 테이블 컴포넌트
const FastPurchaseTable = ({ 
  purchases, 
  activeTab = 'done', 
  currentUserRoles = [], 
  onRefresh,
  onOptimisticUpdate,
  onPaymentComplete,
  onReceiptComplete,
  columnVisibility
}: FastPurchaseTableProps) => {
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null);
  // vendorColumnWidth는 이제 useMemo로 직접 계산됨
  const supabase = createClient();

  // 권한 체크 - lead buyer와 app_admin만 구매완료/입고완료 버튼 사용 가능
  const isLeadBuyer = currentUserRoles && (
    currentUserRoles.includes('lead buyer') ||
    currentUserRoles.includes('app_admin')
  );
  

  // 권한 체크
  const canEdit = currentUserRoles.includes('final_approver') || 
                  currentUserRoles.includes('app_admin') || 
                  currentUserRoles.includes('ceo');
  
  const canDelete = canEdit;

  // 업체 칼럼 너비 직접 계산 (useState와 useEffect 제거로 렌더링 최적화)
  const vendorColumnWidth = useMemo(() => {
    if (!purchases || purchases.length === 0) return 80;

    // 탭별로 캐시된 계산값 사용을 위해 탭도 의존성에 추가
    const cacheKey = `${activeTab}-${purchases.length}`;
    
    let maxLength = 2; // "업체" 헤더 길이

    // 성능 최적화: 최대 100개 항목만 샘플링
    const sampleSize = Math.min(purchases.length, 100);
    const sampledPurchases = purchases.slice(0, sampleSize);
    
    sampledPurchases.forEach(purchase => {
      const vendorName = purchase.vendor_name || '';
      // 한글/영문 혼합 텍스트 길이 계산 (한글은 1.5배 가중치)
      const adjustedLength = vendorName.split('').reduce((acc, char) => {
        return acc + (/[가-힣]/.test(char) ? 1.5 : 1)
      }, 0);
      maxLength = Math.max(maxLength, Math.ceil(adjustedLength));
    });

    // 길이를 픽셀로 변환 (글자당 약 7px + 여백 20px)
    const calculatedWidth = Math.max(80, Math.min(200, maxLength * 7 + 20));
    logger.debug('🔍 [FastPurchaseTable] 업체 칼럼 너비 계산:', {
      activeTab,
      maxLength,
      calculatedWidth,
      sampleSize,
      firstVendor: sampledPurchases[0]?.vendor_name
    });
    return calculatedWidth;
  }, [purchases, activeTab]);

  const handleRowClick = useCallback((purchase: Purchase) => {
    setSelectedPurchaseId(purchase.id);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedPurchaseId(null);
  }, []);

  // UTK 확인 토글 (전체항목 테이블에서 사용)
  const handleToggleUtkCheck = useCallback(async (purchase: Purchase) => {
    if (!purchase?.id) return
    const isCurrentlyChecked = purchase.is_utk_checked || false
    const newStatus = !isCurrentlyChecked

    const confirmMessage = newStatus
      ? `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인 처리하시겠습니까?`
      : `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인을 취소하시겠습니까?`

    if (!window.confirm(confirmMessage)) return

    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update({ is_utk_checked: newStatus })
        .eq('id', purchase.id)

      if (error) {
        logger.error('UTK 확인 DB 업데이트 실패', { error, purchaseId: purchase.id })
        toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
        return
      }

      // 메모리 캐시 업데이트 (리스트 즉시 반영)
      updatePurchaseInMemory(purchase.id, (prev) => ({
        ...prev,
        is_utk_checked: newStatus
      }))

      toast.success(newStatus ? 'UTK 확인이 완료되었습니다.' : 'UTK 확인이 취소되었습니다.')

      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) {
        await refreshResult
      }
    } catch (err) {
      logger.error('UTK 확인 처리 중 오류', err)
      toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
    }
  }, [supabase, onRefresh]);

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = useCallback(async (purchase: Purchase) => {
    try {
      // DB에서 직접 모든 품목 조회
      const { data: purchaseRequest, error: requestError } = await supabase
        .from('purchase_requests')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .single();

      if (requestError || !purchaseRequest) {
        toast.error('해당 발주요청번호의 데이터를 찾을 수 없습니다.');
        return;
      }

      // 품목 데이터 조회
      const { data: orderItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .order('line_number');

      if (itemsError || !orderItems || orderItems.length === 0) {
        toast.error('해당 발주요청번호의 품목 데이터를 찾을 수 없습니다.');
        return;
      }

      // 업체 상세 정보 및 담당자 정보 조회
      const vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: '',
        vendor_payment_schedule: ''
      };

      try {
        const vendorId = purchaseRequest.vendor_id || purchase.vendor_id;
        const contactId = purchaseRequest.contact_id || purchase.contact_id;
        
        // vendor 정보 조회
        if (vendorId) {
          const { data: vendorData } = await supabase
            .from('vendors')
            .select('vendor_phone, vendor_fax, vendor_payment_schedule')
            .eq('id', vendorId)
            .single();

          if (vendorData) {
            vendorInfo.vendor_phone = vendorData.vendor_phone || '';
            vendorInfo.vendor_fax = vendorData.vendor_fax || '';
            vendorInfo.vendor_payment_schedule = vendorData.vendor_payment_schedule || '';
          }
        }

        // vendor_contacts에서 contact_id로 담당자 정보 조회
        if (contactId) {
          const { data: contactData } = await supabase
            .from('vendor_contacts')
            .select('contact_name, contact_phone, contact_email')
            .eq('id', contactId)
            .single();
          if (contactData) {
            vendorInfo.vendor_contact_name = contactData.contact_name || '';
          }
        }
      } catch (error) {
        // 업체 정보 조회 실패는 무시
      }

      const excelData: PurchaseOrderData = {
        purchase_order_number: purchaseRequest.purchase_order_number || '',
        request_date: purchaseRequest.request_date,
        delivery_request_date: purchaseRequest.delivery_request_date,
        requester_name: purchaseRequest.requester_name,
        vendor_name: vendorInfo.vendor_name || '',
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchaseRequest.project_vendor,
        sales_order_number: purchaseRequest.sales_order_number,
        project_item: purchaseRequest.project_item,
        vendor_payment_schedule: vendorInfo.vendor_payment_schedule,
        items: orderItems.map((item: PurchaseRequestItem) => ({
          line_number: item.line_number,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price_value,
          amount_value: item.amount_value,
          remark: item.remark,
          currency: purchaseRequest.currency || 'KRW'
        }))
      };

      // 코드 기반 ExcelJS 생성
      const blob = await generatePurchaseOrderExcelJS(excelData);
      
      // 다운로드용 파일명
      const downloadFilename = `발주서_${excelData.vendor_name}_${excelData.purchase_order_number}.xlsx`;

      // 다운로드 제공
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
      
      // DB에 다운로드 완료 플래그(is_po_download) 업데이트 - lead buyer만 해당
      try {
        const canUpdateFlag = currentUserRoles && (
          currentUserRoles.includes('lead buyer')
        );

        if (canUpdateFlag) {
          const { error: downloadFlagErr } = await supabase
            .from('purchase_requests')
            .update({ is_po_download: true })
            .eq('purchase_order_number', purchase.purchase_order_number);
          
          if (!downloadFlagErr) {
            // 화면 업데이트
            onRefresh?.();
          }
        }
      } catch (flagErr) {
        // 플래그 업데이트 실패는 무시
      }
    } catch (error) {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  }, [supabase]);

  const handleConfirmDelete = useCallback(async () => {
    if (!purchaseToDelete) {
      logger.error('[handleConfirmDelete] purchaseToDelete가 null입니다');
      toast.error('삭제할 발주요청을 찾을 수 없습니다.');
      return;
    }

    logger.info('🚀 [handleConfirmDelete] 삭제 시작', {
      purchaseId: purchaseToDelete.id,
      purchaseOrderNumber: purchaseToDelete.purchase_order_number,
      type: typeof purchaseToDelete.id
    });

    try {
      // Supabase 환경 변수 확인
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
        logger.warn('Supabase 환경 변수가 설정되지 않음 - FastPurchaseTable');
        toast.error("환경 설정 오류가 발생했습니다.");
        return;
      }

      // 현재 사용자 정보 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      
      if (authError || !user) {
        toast.error("로그인이 필요합니다.");
        return;
      }

      // 사용자 권한 확인
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, email, purchase_role')
        .eq('email', user.email)
        .single();


      if (empError || !employee) {
        toast.error("사용자 권한을 확인할 수 없습니다.");
        return;
      }

      // 권한 체크
      let roles: string[] = [];
      if (employee.purchase_role) {
        if (Array.isArray(employee.purchase_role)) {
          roles = employee.purchase_role.map((r: string) => String(r).trim());
        } else {
          const roleString = String(employee.purchase_role);
          roles = roleString.split(',').map((r: string) => r.trim()).filter((r: string) => r.length > 0);
        }
      }

      const canEdit = roles.includes('final_approver') || 
                      roles.includes('app_admin') || 
                      roles.includes('ceo');
      
      const isApproved = purchaseToDelete.final_manager_status === 'approved';
      const isRequester = purchaseToDelete.requester_name === employee.name;
      const canDeleteThis = isApproved ? canEdit : (canEdit || isRequester);


      if (!canDeleteThis) {
        logger.warn('[handleConfirmDelete] 삭제 권한 없음', {
          canEdit,
          isApproved,
          isRequester,
          roles,
          employeeName: employee.name
        });
        toast.error("삭제 권한이 없습니다.");
        return;
      }

      logger.info('✅ [handleConfirmDelete] 권한 확인 완료, 삭제 진행', {
        purchaseId: purchaseToDelete.id
      });

      // 모든 아이템 삭제
      logger.info('🗑️ [handleConfirmDelete] 품목 삭제 시작', {
        purchaseId: purchaseToDelete.id
      });
      
      const { data: deletedItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchaseToDelete.id)
        .select();

      if (itemsError) {
        logger.error('❌ [handleConfirmDelete] 아이템 삭제 중 오류 발생', itemsError, {
          code: itemsError.code,
          message: itemsError.message,
          details: itemsError.details,
          hint: itemsError.hint,
          purchaseId: purchaseToDelete.id
        });
        throw itemsError;
      }

      logger.info('✅ [handleConfirmDelete] 품목 삭제 완료', {
        purchaseId: purchaseToDelete.id,
        deletedItemsCount: deletedItems?.length || 0
      });

      // ID를 숫자로 변환하여 사용
      const purchaseIdForDelete = typeof purchaseToDelete.id === 'string' 
        ? parseInt(purchaseToDelete.id, 10) 
        : purchaseToDelete.id;
      
      if (isNaN(purchaseIdForDelete)) {
        logger.error('❌ [handleConfirmDelete] purchaseId 변환 실패', {
          originalId: purchaseToDelete.id,
          type: typeof purchaseToDelete.id
        });
        throw new Error('발주요청 ID가 유효하지 않습니다.');
      }

      // support_inquires 테이블에서 해당 purchase_request_id를 참조하는 레코드 처리
      // Foreign key constraint를 해결하기 위해 먼저 참조를 제거해야 함
      // ⚠️ 중요: 문의 기록(support_inquires)은 삭제하지 않고, purchase_request_id만 null로 업데이트
      logger.info('🗑️ [handleConfirmDelete] support_inquires 관련 레코드 처리 시작 (문의 기록 보존)', {
        purchaseId: purchaseIdForDelete
      });
      
      let inquiriesUpdated = false;
      let inquiriesCount = 0;
      
      try {
        const { data: relatedInquiries, error: inquiriesCheckError } = await supabase
          .from('support_inquires')
          .select('id, purchase_order_number')
          .eq('purchase_request_id', purchaseIdForDelete);

        if (inquiriesCheckError) {
          logger.warn('[handleConfirmDelete] support_inquires 조회 실패 (무시하고 계속 진행)', {
            error: inquiriesCheckError,
            purchaseId: purchaseIdForDelete
          });
        } else if (relatedInquiries && relatedInquiries.length > 0) {
          inquiriesCount = relatedInquiries.length;
          logger.info('🗑️ [handleConfirmDelete] support_inquires 레코드 업데이트 필요 (문의 기록 보존)', {
            purchaseId: purchaseIdForDelete,
            inquiriesCount: relatedInquiries.length,
            inquiryIds: relatedInquiries.map((i: { id: string | number }) => i.id),
            note: '문의 기록은 삭제하지 않고 purchase_request_id만 null로 업데이트합니다.'
          });
          
          // support_inquires에서 purchase_request_id를 null로 업데이트 (레코드 보존)
          // 문의 기록은 보존하되, 삭제되는 발주요청과의 연결만 제거
          const { data: updatedInquiries, error: inquiriesUpdateError } = await supabase
            .from('support_inquires')
            .update({ purchase_request_id: null })
            .eq('purchase_request_id', purchaseIdForDelete)
            .select();

          if (inquiriesUpdateError) {
            logger.error('❌ [handleConfirmDelete] support_inquires 업데이트 실패', {
              error: inquiriesUpdateError,
              purchaseId: purchaseIdForDelete,
              code: inquiriesUpdateError.code,
              message: inquiriesUpdateError.message,
              details: inquiriesUpdateError.details
            });
            // 업데이트 실패 시 삭제도 실패할 수 있으므로 에러를 던짐
            throw new Error(`문의 기록(${relatedInquiries.length}개)의 참조를 제거하지 못했습니다. 삭제를 중단합니다.`);
          } else {
            inquiriesUpdated = true;
            logger.info('✅ [handleConfirmDelete] support_inquires 업데이트 완료 (문의 기록 보존)', {
              purchaseId: purchaseIdForDelete,
              updatedCount: updatedInquiries?.length || relatedInquiries.length,
              updatedInquiryIds: updatedInquiries?.map((i: { id: string | number }) => i.id) || relatedInquiries.map((i: { id: string | number }) => i.id),
              note: '문의 기록은 그대로 보존되었고, purchase_request_id만 null로 변경되었습니다.'
            });
            
            // 업데이트 후 DB 동기화를 위해 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          logger.info('✅ [handleConfirmDelete] support_inquires 관련 레코드 없음', {
            purchaseId: purchaseIdForDelete
          });
        }
      } catch (inquiriesError) {
        logger.error('❌ [handleConfirmDelete] support_inquires 처리 중 예외 발생', {
          error: inquiriesError,
          purchaseId: purchaseIdForDelete
        });
        // 예외가 발생하면 삭제를 중단
        toast.error(`문의 기록 처리 중 오류가 발생했습니다: ${inquiriesError instanceof Error ? inquiriesError.message : '알 수 없는 오류'}`);
        throw inquiriesError;
      }

      // 발주요청 삭제
      logger.info('🗑️ [handleConfirmDelete] 발주기본정보 삭제 시작', {
        purchaseId: purchaseIdForDelete,
        idType: typeof purchaseToDelete.id,
        idValue: purchaseToDelete.id
      });
      
      // select() 없이 삭제 시도 (409 오류 방지)
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchaseIdForDelete);

      if (requestError) {
        logger.error('❌ [handleConfirmDelete] 발주요청 삭제 중 오류 발생', requestError, {
          code: requestError.code,
          message: requestError.message,
          details: requestError.details,
          hint: requestError.hint,
          purchaseId: purchaseIdForDelete,
          originalId: purchaseToDelete.id,
          note: '품목은 이미 삭제되었지만 발주요청은 삭제되지 않았습니다. 다른 테이블에서 참조하고 있을 수 있습니다.'
        });
        
        // 409 Conflict 또는 Foreign key violation 오류인 경우 더 자세한 메시지 제공
        if (requestError.code === '409' || 
            requestError.code === '23503' || 
            requestError.message?.includes('409') ||
            requestError.message?.includes('foreign key')) {
          const errorMsg = requestError.details || requestError.message || '다른 데이터에서 참조하고 있습니다.';
          logger.error('❌ [handleConfirmDelete] Foreign key constraint 위반', {
            code: requestError.code,
            message: requestError.message,
            details: requestError.details,
            hint: requestError.hint,
            purchaseId: purchaseIdForDelete
          });
          toast.error(`삭제할 수 없습니다: ${errorMsg} 관리자에게 문의하세요.`);
        } else {
          throw requestError;
        }
        return;
      }

      logger.info('✅ [handleConfirmDelete] 발주기본정보 삭제 완료', {
        purchaseId: purchaseIdForDelete,
        originalId: purchaseToDelete.id,
        inquiriesPreserved: inquiriesUpdated ? `${inquiriesCount}개 문의 기록 보존됨` : '문의 기록 없음'
      });

      // 🚀 메모리 캐시에서 즉시 삭제 (구매완료 등과 동일한 패턴)
      const purchaseIdNumber = purchaseIdForDelete;
      const memoryUpdated = removePurchaseFromMemory(purchaseIdNumber);
      if (!memoryUpdated) {
        logger.warn('[handleConfirmDelete] 메모리 캐시에서 발주서 삭제 실패', { 
          purchaseId: purchaseIdNumber,
          originalId: purchaseToDelete.id
        });
      } else {
        logger.info('✅ [handleConfirmDelete] 메모리 캐시에서 발주서 삭제 성공', { 
          purchaseId: purchaseIdNumber,
          originalId: purchaseToDelete.id
        });
      }

      // 삭제 성공 메시지 (문의 기록 보존 여부 포함)
      if (inquiriesUpdated && inquiriesCount > 0) {
        toast.success(`발주요청이 삭제되었습니다. (${inquiriesCount}개의 문의 기록은 보존되었습니다)`);
      } else {
        toast.success("발주요청 내역이 삭제되었습니다.");
      }
      
      // 삭제 완료 후 모달 닫기 (상세 모달과 삭제 확인 다이얼로그 모두 닫기)
      setIsModalOpen(false);
      setSelectedPurchaseId(null);
      setDeleteConfirmOpen(false);
      setPurchaseToDelete(null);
      
      // 데이터 새로고침 (강제 새로고침) - 메모리 캐시 업데이트 후 UI 갱신
      // 메모리 캐시가 이미 업데이트되었으므로 즉시 새로고침
      if (onRefresh) {
        try {
          await onRefresh(true, { silent: false });
          logger.info('✅ [handleConfirmDelete] 데이터 새로고침 완료');
        } catch (refreshError) {
          logger.error('❌ [handleConfirmDelete] 데이터 새로고침 실패', refreshError);
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error('❌ [handleConfirmDelete] 발주요청 삭제 중 예외 발생', errorObj, {
        name: errorObj.name,
        message: errorObj.message,
        code: (error as { code?: string })?.code,
        details: (error as { details?: string })?.details,
        hint: (error as { hint?: string })?.hint,
        stack: errorObj.stack,
        purchaseId: purchaseToDelete?.id,
        purchaseOrderNumber: purchaseToDelete?.purchase_order_number
      });
      toast.error(`삭제 중 오류가 발생했습니다: ${errorObj.message || '알 수 없는 오류'}`);
    } finally {
      setDeleteConfirmOpen(false);
      setPurchaseToDelete(null);
    }
  }, [supabase, purchaseToDelete, onRefresh]);

  // 칼럼 표시 여부 체크 함수
  const isColumnVisible = useCallback((columnId: DoneTabColumnId) => {
    if (!columnVisibility) return true; // columnVisibility가 없으면 모든 칼럼 표시
    
    // 전체항목 탭인 경우 권한 체크
    if (activeTab === 'done' && RESTRICTED_COLUMNS.includes(columnId)) {
      // 권한 있는 역할이 있는지 확인
      const hasPermission = currentUserRoles?.some(role => AUTHORIZED_ROLES.includes(role));
      if (!hasPermission) return false;
    }
    
    return columnVisibility[columnId] !== false;
  }, [columnVisibility, activeTab, currentUserRoles]);

  // 탭별 테이블 헤더 메모화
  const tableHeader = useMemo(() => {
    if (activeTab === 'pending') {
      return (
        <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
          <tr>
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.approvalStatus}`}>승인상태</th>
            {isColumnVisible('purchase_order_number') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>발주번호</th>
            )}
            {isColumnVisible('payment_category') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>결제종류</th>
            )}
            {isColumnVisible('requester_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName}`}>요청자</th>
            )}
            {isColumnVisible('request_date') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requestDate}`}>청구일</th>
            )}
            {isColumnVisible('vendor_name') && (
              <th 
                className="px-2 py-1.5 modal-label text-gray-900 text-left vendor-dynamic-column"
                style={{ 
                  width: `${vendorColumnWidth || 80}px`, 
                  minWidth: `${vendorColumnWidth || 80}px`, 
                  maxWidth: `${vendorColumnWidth || 80}px` 
                }}
              >업체</th>
            )}
            {isColumnVisible('contact_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName}`}>담당자</th>
            )}
            {isColumnVisible('delivery_request_date') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>입고요청일</th>
            )}
            {isColumnVisible('item_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.itemName}`}>품명</th>
            )}
            {isColumnVisible('specification') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.specification}`}>규격</th>
            )}
            {isColumnVisible('quantity') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity}`}>요청수량</th>
            )}
            {isColumnVisible('unit_price') && (
              <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>단가</th>
            )}
            {isColumnVisible('amount') && (
              <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>합계</th>
            )}
            {isColumnVisible('remark') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
            )}
            {isColumnVisible('project_vendor') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
            )}
            {isColumnVisible('project_item') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
            )}
            {isColumnVisible('sales_order_number') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
            )}
          </tr>
        </thead>
      );
    }
    
    if (activeTab === 'purchase') {
      return (
        <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
          <tr>
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress}`}>구매진행</th>
            {isColumnVisible('purchase_order_number') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>발주번호</th>
            )}
            {isColumnVisible('payment_category') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>결제종류</th>
            )}
            {isColumnVisible('requester_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName}`}>요청자</th>
            )}
            {isColumnVisible('request_date') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requestDate}`}>청구일</th>
            )}
            {isColumnVisible('vendor_name') && (
              <th 
                className="px-2 py-1.5 modal-label text-gray-900 text-left vendor-dynamic-column"
                style={{ 
                  width: `${vendorColumnWidth || 80}px`, 
                  minWidth: `${vendorColumnWidth || 80}px`, 
                  maxWidth: `${vendorColumnWidth || 80}px` 
                }}
              >업체</th>
            )}
            {isColumnVisible('contact_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName}`}>담당자</th>
            )}
            {isColumnVisible('delivery_request_date') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>입고요청일</th>
            )}
            {isColumnVisible('item_name') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.itemName}`}>품명</th>
            )}
            {isColumnVisible('specification') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.specification}`}>규격</th>
            )}
            {isColumnVisible('quantity') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity}`}>요청수량</th>
            )}
            {isColumnVisible('unit_price') && (
              <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>단가</th>
            )}
            {isColumnVisible('amount') && (
              <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>합계</th>
            )}
            {isColumnVisible('remark') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
            )}
            {activeTab === 'purchase' && isColumnVisible('link') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.link}`}>링크</th>
            )}
            {isColumnVisible('project_vendor') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
            )}
            {isColumnVisible('project_item') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
            )}
            {isColumnVisible('sales_order_number') && (
              <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
            )}
          </tr>
        </thead>
      );
    }
    
    const baseHeaders = (
      <>
        {isColumnVisible('purchase_order_number') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>발주번호</th>
        )}
        {isColumnVisible('payment_category') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>결제종류</th>
        )}
        {isColumnVisible('requester_name') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName}`}>요청자</th>
        )}
        {isColumnVisible('request_date') && (
          <th className={`py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.requestDate}`}>청구일</th>
        )}
        {/* 전체항목 탭에서만 UTK 확인 칼럼 헤더 표시 */}
        {activeTab === 'done' && isColumnVisible('utk_status') && (
          <th className={`pl-2 pr-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center ${COMMON_COLUMN_CLASSES.utk}`}>UTK</th>
        )}
        {isColumnVisible('vendor_name') && (
          <th 
            className={`px-2 py-1.5 modal-label text-gray-900 text-left ${activeTab === 'done' ? COMMON_COLUMN_CLASSES.vendorName : 'vendor-dynamic-column'}`}
            style={activeTab === 'done' ? undefined : { 
              width: `${vendorColumnWidth || 80}px`, 
              minWidth: `${vendorColumnWidth || 80}px`, 
              maxWidth: `${vendorColumnWidth || 80}px` 
            }}
          >업체</th>
        )}
        {isColumnVisible('contact_name') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName}`}>담당자</th>
        )}
        {isColumnVisible('delivery_request_date') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>입고요청일</th>
        )}
        {(activeTab === 'receipt' || activeTab === 'done') && isColumnVisible('revised_delivery_date') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.revisedDeliveryRequestDate}`}>변경 입고일</th>
        )}
        {isColumnVisible('item_name') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.itemName}`}>품명</th>
        )}
        {isColumnVisible('specification') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 text-left ${COMMON_COLUMN_CLASSES.specification}`}>규격</th>
        )}
        {isColumnVisible('quantity') && (
          <th className={`px-2 py-1.5 modal-label text-gray-900 ${COMMON_COLUMN_CLASSES.quantity}`}>
            {(activeTab === 'receipt' || activeTab === 'done') ? (
              <div className="flex flex-col items-center leading-tight">
                <div className="text-[9px]">요청/실제</div>
                <div className="text-[10px]">입고수량</div>
              </div>
            ) : (
              '요청수량'
            )}
          </th>
        )}
        {isColumnVisible('unit_price') && (
          <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>단가</th>
        )}
        {isColumnVisible('amount') && (
          <th className={`px-2 py-1.5 table-header-text text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>(총 품목)합계</th>
        )}
      </>
    );

    let additionalHeaders = null;
    
    if (activeTab === 'receipt') {
      additionalHeaders = (
        <>
          {isColumnVisible('remark') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
          )}
          {isColumnVisible('project_vendor') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
          )}
          {isColumnVisible('project_item') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
          )}
          {isColumnVisible('sales_order_number') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
          )}
        </>
      );
    } else if (activeTab === 'done') {
      // 전체항목 탭
      additionalHeaders = (
        <>
          {isColumnVisible('remark') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
          )}
          {isColumnVisible('link') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.link}`}>링크</th>
          )}
          {isColumnVisible('project_vendor') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
          )}
          {isColumnVisible('project_item') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
          )}
          {isColumnVisible('sales_order_number') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
          )}
          {isColumnVisible('purchase_progress') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.status}`}>구매진행</th>
          )}
          {isColumnVisible('receipt_progress') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receipt}`}>입고진행</th>
          )}
        </>
      );
    }

    return (
      <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
        <tr>
          {/* 입고현황 탭에서는 입고진행을 맨 앞에 */}
          {activeTab === 'receipt' && isColumnVisible('receipt_progress') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress}`}>입고진행</th>
          )}
          {/* 전체항목 탭에서는 거래명세서 진행률을 맨 앞에 */}
          {activeTab === 'done' && isColumnVisible('statement_progress') && (
            <th className={`px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress}`}>거래명세서</th>
          )}
          {baseHeaders}
          {additionalHeaders}
        </tr>
      </thead>
    );
  }, [activeTab, isColumnVisible, vendorColumnWidth]);

  // 숨겨진 칼럼이 있는지 확인하여 테이블 클래스 동적 적용
  const shouldUseFitLayout = useMemo(() => {
    if (!columnVisibility) return false;
    const hasHidden = Object.values(columnVisibility).some(visible => !visible);
    if (!hasHidden) return false;
    return true;
  }, [columnVisibility]);

  // 가상 스크롤 사용 여부 결정 (100개 이상 항목일 때)
  const shouldUseVirtualScroll = useMemo(() => {
    return purchases.length >= 100;
  }, [purchases.length]);

  return (
    <>
      {/* 데스크톱 테이블 뷰 - 실제 데이터 1,979건 분석 기반 최적 너비 */}
      <div className="hidden md:block w-full max-w-full">
        
{shouldUseVirtualScroll ? (
          // 진짜 가상 스크롤 테이블 (100개 이상 항목) - DOM 노드 대폭 감소
          <VirtualScrollTable
            purchases={purchases}
            activeTab={activeTab}
            onRowClick={handleRowClick}
            isLeadBuyer={isLeadBuyer}
            onPaymentComplete={onPaymentComplete}
            onReceiptComplete={onReceiptComplete}
            onExcelDownload={handleExcelDownload}
            onToggleUtkCheck={handleToggleUtkCheck}
            columnVisibility={columnVisibility}
            vendorColumnWidth={vendorColumnWidth}
            tableHeader={tableHeader}
            TableRowComponent={TableRow}
            shouldUseFitLayout={shouldUseFitLayout}
            currentUserRoles={currentUserRoles}
          />
        ) : (
          // 기존 테이블 (100개 미만 항목)
          <div className={shouldUseFitLayout ? 'table-container-fit-left max-h-[70vh] overflow-auto' : 'overflow-x-auto overflow-y-auto max-h-[70vh] border rounded-lg'}>
            <table className={shouldUseFitLayout ? `table-fit-left ${activeTab}-tab` : 'w-full min-w-[1790px] border-collapse'}>
              {tableHeader}
              <tbody>
                {purchases.map((purchase) => (
                  <TableRow 
                    key={purchase.id} 
                    purchase={purchase} 
                    onClick={handleRowClick}
                    activeTab={activeTab}
                    isLeadBuyer={isLeadBuyer}
                    onPaymentComplete={onPaymentComplete}
                    onReceiptComplete={onReceiptComplete}
                    onExcelDownload={handleExcelDownload}
                    onToggleUtkCheck={handleToggleUtkCheck}
                    vendorColumnWidth={vendorColumnWidth}
                    columnVisibility={columnVisibility}
                    currentUserRoles={currentUserRoles}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* 태블릿 컴팩트 뷰 */}
      <div className="hidden sm:block md:hidden w-full">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-[600px] card-title">
            <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
              <tr>
                <th className="text-left p-2 modal-label text-gray-900 w-24">발주번호</th>
                <th className="text-left p-2 modal-label text-gray-900 w-16">요청자</th>
                <th className="text-left p-2 modal-label text-gray-900 vendor-dynamic-column" style={{ width: `${vendorColumnWidth || 80}px` }}>업체</th>
                <th className="text-left p-2 modal-label text-gray-900 w-32">품명</th>
                <th className="text-right p-2 modal-label text-gray-900 w-20">금액</th>
                <th className="text-center p-2 modal-label text-gray-900 w-16">상태</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr 
                  key={purchase.id}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleRowClick(purchase)}
                >
                  <td className="p-2 modal-value">{purchase.purchase_order_number || '-'}</td>
                  <td className="p-2">{purchase.requester_name}</td>
                  <td className="p-2 truncate" title={purchase.vendor_name}>{purchase.vendor_name}</td>
                  <td className="p-2 truncate" title={purchase.purchase_request_items?.[0]?.item_name}>{purchase.purchase_request_items?.[0]?.item_name || '-'}</td>
                  <td className="p-2 text-right card-amount">
                    {purchase.purchase_request_items?.[0]?.amount_value ? `${purchase.purchase_request_items[0].amount_value.toLocaleString()} ${getCurrencySymbol(purchase.purchase_request_items[0]?.amount_currency || 'KRW')}` : purchase.total_amount ? `${purchase.total_amount.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : `0 ${getCurrencySymbol(purchase.currency || 'KRW')}`}
                  </td>
                  <td className="p-2 text-center">
                    <StatusBadge purchase={purchase} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* 모바일 카드 뷰 */}
      <div className="sm:hidden space-y-3">
        {purchases.map((purchase) => (
          <MobilePurchaseCard
            key={purchase.id}
            purchase={purchase}
            onClick={() => handleRowClick(purchase)}
          />
        ))}
      </div>
      
      {/* 통합 상세/편집 모달 */}
      <PurchaseDetailModal
        purchaseId={selectedPurchaseId}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        currentUserRoles={currentUserRoles}
        activeTab={activeTab}
        onRefresh={onRefresh}
        onOptimisticUpdate={onOptimisticUpdate}
        onDelete={(purchase) => {
          logger.info('🗑️ [FastPurchaseTable] 삭제 버튼 클릭', {
            purchaseId: purchase.id,
            purchaseOrderNumber: purchase.purchase_order_number,
            type: typeof purchase.id
          });
          setPurchaseToDelete(purchase as unknown as Purchase);
          setDeleteConfirmOpen(true);
        }}
      />

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => {
        setDeleteConfirmOpen(open);
        if (!open) {
          // 다이얼로그가 닫힐 때 purchaseToDelete 초기화
          setPurchaseToDelete(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>발주요청 내역 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              발주요청번호 <strong>{purchaseToDelete?.purchase_order_number || '알 수 없음'}</strong>를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                logger.info('✅ [FastPurchaseTable] 삭제 확인 버튼 클릭', {
                  purchaseId: purchaseToDelete?.id,
                  purchaseOrderNumber: purchaseToDelete?.purchase_order_number
                });
                await handleConfirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

FastPurchaseTable.displayName = 'FastPurchaseTable';

export default FastPurchaseTable;