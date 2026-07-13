import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, Search, Plus, X } from "lucide-react";
import { toast } from "sonner";
import ReceiptDetailModal from "./ReceiptDetailModal";
import MobileReceiptCard from "./MobileReceiptCard";
import ReceiptUploadModal from "./ReceiptUploadModal";
import ReceiptCompactTable from "./ReceiptCompactTable";
import ReceiptFilterToolbar from "./ReceiptFilterToolbar";
import ReceiptSortControl from "./ReceiptSortControl";
import ReceiptColumnMenu, { type ReceiptColumnVisibility } from "./ReceiptColumnMenu";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import { useReceiptTableFilters } from "@/hooks/useReceiptTableFilters";
import { useReceiptSortRules } from "@/hooks/useReceiptSortRules";
import type { ReceiptItem, ReceiptGroup } from "@/types/receipt";
import {
  type ReceiptColumnId, RECEIPT_COLUMNS_STORAGE_KEY,
  buildReceiptGroups, buildReceiptRows,
  applyReceiptSearch, applyReceiptFilters, compareByReceiptSortRules, receiptYearsFor,
} from "@/utils/receiptTable";
import { extractStoragePathFromUrl } from "@/utils/receipt";
import { logger } from "@/lib/logger";
import { parseRoles } from "@/utils/roleHelper";

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
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptItem | null>(null);
  const [selectedGroupReceipts, setSelectedGroupReceipts] = useState<ReceiptItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

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

  useEffect(() => {
    if (!permissionsLoading) {
      loadReceipts();
    }
  }, [loadReceipts, permissionsLoading]);

  // ── 컴팩트 테이블 상태 (통합검색 / 조건필터 / 다중정렬 / 칼럼표시) ──
  const [searchTerm, setSearchTerm] = useState('');
  const sortCtl = useReceiptSortRules();
  const [columnVisibility, setColumnVisibility] = useState<ReceiptColumnVisibility>(() => {
    try { return JSON.parse(localStorage.getItem(RECEIPT_COLUMNS_STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const persistColumns = useCallback((next: ReceiptColumnVisibility) => {
    setColumnVisibility(next);
    try { localStorage.setItem(RECEIPT_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* 무시 */ }
  }, []);
  const toggleColumn = useCallback((id: ReceiptColumnId) => {
    persistColumns({ ...columnVisibility, [id]: columnVisibility[id] === false });
  }, [columnVisibility, persistColumns]);
  const resetColumns = useCallback(() => persistColumns({}), [persistColumns]);

  const groups = useMemo(() => buildReceiptGroups(receipts), [receipts]);
  const allRows = useMemo(() => buildReceiptRows(groups), [groups]);

  const dynamicOptions = useMemo(() => ({
    uploaders: [...new Set(allRows.map(r => r.uploader).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
  }), [allRows]);
  const years = useMemo(() => receiptYearsFor(allRows), [allRows]);

  const tableFilters = useReceiptTableFilters(dynamicOptions);

  // 파이프라인: 통합검색 → 조건 규칙 → 다중 정렬 (모두 클라이언트, 표는 행 가상화)
  const displayRows = useMemo(() => {
    const searched = applyReceiptSearch(allRows, searchTerm);
    const filtered = applyReceiptFilters(searched, tableFilters.activeRules);
    return [...filtered].sort((a, b) => compareByReceiptSortRules(a, b, sortCtl.sortRules));
  }, [allRows, searchTerm, tableFilters.activeRules, sortCtl.sortRules]);

  // 모바일 카드 뷰용 — 표시 행에서 그룹 단위로 중복 제거 (행 순서 유지)
  const displayGroups = useMemo(() => {
    const seen = new Set<string>();
    const out: ReceiptGroup[] = [];
    for (const r of displayRows) {
      const key = r.group.group_id || String(r.group.primary.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r.group);
    }
    return out;
  }, [displayRows]);

  const handleViewReceipt = useCallback((group: ReceiptGroup) => {
    setSelectedReceipt(group.primary);
    setSelectedGroupReceipts(group.receipts);
    setIsModalOpen(true);
  }, []);

  const markGroupAsPrinted = useCallback(async (receiptIds: Array<string | number>) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast.error('사용자 인증에 실패했습니다.');
        return;
      }

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, roles')
        .eq('email', user.email)
        .single();

      if (empError) {
        toast.error('직원 정보를 불러올 수 없습니다.');
        return;
      }

      const roles = parseRoles(employee?.roles);
      const hasPermission = roles.includes('superadmin') || roles.includes('hr') || roles.includes('lead buyer');

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

  const handlePrintGroup = useCallback((group: ReceiptGroup) => {
    const imageUrls = group.receipts
      .filter((r) => r.receipt_image_url)
      .map((r) => r.receipt_image_url);

    if (imageUrls.length === 0) {
      toast.error('영수증 이미지가 없습니다.');
      return;
    }

    const receiptIds = group.receipts.map((r) => r.id);
    printReceiptImages(imageUrls, () => markGroupAsPrinted(receiptIds));
  }, [markGroupAsPrinted]);

  const handleDownloadReceipt = useCallback(async (receipt: ReceiptItem) => {
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
  }, [supabase]);

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
        </div>
      </div>

      {(loading || permissionsLoading) ? (
        <Card className="border border-gray-200">
          <CardContent className="p-0">
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 card-subtitle">로딩 중...</span>
            </div>
          </CardContent>
        </Card>
      ) : !permissions.canView ? (
        <Card className="border border-gray-200">
          <CardContent className="p-0">
            <div className="text-center py-12">
              <div className="w-12 h-12 text-red-400 mx-auto mb-4">🔒</div>
              <h3 className="modal-section-title mb-2">접근 권한 없음</h3>
              <p className="card-subtitle">영수증 관리에 접근할 권한이 없습니다.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* 필터 영역 (제작현황 표준): 통합 검색 + 칼럼 표시 + 조건 규칙/저장된 필터 */}
          <Card className="border border-gray-200">
            <CardContent className="py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="relative w-[280px] flex-shrink-0 h-5 flex items-center">
                  <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="파일명, 메모, 거래처, 품명, 날짜 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ paddingLeft: '26px', height: '20px' }}
                    className="hansl-search-input"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      title="검색어 지우기"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <ReceiptColumnMenu
                  columnVisibility={columnVisibility}
                  toggleColumn={toggleColumn}
                  resetToDefault={resetColumns}
                  excludedIds={permissions.canViewUploaderInfo ? [] : ['uploader']}
                />
              </div>
              <ReceiptFilterToolbar
                rules={tableFilters.rules}
                dynamicOptions={dynamicOptions}
                years={years}
                addRule={tableFilters.addRule}
                updateRule={tableFilters.updateRule}
                changeRuleField={tableFilters.changeRuleField}
                removeRule={tableFilters.removeRule}
                resetRules={tableFilters.resetRules}
                filterViewsConfig={tableFilters.filterViewsConfig}
                viewsMenuOpen={tableFilters.viewsMenuOpen}
                setViewsMenuOpen={tableFilters.setViewsMenuOpen}
                viewsAnchor={tableFilters.viewsAnchor}
                setViewsAnchor={tableFilters.setViewsAnchor}
                namingView={tableFilters.namingView}
                setNamingView={tableFilters.setNamingView}
                newViewName={tableFilters.newViewName}
                setNewViewName={tableFilters.setNewViewName}
                closeViewsMenu={tableFilters.closeViewsMenu}
                commitSaveView={tableFilters.commitSaveView}
                handleApplyView={tableFilters.handleApplyView}
                handleRenameView={tableFilters.handleRenameView}
                handleDeleteView={tableFilters.handleDeleteView}
                handleSetDefault={tableFilters.handleSetDefault}
                handleClearDefault={tableFilters.handleClearDefault}
              />
            </CardContent>
          </Card>

          {/* 표 카드 — 제목행(정렬·건수) + 컴팩트 테이블 (행 가상화) */}
          <div className="hidden md:block border rounded-lg overflow-hidden bg-white shadow-sm w-fit max-w-full">
            <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 bg-gray-50/50">
              <span className="modal-section-title">영수증 목록</span>
              <ReceiptSortControl
                sortRules={sortCtl.sortRules}
                addSortRule={sortCtl.addSortRule}
                updateSortRule={sortCtl.updateSortRule}
                removeSortRule={sortCtl.removeSortRule}
                clearSort={sortCtl.clearSort}
              />
              <span className="badge-stats bg-gray-100 text-gray-600">
                {displayRows.length === allRows.length
                  ? `${allRows.length}건`
                  : `${displayRows.length} / ${allRows.length}건`}
              </span>
            </div>
            {displayRows.length === 0 ? (
              <div className="text-center py-12 px-16">
                <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="modal-section-title mb-2">영수증이 없습니다</h3>
                <p className="card-subtitle">업로드된 영수증이 없거나 검색 조건에 맞는 결과가 없습니다.</p>
              </div>
            ) : (
              <ReceiptCompactTable
                rows={displayRows}
                columnVisibility={columnVisibility}
                ctx={{
                  onRowClick: (row) => handleViewReceipt(row.group),
                  onPrint: (row) => handlePrintGroup(row.group),
                  onDownload: (row) => handleDownloadReceipt(row.receipt),
                  onDelete: (row) => handleDeleteGroup(row.group),
                  canDelete: permissions.canDelete,
                  canViewUploaderInfo: permissions.canViewUploaderInfo,
                }}
              />
            )}
          </div>

          {/* 모바일 카드 뷰 */}
          <div className="md:hidden space-y-3">
            {displayGroups.length === 0 ? (
              <Card className="border border-gray-200">
                <CardContent className="p-0">
                  <div className="text-center py-12">
                    <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="modal-section-title mb-2">영수증이 없습니다</h3>
                    <p className="card-subtitle">업로드된 영수증이 없거나 검색 조건에 맞는 결과가 없습니다.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              displayGroups.map((group) => (
                <MobileReceiptCard
                  key={group.group_id || String(group.primary.id)}
                  receipt={group.primary}
                  groupCount={group.count}
                  onView={() => handleViewReceipt(group)}
                  onPrint={() => handlePrintGroup(group)}
                  onDownload={handleDownloadReceipt}
                  onDelete={permissions.canDelete ? () => handleDeleteGroup(group) : undefined}
                />
              ))
            )}
          </div>
        </div>
      )}

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
