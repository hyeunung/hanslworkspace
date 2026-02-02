import { useMemo, useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar, Loader2, MessageSquarePlus, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Purchase } from '@/types/purchase';
import { toast } from 'sonner';
import { addCacheListener, findPurchaseInMemory } from '@/stores/purchaseMemoryStore';
import { dateToISOString } from '@/utils/helpers';
import { logger } from '@/lib/logger';

// 상세 모달 lazy load
const PurchaseDetailModal = lazy(() => import('./PurchaseDetailModal'));

interface DeliveryDateWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchases: Purchase[];
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>;
  currentUserName?: string | null;
}

interface WarningItem {
  purchase: Purchase;
  warningType: 'delivery_overdue' | 'revision_overdue';
  daysOverdue: number;
}

export default function DeliveryDateWarningModal({
  isOpen,
  onClose,
  purchases,
  onRefresh,
  currentUserName
}: DeliveryDateWarningModalProps) {
  const navigate = useNavigate();
  // 완료된 항목 ID 목록 (로컬 상태로 즉시 UI 반영)
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  // 모달이 열릴 때 고정된 경고 항목 (이후 재계산 방지)
  const [fixedWarningItems, setFixedWarningItems] = useState<WarningItem[]>([]);
  // 이미 항목을 고정했는지 추적 (한 번만 고정)
  const hasFixedItemsRef = useRef(false);
  // 자동 닫기가 이미 실행되었는지 추적 (중복 방지)
  const hasClosedRef = useRef(false);
  
  // 상세 모달 상태
  const [detailModalPurchaseId, setDetailModalPurchaseId] = useState<number | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // detailModalPurchaseId를 ref로도 저장 (onRefresh 콜백에서 사용)
  const detailModalPurchaseIdRef = useRef<number | null>(null);
  useEffect(() => {
    detailModalPurchaseIdRef.current = detailModalPurchaseId;
  }, [detailModalPurchaseId]);
  
  // onClose를 ref로 감싸서 useEffect 의존성 문제 해결
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 경고 항목 계산 함수
  const calculateWarningItems = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const items: WarningItem[] = [];
    
    purchases.forEach(purchase => {
      // 이미 입고 완료된 항목 제외
      if (purchase.is_received || purchase.delivery_status === 'completed') return;
      // 승인 안된 항목 제외
      if (purchase.middle_manager_status !== 'approved' || purchase.final_manager_status !== 'approved') return;
      // 본인 발주만 표시
      if (currentUserName && purchase.requester_name !== currentUserName) return;
      // 이미 수정요청 완료된 항목 제외
      if (purchase.delivery_revision_requested === true) return;
      
      const deliveryDate = purchase.delivery_request_date ? new Date(purchase.delivery_request_date) : null;
      const revisedDate = purchase.revised_delivery_request_date ? new Date(purchase.revised_delivery_request_date) : null;
      
      if (deliveryDate) deliveryDate.setHours(0, 0, 0, 0);
      if (revisedDate) revisedDate.setHours(0, 0, 0, 0);
      
      // 변경요청일이 있고 지난 경우
      if (revisedDate && revisedDate < today) {
        items.push({
          purchase,
          warningType: 'revision_overdue',
          daysOverdue: Math.floor((today.getTime() - revisedDate.getTime()) / (1000 * 60 * 60 * 24))
        });
        return;
      }
      
      // 입고요청일이 지났고 변경요청일이 없는 경우
      if (deliveryDate && deliveryDate < today && !revisedDate) {
        items.push({
          purchase,
          warningType: 'delivery_overdue',
          daysOverdue: Math.floor((today.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24))
        });
      }
    });
    
    return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [purchases, currentUserName]);

  // 모달이 열릴 때 경고 항목 고정 (이후 메모리 캐시 업데이트로 재계산되지 않음)
  // 단, 입고완료 처리로 항목이 제거되면 실시간으로 업데이트
  const [warningItems, setWarningItems] = useState<WarningItem[]>([]);

  // 모달 열릴 때 상태 초기화 및 경고 항목 고정 (한 번만)
  useEffect(() => {
    if (isOpen && !hasFixedItemsRef.current) {
      setCompletedIds(new Set());
      hasClosedRef.current = false; // 자동 닫기 플래그 초기화
      // 모달 열릴 때 경고 항목 고정 (이후 재계산 방지)
      const items = calculateWarningItems();
      setFixedWarningItems(items);
      setWarningItems(items);
      hasFixedItemsRef.current = true;
    }
    
    // 모달이 닫히면 플래그 초기화
    if (!isOpen) {
      hasFixedItemsRef.current = false;
    }
  }, [isOpen, calculateWarningItems]);
  
  // 입고완료 처리 후 경고 항목 실시간 업데이트
  useEffect(() => {
    if (!isOpen || fixedWarningItems.length === 0) return;
    
    // 입고완료된 항목 제거 (메모리 캐시 우선 확인, 없으면 purchases prop 확인)
    const remainingItems = fixedWarningItems.filter(fixedItem => {
      // 1. 메모리 캐시에서 먼저 확인 (가장 최신 데이터)
      const memoryPurchase = findPurchaseInMemory(fixedItem.purchase.id);
      if (memoryPurchase) {
        if (memoryPurchase.is_received || memoryPurchase.delivery_status === 'completed') {
          return false;
        }
        return true;
      }
      
      // 2. 메모리 캐시에 없으면 purchases prop에서 확인
      const currentPurchase = purchases.find(p => p.id === fixedItem.purchase.id);
      if (!currentPurchase) {
        // 데이터가 없으면 원본 데이터로 체크
        return !(fixedItem.purchase.is_received || fixedItem.purchase.delivery_status === 'completed');
      }
      
      // 입고완료되었으면 제외
      if (currentPurchase.is_received || currentPurchase.delivery_status === 'completed') {
        return false;
      }
      
      return true;
    });
    
    // 경고 항목 업데이트
    if (remainingItems.length !== warningItems.length) {
      setWarningItems(remainingItems);
    }
    
    // 모든 항목이 입고완료되었으면 모달 자동 닫기
    if (remainingItems.length === 0 && fixedWarningItems.length > 0 && !hasClosedRef.current) {
      hasClosedRef.current = true;
      setTimeout(() => {
        onCloseRef.current();
      }, 300);
    }
  }, [purchases, isOpen, fixedWarningItems, warningItems.length]);
  
  // warningItems가 변경될 때 모든 항목 완료 확인
  useEffect(() => {
    if (!isOpen) return;
    
    // 모든 항목이 완료되었는지 확인 (입고완료 또는 수정요청 완료)
    const allCompleted = warningItems.length === 0 || 
      warningItems.every(item => 
        completedIds.has(item.purchase.id) ||
        item.purchase.is_received ||
        item.purchase.delivery_status === 'completed'
      );
    
    if (allCompleted && warningItems.length > 0 && !hasClosedRef.current) {
      logger.info('🔍 [입고지연알림] 모든 항목 완료, 모달 자동 닫기');
      hasClosedRef.current = true;
      setTimeout(() => {
        onCloseRef.current();
      }, 300);
    }
  }, [warningItems, completedIds, isOpen]);

  // 모든 항목 완료 여부
  const allCompleted = useMemo(() => {
    if (warningItems.length === 0) return true;
    return warningItems.every(item => completedIds.has(item.purchase.id));
  }, [warningItems, completedIds]);

  // 진행률
  const progress = useMemo(() => {
    if (warningItems.length === 0) return 100;
    return Math.round((completedIds.size / warningItems.length) * 100);
  }, [warningItems.length, completedIds.size]);

  // 100% 완료 시 자동 닫기
  useEffect(() => {
    if (progress === 100 && warningItems.length > 0 && !hasClosedRef.current) {
      hasClosedRef.current = true;
      // 300ms 후 모달 자동 닫기
      setTimeout(() => {
        onCloseRef.current();
      }, 300);
    }
  }, [progress, warningItems.length]);

  // 🚀 Realtime 이벤트 구독 - 모달이 열려있는 동안 실시간 업데이트
  const realtimeFirstMount = useRef(true);
  useEffect(() => {
    if (!isOpen) return;

    const handleCacheUpdate = () => {
      if (realtimeFirstMount.current) {
        realtimeFirstMount.current = false;
        return;
      }
      // Realtime 이벤트 발생 시 부모에게 새로고침 요청
      onRefresh?.();
    };

    const unsubscribe = addCacheListener(handleCacheUpdate);
    return () => unsubscribe();
  }, [isOpen, onRefresh]);

  const handleOpenDeliveryDateChangeSupport = useCallback((purchase: Purchase) => {
    const purchaseId = purchase?.id;
    if (!purchaseId) {
      toast.error('발주요청 정보를 확인할 수 없습니다.');
      return;
    }

    const returnTo = encodeURIComponent('/purchase/list?tab=receipt');
    navigate(`/support?type=delivery_date_change&purchaseId=${purchaseId}&source=delivery-warning&returnTo=${returnTo}`);
  }, [navigate]);

  // 닫기 핸들러
  const handleClose = useCallback(() => {
    if (allCompleted) {
      onClose();
    } else {
      toast.error(`모든 항목(${warningItems.length}건)에 대해 수정요청을 완료해주세요.`);
    }
  }, [allCompleted, onClose, warningItems.length]);

  // 날짜 포맷
  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // 카드 클릭 시 상세 모달 열기
  const handleCardClick = useCallback((purchaseId: number) => {
    setDetailModalPurchaseId(purchaseId);
    setIsDetailModalOpen(true);
  }, []);

  // 상세 모달 닫기 - 입고완료 처리 확인 및 경고 항목 업데이트
  const handleDetailModalClose = useCallback(() => {
    const purchaseIdToCheck = detailModalPurchaseId;
    
    setIsDetailModalOpen(false);
    setDetailModalPurchaseId(null);
    
    if (purchaseIdToCheck) {
      // 1. 메모리 캐시에서 즉시 확인 (지연 없음)
      const memoryPurchase = findPurchaseInMemory(purchaseIdToCheck);
      
      if (memoryPurchase) {
        const isReceived = memoryPurchase.is_received || memoryPurchase.delivery_status === 'completed';
        
        if (isReceived) {
          // 즉시 경고 항목에서 제거
          setWarningItems(prev => {
            const filtered = prev.filter(item => item.purchase.id !== purchaseIdToCheck);
            return filtered;
          });
          
          setFixedWarningItems(prev => prev.filter(item => item.purchase.id !== purchaseIdToCheck));
          setCompletedIds(prev => new Set(prev).add(purchaseIdToCheck));
        }
      } else {
        // 메모리 캐시에 없으면 purchases prop에서 확인 (fallback)
        const currentPurchase = purchases.find(p => p.id === purchaseIdToCheck);
        
        if (currentPurchase) {
          const isReceived = currentPurchase.is_received || currentPurchase.delivery_status === 'completed';
          
          if (isReceived) {
            setWarningItems(prev => prev.filter(item => item.purchase.id !== purchaseIdToCheck));
            setFixedWarningItems(prev => prev.filter(item => item.purchase.id !== purchaseIdToCheck));
            setCompletedIds(prev => new Set(prev).add(purchaseIdToCheck));
          }
        }
      }
      
      // 2. 백그라운드에서 onRefresh 호출 (prop 업데이트용)
      onRefresh?.(false, { silent: true });
    }
  }, [detailModalPurchaseId, purchases, onRefresh]);

  if (warningItems.length === 0) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0" showCloseButton={false}>
          {/* 헤더 */}
          <DialogHeader className="px-5 py-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <DialogTitle className="page-title text-base">
                  입고 일정 지연 알림
                </DialogTitle>
              </div>
              <span className="text-xs text-gray-500">
                {completedIds.size}/{warningItems.length} 완료
              </span>
            </div>
            <Progress value={progress} className="h-1 mt-3" />
          </DialogHeader>

          {/* 본문 */}
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {warningItems.map((item) => {
              const isCompleted = completedIds.has(item.purchase.id);

              return (
                <div
                  key={item.purchase.id}
                  className={`border rounded-lg p-3 transition-all duration-200 cursor-pointer hover:border-hansl-400 ${
                    isCompleted ? 'bg-gray-50 opacity-60' : 'bg-white'
                  }`}
                  onClick={() => handleCardClick(item.purchase.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900">
                          {item.purchase.purchase_order_number}
                        </span>
                        <span className="text-xs text-gray-500">
                          {item.purchase.vendor_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          입고요청: {formatDate(item.purchase.delivery_request_date)}
                        </span>
                        {item.purchase.revised_delivery_request_date && (
                          <span>변경: {formatDate(item.purchase.revised_delivery_request_date)}</span>
                        )}
                        <span className="text-red-500">{item.daysOverdue}일 경과</span>
                      </div>
                    </div>

                    {/* 버튼 */}
                    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isCompleted ? (
                        <Button
                          size="sm"
                          disabled
                          className="button-base bg-gray-100 text-gray-500 h-7 px-3 text-xs"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          요청 완료
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="button-base bg-hansl-600 hover:bg-hansl-700 text-white h-7 px-3 text-xs"
                          onClick={() => handleOpenDeliveryDateChangeSupport(item.purchase)}
                          title="입고일 변경 요청"
                        >
                          <MessageSquarePlus className="w-3 h-3 mr-1" />
                          입고일 변경 요청
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 푸터 */}
          <div className="border-t px-5 py-3">
            <p className="text-xs text-gray-500 text-center">
              ℹ️ 모든 수정 요청이 완료되면 이 창이 자동으로 닫힙니다
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* 상세 모달 - 발주요청관리 > 입고현황 탭의 상세 모달과 동일 */}
      {detailModalPurchaseId && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        }>
          <PurchaseDetailModal
            purchaseId={detailModalPurchaseId}
            isOpen={isDetailModalOpen}
            onClose={handleDetailModalClose}
            activeTab="receipt"
            onRefresh={async (silent, options) => {
              // 상세 모달에서 입고완료 처리 시 부모에게 새로고침 요청
              if (onRefresh) {
                const result = onRefresh(silent, options);
                if (result instanceof Promise) {
                  await result;
                }
              }
              
              // 입고완료 처리 후 메모리 캐시에서 즉시 확인하여 경고 항목 제거
              const currentPurchaseId = detailModalPurchaseIdRef.current;
              if (currentPurchaseId) {
                // 약간의 지연 후 메모리 캐시 확인 (입고완료 처리 완료 대기)
                setTimeout(() => {
                  const memoryPurchase = findPurchaseInMemory(currentPurchaseId);
                  
                  if (memoryPurchase) {
                    const isReceived = memoryPurchase.is_received || memoryPurchase.delivery_status === 'completed';
                    
                    if (isReceived) {
                      // 즉시 경고 항목에서 제거
                      setWarningItems(prev => prev.filter(item => item.purchase.id !== currentPurchaseId));
                      setFixedWarningItems(prev => prev.filter(item => item.purchase.id !== currentPurchaseId));
                      setCompletedIds(prev => new Set(prev).add(currentPurchaseId));
                    }
                  }
                }, 100); // 100ms 지연으로 입고완료 처리 완료 대기
              }
            }}
          />
        </Suspense>
      )}
    </>
  );
}

// 경고 항목 수 계산 훅
export function useDeliveryWarningCount(purchases: Purchase[], currentUserName?: string | null): number {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let count = 0;
    const debugItems: any[] = [];

    purchases.forEach(purchase => {
      // F20251226_003 항목 디버깅
      const isTarget = purchase.purchase_order_number === 'F20251226_003';
      
      if (purchase.is_received || purchase.delivery_status === 'completed') {
        if (isTarget) debugItems.push({ step: '입고완료로 제외', purchase: purchase.purchase_order_number });
        return;
      }
      if (purchase.middle_manager_status !== 'approved' || purchase.final_manager_status !== 'approved') {
        if (isTarget) debugItems.push({ 
          step: '승인 미완료로 제외', 
          purchase: purchase.purchase_order_number,
          middle: purchase.middle_manager_status,
          final: purchase.final_manager_status
        });
        return;
      }
      if (currentUserName && purchase.requester_name !== currentUserName) {
        if (isTarget) debugItems.push({ 
          step: '본인 발주 아님으로 제외', 
          purchase: purchase.purchase_order_number,
          requester_name: purchase.requester_name,
          currentUserName
        });
        return;
      }
      if (purchase.delivery_revision_requested === true) {
        if (isTarget) debugItems.push({ 
          step: '수정요청 완료로 제외', 
          purchase: purchase.purchase_order_number 
        });
        return;
      }

      const deliveryDate = purchase.delivery_request_date ? new Date(purchase.delivery_request_date) : null;
      const revisedDate = purchase.revised_delivery_request_date ? new Date(purchase.revised_delivery_request_date) : null;

      if (deliveryDate) deliveryDate.setHours(0, 0, 0, 0);
      if (revisedDate) revisedDate.setHours(0, 0, 0, 0);

      if (revisedDate && revisedDate < today) {
        count++;
        if (isTarget) debugItems.push({ 
          step: '변경요청일 지연으로 포함', 
          purchase: purchase.purchase_order_number,
          revisedDate: dateToISOString(revisedDate),
          today: today.toISOString()
        });
        return;
      }

      if (deliveryDate && deliveryDate < today && !revisedDate) {
        count++;
        if (isTarget) debugItems.push({ 
          step: '입고요청일 지연으로 포함', 
          purchase: purchase.purchase_order_number,
          deliveryDate: dateToISOString(deliveryDate),
          today: today.toISOString()
        });
        return;
      }
      
      if (isTarget) {
        debugItems.push({ 
          step: '날짜 조건 불만족', 
          purchase: purchase.purchase_order_number,
          deliveryDate: deliveryDate ? dateToISOString(deliveryDate) : null,
          revisedDate: revisedDate ? dateToISOString(revisedDate) : null,
          today: today.toISOString()
        });
      }
    });

    // 디버깅 로그 출력
    if (debugItems.length > 0) {
      console.log('🔍 [useDeliveryWarningCount] F20251226_003 디버깅:', debugItems);
    }
    
    // F20251226_003 항목이 purchases에 있는지 확인
    const targetPurchase = purchases.find(p => p.purchase_order_number === 'F20251226_003');
    if (targetPurchase) {
      console.log('🔍 [useDeliveryWarningCount] F20251226_003 항목 상세 정보:', {
        purchase_order_number: targetPurchase.purchase_order_number,
        requester_name: targetPurchase.requester_name,
        currentUserName,
        nameMatch: targetPurchase.requester_name === currentUserName,
        is_received: targetPurchase.is_received,
        delivery_status: targetPurchase.delivery_status,
        middle_manager_status: targetPurchase.middle_manager_status,
        final_manager_status: targetPurchase.final_manager_status,
        delivery_revision_requested: targetPurchase.delivery_revision_requested,
        delivery_request_date: targetPurchase.delivery_request_date,
        revised_delivery_request_date: targetPurchase.revised_delivery_request_date,
        today: today.toISOString(),
        finalCount: count
      });
    }

    return count;
  }, [purchases, currentUserName]);
}
