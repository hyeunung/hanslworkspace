
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { DatePickerPopover } from '@/components/ui/date-picker-popover';
import { useToast } from '@/hooks/use-toast';
import { deliveryService } from '@/services/deliveryService';
import { markCacheStaleAndNotify } from '@/stores/purchaseMemoryStore';
import { PurchaseRequestWithDetails, PurchaseRequestItem } from '@/types/purchase';
import { 
  ChevronDown, 
  ChevronUp, 
  Package, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  Download
} from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface DeliveryManagementProps {
  purchaseRequest: PurchaseRequestWithDetails;
  onUpdate?: () => void;
  currentUser?: {
    id: string;
    name: string;
  } | null;
}

interface ItemDeliveryState {
  itemId: string;
  receivedQuantity: number;
  deliveryNotes: string;
  isSelected: boolean;
}

export function DeliveryManagement({ 
  purchaseRequest, 
  onUpdate,
  currentUser 
}: DeliveryManagementProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [itemStates, setItemStates] = useState<Record<string, ItemDeliveryState>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [batchNotes, setBatchNotes] = useState('');
;

  // 초기 상태 설정
  useEffect(() => {
    const initialStates: Record<string, ItemDeliveryState> = {};
    purchaseRequest.items?.forEach(item => {
      if (item.id) {
        initialStates[item.id] = {
          itemId: item.id,
          receivedQuantity: item.received_quantity || 0,
          deliveryNotes: '',
          isSelected: false
        };
      }
    });
    setItemStates(initialStates);
  }, [purchaseRequest.items]);

  // 입고 상태에 따른 배지 컴포넌트 (actual_received_date 기준)
  const getStatusBadge = (actualReceivedDate: string | null) => {
    if (actualReceivedDate) {
      return <span className="badge-stats bg-green-500 text-white">입고완료</span>;
    } else {
      return <span className="badge-stats bg-gray-500 text-white">입고대기</span>;
    }
  };

  // 개별 품목 입고 수량 변경
  const updateItemQuantity = (itemId: string, quantity: number) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        receivedQuantity: quantity
      }
    }));
  };

  // 개별 품목 메모 변경
  const updateItemNotes = (itemId: string, notes: string) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        deliveryNotes: notes
      }
    }));
  };

  // 개별 품목 선택 상태 변경
  const toggleItemSelection = (itemId: string) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        isSelected: !prev[itemId].isSelected
      }
    }));
  };

  // 전체 선택/해제
  const toggleSelectAll = () => {
    const newSelectAll = !selectAll;
    setSelectAll(newSelectAll);
    setItemStates(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        const itemId = key;
        const item = purchaseRequest.items?.find(i => i.id === itemId);
        // 실제 입고 완료되지 않은 품목만 선택
        if (item && !item.actual_received_date) {
          updated[itemId] = {
            ...updated[itemId],
            isSelected: newSelectAll
          };
        }
      });
      return updated;
    });
  };

  // 단일 품목 입고 처리
  const handleSingleItemDelivery = async (itemId: string) => {
    if (!currentUser) {
      toast({
        title: "오류",
        description: "사용자 정보가 없습니다.",
        variant: "destructive"
      });
      return;
    }

    const itemState = itemStates[itemId];
    if (!itemState || itemState.receivedQuantity <= 0) {
      toast({
        title: "오류",
        description: "입고 수량을 입력해주세요.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      const result = await deliveryService.updateItemDeliveryStatus(parseInt(itemId), {
        receivedQuantity: itemState.receivedQuantity,
        deliveryNotes: itemState.deliveryNotes,
        receivedBy: currentUser.id,
        receivedByName: currentUser.name
      });

      if (result.success) {
        toast({
          title: "입고 처리 완료",
          description: "품목이 성공적으로 입고 처리되었습니다."
        });
        onUpdate?.();
        markCacheStaleAndNotify(); // 다른 화면에서도 최신화
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "입고 처리 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 배치 입고 처리
  const handleBatchDelivery = async () => {
    if (!currentUser) {
      toast({
        title: "오류",
        description: "사용자 정보가 없습니다.",
        variant: "destructive"
      });
      return;
    }

    const selectedItems = Object.values(itemStates)
      .filter(state => state.isSelected && state.receivedQuantity > 0)
      .map(state => ({
        itemId: parseInt(state.itemId),
        receivedQuantity: state.receivedQuantity,
        deliveryNotes: state.deliveryNotes || batchNotes
      }));

    if (selectedItems.length === 0) {
      toast({
        title: "오류",
        description: "입고 처리할 품목을 선택하고 수량을 입력해주세요.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      const result = await deliveryService.batchUpdateItemsDeliveryStatus(
        selectedItems,
        currentUser.id,
        currentUser.name
      );

      if (result.success) {
        toast({
          title: "배치 입고 처리 완료",
          description: `${selectedItems.length}개 품목이 성공적으로 입고 처리되었습니다.`
        });
        setShowBatchDialog(false);
        setBatchNotes('');
        setSelectAll(false);
        onUpdate?.();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "배치 입고 처리 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 전체 입고 처리 (날짜 선택 후 실행)
  const handleCompleteAllDelivery = async (selectedDate: Date) => {
    if (!currentUser) return;
    if (!purchaseRequest.id) return;

    // 확인 다이얼로그 표시
    const confirmMessage = `발주번호: ${purchaseRequest.purchase_order_number}

전체 입고완료 처리하시겠습니까?`
    
    if (!window.confirm(confirmMessage)) {
      return
    }

    setIsProcessing(true);
    try {
      const result = await deliveryService.markAllItemsAsReceived(
        parseInt(purchaseRequest.id),
        currentUser.id,
        currentUser.name,
        "전체 품목 일괄 입고 처리",
        selectedDate.toISOString()
      );

      if (result.success) {
        toast({
          title: "전체 입고 처리 완료",
          description: "모든 품목이 성공적으로 입고 처리되었습니다."
        });
        onUpdate?.();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "전체 입고 처리 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 엑셀 다운로드 버튼 클릭 시 테두리 표시
  const handleExcelDownload = async () => {
    if (!purchaseRequest.purchase_order_number) return;
    
    try {
      const response = await fetch(`/api/excel/download/${purchaseRequest.purchase_order_number}`);
      
      if (!response.ok) {
        throw new Error('엑셀 다운로드 실패');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `발주서_${purchaseRequest.purchase_order_number}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "다운로드 완료",
        description: "엑셀 파일이 다운로드되었습니다."
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: "엑셀 파일 다운로드에 실패했습니다.",
        variant: "destructive"
      });
    }
  };

  // 통계 계산 (actual_received_date 기준)
  const stats = {
    total: purchaseRequest.items?.length || 0,
    completed: purchaseRequest.items?.filter(item => item.actual_received_date).length || 0,
    partial: 0, // 부분 입고는 actual_received_date 시스템에서는 사용하지 않음
    pending: purchaseRequest.items?.filter(item => !item.actual_received_date).length || 0
  };

  const selectedCount = Object.values(itemStates).filter(state => state.isSelected).length;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="button-base p-2"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5" />
              입고현황 ({stats.completed}/{stats.total})
            </CardTitle>
            <div className="flex gap-2">
              <span className="badge-stats bg-green-500 text-white">
                완료: {stats.completed}
              </span>
              <span className="badge-stats bg-yellow-500 text-white">
                부분: {stats.partial}
              </span>
              <span className="badge-stats bg-gray-500 text-white">
                대기: {stats.pending}
              </span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcelDownload}
              className="button-base border-2 border-hansl-500 hover:border-hansl-600 hover:bg-hansl-50"
            >
              <Download className="h-4 w-4 mr-2" />
              엑셀 다운로드
            </Button>
            {stats.pending > 0 && (
              <>
                <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="button-base">
                      배치 처리 ({selectedCount})
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>배치 입고 처리</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">공통 메모</label>
                        <Textarea
                          value={batchNotes}
                          onChange={(e) => setBatchNotes(e.target.value)}
                          placeholder="배치 처리에 대한 메모를 입력하세요..."
                        />
                      </div>
                      <div className="text-sm text-muted-foreground">
                        선택된 {selectedCount}개 품목을 일괄 입고 처리합니다.
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowBatchDialog(false)} className="button-base">
                        취소
                      </Button>
                      <Button onClick={handleBatchDelivery} disabled={isProcessing} className="button-base bg-blue-500 hover:bg-blue-600 text-white">
                        처리
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                <DatePickerPopover
                  onDateSelect={handleCompleteAllDelivery}
                  placeholder="전체 입고완료 날짜를 선택하세요"
                  disabled={isProcessing}
                  align="end"
                  side="bottom"
                >
                  <Button
                    size="sm"
                    disabled={isProcessing}
                    className="button-base bg-green-500 hover:bg-green-600 text-white"
                  >
                    전체 완료
                  </Button>
                </DatePickerPopover>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          {stats.pending > 0 && (
            <div className="mb-4 p-3 bg-hansl-50 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectAll}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm font-medium">전체 선택 (입고 가능한 품목)</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {selectedCount}개 품목 선택됨
              </span>
            </div>
          )}

          <div className="space-y-4">
            {purchaseRequest.items?.map((item, index) => {
              const itemState = itemStates[item.id!] || {
                itemId: item.id!,
                receivedQuantity: item.received_quantity || 0,
                deliveryNotes: '',
                isSelected: false
              };

              const canReceive = !item.actual_received_date;
              const completionPercentage = item.quantity > 0 
                ? Math.round(((item.received_quantity || 0) / item.quantity) * 100) 
                : 0;

              return (
                <div key={item.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {canReceive && (
                        <Checkbox
                          checked={itemState.isSelected}
                          onCheckedChange={() => toggleItemSelection(item.id!)}
                        />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.line_number}.</span>
                          <span className="font-medium">{item.item_name}</span>
                          {getStatusBadge(item.actual_received_date || null)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          규격: {item.specification || '없음'}
                        </div>
                        <div className="text-sm">
                          주문수량: {item.quantity.toLocaleString()} | 
                          입고수량: {(item.received_quantity || 0).toLocaleString()} ({completionPercentage}%)
                        </div>
                        {item.actual_received_date && (
                          <div className="text-sm text-muted-foreground">
                            실제입고일: {format(new Date(item.actual_received_date), 'yyyy-MM-dd', { locale: ko })}
                            {item.received_by && ` (${item.received_by})`}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {canReceive && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pl-8">
                      <div>
                        <label className="text-sm font-medium">입고 수량</label>
                        <Input
                          type="number"
                          value={itemState.receivedQuantity}
                          onChange={(e) => updateItemQuantity(item.id!, parseFloat(e.target.value) || 0)}
                          max={item.quantity}
                          min={0}
                          step="0.01"
                          placeholder="입고 수량"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">메모</label>
                        <Input
                          value={itemState.deliveryNotes}
                          onChange={(e) => updateItemNotes(item.id!, e.target.value)}
                          placeholder="입고 관련 메모"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          onClick={() => handleSingleItemDelivery(item.id!)}
                          disabled={isProcessing || itemState.receivedQuantity <= 0}
                          size="sm"
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white w-full"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          입고 처리
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
      
    </Card>
  );
}