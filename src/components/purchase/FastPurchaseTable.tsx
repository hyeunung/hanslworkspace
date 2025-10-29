import { memo, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import PurchaseDetailModal from "./PurchaseDetailModal";
import MobilePurchaseCard from "./MobilePurchaseCard";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";
import { formatDateShort } from "@/utils/helpers";
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
import { Purchase, PurchaseRequestWithDetails } from "@/types/purchase";

interface FastPurchaseTableProps {
  purchases: Purchase[];
  activeTab?: string; // 현재 활성 탭
  currentUserRoles?: string[];
  onRefresh?: () => void;
  onPaymentComplete?: (purchaseId: number) => Promise<void>;
  onReceiptComplete?: (purchaseId: number) => Promise<void>;
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
    completed: { text: '입고완료', className: 'bg-green-100 text-green-800' },
    inProgress: { text: '구매진행', className: 'bg-hansl-100 text-hansl-800' },
    rejected: { text: '반려', className: 'bg-red-100 text-red-800' },
    pending: { text: '승인대기', className: 'bg-yellow-100 text-yellow-800' }
  };
  
  const { text, className } = config[status];
  return <Badge className={className}>{text}</Badge>;
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
  purchaseOrderNumber: "pl-2 w-36 min-w-[145px] max-w-[145px]",      // 발주번호 + 엑셀아이콘
  paymentCategory: "text-center w-20 min-w-[85px] max-w-[85px]",
  requesterName: "w-16 min-w-[68px] max-w-[68px]",
  requestDate: "w-20 min-w-[85px] max-w-[85px]",
  vendorName: "w-28 min-w-[115px] max-w-[115px]",
  contactName: "w-16 min-w-[68px] max-w-[68px]",
  deliveryRequestDate: "w-20 min-w-[85px] max-w-[85px]",
  itemName: "w-28 min-w-[120px] max-w-[120px]",                       // 평균 7.8자 + 여유
  specification: "w-64 min-w-[260px] max-w-[260px]",                  // 평균 15.5자 + 여유 (조금 더 길게)
  quantity: "text-center w-14 min-w-[60px] max-w-[60px]",
  unitPrice: "text-right w-24 min-w-[100px] max-w-[100px]",
  amount: "text-right w-24 min-w-[100px] max-w-[100px]",
  
  // 탭별 특화 컬럼들 (고정 너비)
  remark: "w-28 min-w-[115px] max-w-[115px]",                         // 평균 1.8자, 대부분 비어있음
  paymentSchedule: "w-24 min-w-[100px] max-w-[100px]",
  purchaseStatus: "text-center w-20 min-w-[85px] max-w-[85px]",
  projectVendor: "w-24 min-w-[105px] max-w-[105px]",                  // 평균 6.6자
  salesOrderNumber: "w-28 min-w-[115px] max-w-[115px]",               // 평균 8.6자
  projectItem: "w-44 min-w-[180px] max-w-[180px]",                    // 평균 11.1자 + 여유 (조금 더 길게)
  receiptProgress: "text-center w-20 min-w-[85px] max-w-[85px]",
  status: "text-center w-20 min-w-[85px] max-w-[85px]",
  receipt: "text-center w-16 min-w-[70px] max-w-[70px]",
  paymentStatus: "text-center w-16 min-w-[70px] max-w-[70px]",
  link: "w-20 min-w-[85px] max-w-[85px]"
};

// 승인 상태 상세 표시 컴포넌트 (승인대기 탭용)
const ApprovalStatusBadge = memo(({ purchase }: { purchase: Purchase }) => {
  const middleApproved = purchase.middle_manager_status === 'approved';
  const middleRejected = purchase.middle_manager_status === 'rejected';
  const finalApproved = purchase.final_manager_status === 'approved';
  const finalRejected = purchase.final_manager_status === 'rejected';

  // 전체 상태 결정
  if (middleRejected || finalRejected) {
    // 하나라도 반려면 반려 표시
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5">
          <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
        </div>
        <Badge className="bg-red-100 text-red-800 text-[11px] font-medium px-1.5 py-0">
          반려
        </Badge>
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
        <Badge className="bg-green-100 text-green-800 text-[11px] font-medium px-1.5 py-0">
          승인완료
        </Badge>
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
        <Badge className="bg-yellow-100 text-yellow-800 text-[11px] font-medium px-1.5 py-0">
          1차 승인
        </Badge>
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
      <Badge className="bg-gray-100 text-gray-600 text-[11px] font-medium px-1.5 py-0">
        승인대기
      </Badge>
    </div>
  );
});

ApprovalStatusBadge.displayName = 'ApprovalStatusBadge';

// 입고 현황 계산 함수
const getReceiptProgress = (purchase: Purchase) => {
  // purchase_requests 테이블의 is_received 필드 우선 체크
  if (purchase.is_received) {
    return { received: 1, total: 1, percentage: 100 };
  }
  
  // items 배열이 없으면 전체 미입고로 처리
  if (!purchase.items || purchase.items.length === 0) {
    return { received: 0, total: 1, percentage: 0 };
  }
  
  // 개별 아이템 입고 상태 계산
  const total = purchase.items.length;
  const received = purchase.items.filter((item: any) => 
    item.is_received === true
  ).length;
  const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
  
  return { received, total, percentage };
};

// 구매완료 현황 계산 함수
const getPaymentProgress = (purchase: Purchase) => {
  // purchase_requests 테이블의 is_payment_completed 필드 우선 체크
  if (purchase.is_payment_completed) {
    return { completed: 1, total: 1, percentage: 100 };
  }
  
  // items 배열이 없으면 전체 미완료로 처리
  if (!purchase.items || purchase.items.length === 0) {
    return { completed: 0, total: 1, percentage: 0 };
  }
  
  // 개별 아이템 구매완료 상태 계산
  const total = purchase.items.length;
  const completed = purchase.items.filter((item: any) => 
    item.is_payment_completed === true
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return { completed, total, percentage };
};

// 구매진행 현황 계산 함수 (purchase_request_items 기반)
const getPurchaseProgress = (purchase: Purchase) => {
  // items 배열이 없으면 전체 상태로 판단
  if (!purchase.items || purchase.items.length === 0) {
    if (purchase.is_received) return { percentage: 100 };
    if (purchase.is_payment_completed) return { percentage: 80 };
    
    const middleRejected = purchase.middle_manager_status === 'rejected';
    const finalRejected = purchase.final_manager_status === 'rejected';
    if (middleRejected || finalRejected) return { percentage: 0 };
    
    const middleApproved = purchase.middle_manager_status === 'approved';
    const finalApproved = purchase.final_manager_status === 'approved';
    if (middleApproved && finalApproved) return { percentage: 40 };
    
    return { percentage: 20 };
  }
  
  // 개별 아이템 기반 진행률 계산
  const total = purchase.items.length;
  const receivedItems = purchase.items.filter((item: any) => item.is_received === true).length;
  const paymentCompletedItems = purchase.items.filter((item: any) => item.is_payment_completed === true).length;
  
  // 모든 아이템이 입고완료된 경우 100%
  if (receivedItems === total) {
    return { percentage: 100 };
  }
  
  // 일부 아이템이라도 입고완료된 경우 80% + (입고완료율 * 20%)
  if (receivedItems > 0) {
    const receiptPercentage = Math.round((receivedItems / total) * 100);
    return { percentage: Math.min(80 + Math.round(receiptPercentage * 0.2), 99) };
  }
  
  // 모든 아이템이 구매완료된 경우 80%
  if (paymentCompletedItems === total) {
    return { percentage: 80 };
  }
  
  // 일부 아이템이라도 구매완료된 경우 40% + (구매완료율 * 40%)
  if (paymentCompletedItems > 0) {
    const paymentPercentage = Math.round((paymentCompletedItems / total) * 100);
    return { percentage: Math.min(40 + Math.round(paymentPercentage * 0.4), 79) };
  }
  
  // 승인 상태에 따른 기본 진행률
  const middleRejected = purchase.middle_manager_status === 'rejected';
  const finalRejected = purchase.final_manager_status === 'rejected';
  if (middleRejected || finalRejected) return { percentage: 0 };
  
  const middleApproved = purchase.middle_manager_status === 'approved';
  const finalApproved = purchase.final_manager_status === 'approved';
  if (middleApproved && finalApproved) return { percentage: 40 };
  
  return { percentage: 20 };
};

// formatDateShort는 utils/helpers.ts에서 import

// 선진행 구분 배지
const ProgressTypeBadge = memo(({ type }: { type?: string }) => {
  const isAdvance = type === '선진행' || type?.includes('선진행');
  
  if (isAdvance) {
    return (
      <Badge className="bg-red-500 text-white font-bold text-[11px] px-2 py-0.5">
        선진행
      </Badge>
    );
  }
  
  return (
    <Badge className="bg-gray-200 text-gray-700 text-[11px] px-2 py-0.5">
      일반
    </Badge>
  );
});

ProgressTypeBadge.displayName = 'ProgressTypeBadge';

// 테이블 행 컴포넌트 메모화
const TableRow = memo(({ purchase, onClick, activeTab, isLeadBuyer, onPaymentComplete, onReceiptComplete, onExcelDownload }: { 
  purchase: Purchase; 
  onClick: (purchase: Purchase) => void;
  activeTab?: string;
  isLeadBuyer?: boolean;
  onPaymentComplete?: (purchaseId: number) => Promise<void>;
  onReceiptComplete?: (purchaseId: number) => Promise<void>;
  onExcelDownload?: (purchase: Purchase) => Promise<void>;
}) => {
  const receiptProgress = getReceiptProgress(purchase);
  const paymentProgress = getPaymentProgress(purchase);
  const purchaseProgress = getPurchaseProgress(purchase);
  const isAdvance = purchase.progress_type === '선진행' || purchase.progress_type?.includes('선진행');
  
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
      {/* 구매현황 탭에서는 구매완료 진행률만 표시 */}
      {activeTab === 'purchase' && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
          <div className="flex items-center justify-center gap-1">
            <div className="bg-gray-200 rounded-full h-1.5 w-8">
              <div 
                className={`h-1.5 rounded-full ${
                  paymentProgress.percentage === 100 ? 'bg-blue-500' : 
                  paymentProgress.percentage > 0 ? 'bg-blue-400' : 'bg-gray-300'
                }`}
                style={{ width: `${paymentProgress.percentage}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-600">
              {paymentProgress.percentage}%
            </span>
          </div>
        </td>
      )}
      {/* 입고현황 탭에서는 입고진행을 맨 앞에 표시 */}
      {activeTab === 'receipt' && (
        <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receiptProgress}`}>
          <div className="flex items-center justify-center gap-1">
            <div className="bg-gray-200 rounded-full h-1.5 w-8">
              <div 
                className={`h-1.5 rounded-full ${
                  receiptProgress.percentage === 100 ? 'bg-green-500' : 
                  receiptProgress.percentage > 0 ? 'bg-hansl-500' : 'bg-gray-300'
                }`}
                style={{ width: `${receiptProgress.percentage}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-600">
              {receiptProgress.percentage}%
            </span>
          </div>
        </td>
      )}
      <td className={`px-2 py-1.5 font-medium text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>
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
            {purchase.items && purchase.items.length > 1 && (
              <span className="text-gray-500 ml-0.5">({purchase.items.length})</span>
            )}
          </span>
        </div>
      </td>
      {/* 승인대기, 입고현황, 전체항목 탭에서만 결제종류 표시 */}
      {(activeTab === 'pending' || activeTab === 'receipt' || activeTab === 'done' || !activeTab) && (
        <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>
          <Badge className={`text-[11px] ${
            purchase.payment_category === '구매 요청' ? 'bg-blue-100 text-blue-800' : 
            purchase.payment_category === '발주' ? 'bg-green-100 text-green-800' :
            purchase.payment_category === '경비 청구' ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {(() => {
              // 표시 텍스트 통일
              if (purchase.payment_category === '구매 요청') return '구매요청';
              if (purchase.payment_category === '발주') return '발주요청';
              return purchase.payment_category || '-';
            })()}
          </Badge>
        </td>
      )}
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.requesterName}`}>
        <span className="block truncate" title={purchase.requester_name || ''}>
          {purchase.requester_name || '-'}
        </span>
      </td>
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.requestDate}`}>
        {formatDateShort(purchase.request_date)}
      </td>
      <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.vendorName}`}>
        <span className="block truncate" title={purchase.vendor_name || ''}>
          {purchase.vendor_name || '-'}
        </span>
      </td>
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.contactName}`}>
        <span className="block truncate" title={purchase.contact_name || ''}>
          {purchase.contact_name || '-'}
        </span>
      </td>
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>
        {formatDateShort(purchase.delivery_request_date)}
      </td>
      <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.itemName}`}>
        <span className="block truncate" title={purchase.item_name || ''}>
          {purchase.item_name || '-'}
        </span>
      </td>
      <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.specification}`}>
        <span className="block truncate" title={purchase.specification || ''}>
          {purchase.specification || '-'}
        </span>
      </td>
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity}`}>
        {purchase.quantity || 0}
      </td>
      <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>
        {purchase.unit_price_value ? `${purchase.unit_price_value.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : `0 ${getCurrencySymbol(purchase.currency || 'KRW')}`}
      </td>
      <td className={`px-2 py-1.5 text-[11px] font-medium whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>
        {purchase.amount_value ? `${purchase.amount_value.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : purchase.total_amount ? `${purchase.total_amount.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : `0 ${getCurrencySymbol(purchase.currency || 'KRW')}`}
      </td>
      
      {/* 탭별 다른 칼럼 표시 */}
      {activeTab === 'pending' && (
        <>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.remark}`}>
            <span className="block truncate" title={purchase.remark || ''}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectVendor}`}>
            <span className="block truncate" title={purchase.project_vendor || ''}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectItem}`}>
            <span className="block truncate" title={purchase.project_item || ''}>
              {purchase.project_item || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
            <span className="block truncate" title={purchase.sales_order_number || ''}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
        </>
      )}
      
      {activeTab === 'purchase' && (
        <>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.remark}`}>
            <span className="block truncate" title={purchase.remark || ''}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.link}`}>
            {purchase.link ? (
              <a 
                href={purchase.link} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-blue-600 hover:text-blue-800 underline truncate block"
                title={purchase.link}
              >
                링크 보기
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>
            <span className="block truncate" title={purchase.vendor_payment_schedule || ''}>
              {purchase.vendor_payment_schedule || '-'}
            </span>
          </td>
        </>
      )}
      
      {activeTab === 'receipt' && (
        <>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.remark}`}>
            <span className="block truncate" title={purchase.remark || ''}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectVendor}`}>
            <span className="block truncate" title={purchase.project_vendor || ''}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectItem}`}>
            <span className="block truncate" title={purchase.project_item || ''}>
              {purchase.project_item || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
            <span className="block truncate" title={purchase.sales_order_number || ''}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>
            <span className="block truncate" title={purchase.vendor_payment_schedule || ''}>
              {purchase.vendor_payment_schedule || '-'}
            </span>
          </td>
        </>
      )}
      
      {(activeTab === 'done' || !activeTab) && (
        <>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.remark}`}>
            <span className="block truncate" title={purchase.remark || ''}>
              {purchase.remark || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.link}`}>
            {purchase.link ? (
              <a 
                href={purchase.link} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-blue-600 hover:text-blue-800 underline truncate block"
                title={purchase.link}
              >
                링크 보기
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectVendor}`}>
            <span className="block truncate" title={purchase.project_vendor || ''}>
              {purchase.project_vendor || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] ${COMMON_COLUMN_CLASSES.projectItem}`}>
            <span className="block truncate" title={purchase.project_item || ''}>
              {purchase.project_item || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>
            <span className="block truncate" title={purchase.sales_order_number || ''}>
              {purchase.sales_order_number || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>
            <span className="block truncate" title={purchase.vendor_payment_schedule || ''}>
              {purchase.vendor_payment_schedule || '-'}
            </span>
          </td>
          <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.status}`}>
            {purchase.payment_category === '구매 요청' ? (
              <div className="flex items-center justify-center gap-1">
                <div className="bg-gray-200 rounded-full h-1.5 w-8">
                  <div 
                    className={`h-1.5 rounded-full ${
                      purchaseProgress.percentage === 100 ? 'bg-green-500' : 
                      purchaseProgress.percentage >= 80 ? 'bg-blue-500' : 
                      purchaseProgress.percentage >= 40 ? 'bg-hansl-500' :
                      purchaseProgress.percentage > 0 ? 'bg-gray-400' : 'bg-red-500'
                    }`}
                    style={{ width: `${purchaseProgress.percentage}%` }}
                  />
                </div>
                <span className="text-[11px] text-gray-600">
                  {purchaseProgress.percentage}%
                </span>
              </div>
            ) : (
              <span className="text-gray-400 text-[11px]">-</span>
            )}
          </td>
          <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.receipt}`}>
            <div className="flex items-center justify-center gap-1">
              <div className="bg-gray-200 rounded-full h-1.5 w-8">
                <div 
                  className={`h-1.5 rounded-full ${
                    receiptProgress.percentage === 100 ? 'bg-green-500' : 
                    receiptProgress.percentage > 0 ? 'bg-hansl-500' : 'bg-gray-300'
                  }`}
                  style={{ width: `${receiptProgress.percentage}%` }}
                />
              </div>
              <span className="text-[11px] text-gray-600">
                {receiptProgress.percentage}%
              </span>
            </div>
          </td>
          <td className={`px-2 py-1.5 ${COMMON_COLUMN_CLASSES.paymentStatus}`}>
            {purchase.is_payment_completed ? (
              <Badge className="bg-green-100 text-green-800 text-[11px]">완료</Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-800 text-[11px]">대기</Badge>
            )}
          </td>
        </>
      )}
      
    </tr>
  );
});

TableRow.displayName = 'TableRow';

// 메인 테이블 컴포넌트
const FastPurchaseTable = memo(({ 
  purchases, 
  activeTab = 'done', 
  currentUserRoles = [], 
  onRefresh,
  onPaymentComplete,
  onReceiptComplete 
}: FastPurchaseTableProps) => {
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null);
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

  const handleRowClick = (purchase: Purchase) => {
    setSelectedPurchaseId(purchase.id);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPurchaseId(null);
  };

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = async (purchase: Purchase) => {
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
        items: orderItems.map((item: any) => ({
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
        const canUpdateFlag = currentUserRoles && currentUserRoles.includes('lead buyer');

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
  };

  const handleConfirmDelete = async () => {
    if (!purchaseToDelete) return;

    console.log('🗑️ === 삭제 프로세스 시작 ===');
    console.log('삭제할 발주요청:', {
      id: purchaseToDelete.id,
      purchase_order_number: purchaseToDelete.purchase_order_number,
      requester_name: purchaseToDelete.requester_name,
      final_manager_status: purchaseToDelete.final_manager_status
    });

    try {
      // 현재 사용자 정보 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      console.log('현재 사용자:', user?.email || '로그인 안됨');
      
      if (authError || !user) {
        console.error('❌ 인증 오류:', authError);
        toast.error("로그인이 필요합니다.");
        return;
      }

      // 사용자 권한 확인
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, email, purchase_role')
        .eq('email', user.email)
        .single();

      console.log('사용자 권한 정보:', {
        employee: employee?.name,
        roles: employee?.purchase_role,
        email: employee?.email
      });

      if (empError || !employee) {
        console.error('❌ 직원 정보 조회 실패:', empError);
        toast.error("사용자 권한을 확인할 수 없습니다.");
        return;
      }

      // 권한 체크
      let roles = [];
      if (employee.purchase_role) {
        if (Array.isArray(employee.purchase_role)) {
          roles = employee.purchase_role.map(r => String(r).trim());
        } else {
          const roleString = String(employee.purchase_role);
          roles = roleString.split(',').map(r => r.trim()).filter(r => r.length > 0);
        }
      }

      const canEdit = roles.includes('final_approver') || 
                      roles.includes('app_admin') || 
                      roles.includes('ceo');
      
      const isApproved = purchaseToDelete.final_manager_status === 'approved';
      const isRequester = purchaseToDelete.requester_name === employee.name;
      const canDeleteThis = isApproved ? canEdit : (canEdit || isRequester);

      console.log('삭제 권한 분석:', {
        canEdit,
        isApproved,
        isRequester,
        canDeleteThis,
        userRoles: roles
      });

      if (!canDeleteThis) {
        console.error('❌ 삭제 권한 없음');
        toast.error("삭제 권한이 없습니다.");
        return;
      }

      console.log('✅ 삭제 권한 확인됨 - 아이템 삭제 시작');

      // 모든 아이템 삭제
      const { data: deletedItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchaseToDelete.id)
        .select();

      if (itemsError) {
        console.error('❌ 아이템 삭제 실패:', itemsError);
        console.error('아이템 삭제 오류 상세:', {
          code: itemsError.code,
          message: itemsError.message,
          details: itemsError.details,
          hint: itemsError.hint
        });
        throw itemsError;
      }

      console.log('✅ 아이템 삭제 성공:', deletedItems?.length || 0, '개 삭제됨');
      console.log('삭제된 아이템:', deletedItems);

      console.log('📝 발주요청 삭제 시작');

      // 발주요청 삭제
      const { data: deletedRequest, error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchaseToDelete.id)
        .select();

      if (requestError) {
        console.error('❌ 발주요청 삭제 실패:', requestError);
        console.error('발주요청 삭제 오류 상세:', {
          code: requestError.code,
          message: requestError.message,
          details: requestError.details,
          hint: requestError.hint
        });
        throw requestError;
      }

      console.log('✅ 발주요청 삭제 성공:', deletedRequest);
      console.log('🎉 === 삭제 프로세스 완료 ===');

      toast.success("발주요청 내역이 삭제되었습니다.");
      onRefresh?.();
    } catch (error) {
      console.error('💥 삭제 중 전체 오류:', error);
      console.error('오류 상세 정보:', {
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        stack: error.stack
      });
      toast.error(`삭제 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`);
    }
    
    setDeleteConfirmOpen(false);
    setPurchaseToDelete(null);
  };

  // 탭별 테이블 헤더 메모화
  const tableHeader = useMemo(() => {
    if (activeTab === 'pending') {
      return (
        <thead className="bg-gray-50">
          <tr>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.approvalStatus}`}>승인상태</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>발주번호</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>결제종류</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName}`}>요청자</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requestDate}`}>청구일</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] text-left ${COMMON_COLUMN_CLASSES.vendorName}`}>업체</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName}`}>담당자</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>입고요청일</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] text-left ${COMMON_COLUMN_CLASSES.itemName}`}>품명</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] text-left ${COMMON_COLUMN_CLASSES.specification}`}>규격</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity}`}>수량</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>단가</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>합계</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
          </tr>
        </thead>
      );
    }
    
    const baseHeaders = (
      <>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.purchaseOrderNumber}`}>발주번호</th>
        {(activeTab === 'receipt' || activeTab === 'done' || !activeTab) && (
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentCategory}`}>결제종류</th>
        )}
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requesterName}`}>요청자</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.requestDate}`}>청구일</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.vendorName}`}>업체</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.contactName}`}>담당자</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.deliveryRequestDate}`}>입고요청일</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] text-left ${COMMON_COLUMN_CLASSES.itemName}`}>품명</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] text-left ${COMMON_COLUMN_CLASSES.specification}`}>규격</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.quantity}`}>수량</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.unitPrice}`}>단가</th>
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>합계</th>
      </>
    );

    let additionalHeaders = null;
    
    if (activeTab === 'purchase') {
      additionalHeaders = (
        <>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.link}`}>링크</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>지출예정일</th>
        </>
      );
    } else if (activeTab === 'receipt') {
      additionalHeaders = (
        <>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>지출예정일</th>
        </>
      );
    } else {
      // done 또는 기본
      additionalHeaders = (
        <>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.remark}`}>비고</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.link}`}>링크</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectVendor}`}>PJ업체</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.projectItem}`}>PJ ITEM</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.salesOrderNumber}`}>수주번호</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap text-left ${COMMON_COLUMN_CLASSES.paymentSchedule}`}>지출예정일</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.status}`}>구매진행</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.receipt}`}>입고진행</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.paymentStatus}`}>결제</th>
        </>
      );
    }

    return (
      <thead className="bg-gray-50">
        <tr>
          {/* 구매현황 탭에서는 구매완료 진행률을 맨 앞에 */}
          {activeTab === 'purchase' && (
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress}`}>구매진행</th>
          )}
          {/* 입고현황 탭에서는 입고진행을 맨 앞에 */}
          {activeTab === 'receipt' && (
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.receiptProgress}`}>입고진행</th>
          )}
          {baseHeaders}
          {additionalHeaders}
        </tr>
      </thead>
    );
  }, [activeTab]);

  return (
    <>
      {/* 데스크톱 테이블 뷰 - 실제 데이터 1,979건 분석 기반 최적 너비 */}
      <div className="hidden md:block w-full">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-[1760px]">
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
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* 태블릿 컴팩트 뷰 */}
      <div className="hidden sm:block md:hidden w-full">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-[600px] text-[11px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium text-gray-900 w-24">발주번호</th>
                <th className="text-left p-2 font-medium text-gray-900 w-16">요청자</th>
                <th className="text-left p-2 font-medium text-gray-900 w-20">업체</th>
                <th className="text-left p-2 font-medium text-gray-900 w-32">품명</th>
                <th className="text-right p-2 font-medium text-gray-900 w-20">금액</th>
                <th className="text-center p-2 font-medium text-gray-900 w-16">상태</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr 
                  key={purchase.id}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleRowClick(purchase)}
                >
                  <td className="p-2 font-medium">{purchase.purchase_order_number || '-'}</td>
                  <td className="p-2">{purchase.requester_name}</td>
                  <td className="p-2 truncate" title={purchase.vendor_name}>{purchase.vendor_name}</td>
                  <td className="p-2 truncate" title={purchase.item_name}>{purchase.item_name || '-'}</td>
                  <td className="p-2 text-right font-medium">
                    {purchase.amount_value ? `${purchase.amount_value.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : purchase.total_amount ? `${purchase.total_amount.toLocaleString()} ${getCurrencySymbol(purchase.currency || 'KRW')}` : `0 ${getCurrencySymbol(purchase.currency || 'KRW')}`}
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
        onDelete={(purchase) => {
          setPurchaseToDelete(purchase as unknown as Purchase);
          setDeleteConfirmOpen(true);
        }}
      />

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>발주요청 내역 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              발주요청번호 {purchaseToDelete?.purchase_order_number}를 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

FastPurchaseTable.displayName = 'FastPurchaseTable';

export default FastPurchaseTable;