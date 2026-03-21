import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Filter, Receipt, Printer, Download, Calendar, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ReceiptDetailModal from "./ReceiptDetailModal";
import MobileReceiptCard from "./MobileReceiptCard";
import ReceiptUploadModal from "./ReceiptUploadModal";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import type { ReceiptItem, ReceiptGroup } from "@/types/receipt";
import { formatDate, formatDateISO } from "@/utils/helpers";
import { extractStoragePathFromUrl } from "@/utils/receipt";
import { logger } from "@/lib/logger";

function formatKrw(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatPaymentDate(value?: string | null): string {
  if (!value) return "-";
  const dateOnly = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return "-";
  return dateOnly.slice(2).replace(/-/g, ".");
}

function formatUploadDate(value?: string | null): string {
  const isoDate = formatDateISO(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "-";
  return isoDate.slice(2).replace(/-/g, ".");
}

function buildGroups(receipts: ReceiptItem[]): ReceiptGroup[] {
  const groupMap = new Map<string, ReceiptItem[]>();
  const singles: ReceiptItem[] = [];

  for (const r of receipts) {
    if (r.group_id) {
      const list = groupMap.get(r.group_id) || [];
      list.push(r);
      groupMap.set(r.group_id, list);
    } else {
      singles.push(r);
    }
  }

  const groups: ReceiptGroup[] = [];
  for (const [gid, items] of groupMap) {
    items.sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime());
    groups.push({ group_id: gid, receipts: items, primary: items[0], count: items.length });
  }
  for (const s of singles) {
    groups.push({ group_id: null, receipts: [s], primary: s, count: 1 });
  }

  groups.sort((a, b) => new Date(b.primary.uploaded_at).getTime() - new Date(a.primary.uploaded_at).getTime());
  return groups;
}

function printReceiptImages(imageUrls: string[], onPrintDone?: () => void) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
    return;
  }

  const imagesHtml = imageUrls.map((url, i) => {
    const isLast = i === imageUrls.length - 1;
    return `<div class="page${isLast ? '' : ' page-break'}"><img src="${url}" alt="영수증 ${i + 1}" class="receipt-image" /></div>`;
  }).join('\n');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>영수증 인쇄</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; }
        .page {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .page-break { page-break-after: always; }
        .receipt-image {
          max-width: 100%;
          max-height: 100vh;
          object-fit: contain;
        }
        @media print {
          @page { margin: 0; size: auto; }
          body { margin: 0; padding: 0; }
          .page { min-height: auto; }
          .page-break { page-break-after: always; }
          .receipt-image {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
          }
        }
      </style>
      <script>
        var loaded = 0;
        var total = ${imageUrls.length};
        function onImgLoad() {
          loaded++;
          if (loaded >= total) {
            setTimeout(function(){ window.print(); window.close(); }, 200);
          }
        }
        function onImgError() {
          loaded++;
          if (loaded >= total) {
            alert('일부 이미지를 불러올 수 없습니다.');
            window.close();
          }
        }
      </script>
    </head>
    <body>
      ${imagesHtml.replace(/onload="[^"]*"/g, '').replace(/<img /g, '<img onload="onImgLoad()" onerror="onImgError()" ')}
    </body>
    </html>
  `);

  printWindow.document.close();

  if (onPrintDone) {
    setTimeout(() => {
      if (confirm('인쇄를 완료하셨습니까?')) {
        onPrintDone();
      }
    }, 1000);
  }
}

export default function ReceiptsMain() {
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptItem | null>(null);
  const [selectedGroupReceipts, setSelectedGroupReceipts] = useState<ReceiptItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [olderPage, setOlderPage] = useState(1);
  const OLDER_PAGE_SIZE = 20;

  const supabase = createClient();
  const { permissions, loading: permissionsLoading } = useReceiptPermissions();

  useEffect(() => {
    if (!permissionsLoading && !permissions.canView) {
      toast.error('영수증 관리에 접근할 권한이 없습니다.');
    }
  }, [permissions.canView, permissionsLoading]);

  const loadReceipts = useCallback(async () => {
    if (!permissions.canView) return;
    
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('purchase_receipts')
        .select(`
          id,
          receipt_image_url,
          file_name,
          file_size,
          uploaded_by,
          uploaded_by_name,
          uploaded_at,
          memo,
          is_printed,
          printed_at,
          printed_by,
          printed_by_name,
          group_id
        `)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      const baseReceipts = data || [];
      if (baseReceipts.length === 0) {
        setReceipts([]);
        return;
      }

      const receiptIds = baseReceipts.map((receipt: { id: number | string }) => receipt.id);
      const { data: ocrJobs, error: ocrError } = await supabase
        .from('receipt_ocr_jobs')
        .select(`
          source_receipt_id,
          status,
          created_at,
          receipt_ocr_results (
            merchant_name,
            item_name,
            payment_date,
            quantity,
            unit_price,
            total_amount
          )
        `)
        .in('source_receipt_id', receiptIds)
        .order('created_at', { ascending: false });

      if (ocrError) {
        logger.warn('영수증 OCR 결과 조회 실패', { ocrError });
        setReceipts(baseReceipts);
        return;
      }

      const ocrByReceiptId = new Map<string, {
        status?: 'pending' | 'queued' | 'processing' | 'succeeded' | 'failed';
        merchantName?: string | null;
        itemName?: string | null;
        paymentDate?: string | null;
        quantity?: number | null;
        unitPrice?: number | null;
        totalAmount?: number | null;
      }>();

      (ocrJobs || []).forEach((job: { source_receipt_id?: number | null; status?: string; receipt_ocr_results?: Array<{ merchant_name?: string | null; item_name?: string | null; payment_date?: string | null; quantity?: number | null; unit_price?: number | null; total_amount?: number | null }> | { merchant_name?: string | null; item_name?: string | null; payment_date?: string | null; quantity?: number | null; unit_price?: number | null; total_amount?: number | null } | null }) => {
        const sourceId = String(job.source_receipt_id || '');
        if (!sourceId || ocrByReceiptId.has(sourceId)) return;
        const result = Array.isArray(job.receipt_ocr_results)
          ? job.receipt_ocr_results[0]
          : job.receipt_ocr_results;
        ocrByReceiptId.set(sourceId, {
          status: job.status as 'pending' | 'queued' | 'processing' | 'succeeded' | 'failed' | undefined,
          merchantName: result?.merchant_name ?? null,
          itemName: result?.item_name ?? null,
          paymentDate: result?.payment_date ?? null,
          quantity: result?.quantity ?? null,
          unitPrice: result?.unit_price ?? null,
          totalAmount: result?.total_amount ?? null,
        });
      });

      const mergedReceipts = baseReceipts.map((receipt: { id: number | string; [key: string]: unknown }) => {
        const ocr = ocrByReceiptId.get(String(receipt.id));
        if (!ocr) return receipt;
        return {
          ...receipt,
          ocr_status: ocr.status,
          ocr_merchant_name: ocr.merchantName,
          ocr_item_name: ocr.itemName,
          ocr_payment_date: ocr.paymentDate,
          ocr_quantity: ocr.quantity,
          ocr_unit_price: ocr.unitPrice,
          ocr_total_amount: ocr.totalAmount,
        };
      });

      setReceipts(mergedReceipts);
    } catch (error) {
      toast.error('영수증 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [permissions.canView, supabase]);

  const filteredReceipts = useMemo(() => {
    let filtered = [...receipts];

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(receipt => 
        receipt.file_name.toLowerCase().includes(searchLower) ||
        receipt.memo?.toLowerCase().includes(searchLower) ||
        (receipt.ocr_payment_date || "").includes(searchTerm) ||
        formatDate(receipt.uploaded_at).includes(searchTerm) ||
        receipt.uploaded_at.includes(searchTerm)
      );
    }

    if (dateFilter) {
      filtered = filtered.filter(receipt => {
        if (!receipt.uploaded_at) return false;
        const uploadDate = new Date(receipt.uploaded_at).toISOString().split('T')[0];
        return uploadDate === dateFilter;
      });
    }

    return filtered;
  }, [receipts, searchTerm, dateFilter]);

  const groupedReceipts = useMemo(() => buildGroups(filteredReceipts), [filteredReceipts]);

  const recentWeekGroups = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return groupedReceipts.filter((g) => new Date(g.primary.uploaded_at) >= weekAgo);
  }, [groupedReceipts]);

  const olderGroups = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return groupedReceipts.filter((g) => new Date(g.primary.uploaded_at) < weekAgo);
  }, [groupedReceipts]);

  const olderTotalPages = Math.max(1, Math.ceil(olderGroups.length / OLDER_PAGE_SIZE));
  const pagedOlderGroups = useMemo(() => {
    const start = (olderPage - 1) * OLDER_PAGE_SIZE;
    return olderGroups.slice(start, start + OLDER_PAGE_SIZE);
  }, [olderGroups, olderPage]);

  const visibleGroups = useMemo(
    () => [...recentWeekGroups, ...pagedOlderGroups],
    [recentWeekGroups, pagedOlderGroups]
  );

  useEffect(() => {
    if (!permissionsLoading) {
      loadReceipts();
    }
  }, [loadReceipts, permissionsLoading]);

  useEffect(() => {
    if (olderPage > olderTotalPages) {
      setOlderPage(olderTotalPages);
    }
  }, [olderPage, olderTotalPages]);

  useEffect(() => {
    setOlderPage(1);
  }, [searchTerm, dateFilter]);

  const handleViewReceipt = (group: ReceiptGroup) => {
    setSelectedReceipt(group.primary);
    setSelectedGroupReceipts(group.receipts);
    setIsModalOpen(true);
  };

  const markGroupAsPrinted = useCallback(async (receiptIds: Array<string | number>) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast.error('사용자 인증에 실패했습니다.');
        return;
      }

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, purchase_role')
        .eq('email', user.email)
        .single();

      if (empError) {
        toast.error('직원 정보를 불러올 수 없습니다.');
        return;
      }

      const role = employee?.purchase_role || '';
      const hasPermission = role.includes('app_admin') || role.includes('hr') || role.includes('lead buyer');
      
      if (!hasPermission) {
        toast.error('인쇄완료 처리 권한이 없습니다.');
        return;
      }

      const updateData = {
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: user.id,
        printed_by_name: employee?.name || user.email
      };

      const { error: updateError } = await supabase
        .from('purchase_receipts')
        .update(updateData)
        .in('id', receiptIds);

      if (updateError) {
        logger.error('영수증 인쇄완료 업데이트 실패', updateError);
        toast.error(`업데이트 실패: ${updateError.message}`);
        return;
      }

      toast.success('인쇄 완료로 표시되었습니다.');
      loadReceipts();
    } catch (error) {
      const errorObj = error instanceof Error ? error : null;
      logger.error('영수증 인쇄완료 처리 중 예외 발생', error);
      toast.error(`인쇄 완료 처리에 실패했습니다: ${errorObj?.message || '알 수 없는 오류'}`);
    }
  }, [supabase, loadReceipts]);

  const handlePrintGroup = (group: ReceiptGroup) => {
    const imageUrls = group.receipts
      .filter((r) => r.receipt_image_url)
      .map((r) => r.receipt_image_url);

    if (imageUrls.length === 0) {
      toast.error('영수증 이미지가 없습니다.');
      return;
    }

    const receiptIds = group.receipts.map((r) => r.id);
    printReceiptImages(imageUrls, () => markGroupAsPrinted(receiptIds));
  };

  const handleDownloadReceipt = async (receipt: ReceiptItem) => {
    if (!receipt.receipt_image_url) {
      toast.error('영수증 이미지가 없습니다.');
      return;
    }

    try {
      const url = new URL(receipt.receipt_image_url);
      const pathSegments = url.pathname.split('/');
      const bucketIndex = pathSegments.indexOf('receipt-images');
      
      if (bucketIndex === -1) {
        throw new Error('잘못된 영수증 URL입니다');
      }
      
      const filePath = pathSegments.slice(bucketIndex + 1).join('/');

      const { data, error } = await supabase.storage
        .from('receipt-images')
        .download(filePath);

      if (error) throw error;

      const blob = new Blob([data], { type: 'image/jpeg' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = receipt.file_name || `영수증_${receipt.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      toast.success('영수증 이미지가 다운로드되었습니다.');
    } catch (error) {
      toast.error('다운로드에 실패했습니다.');
    }
  };

  const handleDeleteGroup = useCallback(async (group: ReceiptGroup) => {
    if (!permissions.canDelete) {
      toast.error('삭제 권한이 없습니다.');
      return;
    }

    const countText = group.count > 1 ? `${group.count}장의 영수증을` : `"${group.primary.file_name}" 영수증을`;
    if (!confirm(`정말로 ${countText} 삭제하시겠습니까?`)) {
      return;
    }

    try {
      for (const receipt of group.receipts) {
        const filePath = extractStoragePathFromUrl(receipt.receipt_image_url);
        if (filePath) {
          const { error: storageError } = await supabase.storage
            .from('receipt-images')
            .remove([filePath]);
          if (storageError) {
            logger.warn('Storage 파일 삭제 실패', { storageError, filePath });
          }
        }

        const { error: dbError } = await supabase
          .from('purchase_receipts')
          .delete()
          .eq('id', receipt.id);

        if (dbError) throw dbError;
      }

      toast.success('영수증이 삭제되었습니다.');
      loadReceipts();
    } catch (error) {
      toast.error('삭제에 실패했습니다.');
    }
  }, [permissions.canDelete, loadReceipts]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="page-title">영수증 관리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Receipt Management</p>
        </div>
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
          <Button
            onClick={() => {
              setIsUploadModalOpen(true);
            }}
            className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
          >
            <Plus className="w-4 h-4 mr-1" />
            영수증 업로드
          </Button>
          <span className="badge-stats bg-gray-100 text-gray-600 modal-subtitle">
            총 {filteredReceipts.length}건
          </span>
        </div>
      </div>

      {/* 필터 섹션 */}
      <Card className="mb-4 border border-gray-200">
        <CardHeader className="bg-white border-b border-gray-200 py-3">
          <CardTitle className="flex items-center modal-section-title">
            <Filter className="w-4 h-4 mr-2" />
            검색 필터
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <label className="block modal-label mb-1">검색</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <Input
                  placeholder="파일명, 메모, 업로드일..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 modal-subtitle h-9"
                />
              </div>
            </div>

            <div>
              <label className="block modal-label mb-1">업로드 날짜</label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="modal-subtitle h-9"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setDateFilter("");
                }}
                className="h-9 modal-subtitle"
              >
                초기화
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 영수증 목록 */}
      <Card className="overflow-hidden border border-gray-200">
        <CardContent className="p-0">
          {(loading || permissionsLoading) ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 card-subtitle">로딩 중...</span>
            </div>
          ) : !permissions.canView ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 text-red-400 mx-auto mb-4">🔒</div>
              <h3 className="modal-section-title mb-2">접근 권한 없음</h3>
              <p className="card-subtitle">영수증 관리에 접근할 권한이 없습니다.</p>
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="modal-section-title mb-2">영수증이 없습니다</h3>
              <p className="card-subtitle">업로드된 영수증이 없거나 검색 조건에 맞는 결과가 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 데스크톱 테이블 뷰 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[1400px] table-fixed">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-[104px] px-5 py-3 text-center header-title text-gray-600 uppercase tracking-wider">인쇄완료</th>
                    <th className="w-[104px] px-5 py-3 text-center header-title text-gray-600 uppercase tracking-wider">업로드일</th>
                    <th className="w-[118px] px-5 py-3 text-center header-title text-gray-600 uppercase tracking-wider">결제일</th>
                    <th className="w-[188px] px-5 py-3 text-left header-title text-gray-600 uppercase tracking-wider">거래처</th>
                    <th className="w-[240px] px-5 py-3 text-left header-title text-gray-600 uppercase tracking-wider">품명</th>
                    <th className="w-[90px] px-5 py-3 text-right header-title text-gray-600 uppercase tracking-wider">수량</th>
                    <th className="w-[140px] px-5 py-3 text-right header-title text-gray-600 uppercase tracking-wider">단가</th>
                    <th className="w-[150px] px-5 py-3 text-right header-title text-gray-600 uppercase tracking-wider">합계</th>
                    <th className="px-5 py-3 text-left header-title text-gray-600 uppercase tracking-wider">메모</th>
                    {permissions.canViewUploaderInfo && (
                      <th className="w-[110px] px-5 py-3 text-left header-title text-gray-600 uppercase tracking-wider">등록인</th>
                    )}
                    <th className="w-[100px] px-5 py-3 text-center header-title text-gray-600 uppercase tracking-wider">액션</th>
                    {permissions.canDelete && (
                      <th className="w-[64px] px-5 py-3 text-center header-title text-gray-600 uppercase tracking-wider">삭제</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {visibleGroups.map((group) => {
                    const r = group.primary;
                    const printed = group.receipts.every((item) => !!item.is_printed);
                    const lineItems = [...group.receipts];
                    return (
                      <tr 
                        key={group.group_id || String(r.id)} 
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => handleViewReceipt(group)}
                      >
                        <td className="px-5 py-3 modal-subtitle text-center whitespace-nowrap">
                          {printed ? (
                            <span className="badge-stats bg-green-100 text-green-700">
                              ✓ 완료
                            </span>
                          ) : (
                            <span className="badge-stats bg-gray-100 text-gray-600">
                              미완료
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-center text-gray-600 whitespace-nowrap">
                          {formatUploadDate(r.uploaded_at)}
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-center text-gray-700 whitespace-nowrap">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`payment-date-${item.id}`} className="leading-5">
                                {formatPaymentDate(item.ocr_payment_date)}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-gray-700 truncate">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`merchant-${item.id}`} className="leading-5 truncate">
                                {item.ocr_merchant_name || "-"}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-gray-700 truncate">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`item-${item.id}`} className="leading-5 truncate">
                                {item.ocr_item_name || "-"}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-right text-gray-900 whitespace-nowrap">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`qty-${item.id}`} className="leading-5">
                                {item.ocr_quantity != null ? item.ocr_quantity.toLocaleString("ko-KR") : "-"}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-right text-gray-900 whitespace-nowrap">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`unit-${item.id}`} className="leading-5">
                                {formatKrw(item.ocr_unit_price)}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-right text-gray-900 whitespace-nowrap">
                          <div className="space-y-1">
                            {lineItems.map((item) => (
                              <div key={`total-${item.id}`} className="leading-5">
                                {item.ocr_total_amount != null ? formatKrw(item.ocr_total_amount) : "-"}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 modal-subtitle text-gray-900">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{r.memo || "-"}</span>
                            {group.count > 1 && (
                              <span className="inline-flex items-center gap-0.5 badge-stats bg-blue-100 text-blue-700 shrink-0">
                                {group.count}장
                              </span>
                            )}
                          </div>
                        </td>
                        {permissions.canViewUploaderInfo && (
                          <td className="px-5 py-3 modal-subtitle text-gray-600 truncate">
                            {r.uploaded_by_name || r.uploaded_by}
                          </td>
                        )}
                        <td className="px-5 py-3 modal-subtitle text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrintGroup(group);
                              }}
                              className="h-8 w-8 p-0"
                              title={group.count > 1 ? `${group.count}장 인쇄` : '인쇄'}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadReceipt(r);
                              }}
                              className="h-8 w-8 p-0"
                              title="다운로드"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                        {permissions.canDelete && (
                          <td className="px-5 py-3 modal-subtitle text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteGroup(group);
                              }}
                              className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                              title="삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>

              {/* 모바일 카드 뷰 */}
              <div className="md:hidden space-y-3 p-4">
                {visibleGroups.map((group) => (
                  <MobileReceiptCard
                    key={group.group_id || String(group.primary.id)}
                    receipt={group.primary}
                    groupCount={group.count}
                    onView={() => handleViewReceipt(group)}
                    onPrint={() => handlePrintGroup(group)}
                    onDownload={handleDownloadReceipt}
                    onDelete={permissions.canDelete ? () => handleDeleteGroup(group) : undefined}
                  />
                ))}
              </div>

              {/* 이전(7일 이전) 영수증 페이지네이션 */}
              {olderGroups.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <div className="card-subtitle text-gray-600">
                    최근 7일: {recentWeekGroups.length}건 · 이전 영수증: {olderGroups.length}건
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      disabled={olderPage <= 1}
                      onClick={() => setOlderPage((p) => Math.max(1, p - 1))}
                    >
                      이전
                    </Button>
                    <span className="badge-stats bg-white text-gray-700">
                      {olderPage} / {olderTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      disabled={olderPage >= olderTotalPages}
                      onClick={() => setOlderPage((p) => Math.min(olderTotalPages, p + 1))}
                    >
                      다음
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 영수증 상세보기 모달 */}
      {selectedReceipt && (
        <ReceiptDetailModal
          receipt={selectedReceipt}
          groupReceipts={selectedGroupReceipts}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedReceipt(null);
            setSelectedGroupReceipts([]);
          }}
          onDelete={() => {
            loadReceipts();
          }}
        />
      )}

      {/* 영수증 업로드 모달 */}
      <ReceiptUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => {
          loadReceipts();
        }}
      />
    </div>
  );
}
