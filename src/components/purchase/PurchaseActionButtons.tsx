import { memo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Purchase } from "@/types/purchase";
import { updatePurchaseInMemory } from '@/stores/purchaseMemoryStore';
import { logger } from '@/lib/logger';

interface PurchaseActionButtonsProps {
  purchase: Purchase;
  currentUserRoles: string[];
  onUpdate: () => void;
}

/**
 * 구매 현황 탭에서 결제 완료 및 입고 완료 처리를 위한 버튼 컴포넌트
 * hanslwebapp의 ApproveDetailAccordion과 동일한 로직 구현
 */
const PurchaseActionButtons = memo(({ 
  purchase, 
  currentUserRoles, 
  onUpdate 
}: PurchaseActionButtonsProps) => {
  const [isPaymentCompleted, setIsPaymentCompleted] = useState(purchase.is_payment_completed);
  const [isReceived, setIsReceived] = useState(purchase.is_received);
  const [updating, setUpdating] = useState(false);
  
  const supabase = createClient();

  // 구매완료 권한 체크: lead buyer, app_admin만 가능
  const canManagePayment = currentUserRoles.some(role => 
    ['lead buyer', 'app_admin'].includes(role)
  );
  
  // 입고완료 권한 체크: purchase_manager, raw_material_manager, consumable_manager, lead buyer, app_admin
  const canManageReceipt = currentUserRoles.some(role => 
    ['purchase_manager', 'raw_material_manager', 'consumable_manager', 'lead buyer', 'app_admin'].includes(role)
  );

  // 결제 완료 처리
  const handlePaymentComplete = async (checked: boolean) => {
    if (!canManagePayment || updating) return;
    
    setUpdating(true);
    try {
      const currentTime = new Date().toISOString();
      
      const { error } = await supabase
        .from('purchase_requests')
        .update({ 
          is_payment_completed: checked,
          payment_completed_at: checked ? currentTime : null
        })
        .eq('id', purchase.id);

      if (error) throw error;

      // 🚀 메모리 캐시 업데이트 (UI 즉시 반영)
      const memoryUpdated = updatePurchaseInMemory(purchase.id, (p) => ({
        ...p,
        is_payment_completed: checked,
        payment_completed_at: checked ? currentTime : null,
        // 개별 품목도 동시 업데이트
        items: checked 
          ? (p.items || []).map(item => ({
              ...item,
              is_payment_completed: true,
              payment_completed_at: currentTime
            }))
          : (p.items || []).map(item => ({
              ...item,
              is_payment_completed: false,
              payment_completed_at: null
            }))
      }));
      
      if (memoryUpdated) {
        logger.debug('[PurchaseActionButtons] 메모리 캐시 구매완료 업데이트 완료', { 
          purchaseId: purchase.id, 
          checked 
        });
      } else {
        logger.warn('[PurchaseActionButtons] 메모리 캐시 업데이트 실패', { 
          purchaseId: purchase.id 
        });
      }

      setIsPaymentCompleted(checked);
      toast.success(checked ? '결제 완료 처리되었습니다.' : '결제 완료가 취소되었습니다.');
      onUpdate();
    } catch (error) {
      logger.error('[PurchaseActionButtons] 구매완료 처리 실패:', error);
      toast.error('처리 중 오류가 발생했습니다.');
    } finally {
      setUpdating(false);
    }
  };

  // 입고 완료 처리
  const handleReceiptComplete = async (checked: boolean) => {
    if (!canManageReceipt || updating) return;
    
    setUpdating(true);
    try {
      const currentTime = new Date().toISOString();
      
      const { error } = await supabase
        .from('purchase_requests')
        .update({ 
          delivery_status: checked ? 'completed' : 'pending',
          received_at: checked ? currentTime : null
        })
        .eq('id', purchase.id);

      if (error) throw error;

      // 🚀 메모리 캐시 업데이트 (UI 즉시 반영)
      const memoryUpdated = updatePurchaseInMemory(purchase.id, (p) => ({
        ...p,
        delivery_status: checked ? 'completed' : 'pending',
        received_at: checked ? currentTime : null,
        is_received: checked
      }));
      
      if (memoryUpdated) {
        logger.debug('[PurchaseActionButtons] 메모리 캐시 입고완료 업데이트 완료', { 
          purchaseId: purchase.id, 
          checked 
        });
      } else {
        logger.warn('[PurchaseActionButtons] 메모리 캐시 입고완료 업데이트 실패', { 
          purchaseId: purchase.id 
        });
      }

      setIsReceived(checked);
      toast.success(checked ? '입고 완료 처리되었습니다.' : '입고 완료가 취소되었습니다.');
      onUpdate();
    } catch (error) {
      logger.error('[PurchaseActionButtons] 입고완료 처리 실패:', error);
      toast.error('처리 중 오류가 발생했습니다.');
    } finally {
      setUpdating(false);
    }
  };

  // 권한이 없으면 아무것도 표시하지 않음
  if (!canManagePayment && !canManageReceipt) {
    return null;
  }

  return (
    <div className="flex items-center gap-4">
      {/* 결제 완료 체크박스 - lead buyer, app_admin만 */}
      {canManagePayment && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`payment-${purchase.id}`}
            checked={isPaymentCompleted}
            onCheckedChange={handlePaymentComplete}
            disabled={updating}
          />
          <label
            htmlFor={`payment-${purchase.id}`}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            결제완료
          </label>
        </div>
      )}

      {/* 입고 완료 체크박스 - 구매 관리자들 */}
      {canManageReceipt && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`receipt-${purchase.id}`}
            checked={isReceived}
            onCheckedChange={handleReceiptComplete}
            disabled={updating || !isPaymentCompleted}
          />
          <label
            htmlFor={`receipt-${purchase.id}`}
            className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${
              !isPaymentCompleted ? 'opacity-50' : ''
            }`}
          >
            입고완료
          </label>
        </div>
      )}
    </div>
  );
});

PurchaseActionButtons.displayName = 'PurchaseActionButtons';

export default PurchaseActionButtons;