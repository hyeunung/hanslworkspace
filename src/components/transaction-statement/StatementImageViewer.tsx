import { X, ZoomIn, ZoomOut, RotateCw, Download, ExternalLink, FileText, Save, Loader2, GripHorizontal } from "lucide-react";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

type FileViewType = 'image' | 'pdf';

interface OpenStatementPreviewOptions {
  fileUrl: string;
  onOpenImageViewer: (viewerImageUrl: string) => void;
}

function detectFileType(url: string): FileViewType {
  const urlPath = url.split('?')[0].toLowerCase();
  if (urlPath.endsWith('.pdf')) return 'pdf';
  return 'image';
}

export function openStatementPreview({ fileUrl, onOpenImageViewer }: OpenStatementPreviewOptions) {
  const urlPath = fileUrl.split("?")[0].toLowerCase();
  const isExcel = urlPath.endsWith(".xls") || urlPath.endsWith(".xlsx");
  const isPdf = urlPath.endsWith(".pdf");

  if (isExcel) {
    const width = 1000;
    const height = 800;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`;
    window.open(viewerUrl, "transaction-statement-viewer", `width=${width},height=${height},left=${left},top=${top}`);
    return;
  }

  if (isPdf) {
    const width = 1000;
    const height = 800;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    window.open(fileUrl, "transaction-statement-viewer", `width=${width},height=${height},left=${left},top=${top}`);
    return;
  }

  const viewerImageUrl = `${fileUrl}${fileUrl.includes("?") ? "&" : "?"}viewer_t=${Date.now()}`;
  onOpenImageViewer(viewerImageUrl);
}

function extractStoragePath(url: string): { bucket: string; path: string } | null {
  try {
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+?)\/(.+?)(\?|$)/);
    if (!match) return null;
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

interface StatementImageViewerProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
  onSaved?: (newUrl: string) => void;
}

/**
 * 거래명세서 파일 뷰어 (이미지/PDF)
 * 드래그 가능한 플로팅 창 - 배경 모달과 동시에 비교 가능
 */
export default function StatementImageViewer({
  isOpen,
  imageUrl,
  onClose,
  onSaved,
}: StatementImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [displayUrl, setDisplayUrl] = useState(imageUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [suppressTransformTransition, setSuppressTransformTransition] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);

  const dragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const positionRef = useRef(position);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  const fileType = useMemo(() => detectFileType(imageUrl), [imageUrl]);
  const supabase = createClient();

  // 열릴 때만 초기 상태를 설정한다.
  // imageUrl 변경(저장 직후 onSaved) 때까지 초기화를 반복하면 저장 반영 순간 transition이 다시 켜질 수 있다.
  useEffect(() => {
    const opening = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!opening) return;

    setScale(1);
    setRotation(0);
    setSaved(false);
    setSuppressTransformTransition(false);
    setInitialized(false);
    setDisplayUrl(imageUrl);
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (isOpen && !initialized) {
      const w = containerRef.current?.offsetWidth ?? 800;
      const h = containerRef.current?.offsetHeight ?? 600;
      setPosition({
        x: Math.round((window.innerWidth - w) / 2),
        y: Math.round((window.innerHeight - h) / 2),
      });
      setInitialized(true);
    }
  }, [isOpen, initialized]);

  // positionRef를 항상 최신 state와 동기화
  positionRef.current = position;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
    };
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.mouseX;
      const dy = e.clientY - dragStart.current.mouseY;
      setPosition({
        x: dragStart.current.posX + dx,
        y: dragStart.current.posY + dy,
      });
    };
    const handleMouseUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => {
    setSaved(false);
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleSaveRotation = async () => {
    if (rotation === 0) return;

    const storageInfo = extractStoragePath(imageUrl);
    if (!storageInfo) {
      toast.error(`경로 파싱 실패: ${imageUrl.slice(0, 100)}`, { duration: 10000 });
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`fetch 실패: ${response.status} ${response.statusText}`);

      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      const rad = (rotation * Math.PI) / 180;
      const isRotated90 = rotation === 90 || rotation === 270;
      const canvas = document.createElement('canvas');
      canvas.width = isRotated90 ? bitmap.height : bitmap.width;
      canvas.height = isRotated90 ? bitmap.width : bitmap.height;

      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

      const rotatedBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92)
      );
      if (!rotatedBlob) throw new Error('canvas.toBlob 실패 (null 반환)');

      const { data: uploadData, error } = await supabase.storage
        .from(storageInfo.bucket)
        .upload(storageInfo.path, rotatedBlob, { contentType: 'image/jpeg', upsert: true });

      if (error) throw new Error(`업로드 실패: ${error.message} (${JSON.stringify(error)})`);
      if (!uploadData) throw new Error("업로드 결과가 비어 있습니다.");

      const baseUrl = imageUrl.split('?')[0];
      const newUrl = `${baseUrl}?t=${Date.now()}`;
      await new Promise<void>((resolve, reject) => {
        const preloader = new Image();
        preloader.onload = () => resolve();
        preloader.onerror = () => reject(new Error("saved image preload failed"));
        preloader.src = newUrl;
      });
      setSuppressTransformTransition(true);
      setDisplayUrl(newUrl);
      setRotation(0);
      setSaved(true);
      onSaved?.(newUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`저장 실패: ${msg}`, { duration: 10000 });
    } finally {
      setSaving(false);
    }
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
    } catch {
      toast.error('다운로드에 실패했습니다.');
    }
  };

  const handleOpenExternal = () => window.open(imageUrl, '_blank');

  const handleClose = () => {
    setScale(1);
    setRotation(0);
    onClose();
  };

  if (!isOpen || !imageUrl) return null;

  return createPortal(
    <>
      {/* 클릭 아웃사이드 오버레이 */}
      <div className="fixed inset-0 z-[199]" onClick={handleClose} />

    <div
      ref={containerRef}
      className="fixed z-[200] bg-black/95 rounded-xl shadow-2xl overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: 760,
        height: 600,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 드래그 핸들 + 컨트롤 바 */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-zinc-900 cursor-grab active:cursor-grabbing select-none shrink-0"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <GripHorizontal className="w-4 h-4 text-white/30 mr-1 pointer-events-none" />

          {fileType === 'image' && (
            <>
              <button
                onClick={handleZoomOut}
                disabled={scale <= 0.5}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-white min-w-[42px] text-center font-medium">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                disabled={scale >= 3}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-white/30 mx-1" />
              <button
                onClick={handleRotate}
                disabled={saving}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
                title="90도 회전"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {saved ? (
                <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500 text-white text-[10px] font-medium">
                  <Save className="w-3 h-3" />
                  저장완료
                </span>
              ) : rotation !== 0 ? (
                <button
                  onClick={handleSaveRotation}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/80 hover:bg-blue-500 text-white text-[10px] font-medium transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {saving ? '저장 중...' : '회전 저장'}
                </button>
              ) : null}
              <div className="w-px h-4 bg-white/30 mx-1" />
            </>
          )}

          {fileType === 'pdf' && (
            <>
              <FileText className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[10px] text-white font-medium mr-1">PDF</span>
              <div className="w-px h-4 bg-white/30 mx-1" />
            </>
          )}

          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="다운로드"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="새 탭에서 열기"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-red-500/80 text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {fileType === 'image' && (
          <img
            src={displayUrl}
            alt="거래명세서"
            className={`max-w-full max-h-full object-contain ${suppressTransformTransition ? "transition-none" : "transition-transform duration-200"}`}
            style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
            onLoad={() => {
              if (suppressTransformTransition) {
                setSuppressTransformTransition(false);
              }
            }}
            draggable={false}
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
    </div>
    </>,
    document.body
  );
}
