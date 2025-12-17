import { useMemo, useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { AlertCircle, Calendar, Loader2, MessageSquarePlus, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Purchase } from '@/types/purchase';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { addCacheListener, updatePurchaseInMemory, notifyCacheListeners } from '@/stores/purchaseMemoryStore';

// 상세 모달 lazy load
const PurchaseDetailModal = lazy(() => import('./PurchaseDetailModal'));

interface DeliveryDateWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchases: Purchase[];
  onRefresh?: () => void;
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
  // 완료된 항목 ID 목록 (로컬 상태로 즉시 UI 반영)
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  // 모달이 열릴 때 고정된 경고 항목 (이후 재계산 방지)
  const [fixedWarningItems, setFixedWarningItems] = useState<WarningItem[]>([]);
  // 이미 항목을 고정했는지 추적 (한 번만 고정)
  const hasFixedItemsRef = useRef(false);
  // 자동 닫기가 이미 실행되었는지 추적 (중복 방지)
  const hasClosedRef = useRef(false);
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null);
  const [modifySubject, setModifySubject] = useState('');
  const [modifyMessage, setModifyMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // 상세 모달 상태
  const [detailModalPurchaseId, setDetailModalPurchaseId] = useState<number | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // onClose를 ref로 감싸서 useEffect 의존성 문제 해결
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  
  const supabase = createClient();

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
  const warningItems = fixedWarningItems;

  // 모달 열릴 때 상태 초기화 및 경고 항목 고정 (한 번만)
  useEffect(() => {
    if (isOpen && !hasFixedItemsRef.current) {
      setCompletedIds(new Set());
      setOpenPopoverId(null);
      hasClosedRef.current = false; // 자동 닫기 플래그 초기화
      // 모달 열릴 때 경고 항목 고정 (이후 재계산 방지)
      const items = calculateWarningItems();
      setFixedWarningItems(items);
      hasFixedItemsRef.current = true;
    }
    
    // 모달이 닫히면 플래그 초기화
    if (!isOpen) {
      hasFixedItemsRef.current = false;
    }
  }, [isOpen, calculateWarningItems]);

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

  // 팝오버 열기
  const openPopover = useCallback((purchaseId: number, orderNumber: string) => {
    setOpenPopoverId(purchaseId);
    setModifySubject(`[입고일 수정요청] ${orderNumber}`);
    setModifyMessage('');
  }, []);

  // 수정 요청 전송
  const sendRequest = useCallback(async (purchase: Purchase) => {
    if (!modifySubject.trim() || !modifyMessage.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.');
      return;
    }

    setIsSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      // 1. 문의하기에 저장
      const { error: inquiryError } = await supabase
        .from('support_inquires')
        .insert({
          user_id: user.id,
          user_email: user.email,
          user_name: currentUserName,
          inquiry_type: 'modify',
          subject: modifySubject,
          message: modifyMessage,
          status: 'open',
          purchase_request_id: purchase.id,
          purchase_order_number: purchase.purchase_order_number,
          requester_id: purchase.requester_id,
          purchase_info: JSON.stringify({
            vendor_name: purchase.vendor_name,
            delivery_request_date: purchase.delivery_request_date,
            revised_delivery_request_date: purchase.revised_delivery_request_date
          })
        });

      if (inquiryError) throw inquiryError;

      // 2. 수정요청완료 플래그 업데이트
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({
          delivery_revision_requested: true,
          delivery_revision_requested_at: new Date().toISOString(),
          delivery_revision_requested_by: currentUserName || 'unknown'
        })
        .eq('id', purchase.id);

      if (updateError) throw updateError;

      // 3. 메모리 캐시 즉시 업데이트 (deliveryWarningCount 재계산용)
      const updated = updatePurchaseInMemory(purchase.id, (p) => ({
        ...p,
        delivery_revision_requested: true,
        delivery_revision_requested_at: new Date().toISOString(),
        delivery_revision_requested_by: currentUserName || 'unknown'
      }));
      if (updated) {
        notifyCacheListeners(); // 구독자들에게 알림
      }

      // 4. 로컬 상태 즉시 업데이트 (UI 즉시 반영)
      setCompletedIds(prev => new Set(prev).add(purchase.id));
      setOpenPopoverId(null);
      setModifySubject('');
      setModifyMessage('');
      toast.success('수정 요청이 전송되었습니다.');

    } catch (error: any) {
      console.error('수정 요청 실패:', error);
      toast.error('수정 요청 전송에 실패했습니다.');
    } finally {
      setIsSending(false);
    }
  }, [supabase, currentUserName, modifySubject, modifyMessage]);

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

  // 상세 모달 닫기
  const handleDetailModalClose = useCallback(() => {
    setIsDetailModalOpen(false);
    setDetailModalPurchaseId(null);
  }, []);

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
                        <Popover
                          open={openPopoverId === item.purchase.id}
                          onOpenChange={(open) => {
                            if (open) {
                              openPopover(item.purchase.id, item.purchase.purchase_order_number);
                            } else {
                              setOpenPopoverId(null);
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              size="sm"
                              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white h-7 px-3 text-xs"
                            >
                              <MessageSquarePlus className="w-3 h-3 mr-1" />
                              수정 요청
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-80 p-4"
                            align="end"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <div className="space-y-3">
                              <div>
                                <h4 className="font-medium text-sm">입고일 수정 요청</h4>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {item.purchase.vendor_name}
                                </p>
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <Label className="text-xs">제목</Label>
                                  <Input
                                    value={modifySubject}
                                    onChange={(e) => setModifySubject(e.target.value)}
                                    className="h-8 text-xs mt-1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">내용</Label>
                                  <Textarea
                                    value={modifyMessage}
                                    onChange={(e) => setModifyMessage(e.target.value)}
                                    className="min-h-[80px] text-xs mt-1"
                                    placeholder="변경 요청 내용을 입력하세요"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setOpenPopoverId(null)}
                                  className="button-base h-7 text-xs"
                                >
                                  취소
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => sendRequest(item.purchase)}
                                  disabled={isSending}
                                  className="button-base bg-hansl-600 hover:bg-hansl-700 text-white h-7 text-xs"
                                >
                                  {isSending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                                  요청 전송
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
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
            onRefresh={onRefresh}
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

    purchases.forEach(purchase => {
      if (purchase.is_received || purchase.delivery_status === 'completed') return;
      if (purchase.middle_manager_status !== 'approved' || purchase.final_manager_status !== 'approved') return;
      if (currentUserName && purchase.requester_name !== currentUserName) return;
      if (purchase.delivery_revision_requested === true) return;

      const deliveryDate = purchase.delivery_request_date ? new Date(purchase.delivery_request_date) : null;
      const revisedDate = purchase.revised_delivery_request_date ? new Date(purchase.revised_delivery_request_date) : null;

      if (deliveryDate) deliveryDate.setHours(0, 0, 0, 0);
      if (revisedDate) revisedDate.setHours(0, 0, 0, 0);

      if (revisedDate && revisedDate < today) {
        count++;
        return;
      }

      if (deliveryDate && deliveryDate < today && !revisedDate) {
        count++;
      }
    });

    return count;
  }, [purchases, currentUserName]);
}
