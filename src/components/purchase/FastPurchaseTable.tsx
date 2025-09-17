import { memo, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import PurchaseDetailModal from "./PurchaseDetailModal";
import MobilePurchaseCard from "./MobilePurchaseCard";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";
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

// 반응형 칼럼 클래스 - Tailwind 클래스로 유연한 너비 관리
const COMMON_COLUMN_CLASSES = {
  approvalStatus: "text-center w-20 min-w-[70px]",
  purchaseOrderNumber: "pl-2 w-32 min-w-[110px] sm:w-36 lg:w-40 xl:w-44",
  paymentCategory: "text-center w-20 min-w-[70px]",
  requesterName: "w-20 min-w-[60px]",
  requestDate: "w-20 min-w-[70px] lg:w-24",
  vendorName: "w-28 min-w-[90px] lg:w-32",
  contactName: "w-20 min-w-[60px]",
  deliveryRequestDate: "w-20 min-w-[70px] lg:w-24",
  itemName: "w-36 min-w-[120px] lg:w-44 xl:w-48",
  specification: "w-40 min-w-[140px] lg:w-48 xl:w-52",
  quantity: "text-center w-14 min-w-[45px]",
  unitPrice: "text-right w-20 min-w-[70px]",
  amount: "text-right w-24 min-w-[80px]",
  remark: "min-w-[150px] lg:min-w-[200px]",
  paymentSchedule: "w-20 min-w-[70px]",
  purchaseStatus: "text-center w-20 min-w-[70px]",
  projectVendor: "w-28 min-w-[90px] lg:w-32",
  salesOrderNumber: "w-24 min-w-[80px] lg:w-28",
  projectItem: "w-28 min-w-[90px] lg:w-32",
  receiptProgress: "text-center w-20 min-w-[70px]",
  status: "text-center w-20 min-w-[70px]",
  receipt: "text-center w-20 min-w-[70px]",
  paymentStatus: "text-center w-16 min-w-[60px]",
  link: "w-20 min-w-[70px]"
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
    item.is_received === true || 
    item.delivery_status === 'received' ||
    item.delivery_status === 'completed'
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

// 날짜 포맷 함수
const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

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
        {formatDate(purchase.request_date)}
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
        {formatDate(purchase.delivery_request_date)}
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
        {purchase.unit_price_value?.toLocaleString() || 0}
      </td>
      <td className={`px-2 py-1.5 text-[11px] font-medium whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>
        {purchase.amount_value?.toLocaleString() || purchase.total_amount?.toLocaleString() || 0}
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
            <StatusBadge purchase={purchase} />
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
    currentUserRoles.includes('raw_material_manager') || 
    currentUserRoles.includes('consumable_manager') ||
    currentUserRoles.includes('purchase_manager') ||
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
      
      // DB에 다운로드 완료 플래그(is_po_download) 업데이트 - lead_buyer만 해당
      try {
        const canUpdateFlag = currentUserRoles && currentUserRoles.includes('lead_buyer');

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

    try {
      // 모든 아이템 삭제
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchaseToDelete.id);

      if (itemsError) throw itemsError;

      // 발주요청 삭제
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchaseToDelete.id);

      if (requestError) throw requestError;

      toast.success("발주요청 내역이 삭제되었습니다.");
      onRefresh?.();
    } catch (error) {
      toast.error("삭제 중 오류가 발생했습니다.");
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
            <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>금액</th>
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
        <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.amount}`}>금액</th>
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
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.status}`}>상태</th>
          <th className={`px-2 py-1.5 font-medium text-gray-900 text-[11px] whitespace-nowrap ${COMMON_COLUMN_CLASSES.receipt}`}>입고</th>
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
      {/* 데스크톱 테이블 뷰 - 강화된 반응형 처리 */}
      <div className="hidden md:block w-full">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-fit">
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
          <table className="w-full min-w-[640px] text-[11px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium text-gray-900 w-20 sm:w-24">발주번호</th>
                <th className="text-left p-2 font-medium text-gray-900 w-16 sm:w-20">요청자</th>
                <th className="text-left p-2 font-medium text-gray-900 w-24 sm:w-28">업체</th>
                <th className="text-left p-2 font-medium text-gray-900 min-w-[100px]">품명</th>
                <th className="text-right p-2 font-medium text-gray-900 w-20 sm:w-24">금액</th>
                <th className="text-center p-2 font-medium text-gray-900 w-16 sm:w-20">상태</th>
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
                    {purchase.amount_value?.toLocaleString() || purchase.total_amount?.toLocaleString() || 0}
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