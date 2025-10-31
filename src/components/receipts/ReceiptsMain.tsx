import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Filter, Receipt, Printer, Download, Calendar, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ReceiptDetailModal from "./ReceiptDetailModal";
import MobileReceiptCard from "./MobileReceiptCard";
import ReceiptUploadModal from "./ReceiptUploadModal";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import type { ReceiptItem } from "@/types/receipt";
import { formatDate, formatFileSize, extractStoragePathFromUrl } from "@/utils/receipt";
import { logger } from "@/lib/logger";

/**
 * 영수증 관리 메인 페이지 컴포넌트
 * 
 * 영수증 목록 조회, 검색, 필터링, 업로드, 다운로드, 인쇄, 삭제 기능을 제공합니다.
 * 사용자 권한에 따라 기능이 제한됩니다.
 * 
 * @component
 * 
 * ### 주요 기능
 * - 영수증 목록 조회 (데스크톱: 테이블, 모바일: 카드)
 * - 파일명, 메모, 날짜 기반 검색
 * - 날짜 필터링
 * - 권한 기반 UI 제어
 * - 영수증 상세보기 모달
 * - 업로드 모달
 * 
 * ### 권한 체계
 * - `app_admin`: 모든 기능 + 삭제 + 등록인 정보 조회
 * - `hr`, `lead buyer`: 조회, 업로드, 다운로드, 인쇄
 * - 기타: 접근 불가
 * 
 * @example
 * ```tsx
 * // App.tsx에서 라우팅
 * <Route path="/receipts" element={<ReceiptsMain />} />
 * ```
 */
export default function ReceiptsMain() {
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const supabase = createClient();
  const { permissions, loading: permissionsLoading } = useReceiptPermissions();

  // 권한 없는 사용자 접근 차단
  useEffect(() => {
    if (!permissionsLoading && !permissions.canView) {
      toast.error('영수증 관리에 접근할 권한이 없습니다.');
      // 적절한 페이지로 리다이렉트 가능
    }
  }, [permissions.canView, permissionsLoading]);

  // 영수증 데이터 로드 - useCallback으로 최적화
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
          printed_by_name
        `)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      setReceipts(data || []);
    } catch (error) {
      toast.error('영수증 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [permissions.canView, supabase]);

  // 필터링 로직 - useMemo로 최적화
  const filteredReceipts = useMemo(() => {
    let filtered = [...receipts];

    // 검색어 필터
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(receipt => 
        receipt.file_name.toLowerCase().includes(searchLower) ||
        receipt.memo?.toLowerCase().includes(searchLower) ||
        formatDate(receipt.uploaded_at).includes(searchTerm) ||
        receipt.uploaded_at.includes(searchTerm)
      );
    }

    // 날짜 필터
    if (dateFilter) {
      filtered = filtered.filter(receipt => {
        if (!receipt.uploaded_at) return false;
        const uploadDate = new Date(receipt.uploaded_at).toISOString().split('T')[0];
        return uploadDate === dateFilter;
      });
    }

    return filtered;
  }, [receipts, searchTerm, dateFilter]);

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    if (!permissionsLoading) {
      loadReceipts();
    }
  }, [loadReceipts, permissionsLoading]);

  // formatDate는 utils에서 import하므로 제거

  // 영수증 상세보기
  const handleViewReceipt = (receipt: ReceiptItem) => {
    setSelectedReceipt(receipt);
    setIsModalOpen(true);
  };

  // 영수증 인쇄 완료 처리
  const markAsPrinted = useCallback(async (receiptId: string) => {
    logger.debug('영수증 인쇄 완료 처리 시작', {
      receiptId,
      timestamp: new Date().toISOString(),
      location: 'ReceiptsMain.tsx'
    });

    try {
      // 1. 사용자 인증 정보 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        toast.error('사용자 인증에 실패했습니다.');
        return;
      }
      
      if (!user) {
        toast.error('사용자 정보를 불러올 수 없습니다.');
        return;
      }

      logger.debug('사용자 인증 정보 확인 완료', {
        userId: user.id,
        email: user.email,
        lastSignIn: user.last_sign_in_at
      });

      // 2. 사용자 권한 및 정보 확인
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, purchase_role')
        .eq('email', user.email)
        .single();

      if (empError) {
        toast.error('직원 정보를 불러올 수 없습니다.');
        return;
      }

      logger.debug('직원 정보 조회 완료', {
        name: employee?.name,
        email: user.email,
        role: employee?.purchase_role
      });

      // 3. 권한 검증
      const role = employee?.purchase_role || '';
      const hasPermission = role.includes('app_admin') || role.includes('hr') || role.includes('lead buyer');
      
      logger.debug('권한 검증 결과', {
        role,
        hasPermission,
        isAppAdmin: role.includes('app_admin'),
        isHr: role.includes('hr'),
        isLeadBuyer: role.includes('lead buyer')
      });

      if (!hasPermission) {
        toast.error('인쇄완료 처리 권한이 없습니다.');
        return;
      }

      // 4. 업데이트 데이터 준비
      const updateData = {
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: user.id,
        printed_by_name: employee?.name || user.email
      };


      // 5. 데이터베이스 업데이트 실행
      const startTime = performance.now();
      
      const { data: updateResult, error: updateError } = await supabase
        .from('purchase_receipts')
        .update(updateData)
        .eq('id', receiptId)
        .select('*');

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      if (updateError) {
        logger.error('영수증 인쇄완료 업데이트 실패', updateError, {
          error: updateError,
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          executionTime: `${executionTime.toFixed(2)}ms`
        });
        
        // RLS 관련 오류 특별 처리
        if (updateError.code === '42501' || updateError.message?.includes('policy')) {
          toast.error('데이터베이스 권한 오류가 발생했습니다. 관리자에게 문의하세요.');
        } else {
          toast.error(`업데이트 실패: ${updateError.message}`);
        }
        return;
      }

      logger.debug('영수증 인쇄완료 업데이트 성공', {
        updateResult,
        executionTime: `${executionTime.toFixed(2)}ms`,
        affectedRows: updateResult?.length || 0
      });

      // 6. 성공 처리
      toast.success('인쇄 완료로 표시되었습니다.');
      
      // 7. 목록 새로고침
      loadReceipts();

      logger.debug('영수증 인쇄완료 처리 성공', {
        receiptId,
        success: true,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorObj = error as any;
      logger.error('영수증 인쇄완료 처리 중 예외 발생', error, {
        error,
        message: errorObj?.message,
        stack: errorObj?.stack,
        receiptId,
        timestamp: new Date().toISOString()
      });
      
      toast.error(`인쇄 완료 처리에 실패했습니다: ${errorObj?.message || '알 수 없는 오류'}`);
    }
  }, [supabase, loadReceipts]);

  // 영수증 인쇄
  const handlePrintReceipt = async (receipt: ReceiptItem) => {
    if (!receipt.receipt_image_url) {
      toast.error('영수증 이미지가 없습니다.');
      return;
    }

    try {
      // 새 창에서 인쇄용 페이지 열기
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>영수증 인쇄</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: white;
            }
            .receipt-image {
              max-width: 100%;
              max-height: 100vh;
              object-fit: contain;
            }
            @media print {
              body {
                margin: 0;
                padding: 0;
              }
              .receipt-image {
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
              }
            }
          </style>
        </head>
        <body>
          <img 
            src="${receipt.receipt_image_url}" 
            alt="영수증" 
            class="receipt-image"
            onload="window.print(); window.close();"
            onerror="alert('이미지를 불러올 수 없습니다.'); window.close();"
          />
        </body>
        </html>
      `);
      
      printWindow.document.close();

      // 인쇄 완료 확인 다이얼로그
      setTimeout(() => {
        if (confirm('인쇄를 완료하셨습니까?')) {
          markAsPrinted(receipt.id);
        }
      }, 1000);
    } catch (error) {
      toast.error('인쇄에 실패했습니다.');
    }
  };

  // 영수증 이미지 다운로드
  const handleDownloadReceipt = async (receipt: ReceiptItem) => {
    if (!receipt.receipt_image_url) {
      toast.error('영수증 이미지가 없습니다.');
      return;
    }

    try {
      // URL에서 파일 경로 추출 (Supabase Storage 경로)
      const url = new URL(receipt.receipt_image_url);
      const pathSegments = url.pathname.split('/');
      const bucketIndex = pathSegments.indexOf('receipt-images');
      
      if (bucketIndex === -1) {
        throw new Error('잘못된 영수증 URL입니다');
      }
      
      const filePath = pathSegments.slice(bucketIndex + 1).join('/');

      // Supabase Storage에서 다운로드
      const { data, error } = await supabase.storage
        .from('receipt-images')
        .download(filePath);

      if (error) throw error;

      // Blob을 다운로드 가능한 URL로 변환
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

  // 영수증 삭제 - useCallback으로 최적화
  const handleDeleteReceipt = useCallback(async (receipt: ReceiptItem) => {
    if (!permissions.canDelete) {
      toast.error('삭제 권한이 없습니다.');
      return;
    }

    if (!confirm(`정말로 "${receipt.file_name}" 영수증을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      // URL에서 파일 경로 추출 (유틸리티 함수 사용)
      const filePath = extractStoragePathFromUrl(receipt.receipt_image_url);
      
      if (filePath) {
        logger.debug('Storage 파일 삭제 시작', { filePath });
        
        // Supabase Storage에서 파일 삭제
        const { error: storageError } = await supabase.storage
          .from('receipt-images')
          .remove([filePath]);

        if (storageError) {
          logger.warn('Storage 파일 삭제 실패', storageError, { filePath });
        }
      }

      // DB에서 레코드 삭제
      const { error: dbError } = await supabase
        .from('purchase_receipts')
        .delete()
        .eq('id', receipt.id);

      if (dbError) throw dbError;

      toast.success('영수증이 삭제되었습니다.');
      loadReceipts(); // 목록 새로고침
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
            className="bg-hansl-600 hover:bg-hansl-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            영수증 업로드
          </Button>
          <Badge variant="secondary" className="text-sm">
            총 {filteredReceipts.length}건
          </Badge>
        </div>
      </div>

      {/* 필터 섹션 */}
      <Card className="mb-4 border border-gray-200">
        <CardHeader className="bg-white border-b border-gray-200 py-3">
          <CardTitle className="flex items-center text-gray-900 text-sm font-medium">
            <Filter className="w-4 h-4 mr-2" />
            검색 필터
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">검색</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <Input
                  placeholder="파일명, 메모, 업로드일..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 text-sm h-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">업로드 날짜</label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setDateFilter("");
                }}
                className="h-9 text-sm"
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
              <span className="ml-3 text-gray-600">로딩 중...</span>
            </div>
          ) : !permissions.canView ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 text-red-400 mx-auto mb-4">🔒</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">접근 권한 없음</h3>
              <p className="text-gray-600">영수증 관리에 접근할 권한이 없습니다.</p>
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">영수증이 없습니다</h3>
              <p className="text-gray-600">업로드된 영수증이 없거나 검색 조건에 맞는 결과가 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 데스크톱 테이블 뷰 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-fit">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">인쇄완료</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">업로드일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">파일명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">메모</th>
                    {permissions.canViewUploaderInfo && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">등록인</th>
                    )}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">크기</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">액션</th>
                    {permissions.canDelete && (
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">삭제</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredReceipts.map((receipt) => (
                    <tr 
                      key={receipt.id} 
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => handleViewReceipt(receipt)}
                    >
                      <td className="px-4 py-3 text-sm text-center">
                        {receipt.is_printed ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            ✓ 완료
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                            미완료
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">
                        {formatDate(receipt.uploaded_at)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {receipt.file_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {receipt.memo || '-'}
                      </td>
                      {permissions.canViewUploaderInfo && (
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {receipt.uploaded_by_name || receipt.uploaded_by}
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-center text-gray-600">
                        {formatFileSize(receipt.file_size)}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrintReceipt(receipt);
                            }}
                            className="h-8 w-8 p-0"
                            title="인쇄"
                          >
                            <Printer className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadReceipt(receipt);
                            }}
                            className="h-8 w-8 p-0"
                            title="다운로드"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                      {permissions.canDelete && (
                        <td className="px-4 py-3 text-sm text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteReceipt(receipt);
                            }}
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>

              {/* 모바일 카드 뷰 */}
              <div className="md:hidden space-y-3 p-4">
                {filteredReceipts.map((receipt) => (
                  <MobileReceiptCard
                    key={receipt.id}
                    receipt={receipt}
                    onView={handleViewReceipt}
                    onPrint={handlePrintReceipt}
                    onDownload={handleDownloadReceipt}
                    onDelete={permissions.canDelete ? handleDeleteReceipt : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 영수증 상세보기 모달 */}
      {selectedReceipt && (
        <ReceiptDetailModal
          receipt={selectedReceipt}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedReceipt(null);
          }}
          onDelete={() => {
            loadReceipts(); // 삭제 후 목록 새로고침
          }}
        />
      )}

      {/* 영수증 업로드 모달 */}
      <ReceiptUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => {
          loadReceipts(); // 업로드 후 목록 새로고침
        }}
      />
    </div>
  );
}