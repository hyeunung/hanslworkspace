import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { X, ZoomIn, ZoomOut, RotateCw, Download, ExternalLink, FileText } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";

type FileViewType = 'image' | 'pdf';

function detectFileType(url: string): FileViewType {
  const urlPath = url.split('?')[0].toLowerCase();
  if (urlPath.endsWith('.pdf')) return 'pdf';
  return 'image';
}

interface StatementImageViewerProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
}

/**
 * 거래명세서 파일 뷰어 (이미지/PDF)
 * 엑셀은 호출 측에서 Office Online Viewer로 새 창 열기 처리
 */
export default function StatementImageViewer({
  isOpen,
  imageUrl,
  onClose,
}: StatementImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [autoRotated, setAutoRotated] = useState(false);

  const fileType = useMemo(() => detectFileType(imageUrl), [imageUrl]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = fileType === 'pdf' ? 'pdf' : 'jpg';
      a.download = `거래명세서_${new Date().toISOString().split('T')[0]}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('다운로드되었습니다.');
    } catch (error) {
      toast.error('다운로드에 실패했습니다.');
    }
  };

  const handleOpenExternal = () => {
    window.open(imageUrl, '_blank');
  };

  const handleClose = () => {
    setScale(1);
    setRotation(0);
    setAutoRotated(false);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setRotation(0);
      setAutoRotated(false);
    }
  }, [isOpen, imageUrl]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (autoRotated) return;
    const img = e.currentTarget;
    const isLikelySideways = img.naturalWidth > img.naturalHeight * 1.15;
    if (isLikelySideways) {
      setRotation(90);
    }
    setAutoRotated(true);
  };

  if (!imageUrl) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-none">
        {/* 컨트롤 바 */}
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-1.5">
            {fileType === 'image' && (
              <>
                <button
                  onClick={handleZoomOut}
                  disabled={scale <= 0.5}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-white min-w-[50px] text-center font-medium">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  disabled={scale >= 3}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-white/30 mx-1.5" />
                <button
                  onClick={handleRotate}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}
            {fileType === 'pdf' && (
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-red-400" />
                <span className="text-[11px] text-white font-medium">PDF 문서</span>
              </div>
            )}
            <div className="w-px h-5 bg-white/30 mx-1.5" />
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="다운로드"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleOpenExternal}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="새 탭에서 열기"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 콘텐츠 영역 */}
        <div className="flex items-center justify-center w-full h-[80vh] overflow-auto p-4 pt-16">
          {fileType === 'image' && (
            <img
              src={imageUrl}
              alt="거래명세서"
              onLoad={handleImageLoad}
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
              }}
            />
          )}

          {fileType === 'pdf' && (
            <iframe
              src={imageUrl}
              className="w-full h-full rounded-lg"
              style={{ border: 'none', background: 'white' }}
              title="PDF 미리보기"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
