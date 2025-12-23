import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  FileCheck, 
  Plus, 
  Trash2, 
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  SlidersHorizontal
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import transactionStatementService from "@/services/transactionStatementService";
import type { 
  TransactionStatement, 
  TransactionStatementStatus 
} from "@/types/transactionStatement";
import StatementUploadModal from "./StatementUploadModal";
import StatementConfirmModal from "./StatementConfirmModal";
import StatementImageViewer from "./StatementImageViewer";

/**
 * 거래명세서 확인 메인 페이지 컴포넌트
 * 
 * 거래명세서 목록 조회, 업로드, OCR 추출, 발주 매칭, 확정 기능을 제공합니다.
 */
export default function TransactionStatementMain() {
  const [statements, setStatements] = useState<TransactionStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  
  // 모달 상태
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<TransactionStatement | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [viewerImageUrl, setViewerImageUrl] = useState<string>("");
  
  // OCR 추출 진행 중인 ID들
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());

  // 데이터 로드
  const loadStatements = useCallback(async () => {
    try {
      setLoading(true);
      const result = await transactionStatementService.getStatements({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        dateFrom: dateFilter || undefined,
        search: searchTerm || undefined,
        limit: 50
      });

      if (result.success) {
        setStatements(result.data || []);
        setTotalCount(result.count || 0);
      } else {
        toast.error(result.error || '데이터를 불러오는데 실패했습니다.');
      }
    } catch (error) {
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFilter, searchTerm]);

  useEffect(() => {
    loadStatements();
  }, [loadStatements]);

  // 상태 배지 렌더링
  const renderStatusBadge = (status: TransactionStatementStatus) => {
    const baseClass = "inline-flex items-center gap-1 business-radius-badge px-2 py-0.5 text-[10px] font-medium leading-tight";
    
    switch (status) {
      case 'pending':
        return (
          <span className={`${baseClass} bg-gray-100 text-gray-600 border border-gray-200`}>
            <Clock className="w-3 h-3" />
            대기중
          </span>
        );
      case 'processing':
        return (
          <span className={`${baseClass} bg-blue-50 text-blue-600 border border-blue-200`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            처리중
          </span>
        );
      case 'extracted':
        return (
          <span className={`${baseClass} bg-yellow-50 text-yellow-600 border border-yellow-200`}>
            <AlertCircle className="w-3 h-3" />
            확인필요
          </span>
        );
      case 'confirmed':
        return (
          <span className={`${baseClass} bg-green-50 text-green-600 border border-green-200`}>
            <CheckCircle className="w-3 h-3" />
            확정됨
          </span>
        );
      case 'rejected':
        return (
          <span className={`${baseClass} bg-red-50 text-red-600 border border-red-200`}>
            <XCircle className="w-3 h-3" />
            거부됨
          </span>
        );
      default:
        return <span className={`${baseClass} bg-gray-100 text-gray-600`}>{status}</span>;
    }
  };

  // 상세 모달 열기
  const handleViewStatement = (statement: TransactionStatement) => {
    setSelectedStatement(statement);
    
    if (statement.status === 'extracted') {
      setIsConfirmModalOpen(true);
    } else if (statement.status === 'confirmed' || statement.status === 'pending') {
      setViewerImageUrl(statement.image_url);
      setIsImageViewerOpen(true);
    }
  };

  // 이미지 뷰어 열기
  const handleViewImage = (e: React.MouseEvent, imageUrl: string) => {
    e.stopPropagation();
    setViewerImageUrl(imageUrl);
    setIsImageViewerOpen(true);
  };

  // OCR 추출 시작
  const handleStartExtraction = async (e: React.MouseEvent, statement: TransactionStatement) => {
    e.stopPropagation();
    console.log('[OCR] Button clicked, statement:', statement);
    
    if (statement.status !== 'pending' || extractingIds.has(statement.id)) {
      console.log('[OCR] Status is not pending or already extracting:', statement.status);
      toast.info('이미 처리 중이거나 완료된 건입니다.');
      return;
    }

    // 추출 시작 - ID 추가
    setExtractingIds(prev => new Set(prev).add(statement.id));

    try {
      console.log('[OCR] Starting extraction...');
      toast.loading('OCR 추출 중... (약 10~30초 소요)', { id: `extraction-${statement.id}` });
      
      const result = await transactionStatementService.extractStatementData(
        statement.id,
        statement.image_url
      );
      console.log('[OCR] Result:', result);

      if (result.success) {
        toast.success('OCR 추출이 완료되었습니다!', { id: `extraction-${statement.id}` });
        loadStatements();
        
        if (result.data) {
          setSelectedStatement(result.data);
          setIsConfirmModalOpen(true);
        }
      } else {
        console.error('[OCR] Failed:', result.error);
        toast.error(result.error || 'OCR 추출에 실패했습니다.', { id: `extraction-${statement.id}` });
      }
    } catch (error) {
      console.error('[OCR] Error:', error);
      toast.error('OCR 추출 중 오류가 발생했습니다.', { id: `extraction-${statement.id}` });
    } finally {
      // 추출 완료 - ID 제거
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(statement.id);
        return next;
      });
    }
  };

  // 삭제
  const handleDelete = async (e: React.MouseEvent, statement: TransactionStatement) => {
    e.stopPropagation();
    
    if (!confirm(`"${statement.file_name || '이 거래명세서'}"를 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const result = await transactionStatementService.deleteStatement(statement.id);
      
      if (result.success) {
        toast.success('삭제되었습니다.');
        loadStatements();
      } else {
        toast.error(result.error || '삭제에 실패했습니다.');
      }
    } catch (error) {
      toast.error('삭제 중 오류가 발생했습니다.');
    }
  };

  // 업로드 성공 후 처리 - 자동으로 OCR 시작
  const handleUploadSuccess = async (statementId: string, imageUrl: string) => {
    setIsUploadModalOpen(false);
    
    // 업로드 완료 후 자동으로 OCR 시작
    try {
      toast.loading('업로드 완료! OCR 추출을 시작합니다...', { id: 'extraction' });
      
      const result = await transactionStatementService.extractStatementData(statementId, imageUrl);
      
      if (result.success) {
        toast.success('OCR 추출이 완료되었습니다. 결과를 확인해주세요.', { id: 'extraction' });
        loadStatements();
        
        // 추출 완료 후 바로 확인 모달 열기
        if (result.data) {
          setSelectedStatement(result.data);
          setIsConfirmModalOpen(true);
        }
      } else {
        toast.error(result.error || 'OCR 추출에 실패했습니다.', { id: 'extraction' });
        loadStatements();
      }
    } catch (error) {
      toast.error('OCR 추출 중 오류가 발생했습니다.', { id: 'extraction' });
      loadStatements();
    }
  };

  // 확정 모달 닫기
  const handleConfirmModalClose = () => {
    setIsConfirmModalOpen(false);
    setSelectedStatement(null);
    loadStatements();
  };

  // 날짜 포맷
  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  // 금액 포맷
  const formatAmount = (amount?: number) => {
    if (amount === undefined || amount === null) return '-';
    return amount.toLocaleString('ko-KR') + '원';
  };

  return (
    <div className="w-full">
      {/* Header - 발주요청 관리와 동일 */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">거래명세서 확인</h1>
            <p className="page-subtitle" style={{ marginTop: '-2px', marginBottom: '-4px' }}>
              Transaction Statement Verification
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsUploadModalOpen(true)}
              className="!h-auto button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">업로드</span>
            </Button>
            <Button
              variant="outline"
              onClick={loadStatements}
              disabled={loading}
              className="!h-auto button-base"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* 필터 툴바 - 발주요청 관리와 동일한 스타일 */}
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 검색 */}
          <div className="relative min-w-[140px] max-w-[200px]">
            <Search className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-2.5 h-2.5 text-gray-400" />
            <Input
              placeholder="거래처명, 파일명 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="!h-auto !py-px !pr-1.5 !pl-5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
            />
          </div>
          
          {/* 상태 필터 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="!h-auto !py-[1px] !px-2 !text-[12px] !min-h-[22px] w-[100px] business-radius-input border border-gray-300 bg-white text-gray-700 [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent className="min-w-[100px]">
              <SelectItem value="all" className="text-[12px] py-1.5">전체 상태</SelectItem>
              <SelectItem value="pending" className="text-[12px] py-1.5">대기중</SelectItem>
              <SelectItem value="extracted" className="text-[12px] py-1.5">확인필요</SelectItem>
              <SelectItem value="confirmed" className="text-[12px] py-1.5">확정됨</SelectItem>
              <SelectItem value="rejected" className="text-[12px] py-1.5">거부됨</SelectItem>
            </SelectContent>
          </Select>
          
          {/* 날짜 필터 토글 */}
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className={`!h-auto button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${showFilters ? 'bg-hansl-50 border-hansl-300 text-hansl-700' : ''}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
            <span className="button-text">필터</span>
          </Button>
          
          {/* 건수 표시 */}
          <span className="badge-stats bg-gray-100 text-gray-600">
            총 {totalCount}건
          </span>
        </div>
        
        {/* 확장 필터 */}
        {showFilters && (
          <div className="mt-2 p-3 bg-gray-50 business-radius-card border border-gray-200">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-medium text-gray-500">업로드 날짜</label>
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="!h-auto !py-[2px] !px-2.5 !text-[12px] !min-h-[24px] w-[140px] business-radius-input border border-gray-300 bg-white text-gray-700"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setDateFilter("");
                }}
                className="!h-auto button-base border border-gray-300 bg-white text-blue-600 hover:bg-blue-50 hover:border-blue-300"
              >
                ↻ <span className="button-text text-blue-600">초기화</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 목록 카드 */}
      <Card className="overflow-hidden border border-gray-200 business-radius-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-[11px] text-gray-500">로딩 중...</span>
            </div>
          ) : statements.length === 0 ? (
            <div className="text-center py-12">
              <FileCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-[12px] font-medium text-gray-700 mb-1">거래명세서가 없습니다</h3>
              <p className="text-[11px] text-gray-500">업로드된 거래명세서가 없거나 검색 조건에 맞는 결과가 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 데스크톱 테이블 뷰 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-fit">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">상태</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">업로드일</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">명세서일</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">거래처명</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">파일명</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">합계금액</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">등록자</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">액션</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {statements.map((statement) => (
                      <tr
                        key={statement.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => handleViewStatement(statement)}
                      >
                        <td className="px-3 py-2.5 text-center">
                          {renderStatusBadge(statement.status)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {formatDate(statement.uploaded_at)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {statement.statement_date ? formatDate(statement.statement_date) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-medium text-gray-900">
                          {statement.vendor_name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-700 max-w-[180px] truncate">
                          {statement.file_name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-medium text-right text-gray-900">
                          {formatAmount(statement.grand_total)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {statement.uploaded_by_name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {statement.status === 'pending' || extractingIds.has(statement.id) ? (
                              // 대기중이거나 추출중일 때
                              <button
                                onClick={(e) => handleStartExtraction(e, statement)}
                                disabled={extractingIds.has(statement.id)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                                  extractingIds.has(statement.id) 
                                    ? 'bg-blue-400 text-white cursor-not-allowed' 
                                    : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                              >
                                {extractingIds.has(statement.id) ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    추출중...
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3 h-3" />
                                    OCR 시작
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => handleViewImage(e, statement.image_url)}
                                className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                                title="이미지 보기"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => handleDelete(e, statement)}
                              className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 모바일 카드 뷰 */}
              <div className="md:hidden divide-y divide-gray-100">
                {statements.map((statement) => (
                  <div
                    key={statement.id}
                    className="p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => handleViewStatement(statement)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      {renderStatusBadge(statement.status)}
                      <span className="text-[10px] text-gray-400">
                        {formatDate(statement.uploaded_at)}
                      </span>
                    </div>
                    <div className="mb-2">
                      <p className="text-[11px] font-medium text-gray-900">
                        {statement.vendor_name || '거래처 미확인'}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {statement.file_name}
                      </p>
                    </div>
                    {statement.grand_total && (
                      <p className="text-[12px] font-bold text-gray-900">
                        {formatAmount(statement.grand_total)}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                      {statement.status === 'pending' || extractingIds.has(statement.id) ? (
                        <button
                          onClick={(e) => handleStartExtraction(e, statement)}
                          disabled={extractingIds.has(statement.id)}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                            extractingIds.has(statement.id) 
                              ? 'bg-blue-400 text-white cursor-not-allowed' 
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {extractingIds.has(statement.id) ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              추출중...
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              OCR 시작
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleViewImage(e, statement.image_url)}
                          className="button-base px-2 py-1 text-[10px] border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          <ImageIcon className="w-3 h-3 mr-1" />
                          보기
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 업로드 모달 */}
      <StatementUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* 확인/수정/확정 모달 */}
      {selectedStatement && (
        <StatementConfirmModal
          isOpen={isConfirmModalOpen}
          statement={selectedStatement}
          onClose={handleConfirmModalClose}
          onConfirm={handleConfirmModalClose}
        />
      )}

      {/* 이미지 뷰어 */}
      <StatementImageViewer
        isOpen={isImageViewerOpen}
        imageUrl={viewerImageUrl}
        onClose={() => {
          setIsImageViewerOpen(false);
          setViewerImageUrl("");
        }}
      />
    </div>
  );
}
