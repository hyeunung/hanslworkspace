import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, ZoomIn, ZoomOut, RotateCcw, Printer, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import type { ReceiptItem } from "@/types/receipt";
import { logger } from "@/lib/logger";

interface ReceiptDetailModalProps {
  receipt: ReceiptItem;
  groupReceipts?: ReceiptItem[];
  isOpen: boolean;
  onClose: () => void;
  onDelete?: () => void;
}

export default function ReceiptDetailModal({ receipt, groupReceipts, isOpen, onClose, onDelete }: ReceiptDetailModalProps) {
  const allReceipts = groupReceipts && groupReceipts.length > 0 ? groupReceipts : [receipt];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageScale, setImageScale] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const supabase = createClient();
  const { permissions } = useReceiptPermissions();

  const currentReceipt = allReceipts[currentIndex] || receipt;
  const hasMultiple = allReceipts.length > 1;

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setImageScale(1);
      setImageRotation(0);
      setImageError(false);
      setImageLoaded(false);
    }
  }, [isOpen]);

  useEffect(() => {
    setImageScale(1);
    setImageRotation(0);
    setImageError(false);
    setImageLoaded(false);
  }, [currentIndex]);

  const goNext = useCallback(() => {
    if (currentIndex < allReceipts.length - 1) setCurrentIndex(prev => prev + 1);
  }, [currentIndex, allReceipts.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  }, [currentIndex]);

  useEffect(() => {
    if (!isOpen || !hasMultiple) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasMultiple, goPrev, goNext]);

  const handleDownload = async () => {
    try {
      const url = new URL(currentReceipt.receipt_image_url);
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
      a.download = currentReceipt.file_name || `영수증_${currentReceipt.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      toast.success('영수증 이미지가 다운로드되었습니다.');
    } catch (error) {
      logger.error('다운로드 오류', error);
      toast.error('다운로드에 실패했습니다.');
    }
  };

  const handleZoomIn = () => setImageScale(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setImageScale(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setImageRotation(prev => (prev + 90) % 360);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    setImageLoaded(true);
  };

  const getOptimalImageStyle = () => {
    if (!imageLoaded) return { width: '100%', height: '100vh' };
    
    const containerWidth = window.innerWidth - 64;
    const containerHeight = window.innerHeight;
    
    const widthRatio = containerWidth / imageDimensions.width;
    const heightRatio = containerHeight / imageDimensions.height;
    const optimalRatio = Math.min(widthRatio, heightRatio);
    
    return {
      width: `${imageDimensions.width * optimalRatio}px`,
      height: `${imageDimensions.height * optimalRatio}px`,
    };
  };

  const markAllAsPrinted = useCallback(async () => {
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

      const receiptIds = allReceipts.map(r => r.id);
      const { error: updateError } = await supabase
        .from('purchase_receipts')
        .update(updateData)
        .in('id', receiptIds);

      if (updateError) {
        logger.error('업데이트 실패', updateError);
        toast.error(`업데이트 실패: ${updateError.message}`);
        return;
      }

      toast.success('인쇄 완료로 표시되었습니다.');
      if (onDelete) onDelete();
    } catch (error) {
      const errorObj = error as any;
      logger.error('인쇄완료 처리 예외', errorObj);
      toast.error(`인쇄 완료 처리에 실패했습니다: ${errorObj?.message || '알 수 없는 오류'}`);
    }
  }, [supabase, allReceipts, onClose, onDelete]);

  const handlePrint = useCallback(() => {
    const imageUrls = allReceipts
      .filter(r => r.receipt_image_url)
      .map(r => r.receipt_image_url);

    if (imageUrls.length === 0) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('팝업이 차단되었습니다.');
      return;
    }

    const imagesHtml = imageUrls.map((url, i) => {
      const isLast = i === imageUrls.length - 1;
      return `<div class="page${isLast ? '' : ' page-break'}"><img src="${url}" alt="" class="receipt-image" onload="onImgLoad()" onerror="onImgError()" /></div>`;
    }).join('\n');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title></title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:white;}
        .page{display:flex;justify-content:center;align-items:center;min-height:100vh;}
        .page-break{page-break-after:always;}
        .receipt-image{max-width:100%;max-height:100vh;object-fit:contain;}
        @media print{
          @page{margin:0;size:auto;}
          body{margin:0;padding:0;}
          .page{min-height:auto;}
          .page-break{page-break-after:always;}
          .receipt-image{max-width:100%;max-height:100%;width:auto;height:auto;}
        }
      </style>
      <script>
        var loaded=0,total=${imageUrls.length};
        function onImgLoad(){loaded++;if(loaded>=total)setTimeout(function(){window.print();window.close();},200);}
        function onImgError(){loaded++;if(loaded>=total){alert('일부 이미지를 불러올 수 없습니다.');window.close();}}
      </script>
      </head><body>${imagesHtml}</body></html>
    `);
    printWindow.document.close();

    setTimeout(() => {
      if (confirm('인쇄를 완료하셨습니까?')) {
        onClose();
        markAllAsPrinted();
      }
    }, 1000);
  }, [allReceipts, markAllAsPrinted, onClose]);

  const handleDelete = useCallback(async () => {
    if (!permissions.canDelete) {
      toast.error('삭제 권한이 없습니다.');
      return;
    }

    const countText = allReceipts.length > 1 ? `${allReceipts.length}장의 영수증을` : '이 영수증을';
    if (!confirm(`정말로 ${countText} 삭제하시겠습니까?`)) {
      return;
    }

    try {
      setDeleting(true);

      for (const r of allReceipts) {
        const url = new URL(r.receipt_image_url);
        const pathSegments = url.pathname.split('/');
        const bucketIndex = pathSegments.indexOf('receipt-images');
        
        if (bucketIndex !== -1) {
          const filePath = pathSegments.slice(bucketIndex + 1).join('/');
          const { error: storageError } = await supabase.storage
            .from('receipt-images')
            .remove([filePath]);
          if (storageError) {
            logger.warn('스토리지 파일 삭제 실패', { error: storageError });
          }
        }

        const { error: dbError } = await supabase
          .from('purchase_receipts')
          .delete()
          .eq('id', r.id);

        if (dbError) throw dbError;
      }

      toast.success('영수증이 삭제되었습니다.');
      onClose();
      if (onDelete) onDelete();
    } catch (error) {
      logger.error('삭제 오류', error);
      toast.error('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }, [permissions.canDelete, allReceipts, onClose, onDelete, supabase]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[100vw] max-w-none h-[100vh] p-0 overflow-hidden m-0 border-0 rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle>영수증 상세 보기</DialogTitle>
        </DialogHeader>
        <div className="flex h-full">
          {/* 이미지 영역 */}
          <div className="flex-1 bg-white relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={currentReceipt.receipt_image_url}
                alt="영수증"
                className="object-contain"
                style={{
                  ...getOptimalImageStyle(),
                  transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
                  transformOrigin: 'center'
                }}
                onLoad={handleImageLoad}
                onError={() => setImageError(true)}
              />
            </div>
            
            {/* 닫기 버튼 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="absolute top-4 left-4 h-10 w-10 p-0 bg-gray-900/80 hover:bg-gray-900 text-white rounded-full"
            >
              <X className="h-5 w-5" />
            </Button>

            {/* 페이지 인디케이터 */}
            {hasMultiple && (
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-gray-900/80 text-white rounded-full px-3 py-1.5">
                <span className="text-[11px] font-medium">{currentIndex + 1} / {allReceipts.length}</span>
              </div>
            )}

            {/* 좌우 네비게이션 */}
            {hasMultiple && currentIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goPrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 p-0 bg-gray-900/60 hover:bg-gray-900/80 text-white rounded-full"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}
            {hasMultiple && currentIndex < allReceipts.length - 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goNext}
                className="absolute right-20 top-1/2 -translate-y-1/2 h-12 w-12 p-0 bg-gray-900/60 hover:bg-gray-900/80 text-white rounded-full"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            )}

            {/* 이미지 컨트롤 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-900/80 rounded-full px-4 py-2">
              <div className="flex items-center gap-2 text-white">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={imageScale <= 0.5}
                  className="h-7 w-7 p-0 text-white hover:bg-white/20"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="modal-subtitle min-w-[40px] text-center">
                  {Math.round(imageScale * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={imageScale >= 3}
                  className="h-7 w-7 p-0 text-white hover:bg-white/20"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <div className="w-px h-4 bg-white/30 mx-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRotate}
                  className="h-7 w-7 p-0 text-white hover:bg-white/20"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* 썸네일 스트립 (여러 장일 때만) */}
            {hasMultiple && (
              <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 bg-gray-900/80 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                {allReceipts.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => setCurrentIndex(i)}
                    className={`w-10 h-10 rounded overflow-hidden border-2 transition-all ${
                      i === currentIndex ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={r.receipt_image_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 우측 세로 탭바 */}
          <div className="w-16 bg-gray-900 flex flex-col items-center justify-center space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrint}
              className="w-10 h-10 p-0 text-white hover:bg-gray-700 rounded-lg relative"
              title={hasMultiple ? `${allReceipts.length}장 인쇄` : '인쇄'}
            >
              <Printer className="w-6 h-6" />
              {hasMultiple && (
                <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[8px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {allReceipts.length}
                </span>
              )}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="w-10 h-10 p-0 text-white hover:bg-gray-700 rounded-lg"
              title="다운로드"
            >
              <Download className="w-6 h-6" />
            </Button>

            {permissions.canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="w-10 h-10 p-0 text-white hover:bg-red-600 rounded-lg"
                title="삭제"
              >
                {deleting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 className="w-6 h-6" />
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
