import { memo, useState, useEffect } from "react";
import { Edit2, Trash2, Save, X, Plus, Package, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
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

interface PurchaseItem {
  id?: number;
  item_name: string;
  specification: string;
  quantity: number;
  unit_price_value: number;
  amount_value: number;
  remark?: string;
  is_received?: boolean;
  line_number?: number;
  purchase_status?: string;
  purchase_completed_at?: string;
  delivery_status?: string;
  received_at?: string;
}

interface Purchase {
  id: number;
  purchase_order_number?: string;
  requester_name: string;
  vendor_name: string;
  middle_manager_status?: string;
  final_manager_status?: string;
  is_received: boolean;
  total_amount: number;
  currency: string;
  delivery_request_date?: string;
  request_date: string;
  items?: PurchaseItem[];
  contact_name?: string;
  progress_type?: string;
  is_payment_completed?: boolean;
  project_vendor?: string;
  sales_order_number?: string;
  project_item?: string;
  vendor_payment_schedule?: string;
  payment_category?: string;
}

interface EditablePurchaseTableProps {
  purchase: Purchase;
  currentUserRoles?: string[];
  activeTab?: string;
  onRefresh?: () => void;
  onClose?: () => void;
  startInEditMode?: boolean; // 바로 편집 모드로 시작
}

const EditablePurchaseTable = memo(({ 
  purchase, 
  currentUserRoles = [], 
  activeTab = 'done',
  onRefresh,
  onClose,
  startInEditMode = false 
}: EditablePurchaseTableProps) => {
  const supabase = createClient();
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [editedItems, setEditedItems] = useState<PurchaseItem[]>([]);
  const [editedPurchase, setEditedPurchase] = useState<Purchase>(purchase);
  const [deletedItemIds, setDeletedItemIds] = useState<number[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // 권한 체크
  const canEdit = currentUserRoles.includes('final_approver') || 
                  currentUserRoles.includes('app_admin') || 
                  currentUserRoles.includes('ceo');
  
  const canDelete = canEdit;

  useEffect(() => {
    if (purchase.items) {
      setEditedItems([...purchase.items]);
    }
    setEditedPurchase(purchase);
  }, [purchase]);

  const handleEdit = () => {
    if (!canEdit) {
      toast.error("수정 권한이 없습니다.");
      return;
    }
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedItems(purchase.items ? [...purchase.items] : []);
    setEditedPurchase(purchase);
    setDeletedItemIds([]);
    setIsEditing(false);
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...editedItems];
    newItems[index] = {
      ...newItems[index],
      [field]: value,
      // 금액 자동 계산
      amount_value: field === 'quantity' || field === 'unit_price_value' 
        ? (field === 'quantity' ? value : newItems[index].quantity) * 
          (field === 'unit_price_value' ? value : newItems[index].unit_price_value)
        : newItems[index].amount_value
    };
    setEditedItems(newItems);
  };

  const handleAddItem = () => {
    const newItem: PurchaseItem = {
      item_name: '',
      specification: '',
      quantity: 1,
      unit_price_value: 0,
      amount_value: 0,
      remark: '',
      line_number: editedItems.length + 1
    };
    setEditedItems([...editedItems, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    const item = editedItems[index];
    if (item.id) {
      // 기존 항목은 삭제 목록에 추가하고 화면에서 제거
      setDeletedItemIds([...deletedItemIds, item.id]);
      const newItems = editedItems.filter((_, i) => i !== index);
      setEditedItems(newItems);
      toast.info("항목이 삭제 예정입니다. 저장 버튼을 눌러 확정하세요.");
    } else {
      // 새로 추가한 항목은 바로 제거
      const newItems = editedItems.filter((_, i) => i !== index);
      setEditedItems(newItems);
    }
  };

  const handleSave = async () => {
    try {
      // 발주 기본 정보 업데이트
      const totalAmount = editedItems.reduce((sum, item) => sum + item.amount_value, 0);
      
      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({
          purchase_order_number: editedPurchase.purchase_order_number,
          requester_name: editedPurchase.requester_name,
          vendor_name: editedPurchase.vendor_name,
          contact_name: editedPurchase.contact_name,
          progress_type: editedPurchase.progress_type,
          project_vendor: editedPurchase.project_vendor,
          sales_order_number: editedPurchase.sales_order_number,
          project_item: editedPurchase.project_item,
          vendor_payment_schedule: editedPurchase.vendor_payment_schedule,
          payment_category: editedPurchase.payment_category,
          currency: editedPurchase.currency,
          delivery_request_date: editedPurchase.delivery_request_date,
          request_date: editedPurchase.request_date,
          total_amount: totalAmount,
          updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

      if (updateError) throw updateError;

      // 삭제된 항목들 처리
      if (deletedItemIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('purchase_request_items')
          .delete()
          .in('id', deletedItemIds);

        if (deleteError) throw deleteError;
      }

      // 각 아이템 업데이트 또는 생성
      for (const item of editedItems) {
        if (item.id) {
          // 기존 항목 업데이트
          const { error } = await supabase
            .from('purchase_request_items')
            .update({
              item_name: item.item_name,
              specification: item.specification,
              quantity: item.quantity,
              unit_price_value: item.unit_price_value,
              amount_value: item.amount_value,
              remark: item.remark,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);

          if (error) throw error;
        } else {
          // 새 항목 생성
          const { error } = await supabase
            .from('purchase_request_items')
            .insert({
              purchase_request_id: purchase.id,
              item_name: item.item_name,
              specification: item.specification,
              quantity: item.quantity,
              unit_price_value: item.unit_price_value,
              amount_value: item.amount_value,
              remark: item.remark,
              line_number: item.line_number,
              created_at: new Date().toISOString()
            });

          if (error) throw error;
        }
      }

      toast.success("발주 내역이 수정되었습니다.");
      setIsEditing(false);
      setDeletedItemIds([]);
      onRefresh?.();
    } catch (error) {
      toast.error("저장 중 오류가 발생했습니다.");
    }
  };


  const handleDeleteAll = async () => {
    try {
      // 모든 아이템 삭제
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchase.id);

      if (itemsError) throw itemsError;

      // 발주 요청 삭제
      const { error: requestError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('id', purchase.id);

      if (requestError) throw requestError;

      toast.success("발주 내역이 삭제되었습니다.");
      onRefresh?.();
      onClose?.();
    } catch (error) {
      toast.error("삭제 중 오류가 발생했습니다.");
    }
    
    setDeleteConfirmOpen(false);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ko-KR').format(value);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  // 전체 구매완료 처리
  const handlePurchaseComplete = async () => {
    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update({ 
          is_payment_completed: true,
          payment_completed_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

      if (error) throw error;
      
      toast.success('구매완료 처리되었습니다.');
      onRefresh?.();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  // 전체 입고완료 처리
  const handleReceiptComplete = async () => {
    try {
      // 발주 전체를 입고완료로 변경
      const { error: purchaseError } = await supabase
        .from('purchase_requests')
        .update({ 
          is_received: true,
          received_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

      if (purchaseError) throw purchaseError;
      
      // 모든 항목을 입고완료로 변경
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .update({ 
          is_received: true,
          delivery_status: 'received'
        })
        .eq('purchase_request_id', purchase.id);

      if (itemsError) throw itemsError;

      toast.success('입고완료 처리되었습니다.');
      onRefresh?.();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  // 개별 항목 구매완료 처리
  const handleItemPurchaseComplete = async (itemId: number) => {
    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({ 
          purchase_status: 'completed',
          purchase_completed_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (error) throw error;
      
      toast.success('항목 구매완료 처리되었습니다.');
      onRefresh?.();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  // 개별 항목 입고완료 처리
  const handleItemReceiptComplete = async (itemId: number) => {
    try {
      const { error } = await supabase
        .from('purchase_request_items')
        .update({ 
          is_received: true,
          delivery_status: 'received',
          received_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (error) throw error;
      
      toast.success('항목 입고완료 처리되었습니다.');
      onRefresh?.();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          발주요청번호: {isEditing ? (
            <Input
              value={editedPurchase.purchase_order_number || ''}
              onChange={(e) => setEditedPurchase({...editedPurchase, purchase_order_number: e.target.value})}
              className="inline-block w-48 ml-2"
            />
          ) : (
            purchase.purchase_order_number
          )}
        </h3>
        <div className="flex gap-2">
          {!isEditing ? (
            <>
              {/* startInEditMode가 true면 수정 버튼 제거 */}
              {(activeTab === 'purchase' || activeTab === 'done') && !purchase.is_payment_completed && canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePurchaseComplete}
                  className="text-green-600 hover:bg-green-50"
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  구매완료
                </Button>
              )}
              {(activeTab === 'receipt' || activeTab === 'done') && !purchase.is_received && canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReceiptComplete}
                  className="text-purple-600 hover:bg-purple-50"
                >
                  <Package className="w-4 h-4 mr-1" />
                  입고완료
                </Button>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  전체 삭제
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
              >
                <X className="w-4 h-4 mr-1" />
                취소
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="bg-hansl-600 hover:bg-hansl-700 text-white"
              >
                <Save className="w-4 h-4 mr-1" />
                저장
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 발주 기본 정보 섹션 */}
      {!isEditing ? (
        <div className="border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3">발주 정보</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-600">청구일:</span>
              <span className="ml-2 font-medium">{formatDate(purchase.request_date)}</span>
            </div>
            <div>
              <span className="text-gray-600">입고요청일:</span>
              <span className="ml-2 font-medium">{formatDate(purchase.delivery_request_date)}</span>
            </div>
            <div>
              <span className="text-gray-600">요청자:</span>
              <span className="ml-2 font-medium">{purchase.requester_name}</span>
            </div>
            <div>
              <span className="text-gray-600">업체:</span>
              <span className="ml-2 font-medium">{purchase.vendor_name}</span>
            </div>
            <div>
              <span className="text-gray-600">담당자:</span>
              <span className="ml-2 font-medium">{purchase.contact_name || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">구분:</span>
              <span className={`ml-2 font-medium ${purchase.progress_type === '선진행' ? 'text-red-600' : ''}`}>
                {purchase.progress_type || '일반'}
              </span>
            </div>
            <div>
              <span className="text-gray-600">PJ업체:</span>
              <span className="ml-2 font-medium">{purchase.project_vendor || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">수주번호:</span>
              <span className="ml-2 font-medium">{purchase.sales_order_number || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">프로젝트:</span>
              <span className="ml-2 font-medium">{purchase.project_item || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">지출예정일:</span>
              <span className="ml-2 font-medium">{purchase.vendor_payment_schedule || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">결제구분:</span>
              <span className="ml-2 font-medium">{purchase.payment_category || '-'}</span>
            </div>
            <div>
              <span className="text-gray-600">통화:</span>
              <span className="ml-2 font-medium">{purchase.currency || 'KRW'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="text-sm font-semibold mb-3">발주 기본 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-600">청구일</label>
              <Input
                type="date"
                value={editedPurchase.request_date?.split('T')[0] || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, request_date: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">입고요청일</label>
              <Input
                type="date"
                value={editedPurchase.delivery_request_date?.split('T')[0] || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, delivery_request_date: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">요청자</label>
              <Input
                value={editedPurchase.requester_name || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, requester_name: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">업체명</label>
              <Input
                value={editedPurchase.vendor_name || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, vendor_name: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">담당자</label>
              <Input
                value={editedPurchase.contact_name || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, contact_name: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">구분</label>
              <select
                value={editedPurchase.progress_type || '일반'}
                onChange={(e) => setEditedPurchase({...editedPurchase, progress_type: e.target.value})}
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-hansl-500"
              >
                <option value="일반">일반</option>
                <option value="선진행">선진행</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">PJ업체</label>
              <Input
                value={editedPurchase.project_vendor || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, project_vendor: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">수주번호</label>
              <Input
                value={editedPurchase.sales_order_number || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, sales_order_number: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">프로젝트명</label>
              <Input
                value={editedPurchase.project_item || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, project_item: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">지출예정일</label>
              <Input
                value={editedPurchase.vendor_payment_schedule || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, vendor_payment_schedule: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">결제구분</label>
              <Input
                value={editedPurchase.payment_category || ''}
                onChange={(e) => setEditedPurchase({...editedPurchase, payment_category: e.target.value})}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">통화</label>
              <select
                value={editedPurchase.currency || 'KRW'}
                onChange={(e) => setEditedPurchase({...editedPurchase, currency: e.target.value})}
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-hansl-500"
              >
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="JPY">JPY</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 세부 항목 테이블 */}
      <div>
        <h4 className="text-sm font-semibold mb-2">세부 항목</h4>
        <div className="overflow-x-auto border rounded-lg">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 sm:p-3 text-left text-xs font-medium text-gray-900">품명</th>
              <th className="p-2 sm:p-3 text-left text-xs font-medium text-gray-900">규격</th>
              <th className="p-2 sm:p-3 text-center text-xs font-medium text-gray-900">수량</th>
              <th className="p-2 sm:p-3 text-right text-xs font-medium text-gray-900">단가</th>
              <th className="p-2 sm:p-3 text-right text-xs font-medium text-gray-900">금액</th>
              <th className="p-2 sm:p-3 text-left text-xs font-medium text-gray-900">비고</th>
              {!isEditing && <th className="p-2 sm:p-3 text-center text-xs font-medium text-gray-900">상태</th>}
              {!isEditing && <th className="p-2 sm:p-3 text-center text-xs font-medium text-gray-900">작업</th>}
              {isEditing && <th className="p-2 sm:p-3 text-center text-xs font-medium text-gray-900">삭제</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {editedItems.map((item, index) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="p-2 sm:p-3">
                  {isEditing ? (
                    <Input
                      value={item.item_name}
                      onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                      className="text-sm"
                    />
                  ) : (
                    <span className="text-sm">{item.item_name}</span>
                  )}
                </td>
                <td className="p-2 sm:p-3">
                  {isEditing ? (
                    <Input
                      value={item.specification}
                      onChange={(e) => handleItemChange(index, 'specification', e.target.value)}
                      className="text-sm"
                    />
                  ) : (
                    <span className="text-sm">{item.specification}</span>
                  )}
                </td>
                <td className="p-2 sm:p-3 text-center">
                  {isEditing ? (
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                      className="text-sm text-center w-20 mx-auto"
                    />
                  ) : (
                    <span className="text-sm">{item.quantity}</span>
                  )}
                </td>
                <td className="p-2 sm:p-3 text-right">
                  {isEditing ? (
                    <Input
                      type="number"
                      value={item.unit_price_value}
                      onChange={(e) => handleItemChange(index, 'unit_price_value', Number(e.target.value))}
                      className="text-sm text-right"
                    />
                  ) : (
                    <span className="text-sm">{formatCurrency(item.unit_price_value)}</span>
                  )}
                </td>
                <td className="p-2 sm:p-3 text-right">
                  <span className="text-sm font-medium">
                    {formatCurrency(item.amount_value)} {purchase.currency}
                  </span>
                </td>
                <td className="p-2 sm:p-3">
                  {isEditing ? (
                    <Input
                      value={item.remark || ''}
                      onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                      className="text-sm"
                    />
                  ) : (
                    <span className="text-sm">{item.remark || '-'}</span>
                  )}
                </td>
                {!isEditing && (
                  <>
                    <td className="p-2 sm:p-3 text-center">
                      {activeTab === 'purchase' && (
                        <Badge className={`text-xs ${
                          item.purchase_status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {item.purchase_status === 'completed' ? '구매완료' : '구매대기'}
                        </Badge>
                      )}
                      {activeTab === 'receipt' && (
                        <Badge className={`text-xs ${
                          item.is_received ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {item.is_received ? '입고완료' : '입고대기'}
                        </Badge>
                      )}
                      {activeTab === 'done' && (
                        <div className="flex items-center gap-1">
                          <Badge className={`text-xs ${
                            item.purchase_status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {item.purchase_status === 'completed' ? '구매' : '미구매'}
                          </Badge>
                          <Badge className={`text-xs ${
                            item.is_received ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {item.is_received ? '입고' : '미입고'}
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {(activeTab === 'purchase' || activeTab === 'done') && item.purchase_status !== 'completed' && canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleItemPurchaseComplete(item.id!)}
                            className="text-green-600 hover:bg-green-50 p-1"
                            title="구매완료"
                          >
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                        )}
                        {(activeTab === 'receipt' || activeTab === 'done') && !item.is_received && canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleItemReceiptComplete(item.id!)}
                            className="text-purple-600 hover:bg-purple-50 p-1"
                            title="입고완료"
                          >
                            <Package className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </>
                )}
                {isEditing && (
                  <td className="p-2 sm:p-3 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveItem(index)}
                      className="text-red-600 hover:bg-red-50"
                      title="항목 삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={4} className="p-2 sm:p-3 text-right font-semibold text-sm">
                총액
              </td>
              <td className="p-2 sm:p-3 text-right font-semibold text-sm">
                {formatCurrency(editedItems.reduce((sum, item) => sum + item.amount_value, 0))} {purchase.currency}
              </td>
              <td colSpan={isEditing ? 1 : 2}></td>
              {isEditing && <td></td>}
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      {/* 항목 추가 버튼 */}
      {isEditing && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleAddItem}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-1" />
          항목 추가
        </Button>
      )}

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>발주 내역 전체 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 발주 내역을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

EditablePurchaseTable.displayName = 'EditablePurchaseTable';

export default EditablePurchaseTable;