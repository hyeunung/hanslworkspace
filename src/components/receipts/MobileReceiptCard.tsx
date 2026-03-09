import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer, Download, Calendar, User, FileText, Trash2, Images } from "lucide-react";
import type { ReceiptItem } from "@/types/receipt";
import { formatDateISO } from "@/utils/helpers";

function formatPaymentDate(value?: string | null): string {
  if (!value) return "-";
  const dateOnly = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly.slice(2).replace(/-/g, ".") : "-";
}

function formatUploadDate(value?: string | null): string {
  const isoDate = formatDateISO(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate.slice(2).replace(/-/g, ".") : "-";
}

interface MobileReceiptCardProps {
  receipt: ReceiptItem;
  groupCount?: number;
  onView: (receipt: ReceiptItem) => void;
  onPrint: (receipt: ReceiptItem) => void;
  onDownload: (receipt: ReceiptItem) => void;
  onDelete?: (receipt: ReceiptItem) => void;
}

export default function MobileReceiptCard({ receipt, groupCount = 1, onView, onPrint, onDownload, onDelete }: MobileReceiptCardProps) {
  return (
    <Card className="w-full border border-gray-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView(receipt)}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* 상단: 인쇄 상태 + 업로드일 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {receipt.is_printed ? (
                <span className="badge-stats bg-green-100 text-green-700 badge-text">
                  ✓ 인쇄완료
                </span>
              ) : (
                <span className="badge-stats bg-gray-100 text-gray-600 badge-text">
                  미완료
                </span>
              )}
              {groupCount > 1 && (
                <span className="inline-flex items-center gap-0.5 badge-stats bg-blue-100 text-blue-700 badge-text">
                  <Images className="w-3 h-3" />
                  {groupCount}장
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 badge-text text-gray-500">
              <Calendar className="w-3 h-3" />
              <span>{formatUploadDate(receipt.uploaded_at)}</span>
            </div>
          </div>

          {/* 파일명 */}
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-hansl-600" />
            <span className="card-title text-gray-900">
              {receipt.file_name}
            </span>
          </div>

          {/* 메모 */}
          {receipt.memo && (
            <div className="card-subtitle text-gray-900 bg-gray-50 rounded p-2">
              {receipt.memo}
            </div>
          )}

          {/* OCR 추출 정보 */}
          <div className="space-y-1">
            <div className="card-subtitle text-gray-700">
              거래처: {receipt.ocr_merchant_name || "-"}
            </div>
            <div className="card-subtitle text-gray-700">
              품명: {receipt.ocr_item_name || "-"}
            </div>
            <div className="card-subtitle text-gray-700">
              결제일: {formatPaymentDate(receipt.ocr_payment_date)}
            </div>
            <div className="card-subtitle text-gray-700">
              수량: {receipt.ocr_quantity != null ? receipt.ocr_quantity.toLocaleString("ko-KR") : "-"}
            </div>
            <div className="card-subtitle text-gray-700">
              단가: {receipt.ocr_unit_price != null ? `₩${receipt.ocr_unit_price.toLocaleString("ko-KR")}` : "-"}
            </div>
            <div className="card-title text-gray-900">
              합계: {receipt.ocr_total_amount != null ? `₩${receipt.ocr_total_amount.toLocaleString("ko-KR")}` : "-"}
            </div>
          </div>

          {/* 업로드 정보 */}
          <div className="flex items-center card-subtitle">
            <div className="flex items-center gap-1 text-gray-600">
              <User className="w-3 h-3" />
              <span>{receipt.uploaded_by_name || receipt.uploaded_by}</span>
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className={`flex gap-2 pt-2 border-t border-gray-100 ${onDelete ? 'grid grid-cols-3' : 'grid grid-cols-2'}`}>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onPrint(receipt);
              }}
              className="flex-1"
            >
              <Printer className="w-4 h-4 mr-1" />
              인쇄{groupCount > 1 ? ` (${groupCount})` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(receipt);
              }}
              className="flex-1"
            >
              <Download className="w-4 h-4 mr-1" />
              다운로드
            </Button>
            {onDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(receipt);
                }}
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                삭제
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
