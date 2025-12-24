import React, { useState } from "react";
import { RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ItemDetail {
  lineNumber: number;
  itemName: string;
  specification: string;
  quantity: number;
  unitPriceValue: number;
  amountValue: number;
  remark?: string;
}

interface ApproveDetailAccordionProps {
  id?: string;
  requestType: string;
  paymentCategory: string;
  vendorName: string;
  contactName: string;
  requesterName: string;
  requestDate: string;
  deliveryRequestDate: string;
  projectVendor: string;
  salesOrderNumber: string;
  projectItem: string;
  purchaseOrderNumber?: string;
  items: ItemDetail[];
  middleManagerStatus?: string;
  finalManagerStatus?: string;
  onMiddleManagerStatusChange?: (status: string) => void;
  onFinalManagerStatusChange?: (status: string) => void;
  isPurchaseTab?: boolean;
  isPaymentCompleted?: boolean;
  onPaymentCompletedChange?: (completed: boolean) => void;
  roles?: string[];
  onApproveListRefresh?: () => Promise<void>;
}

/**
 * hanslwebapp의 ApproveDetailAccordion 컴포넌트
 */
const ApproveDetailAccordion: React.FC<ApproveDetailAccordionProps> = ({
  id,
  requestType,
  paymentCategory,
  vendorName,
  contactName,
  requesterName,
  requestDate,
  deliveryRequestDate,
  projectVendor,
  salesOrderNumber,
  projectItem,
  purchaseOrderNumber,
  items,
  middleManagerStatus: initialMiddleManagerStatus = 'pending',
  finalManagerStatus: initialFinalManagerStatus = 'pending',
  onMiddleManagerStatusChange,
  onFinalManagerStatusChange,
  isPurchaseTab = false,
  isPaymentCompleted = false,
  onPaymentCompletedChange,
  roles = [],
  onApproveListRefresh,
}) => {
  const [middleManagerStatus, setMiddleManagerStatus] = useState(initialMiddleManagerStatus);
  const [finalManagerStatus, setFinalManagerStatus] = useState(initialFinalManagerStatus);
  const [localIsPaymentCompleted, setLocalIsPaymentCompleted] = useState(isPaymentCompleted);
  const supabase = createClient();

  // 총합 계산
  const totalAmount = items.reduce((sum, item) => sum + (item.amountValue || 0), 0);

  // 최종 승인 처리
  const handleApprove = async () => {
    if (!id) {
      toast.error("ID가 없습니다.");
      return;
    }
    
    // DB 업데이트
    const { error } = await supabase
      .from('purchase_requests')
      .update({ final_manager_status: 'approved' })
      .eq('id', Number(id));
    
    if (error) {
      toast.error("승인 처리 중 오류: " + error.message);
      return;
    }
    
    // UI 상태 업데이트
    setFinalManagerStatus('approved');
    onFinalManagerStatusChange?.('approved');
    await onApproveListRefresh?.();
    toast.success("최종 승인이 완료되었습니다.");
  };

  // 반려 처리
  const handleReject = async () => {
    if (!id) {
      toast.error("ID가 없습니다.");
      return;
    }
    
    const { error } = await supabase
      .from('purchase_requests')
      .update({ 
        middle_manager_status: 'rejected', 
        final_manager_status: 'rejected' 
      })
      .eq('id', Number(id));
    
    if (error) {
      toast.error("반려 처리 중 오류: " + error.message);
      return;
    }
    
    setMiddleManagerStatus('rejected');
    setFinalManagerStatus('rejected');
    onMiddleManagerStatusChange?.('rejected');
    onFinalManagerStatusChange?.('rejected');
    await onApproveListRefresh?.();
    toast.success("반려되었습니다.");
  };

  // 1차 승인(검증) 처리
  const handleVerify = async () => {
    if (!id) {
      toast.error("ID가 없습니다.");
      return;
    }
    
    // DB 업데이트
    const { error } = await supabase
      .from('purchase_requests')
      .update({ middle_manager_status: 'approved' })
      .eq('id', Number(id));
    
    if (error) {
      toast.error("검증 처리 중 오류: " + error.message);
      return;
    }
    
    // UI 상태 업데이트
    setMiddleManagerStatus('approved');
    onMiddleManagerStatusChange?.('approved');
    await onApproveListRefresh?.();
    toast.success("1차 승인이 완료되었습니다.");
  };

  // 구매 완료 처리
  const handlePurchaseApprove = async () => {
    if (!id) return;
    
    const currentTime = new Date().toISOString();
    
    // 🔧 헤더와 품목 모두 업데이트 (동기화 보장)
    const [headerResult, itemsResult] = await Promise.all([
      supabase
        .from('purchase_requests')
        .update({ 
          is_payment_completed: true,
          payment_completed_at: currentTime
        })
        .eq('id', Number(id)),
      supabase
        .from('purchase_request_items')
        .update({ 
          is_payment_completed: true,
          payment_completed_at: currentTime
        })
        .eq('purchase_request_id', Number(id))
    ]);
    
    if (!headerResult.error && !itemsResult.error) {
      setLocalIsPaymentCompleted(true);
      onPaymentCompletedChange?.(true);
      await onApproveListRefresh?.();
      toast.success("구매가 완료되었습니다.");
    } else {
      toast.error('구매완료 처리 중 오류: ' + (headerResult.error?.message || itemsResult.error?.message));
    }
  };

  // 구매 반려 처리
  const handlePurchaseReject = async () => {
    if (!id) return;
    
    // 🔧 헤더와 품목 모두 업데이트 (동기화 보장)
    const [headerResult, itemsResult] = await Promise.all([
      supabase
        .from('purchase_requests')
        .update({ 
          is_payment_completed: false,
          payment_completed_at: null
        })
        .eq('id', Number(id)),
      supabase
        .from('purchase_request_items')
        .update({ 
          is_payment_completed: false,
          payment_completed_at: null
        })
        .eq('purchase_request_id', Number(id))
    ]);
    
    if (!headerResult.error && !itemsResult.error) {
      setLocalIsPaymentCompleted(false);
      onPaymentCompletedChange?.(false);
      await onApproveListRefresh?.();
      toast.success("구매가 반려되었습니다.");
    } else {
      toast.error('반려 처리 중 오류: ' + (headerResult.error?.message || itemsResult.error?.message));
    }
  };

  // 초기화
  const handleReset = async () => {
    if (!id) {
      toast.error("ID가 없습니다.");
      return;
    }
    
    const { error } = await supabase
      .from('purchase_requests')
      .update({ 
        middle_manager_status: 'pending', 
        final_manager_status: 'pending',

        payment_completed_at: null,
        received_at: null
      })
      .eq('id', Number(id));
    
    if (error) {
      toast.error("초기화 중 오류: " + error.message);
      return;
    }
    
    setMiddleManagerStatus('pending');
    setFinalManagerStatus('pending');
    onMiddleManagerStatusChange?.('pending');
    onFinalManagerStatusChange?.('pending');
    await onApproveListRefresh?.();
    toast.success("초기화되었습니다.");
  };

  // 승인 버튼 컴포넌트
  const ApproveActionButtons = () => {
    // 중간관리자 권한
    if (roles.includes('middle_manager') && middleManagerStatus === 'pending') {
      return (
        <div className="flex gap-4">
          <Button onClick={handleVerify} className="bg-hansl-500 hover:bg-hansl-600">
            1차 승인
          </Button>
          <Button onClick={handleReject} variant="destructive">
            반려
          </Button>
        </div>
      );
    }

    // 최종승인자/CEO 권한
    if ((roles.includes('final_approver') || roles.includes('ceo')) && 
        middleManagerStatus === 'approved' && finalManagerStatus === 'pending') {
      return (
        <div className="flex gap-4">
          <Button onClick={handleApprove} className="bg-green-500 hover:bg-green-600">
            최종 승인
          </Button>
          <Button onClick={handleReject} variant="destructive">
            반려
          </Button>
        </div>
      );
    }

    // 구매 담당자 권한
    if (isPurchaseTab && !localIsPaymentCompleted) {
      return (
        <div className="flex gap-4">
          <Button onClick={handlePurchaseApprove} className="bg-hansl-500 hover:bg-hansl-600">
            구매완료
          </Button>
          <Button onClick={handlePurchaseReject} variant="destructive">
            반려
          </Button>
        </div>
      );
    }

    // 완료 상태
    if (localIsPaymentCompleted) {
      return (
        <span className="px-4 py-2 business-radius-badge text-sm bg-green-100 text-green-800">
          구매완료
        </span>
      );
    }

    return null;
  };

  return (
    <div className="flex justify-center w-full py-8">
      <div className="flex flex-col gap-4 px-3 sm:px-6 lg:px-8 py-6 sm:py-8 items-center w-full max-w-[95vw] sm:max-w-6xl bg-gray-50 business-radius-card shadow-lg">
        {/* 상단 액션 영역 */}
        <div className="w-full flex justify-between items-center mb-4">
          <div className="flex-1 flex justify-center">
            <ApproveActionButtons />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            title="초기화"
          >
            <RotateCcw className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start w-full">
          {/* 왼쪽: 메타 정보 */}
          <div className="flex flex-col sm:min-w-[220px] sm:max-w-[320px] bg-white business-radius-card p-4 sm:p-6 shadow-sm space-y-4 w-full lg:w-auto">
            <InfoRow label="요청유형" value={requestType} />
            <InfoRow label="결제종류" value={paymentCategory} />
            <InfoRow label="업체명" value={vendorName} />
            <InfoRow label="담당자" value={contactName} />
            <InfoRow label="구매요구자" value={requesterName} />
            <InfoRow label="청구일" value={requestDate} />
            <InfoRow label="입고요청일" value={deliveryRequestDate} />
            <InfoRow label="PJ업체" value={projectVendor} />
            <InfoRow label="수주번호" value={salesOrderNumber} />
            <InfoRow label="item" value={projectItem} />
          </div>

          {/* 오른쪽: 품목 테이블 */}
          <div className="flex-1 bg-white business-radius-card p-6 shadow-sm w-full overflow-x-auto">
            <table className="w-full sm:min-w-[700px] text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-2 py-1 w-20 text-center">번호</th>
                  <th className="px-2 py-1 sm:min-w-[120px] text-center">품명</th>
                  <th className="px-2 py-1 sm:min-w-[180px] text-center">규격</th>
                  <th className="px-2 py-1 w-20 text-center">수량</th>
                  <th className="px-2 py-1 sm:min-w-[80px] text-center">단가(₩)</th>
                  <th className="px-2 py-1 sm:min-w-[80px] text-center">합계(₩)</th>
                  <th className="px-2 py-1 sm:min-w-[120px] text-center">비고</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="text-center px-2 py-1">{idx + 1}</td>
                    <td className="text-center px-2 py-1">{item.itemName}</td>
                    <td className="text-left px-2 py-1">{item.specification}</td>
                    <td className="text-center px-2 py-1">{item.quantity}</td>
                    <td className="text-right px-2 py-1">{item.unitPriceValue?.toLocaleString()} ₩</td>
                    <td className="text-right px-2 py-1">{item.amountValue?.toLocaleString()} ₩</td>
                    <td className="text-center px-2 py-1">{item.remark}</td>
                  </tr>
                ))}
                <tr className="font-bold bg-gray-50">
                  <td colSpan={5} className="text-right px-2 py-1">총 합계</td>
                  <td className="text-right px-2 py-1">{totalAmount.toLocaleString()} ₩</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// 정보 행 컴포넌트
const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex">
    <span className="text-sm text-gray-400 font-medium w-2/5">{label}</span>
    <span className="text-sm text-gray-900 flex-1 ml-1">{value}</span>
  </div>
);

export default ApproveDetailAccordion;