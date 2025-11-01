
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { deliveryService } from '@/services/deliveryService';
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

  // 입고 상태에 따른 배지 컴포넌트
  const getStatusBadge = (status: string | undefined, receivedQty: number, totalQty: number) => {
    switch (status) {
      case 'received':
        return <Badge variant={null} className="badge-success">입고완료</Badge>;
      case 'partial':
        return <Badge variant={null} className="badge-warning">부분입고</Badge>;
      default:
        return <Badge variant={null} className="badge-secondary">입고대기</Badge>;
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
        // 입고 완료되지 않은 품목만 선택
        if (item && item.delivery_status !== 'received') {
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

  // 전체 입고 처리
  const handleCompleteAllDelivery = async () => {
    if (!currentUser) return;
    if (!purchaseRequest.id) return;

    setIsProcessing(true);
    try {
      const result = await deliveryService.markAllItemsAsReceived(
        parseInt(purchaseRequest.id),
        currentUser.id,
        currentUser.name,
        "전체 품목 일괄 입고 처리"
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

  // 통계 계산
  const stats = {
    total: purchaseRequest.items?.length || 0,
    completed: purchaseRequest.items?.filter(item => item.delivery_status === 'received').length || 0,
    partial: purchaseRequest.items?.filter(item => item.delivery_status === 'partial').length || 0,
    pending: purchaseRequest.items?.filter(item => item.delivery_status === 'pending').length || 0
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
              className="p-2"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5" />
              입고현황 ({stats.completed}/{stats.total})
            </CardTitle>
            <div className="flex gap-2">
              <Badge variant={null} className="badge-success">
                완료: {stats.completed}
              </Badge>
              <Badge variant={null} className="badge-warning">
                부분: {stats.partial}
              </Badge>
              <Badge variant={null} className="badge-secondary">
                대기: {stats.pending}
              </Badge>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcelDownload}
              className="border-2 border-hansl-500 hover:border-hansl-600 hover:bg-hansl-50"
            >
              <Download className="h-4 w-4 mr-2" />
              엑셀 다운로드
            </Button>
            {stats.pending > 0 && (
              <>
                <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
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
                      <Button variant="outline" onClick={() => setShowBatchDialog(false)}>
                        취소
                      </Button>
                      <Button onClick={handleBatchDelivery} disabled={isProcessing}>
                        처리
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                <Button
                  onClick={handleCompleteAllDelivery}
                  size="sm"
                  disabled={isProcessing}
                >
                  전체 완료
                </Button>
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

              const canReceive = item.delivery_status !== 'received';
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
                          {getStatusBadge(item.delivery_status, item.received_quantity || 0, item.quantity)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          규격: {item.specification || '없음'}
                        </div>
                        <div className="text-sm">
                          주문수량: {item.quantity.toLocaleString()} | 
                          입고수량: {(item.received_quantity || 0).toLocaleString()} ({completionPercentage}%)
                        </div>
                        {item.received_date && (
                          <div className="text-sm text-muted-foreground">
                            입고일: {format(new Date(item.received_date), 'yyyy-MM-dd HH:mm', { locale: ko })}
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
                          className="w-full"
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