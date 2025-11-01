
import { useState } from "react";
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
    delivery_request_date?: string;
    currency: string;
    items?: PurchaseItem[];
    total_amount: number;
  };
  isAdmin: boolean;
  onUpdate: () => void;
}

export default function PurchaseItemsModal({ isOpen, onClose, purchase, isAdmin, onUpdate }: PurchaseItemsModalProps) {
  const [editingItems, setEditingItems] = useState<PurchaseItem[]>(purchase.items || []);
  const [isEditing, setIsEditing] = useState(false);
  const supabase = createClient();
  
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
      newItems[index].amount_value = newItems[index].quantity * (newItems[index].unit_price_value || 0);
    }
    
    setEditingItems(newItems);
  };

  // 새 품목 추가
  const handleAddItem = () => {
    const newItem: PurchaseItem = {
      line_number: editingItems.length + 1,
      item_name: '',
      specification: '',
      quantity: 0,
      unit_price_value: 0,
      amount_value: 0,
      remark: '',
      is_received: false
    };
    setEditingItems([...editingItems, newItem]);
  };

  // 품목 삭제
  const handleDeleteItem = (index: number) => {
    const newItems = editingItems.filter((_, i) => i !== index);
    // line_number 재정렬
    newItems.forEach((item, i) => {
      item.line_number = i + 1;
    });
    setEditingItems(newItems);
  };

  // 품목 저장
  const handleSave = async () => {
    try {
      // 기존 품목 삭제
      await supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', purchase.id);

      // 새 품목 추가
      const itemsToInsert = editingItems.map(item => ({
        purchase_request_id: purchase.id,
        purchase_order_number: purchase.purchase_order_number,
        line_number: item.line_number,
        item_name: item.item_name,
        specification: item.specification,
        quantity: item.quantity,
        unit_price_value: item.unit_price_value,
        amount_value: item.amount_value,
        remark: item.remark,
        link: item.link,
        is_received: item.is_received || false,
        delivery_status: item.delivery_status || 'pending'
      }));

      const { error } = await supabase
        .from('purchase_request_items')
        .insert(itemsToInsert);

      if (error) throw error;

      // 총금액 업데이트
      const totalAmount = editingItems.reduce((sum, item) => sum + (item.amount_value || 0), 0);
      await supabase
        .from('purchase_requests')
        .update({ total_amount: totalAmount })
        .eq('id', purchase.id);

      toast.success('품목이 수정되었습니다.');
      setIsEditing(false);
      onUpdate();
      onClose();
    } catch (error) {
      toast.error('저장 중 오류가 발생했습니다.');
    }
  };
  
  const items = isEditing ? editingItems : (purchase.items || []);
  const totalAmount = items.reduce((sum, item) => sum + (item.amount_value || 0), 0);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-6xl max-h-[80vh] overflow-hidden flex flex-col bg-white">
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
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow>
                <TableHead className="w-12">No.</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>규격</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead className="text-right">금액</TableHead>
                <TableHead>입고상태</TableHead>
                <TableHead>영수증</TableHead>
                <TableHead>비고</TableHead>
                {isEditing && <TableHead className="w-20">삭제</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
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
                      <span className="modal-value">{item.quantity.toLocaleString()}</span>
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
                      <span className="modal-subtitle">{(item.unit_price_value || 0).toLocaleString()} {purchase.currency}</span>
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
                      <span className="modal-value">{(item.amount_value || 0).toLocaleString()} {purchase.currency}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.is_received ? (
                      <Badge className="bg-green-100 text-green-800 badge-text">입고완료</Badge>
                    ) : (
                      <Badge variant="outline" className="badge-text">대기</Badge>
                    )}
                  </TableCell>
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