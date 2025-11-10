
import { useState, useCallback, useEffect, useMemo } from "react";
import { X, Edit2, Save, Trash2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ReceiptDownloadButton } from "./ReceiptDownloadButton";
import { DatePickerPopover } from "@/components/ui/date-picker-popover";
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
  is_payment_completed?: boolean;
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
    purchase_request_items?: PurchaseItem[];
    total_amount: number;
  };
  isAdmin: boolean;
  onUpdate: () => void;
  activeTab?: string; // 활성 탭 정보 추가
}

export default function PurchaseItemsModal({ isOpen, onClose, purchase, isAdmin, onUpdate, activeTab = 'done' }: PurchaseItemsModalProps) {
  const [editingItems, setEditingItems] = useState<PurchaseItem[]>(purchase.purchase_request_items || []);
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
    purchaseId: purchase.id,
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
    purchaseId: purchase?.id,
    onUpdate: refreshModalData
  })
  
  // 품목 수정 시작
  const handleEditStart = () => {
    setIsEditing(true);
    setEditingItems([...purchase.purchase_request_items || []]);
  };

  // 품목 수정 취소
  const handleEditCancel = () => {
    setIsEditing(false);
    setEditingItems(purchase.purchase_request_items || []);
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
        unit_price_value: item.unit_price_value !== null && item.unit_price_value !== undefined ? Number(item.unit_price_value) : null,
        amount_value: Number(item.amount_value) || 0,
        remark: item.remark || '',
        link: item.link || null,
        is_received: item.is_received || false,
        delivery_status: item.delivery_status || 'pending'
      }));


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

      toast.success('품목이 수정되었습니다.');
      setIsEditing(false);
      onUpdate();
      onClose();
    } catch (error) {
      logger.error('품목 저장 중 오류', error);
      toast.error(`저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
    }
  };
  
  const baseItems = editingItems.length > 0 ? editingItems : (purchase.purchase_request_items || []);
  const items = isEditing ? editingItems : baseItems;

  const tableMinWidth = useMemo(() => {
    const data = items.length > 0 ? items : baseItems;
    if (!data || data.length === 0) {
      return 960;
    }

    const columnDefs = [
      { key: 'index', base: 64, header: 'No.', accessor: (_item: PurchaseItem, index: number) => `${index + 1}` },
      { key: 'item_name', base: 150, max: 320, header: '품목', accessor: (item: PurchaseItem) => item.item_name },
      { key: 'specification', base: 150, max: 320, header: '규격', accessor: (item: PurchaseItem) => item.specification },
      { key: 'quantity', base: 90, header: '수량', accessor: (item: PurchaseItem) => item.quantity != null ? item.quantity.toLocaleString() : '' },
      { key: 'unit_price_value', base: 120, header: '단가', accessor: (item: PurchaseItem) => item.unit_price_value != null ? item.unit_price_value.toLocaleString() : '' },
      { key: 'amount_value', base: 140, header: '금액', accessor: (item: PurchaseItem) => item.amount_value != null ? item.amount_value.toLocaleString() : '' },
      { key: 'remark', base: 140, max: 320, header: '비고', accessor: (item: PurchaseItem) => item.remark }
    ];

    const widths = columnDefs.map((col, index) => {
      const values = data.map((item: any, rowIndex: number) => {
        if (col.accessor) {
          return col.accessor(item, rowIndex) ?? '';
        }
        return '';
      });
      const headerLength = col.header ? col.header.length : 0;
      const maxLen = Math.max(headerLength, ...values.map((value: any) => (value ? String(value).length : 0)));
      const computed = maxLen * 8 + 32;
      const limited = col.max ? Math.min(col.max, computed) : computed;
      return Math.max(col.base, limited);
    });

    if (activeTab === 'purchase') {
      widths.push(120);
    }

    if (activeTab === 'receipt' || activeTab === 'done') {
      widths.push(120);
    }

    if (activeTab === 'receipt') {
      widths.push(140);
    }

    if (activeTab === 'done') {
      widths.push(140, 140, 110);
    }

    if (isEditing) {
      widths.push(100);
    }

    const gap = widths.length > 1 ? (widths.length - 1) * 16 : 0;
    const padding = 48;
    const total = widths.reduce((sum, width) => sum + width, 0) + gap + padding;
    return Math.max(total, 960);
  }, [items, baseItems, activeTab, isEditing]);

  const totalAmount = items.reduce((sum: number, item: any) => sum + (item.amount_value || 0), 0);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="w-full sm:w-auto max-w-[92vw] sm:max-w-[88vw] lg:max-w-[90vw] xl:max-w-[85vw] h-[95vh] sm:h-auto max-h-[90vh] flex flex-col bg-white p-3 sm:p-6"
        maxWidth="max-w-none"
        showCloseButton={false}
      >
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
        
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-x-auto">
            <div className="inline-block align-top" style={{ minWidth: `${tableMinWidth}px` }}>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-[13px] leading-[1.6] border-collapse" style={{ minWidth: `${tableMinWidth}px` }}>
              <thead className="sticky top-0 bg-white z-10 shadow-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-16 min-w-[64px]">No.</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[140px]">품목</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[120px]">규격</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 min-w-[80px]">수량</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 min-w-[110px]">단가</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 min-w-[130px]">금액</th>
                {activeTab === 'purchase' && (
                    <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[110px]">구매상태</th>
                )}
                {(activeTab === 'receipt' || activeTab === 'done') && (
                    <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[110px]">입고상태</th>
                )}
                {activeTab === 'done' && (
                  <>
                      <th className="px-3 py-2 text-center font-medium text-gray-600 min-w-[130px]">거래명세서 확인</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600 min-w-[130px]">회계상 입고일</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600 min-w-[90px]">처리자</th>
                  </>
                )}
                {activeTab === 'receipt' && (
                    <th className="px-3 py-2 text-center font-medium text-gray-600 min-w-[130px]">실제 입고일</th>
                )}
                  <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[110px]">비고</th>
                  {isEditing && <th className="px-3 py-2 text-left font-medium text-gray-600 w-20 min-w-[90px]">삭제</th>}
                </tr>
              </thead>
              <tbody>
              {(isEditing ? editingItems : items).map((item: any, index: number) => (
                  <tr key={item.id || index} className="border-b last:border-b-0">
                    <td className="px-3 py-2 text-center align-top modal-value">{item.line_number || index + 1}</td>
                    <td className="px-3 py-2 align-top min-w-[140px]">
                    {isEditing ? (
                      <Input
                        value={item.item_name}
                        onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                        className="h-7 modal-label w-full"
                      />
                    ) : (
                      <div className="max-w-[200px]">
                        <p className="modal-value truncate" title={item.item_name}>
                          {item.item_name}
                        </p>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top min-w-[120px]">
                    {isEditing ? (
                      <Input
                        value={item.specification}
                        onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                        className="h-7 modal-label w-full"
                      />
                    ) : (
                      <div className="max-w-[150px] truncate" title={item.specification}>
                        {item.specification}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top min-w-[80px]">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                        className="h-7 text-xs text-right w-full"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-value" style={{display: 'block', textAlign: 'right'}}>{item.quantity.toLocaleString()}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top min-w-[110px]">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.unit_price_value}
                        onChange={(e) => handleItemChange(index, 'unit_price_value', e.target.value)}
                        className="h-7 text-xs text-right w-full"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-subtitle" style={{display: 'block', textAlign: 'right'}}>{(item.unit_price_value || 0).toLocaleString()} {purchase.currency}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top min-w-[130px]">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={item.amount_value}
                        onChange={(e) => handleItemChange(index, 'amount_value', e.target.value)}
                        className="h-7 modal-label text-right w-full"
                      />
                    ) : (
                      <div className="text-right">
                        <span className="modal-value" style={{display: 'block', textAlign: 'right'}}>{(item.amount_value || 0).toLocaleString()} {purchase.currency}</span>
                      </div>
                    )}
                  </td>
                  {activeTab === 'purchase' && (
                    <td className="px-3 py-2 align-top min-w-[110px]">
                      {/* 구매상태 - 구매완료/취소 버튼 */}
                      {canReceiptCheck ? (
                        item.is_payment_completed ? (
                          <button
                            onClick={async () => {
                              try {

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
                    </td>
                  )}
                  {(activeTab === 'receipt' || activeTab === 'done') && (
                    <td className="px-3 py-2 align-top min-w-[110px]">
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
                    </td>
                  )}
                  {activeTab === 'receipt' && (
                    <td className="px-3 py-2 text-center align-top min-w-[130px]">
                      {actualReceivedAction.getCompletedDate(item) ? (
                        <span className="modal-subtitle text-green-600">
                          {format(new Date(actualReceivedAction.getCompletedDate(item)), 'yyyy-MM-dd HH:mm')}
                        </span>
                      ) : (
                        <span className="modal-subtitle">-</span>
                      )}
                    </td>
                  )}
                  {activeTab === 'done' && (
                    <>
                      <td className="px-3 py-2 text-center align-top min-w-[130px]">
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
                      </td>
                      <td className="px-3 py-2 text-center align-top min-w-[130px]">
                        {statementReceivedAction.getCompletedDate(item) ? (
                          <span className="modal-subtitle">
                            {format(new Date(statementReceivedAction.getCompletedDate(item)), 'yyyy-MM-dd')}
                          </span>
                        ) : (
                          <span className="modal-subtitle">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center align-top min-w-[90px]">
                        {statementReceivedAction.getCompletedByName(item) ? (
                          <span className="modal-subtitle">
                            {statementReceivedAction.getCompletedByName(item)}
                          </span>
                        ) : (
                          <span className="modal-subtitle">-</span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 align-top min-w-[110px]">
                    {isEditing ? (
                      <Input
                        value={item.remark || ''}
                        onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                        className="h-7 modal-label w-full"
                        placeholder="비고"
                      />
                    ) : (
                      <div className="max-w-[150px]">
                        <span className="modal-subtitle truncate block" title={item.remark}>
                          {item.remark || '-'}
                        </span>
                      </div>
                    )}
                  </td>
                  {isEditing && (
                    <td className="px-3 py-2 align-top min-w-[90px]">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(index)}
                        className="h-7 w-7 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              </tbody>
            </table>
              </div>
            </div>
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