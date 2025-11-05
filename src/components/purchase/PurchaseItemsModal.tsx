
import { useState, useCallback } from "react";
import { X, Edit2, Save, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ReceiptDownloadButton } from "./ReceiptDownloadButton";
import { DatePickerPopover } from "@/components/ui/date-picker-popover";
import { useEffect } from "react";
import { useConfirmDateAction } from '@/hooks/useConfirmDateAction';
import { logger } from '@/lib/logger';

interface PurchaseItem {
  id?: number | string;
  line_number?: number;
  item_name: string;
  specification?: string;
  quantity: number;
  unit_price_value?: number;
  amount_value?: number;
  remark?: string;
  link?: string;
  is_received?: boolean;
  delivery_status?: string;
  receipt_image_url?: string | null;
  receipt_uploaded_at?: string | null;
  receipt_uploaded_by?: string | null;
  // 거래명세서 확인 관련 필드
  is_statement_received?: boolean;
  statement_received_date?: string | null;
  statement_received_by_name?: string | null;
}

interface PurchaseItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchase: {
    id: number;
    purchase_order_number?: string;
    vendor_name: string;
    requester_name: string;
    project_vendor: string;
    sales_order_number: string;
    project_item: string;
    request_date: string;
    delivery_request_date?: string | null;
    revised_delivery_request_date?: string | null;
    currency: string;
    payment_category?: string;
    items?: PurchaseItem[];
    total_amount: number;
  };
  isAdmin: boolean;
  onUpdate: () => void;
  activeTab?: string; // 활성 탭 정보 추가
}

export default function PurchaseItemsModal({ isOpen, onClose, purchase, isAdmin, onUpdate, activeTab = 'done' }: PurchaseItemsModalProps) {
  const [editingItems, setEditingItems] = useState<PurchaseItem[]>(purchase.items || []);
  const [isEditing, setIsEditing] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const supabase = createClient();
  
  // 사용자 정보 및 최신 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          const { data: employeeData } = await supabase
            .from('employees')
            .select('name')
            .eq('email', user.email)
            .single();
          
          if (employeeData?.name) {
            setCurrentUserName(employeeData.name);
          } else {
            setCurrentUserName(user.email);
          }
        }

        // 최신 구매 요청 아이템 데이터 로드 (거래명세서 확인 필드 포함)
        if (purchase.id) {
          const { data: freshItems } = await supabase
            .from('purchase_request_items')
            .select('*')
            .eq('purchase_request_id', purchase.id)
            .order('line_number');
          
          if (freshItems) {
            setEditingItems(freshItems);
          }
        }
      } catch (error) {
        logger.error('데이터 로드 실패', error);
        setCurrentUserName('사용자');
      }
    };

    if (isOpen) {
      loadData();
    }
  }, [isOpen, supabase, purchase.id]);

  // 권한 체크
  const isRequester = purchase?.requester_name === currentUserName
  const canReceiptCheck = isAdmin || isRequester
  
  logger.debug('🔐 PurchaseItemsModal 권한 체크 정보', {
    currentUserName,
    isAdmin,
    isRequester,
    canReceiptCheck,
    purchaseRequesterName: purchase?.requester_name,
    activeTab
  })

  // 모달 내부 데이터만 새로고침하는 함수 (모달 닫지 않음)
  const refreshModalData = useCallback(async () => {
    if (!purchase.id) return
    
    try {
      // 최신 구매 요청 아이템 데이터 로드
      const { data: freshItems } = await supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_request_id', purchase.id)
        .order('line_number')
      
      if (freshItems) {
        setEditingItems(freshItems)
        
        // 모달 상태 유지를 위해 외부 onUpdate 호출 제거
        // 외부 진행률 업데이트는 부모 컴포넌트에서 별도 처리
        logger.debug('모달 아이템 데이터 새로고침 완료 - 모달 상태 유지')
      }
    } catch (error) {
      logger.error('모달 데이터 새로고침 실패', error)
    }
  }, [purchase.id, supabase])

  // 커스텀 훅 설정
  const statementReceivedAction = useConfirmDateAction({
    config: {
      field: 'statement_received',
      confirmMessage: {
        confirm: '거래명세서 확인을 처리하시겠습니까?',
        cancel: '거래명세서 확인을 취소하시겠습니까?'
      },
      successMessage: {
        confirm: '거래명세서 확인이 완료되었습니다.',
        cancel: '거래명세서 확인이 취소되었습니다.'
      },
      completedText: '✓ 완료',
      waitingText: '대기'
    },
    currentUserName,
    canPerformAction: canReceiptCheck,
    onUpdate: refreshModalData
  })

  // 실제 입고 날짜 커스텀 훅 설정
  const actualReceivedAction = useConfirmDateAction({
    config: {
      field: 'actual_received',
      confirmMessage: {
        confirm: '실제 입고 처리를 진행하시겠습니까?',
        cancel: '실제 입고 처리를 취소하시겠습니까?'
      },
      successMessage: {
        confirm: '실제 입고 처리가 완료되었습니다.',
        cancel: '실제 입고 처리가 취소되었습니다.'
      },
      completedText: '입고완료',
      waitingText: '입고대기'
    },
    currentUserName,
    canPerformAction: canReceiptCheck,
    onUpdate: refreshModalData
  })
  
  // 품목 수정 시작
  const handleEditStart = () => {
    setIsEditing(true);
    setEditingItems([...purchase.items || []]);
  };

  // 품목 수정 취소
  const handleEditCancel = () => {
    setIsEditing(false);
    setEditingItems(purchase.items || []);
  };

  // 품목 값 변경
  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...editingItems];
    newItems[index] = {
      ...newItems[index],
      [field]: field === 'quantity' || field === 'unit_price_value' || field === 'amount_value' ? Number(value) : value
    };
    
    // 금액 자동 계산 (amount_value를 직접 수정하는 경우가 아닐 때만)
    if (field === 'quantity' || field === 'unit_price_value') {
      const quantity = newItems[index].quantity || 0;
      const unitPrice = newItems[index].unit_price_value || 0;
      // 단가가 입력된 경우에만 자동 계산, 아니면 0 유지
      newItems[index].amount_value = unitPrice > 0 ? quantity * unitPrice : 0;
    }
    
    setEditingItems(newItems);
  };

  // 새 품목 추가
  const handleAddItem = () => {
    // 현재 최대 라인넘버 찾기
    const maxLineNumber = editingItems.reduce((max, item) => {
      const lineNum = item.line_number || 0;
      return lineNum > max ? lineNum : max;
    }, 0);

    const newItem: PurchaseItem = {
      line_number: maxLineNumber + 1,
      item_name: '',
      specification: '',
      quantity: 1,
      unit_price_value: undefined, // 단가 비워두기
      amount_value: 0,
      remark: '',
      is_received: false
    };
    
    // 새 아이템 추가 후 라인넘버 순서대로 정렬
    const newItems = [...editingItems, newItem].sort((a, b) => {
      const lineA = a.line_number || 999999;
      const lineB = b.line_number || 999999;
      return lineA - lineB;
    });
    
    setEditingItems(newItems);
  };

  // 품목 삭제
  const handleDeleteItem = (index: number) => {
    const newItems = editingItems.filter((_, i) => i !== index).sort((a, b) => {
      const lineA = a.line_number || 999999;
      const lineB = b.line_number || 999999;
      return lineA - lineB;
    });
    setEditingItems(newItems);
  };

  // 품목 저장
  const handleSave = async () => {
    try {
      logger.debug('품목 저장 시작', { 
        editingItems: editingItems.length,
        purchaseId: purchase.id 
      });

      // 유효성 검사 - 품목명만 필수
      const invalidItems = editingItems.filter(item => 
        !item.item_name || !item.item_name.trim()
      );
      
      if (invalidItems.length > 0) {
        toast.error('품목명은 필수 입력 항목입니다.');
        return;
      }

      // 기존 품목 삭제
      const { error: deleteError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchase.id);

      if (deleteError) {
        logger.error('기존 품목 삭제 실패', deleteError);
        throw deleteError;
      }

      // 새 품목 추가
      const itemsToInsert = editingItems.map(item => ({
        purchase_request_id: purchase.id,
        purchase_order_number: purchase.purchase_order_number,
        line_number: item.line_number,
        item_name: item.item_name.trim(),
        specification: item.specification || '',
        quantity: Number(item.quantity) || 0,
        unit_price_value: (item.unit_price_value !== null && item.unit_price_value !== undefined && item.unit_price_value !== '') ? Number(item.unit_price_value) : null,
        amount_value: Number(item.amount_value) || 0,
        remark: item.remark || '',
        link: item.link || null,
        is_received: item.is_received || false,
        delivery_status: item.delivery_status || 'pending'
      }));

      logger.debug('품목 삽입 데이터', { itemsToInsert });

      const { error: insertError } = await supabase
        .from('purchase_request_items')
        .insert(itemsToInsert);

      if (insertError) {
        logger.error('품목 삽입 실패', insertError);
        throw insertError;
      }

      // 총금액 업데이트
      const totalAmount = editingItems.reduce((sum, item) => sum + (Number(item.amount_value) || 0), 0);
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({ total_amount: totalAmount })
        .eq('id', purchase.id);

      if (updateError) {
        logger.error('총금액 업데이트 실패', updateError);
        throw updateError;
      }

      logger.debug('품목 저장 완료');
      toast.success('품목이 수정되었습니다.');
      setIsEditing(false);
      onUpdate();
      onClose();
    } catch (error) {
      logger.error('품목 저장 중 오류', error);
      toast.error(`저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
    }
  };
  
  const items = isEditing ? editingItems : editingItems;
  const totalAmount = items.reduce((sum, item) => sum + (item.amount_value || 0), 0);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[98vw] max-h-[90vh] overflow-hidden flex flex-col bg-white p-3 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="modal-title">
              발주 상세 항목 - {purchase.purchase_order_number}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isAdmin && !isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditStart}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  편집
                </Button>
              )}
              {isEditing && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddItem}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    품목 추가
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSave}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    저장
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleEditCancel}
                  >
                    취소
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-6 w-6"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 gap-3 py-3 border-b">
          <div>
            <p className="modal-label">업체명</p>
            <p className="modal-value">{purchase.vendor_name}</p>
          </div>
          <div>
            <p className="modal-label">요청자</p>
            <p className="modal-value">{purchase.requester_name}</p>
          </div>
          <div>
            <p className="modal-label">프로젝트</p>
            <p className="modal-value truncate" title={purchase.project_vendor}>
              {purchase.project_vendor}
            </p>
          </div>
          <div>
            <p className="modal-label">납기일</p>
            <p className="modal-value">
              {purchase.delivery_request_date && 
                format(new Date(purchase.delivery_request_date), 'yyyy-MM-dd')}
            </p>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto">
          <div className="min-w-[800px] overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow>
                <TableHead className="w-12">No.</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>규격</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead className="text-right">금액</TableHead>
                {activeTab === 'purchase' && (
                  <TableHead>구매상태</TableHead>
                )}
                {(activeTab === 'receipt' || activeTab === 'done') && (
                  <TableHead>입고상태</TableHead>
                )}
                {activeTab === 'done' && (
                  <>
                    <TableHead className="text-center">거래명세서 확인</TableHead>
                    <TableHead className="text-center">회계상 입고일</TableHead>
                    <TableHead className="text-center">처리자</TableHead>
                  </>
                )}
                {activeTab === 'receipt' && (
                  <TableHead className="text-center">실제 입고일</TableHead>
                )}
                <TableHead>비고</TableHead>
                {isEditing && <TableHead className="w-20">삭제</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(isEditing ? editingItems : items).map((item, index) => (
                <TableRow key={item.id || index}>
                  <TableCell className="modal-value">{item.line_number || index + 1}</TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={item.item_name}
                        onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                        className="h-7 modal-label"
                      />
                    ) : (
                      <div className="sm:max-w-[200px]">
                        <p className="modal-value truncate" title={item.item_name}>
                          {item.item_name}
                        </p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={item.specification}
                        onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                        className="h-7 modal-label"
                      />
                    ) : (
                      <div className="sm:max-w-[150px] truncate" title={item.specification}>
                        {item.specification}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                        className="h-7 text-xs text-right"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-value text-right" style={{display: 'block', textAlign: 'right'}}>{item.quantity.toLocaleString()}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.unit_price_value}
                        onChange={(e) => handleItemChange(index, 'unit_price_value', e.target.value)}
                        className="h-7 text-xs text-right"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-subtitle text-right" style={{display: 'block', textAlign: 'right'}}>{(item.unit_price_value || 0).toLocaleString()} {purchase.currency}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.amount_value}
                        onChange={(e) => handleItemChange(index, 'amount_value', e.target.value)}
                        className="h-7 modal-label text-right"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-value text-right" style={{display: 'block', textAlign: 'right'}}>{(item.amount_value || 0).toLocaleString()} {purchase.currency}</span>
                      </div>
                    )}
                  </TableCell>
                  {activeTab === 'purchase' && (
                    <TableCell>
                      {/* 구매상태 - 구매완료/취소 버튼 */}
                      {canReceiptCheck ? (
                        item.is_payment_completed ? (
                          <button
                            onClick={async () => {
                              try {
                                logger.debug('구매취소 버튼 클릭', { 
                                  itemId: item.id,
                                  itemName: item.item_name,
                                  currentStatus: item.is_payment_completed 
                                });

                                if (!item.id) {
                                  throw new Error('품목 ID가 없습니다.');
                                }

                                const { error, data } = await supabase
                                  .from('purchase_request_items')
                                  .update({ is_payment_completed: false })
                                  .eq('id', item.id)
                                  .select();
                                
                                if (error) {
                                  logger.error('구매취소 업데이트 실패', error);
                                  throw error;
                                }

                                logger.debug('구매취소 업데이트 성공', { data });
                                toast.success('구매 취소 처리되었습니다.');
                                await refreshModalData();
                              } catch (error) {
                                logger.error('구매취소 처리 중 오류', error);
                                toast.error(`처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
                              }
                            }}
                            className="button-base bg-green-500 hover:bg-green-600 text-white transition-colors"
                            title="클릭하여 구매 취소"
                          >
                            구매완료
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                logger.debug('구매완료 버튼 클릭', { 
                                  itemId: item.id,
                                  itemName: item.item_name,
                                  currentStatus: item.is_payment_completed 
                                });

                                if (!item.id) {
                                  throw new Error('품목 ID가 없습니다.');
                                }

                                const { error, data } = await supabase
                                  .from('purchase_request_items')
                                  .update({ is_payment_completed: true })
                                  .eq('id', item.id)
                                  .select();
                                
                                if (error) {
                                  logger.error('구매완료 업데이트 실패', error);
                                  throw error;
                                }

                                logger.debug('구매완료 업데이트 성공', { data });
                                toast.success('구매완료 처리되었습니다.');
                                await refreshModalData();
                              } catch (error) {
                                logger.error('구매완료 처리 중 오류', error);
                                toast.error(`처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
                              }
                            }}
                            className="button-base border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                          >
                            구매대기
                          </button>
                        )
                      ) : (
                        <span className={`button-base ${
                          item.is_payment_completed
                            ? 'bg-green-500 text-white' 
                            : 'border border-gray-300 text-gray-400 bg-white'
                        }`}>
                          {item.is_payment_completed ? '구매완료' : '구매대기'}
                        </span>
                      )}
                    </TableCell>
                  )}
                  {(activeTab === 'receipt' || activeTab === 'done') && (
                    <TableCell>
                      {/* 입고현황 탭에서는 실제 입고 날짜 기능 사용 */}
                      {activeTab === 'receipt' ? (
                        canReceiptCheck ? (
                          actualReceivedAction.isCompleted(item) ? (
                            <button
                              onClick={() => {
                                actualReceivedAction.handleCancel(item.id!, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              className="button-base bg-green-500 hover:bg-green-600 text-white transition-colors"
                              title="클릭하여 실제 입고 처리 취소"
                            >
                              {actualReceivedAction.config.completedText}
                            </button>
                          ) : (
                            <DatePickerPopover
                              onDateSelect={(date) => {
                                actualReceivedAction.handleConfirm(item.id!, date, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              placeholder="실제 입고 날짜 선택"
                            >
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="button-base border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                              >
                                {actualReceivedAction.config.waitingText}
                              </Button>
                            </DatePickerPopover>
                          )
                        ) : (
                          <span className={`button-base ${
                            actualReceivedAction.isCompleted(item)
                              ? 'bg-green-500 text-white' 
                              : 'border border-gray-300 text-gray-400 bg-white'
                          }`}>
                            {actualReceivedAction.isCompleted(item) ? actualReceivedAction.config.completedText : actualReceivedAction.config.waitingText}
                          </span>
                        )
                      ) : (
                        /* 전체항목 탭에서는 상태 표시만 */
                        <span className={`button-base ${
                          actualReceivedAction.isCompleted(item)
                            ? 'bg-green-500 text-white' 
                            : 'border border-gray-300 text-gray-600 bg-white'
                        }`}>
                          {actualReceivedAction.isCompleted(item) ? actualReceivedAction.config.completedText : actualReceivedAction.config.waitingText}
                        </span>
                      )}
                    </TableCell>
                  )}
                  {activeTab === 'receipt' && (
                    <TableCell className="text-center">
                      {actualReceivedAction.getCompletedDate(item) ? (
                        <span className="modal-subtitle text-green-600">
                          {format(new Date(actualReceivedAction.getCompletedDate(item)), 'yyyy-MM-dd HH:mm')}
                        </span>
                      ) : (
                        <span className="modal-subtitle">-</span>
                      )}
                    </TableCell>
                  )}
                  {activeTab === 'done' && (
                    <>
                      <TableCell className="text-center">
                        {canReceiptCheck ? (
                          statementReceivedAction.isCompleted(item) ? (
                            <button
                              onClick={() => {
                                statementReceivedAction.handleCancel(item.id!, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              className="button-base bg-green-500 hover:bg-green-600 text-white transition-colors"
                              title="클릭하여 거래명세서 확인 취소"
                            >
                              {statementReceivedAction.config.completedText}
                            </button>
                          ) : (
                            <DatePickerPopover
                              onDateSelect={(date) => {
                                statementReceivedAction.handleConfirm(item.id!, date, {
                                  item_name: item.item_name,
                                  specification: item.specification,
                                  quantity: item.quantity,
                                  unit_price_value: item.unit_price_value,
                                  amount_value: item.amount_value,
                                  remark: item.remark
                                })
                              }}
                              placeholder="날짜 선택"
                            >
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="button-base border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                              >
                                {statementReceivedAction.config.waitingText}
                              </Button>
                            </DatePickerPopover>
                          )
                        ) : (
                          <span className={`button-base ${
                            statementReceivedAction.isCompleted(item)
                              ? 'bg-green-500 text-white' 
                              : 'border border-gray-300 text-gray-400 bg-white'
                          }`}>
                            {statementReceivedAction.isCompleted(item) ? statementReceivedAction.config.completedText : statementReceivedAction.config.waitingText}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {statementReceivedAction.getCompletedDate(item) ? (
                          <span className="modal-subtitle">
                            {format(new Date(statementReceivedAction.getCompletedDate(item)), 'yyyy-MM-dd')}
                          </span>
                        ) : (
                          <span className="modal-subtitle">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {statementReceivedAction.getCompletedByName(item) ? (
                          <span className="modal-subtitle">
                            {statementReceivedAction.getCompletedByName(item)}
                          </span>
                        ) : (
                          <span className="modal-subtitle">-</span>
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={item.remark || ''}
                        onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                        className="h-7 modal-label"
                        placeholder="비고"
                      />
                    ) : (
                      <div className="sm:max-w-[150px]">
                        <span className="modal-subtitle truncate block" title={item.remark}>
                          {item.remark || '-'}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  {isEditing && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(index)}
                        className="h-7 w-7 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
        
        <div className="flex-shrink-0 border-t pt-4 flex justify-between items-center">
          <div className="modal-subtitle">
            총 {items.length}개 품목
          </div>
          <div className="modal-value-large">
            총 금액: {totalAmount.toLocaleString()} {purchase.currency}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}