import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, ZoomIn, ZoomOut, RotateCcw, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import type { ReceiptItem } from "@/types/receipt";

interface ReceiptDetailModalProps {
  receipt: ReceiptItem;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: () => void;
}

export default function ReceiptDetailModal({ receipt, isOpen, onClose, onDelete }: ReceiptDetailModalProps) {
  const [imageScale, setImageScale] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const supabase = createClient();
  const { permissions } = useReceiptPermissions();

  // 모달이 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setImageScale(1);
      setImageRotation(0);
      setImageError(false);
      setImageLoaded(false);
    }
  }, [isOpen]);

  // formatDateTime은 utils/helpers.ts에서 import하여 사용 가능

  // 영수증 이미지 다운로드
  const handleDownload = async () => {
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
      console.error('다운로드 오류:', error);
      toast.error('다운로드에 실패했습니다.');
    }
  };

  // 확대/축소
  const handleZoomIn = () => {
    setImageScale(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setImageScale(prev => Math.max(prev - 0.25, 0.5));
  };

  // 회전
  const handleRotate = () => {
    setImageRotation(prev => (prev + 90) % 360);
  };

  // 초기화
  const handleReset = () => {
    setImageScale(1);
    setImageRotation(0);
  };

  // 이미지 로드 완료 핸들러
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    setImageLoaded(true);
  };

  // 이미지 최적 크기 계산
  const getOptimalImageStyle = () => {
    if (!imageLoaded) return { width: '100%', height: '100vh' };
    
    const containerWidth = window.innerWidth - 64; // 우측 탭바 제외
    const containerHeight = window.innerHeight;
    
    const widthRatio = containerWidth / imageDimensions.width;
    const heightRatio = containerHeight / imageDimensions.height;
    const optimalRatio = Math.min(widthRatio, heightRatio);
    
    return {
      width: `${imageDimensions.width * optimalRatio}px`,
      height: `${imageDimensions.height * optimalRatio}px`,
    };
  };

  // 영수증 인쇄 완료 처리
  const markAsPrinted = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('사용자 정보를 불러올 수 없습니다.');
        return;
      }

      // 사용자 이름 가져오기
      const { data: employee } = await supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single();

      const { error } = await supabase
        .from('purchase_receipts')
        .update({
          is_printed: true,
          printed_at: new Date().toISOString(),
          printed_by: user.id,
          printed_by_name: employee?.name || user.email
        })
        .eq('id', receipt.id);

      if (error) throw error;

      toast.success('인쇄 완료로 표시되었습니다.');
      // onClose()는 이미 handlePrint에서 호출됨
      if (onDelete) {
        onDelete(); // 목록 새로고침을 위해 호출
      }
    } catch (error) {
      console.error('인쇄 완료 처리 오류:', error);
      toast.error('인쇄 완료 처리에 실패했습니다.');
    }
  }, [supabase, receipt.id, onClose, onDelete]);

  // 영수증 인쇄 핸들러
  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html><head><title></title>
        <style>@page{margin:0;size:auto;}*{margin:0;padding:0;box-sizing:border-box;}body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:white;margin:0;padding:0;}.receipt-image{max-width:100%;max-height:100vh;object-fit:contain;display:block;}@media print{@page{margin:0;}body{margin:0;padding:0;background:white;}.receipt-image{max-width:100%;max-height:100%;width:auto;height:auto;page-break-inside:avoid;}}</style>
        </head><body>
        <img src="${receipt.receipt_image_url}" alt="" class="receipt-image" onload="setTimeout(function(){window.print();window.close();},100);" onerror="window.close();" />
        </body></html>
      `);
      printWindow.document.close();

      // 인쇄 완료 확인 다이얼로그
      setTimeout(() => {
        if (confirm('인쇄를 완료하셨습니까?')) {
          // 먼저 모달 닫기
          onClose();
          // 그 다음 인쇄완료 처리
          markAsPrinted();
        }
      }, 1000);
    }
  }, [receipt.receipt_image_url, markAsPrinted, onClose]);

  // 영수증 삭제 - useCallback으로 최적화
  const handleDelete = useCallback(async () => {
    if (!permissions.canDelete) {
      toast.error('삭제 권한이 없습니다.');
      return;
    }

    if (!confirm('정말로 이 영수증을 삭제하시겠습니까?')) {
      return;
    }

    try {
      setDeleting(true);

      // URL에서 파일 경로 추출 (Supabase Storage 경로)
      const url = new URL(receipt.receipt_image_url);
      const pathSegments = url.pathname.split('/');
      const bucketIndex = pathSegments.indexOf('receipt-images');
      
      if (bucketIndex !== -1) {
        const filePath = pathSegments.slice(bucketIndex + 1).join('/');
        
        // Supabase Storage에서 파일 삭제
        const { error: storageError } = await supabase.storage
          .from('receipt-images')
          .remove([filePath]);

        if (storageError) {
          console.warn('스토리지 파일 삭제 실패:', storageError);
        }
      }

      // DB에서 레코드 삭제
      const { error: dbError } = await supabase
        .from('purchase_receipts')
        .delete()
        .eq('id', receipt.id);

      if (dbError) throw dbError;

      toast.success('영수증이 삭제되었습니다.');
      onClose();
      if (onDelete) {
        onDelete();
      }
    } catch (error) {
      console.error('삭제 오류:', error);
      toast.error('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }, [permissions.canDelete, receipt.id, receipt.receipt_image_url, onClose, onDelete, supabase]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[100vw] max-w-none h-[100vh] p-0 overflow-hidden m-0 border-0 rounded-none">
        <div className="flex h-full">
          {/* 이미지 영역 */}
          <div className="flex-1 bg-white relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={receipt.receipt_image_url}
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

            {/* 이미지 컨트롤 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-900/80 rounded-full px-4 py-2">
              <div className="flex items-center gap-2 text-white">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={imageScale <= 0.5}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm min-w-[40px] text-center">
                  {Math.round(imageScale * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={imageScale >= 3}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <div className="w-px h-4 bg-white/30 mx-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRotate}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* 우측 세로 탭바 */}
          <div className="w-16 bg-gray-900 flex flex-col items-center justify-center space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrint}
              className="w-12 h-12 p-0 text-white hover:bg-gray-700 rounded-lg"
              title="인쇄"
            >
              <Printer className="w-6 h-6" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="w-12 h-12 p-0 text-white hover:bg-gray-700 rounded-lg"
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
                className="w-12 h-12 p-0 text-white hover:bg-red-600 rounded-lg"
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
