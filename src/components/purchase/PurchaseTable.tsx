import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Calendar, User, DollarSign, Eye } from "lucide-react";
;
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Purchase } from "@/hooks/usePurchaseData";
import PurchaseActionButtons from "./PurchaseActionButtons";

interface PurchaseTableProps {
  purchases: Purchase[];
  activeTab: string;
  onExcelDownload: (purchase: Purchase) => Promise<void>;
  currentUserRoles?: string[];
  onRefresh?: () => void;
}

const PurchaseTable = memo(({ 
  purchases, 
  activeTab, 
  onExcelDownload,
  currentUserRoles = [],
  onRefresh = () => {}
}: PurchaseTableProps) => {
  const navigate = useNavigate();

  const getStatusBadge = (purchase: Purchase) => {
    if (purchase.is_received) {
      return <Badge variant="success">입고완료</Badge>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <Badge variant="default">구매진행</Badge>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <Badge variant="destructive">반려</Badge>;
    } else {
      return <Badge variant="warning">승인대기</Badge>;
    }
  };

  const getReceiptProgress = (purchase: Purchase) => {
    if (!purchase.items || purchase.items.length === 0) return { received: 0, total: 0, percentage: 0 };
    
    const total = purchase.items.length;
    const received = purchase.items.filter(item => item.is_received || item.delivery_status === 'received').length;
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    
    return { received, total, percentage };
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>발주요청번호</TableHead>
          <TableHead>요청자</TableHead>
          <TableHead>업체</TableHead>
          <TableHead>PJ업체</TableHead>
          <TableHead>PJ ITEM</TableHead>
          <TableHead>수주번호</TableHead>
          <TableHead>요청일</TableHead>
          <TableHead>납기일</TableHead>
          <TableHead>상태</TableHead>
          {(activeTab === 'purchase' || activeTab === 'receipt') && <TableHead>입고현황</TableHead>}
          <TableHead>총금액</TableHead>
          {activeTab === 'purchase' && <TableHead>처리</TableHead>}
          <TableHead>액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {purchases.map((purchase) => {
          const receiptProgress = getReceiptProgress(purchase);
          
          return (
            <TableRow key={purchase.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-1">
                  {/* 엑셀 다운로드 아이콘 */}
                  {(purchase.middle_manager_status === 'approved' && 
                    purchase.final_manager_status === 'approved') && (
                    <img
                      src="/excels-icon.svg"
                      alt="엑셀 다운로드"
                      width="20"
                      height="20"
                      className={`inline-block align-middle transition-transform cursor-pointer hover:scale-110
                        ${purchase.is_po_download ? 'border border-gray-400 rounded' : ''}`}
                      onClick={async (e: React.MouseEvent) => {
                        e.stopPropagation();
                        await onExcelDownload(purchase);
                      }}
                      title="엑셀 발주서 다운로드"
                    />
                  )}
                  {purchase.purchase_order_number}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center">
                  <User className="w-4 h-4 mr-2 text-gray-400" />
                  {purchase.requester_name}
                </div>
              </TableCell>
              <TableCell>{purchase.vendor_name}</TableCell>
              <TableCell>
                <div className="max-w-32 truncate" title={purchase.project_vendor}>
                  {purchase.project_vendor}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-32 truncate" title={purchase.project_item}>
                  {purchase.project_item}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-32 truncate" title={purchase.sales_order_number}>
                  {purchase.sales_order_number}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                  {purchase.request_date && format(new Date(purchase.request_date), 'yyyy-MM-dd')}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                  {purchase.delivery_request_date && format(new Date(purchase.delivery_request_date), 'yyyy-MM-dd')}
                </div>
              </TableCell>
              <TableCell>
                {getStatusBadge(purchase)}
              </TableCell>
              {(activeTab === 'purchase' || activeTab === 'receipt') && (
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600">완료:</span>
                      <span className="font-semibold">{receiptProgress.received}/{receiptProgress.total}</span>
                      <span className="text-gray-500">({receiptProgress.percentage}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${receiptProgress.percentage}%` }}
                      />
                    </div>
                  </div>
                </TableCell>
              )}
              <TableCell>
                <div className="flex items-center font-semibold">
                  <DollarSign className="w-4 h-4 mr-1 text-gray-400" />
                  {purchase.total_amount.toLocaleString()} {purchase.currency}
                </div>
              </TableCell>
              {activeTab === 'purchase' && (
                <TableCell>
                  <PurchaseActionButtons
                    purchase={purchase}
                    currentUserRoles={currentUserRoles}
                    onUpdate={onRefresh}
                  />
                </TableCell>
              )}
              <TableCell>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/purchase/detail/${purchase.id}`)}
                  className="text-hansl-600 hover:bg-hansl-50"
                  title="상세보기"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});

PurchaseTable.displayName = 'PurchaseTable';

export default PurchaseTable;