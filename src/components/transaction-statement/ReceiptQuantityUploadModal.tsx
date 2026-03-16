import { useState, useRef, useEffect } from "react";
import { logger } from "@/lib/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import transactionStatementService from "@/services/transactionStatementService";
import { DateQuantityPickerPopover } from "@/components/ui/date-quantity-picker-popover";
import { format } from "date-fns";

interface ReceiptQuantityUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (statementId: string, imageUrl: string) => void;
}

/**
 * 입고수량 업로드 모달 (월말결제용 - 수량만 추출)
 */
export default function ReceiptQuantityUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: ReceiptQuantityUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaderName, setUploaderName] = useState<string>("");
  const [actualReceiptDate, setActualReceiptDate] = useState<Date | null>(null);
  const [poScope, setPoScope] = useState<"single" | "multi" | "">("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // 현재 사용자 이름 가져오기
  const loadUserName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: employee } = await supabase
          .from('employees')
          .select('name')
          .eq('email', user.email)
          .single();
        
        if (employee?.name) {
          setUploaderName(employee.name);
        }
      }
    } catch (e) {
      logger.warn('Failed to load user name');
    }
  };

  // 모달 열릴 때 사용자 이름 로드
  useEffect(() => {
    if (isOpen) {
      loadUserName();
    }
  }, [isOpen]);

  // 파일 선택 처리
  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('파일 크기는 10MB 이하여야 합니다.');
      return;
    }

    setFile(selectedFile);

    // EXIF 회전 반영된 미리보기 생성 (from-image: EXIF orientation 적용)
    createImageBitmap(selectedFile, { imageOrientation: 'from-image' }).then(bitmap => {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        setPreview(canvas.toDataURL('image/jpeg', 0.8));
      }
    }).catch(() => {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(selectedFile);
    });
  };

  // 드래그앤드롭 처리
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('파일을 선택해주세요.');
      return;
    }

    if (!actualReceiptDate) {
      toast.error('실입고일을 선택해주세요.');
      return;
    }
    if (!poScope) {
      toast.error('단일/다중 여부를 선택해주세요.');
      return;
    }

    try {
      setUploading(true);

      // 입고수량 업로드용 서비스 호출 (statement_mode: 'receipt')
      const result = await transactionStatementService.uploadReceiptQuantity(
        file,
        uploaderName || '알 수 없음',
        actualReceiptDate,
        poScope
      );

      if (result.success && result.data) {
        toast.success('입고수량 업로드가 완료되었습니다.');
        onSuccess(result.data.statementId, result.data.imageUrl);
        handleClose();
      } else {
        toast.error(result.error || '업로드에 실패했습니다.');
      }
    } catch (error) {
      toast.error('업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (uploading) return;
    
    setFile(null);
    setPreview(null);
    setActualReceiptDate(null);
    setPoScope("");
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] business-radius-modal">
        <DialogHeader className="border-b border-gray-100 pb-3">
          <DialogTitle className="flex items-center gap-2 text-[13px] font-bold text-gray-900">
            <Upload className="w-4 h-4 text-orange-600" />
            입고수량 업로드
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 px-1">
          {/* 드래그앤드롭 영역 */}
          <div
            className={`
              border-2 border-dashed business-radius-card p-6 text-center cursor-pointer transition-colors
              ${preview 
                ? 'border-orange-300 bg-orange-50' 
                : 'border-gray-200 hover:border-orange-300 hover:bg-gray-50'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={handleClick}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleInputChange}
              className="hidden"
            />

            {preview ? (
              <div className="relative">
                <img
                  src={preview}
                  alt="미리보기"
                  className="max-h-52 mx-auto business-radius-card shadow-sm"
                />
                <button
                  className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile();
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <p className="mt-3 text-[11px] text-gray-600 truncate px-4">
                  {file?.name}
                </p>
              </div>
            ) : (
              <>
                <ImageIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-[11px] text-gray-600 mb-1">
                  거래명세서 이미지를 드래그하거나 클릭하여 선택하세요
                </p>
                <p className="text-[10px] text-gray-400">
                  지원 형식: JPG, PNG, GIF, WEBP (최대 10MB)
                </p>
              </>
            )}
          </div>

          <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="modal-label text-gray-600">발주/수주 구분</div>
              <div className="flex flex-col items-end gap-1">
                <Select
                  value={poScope}
                  onValueChange={(value) => setPoScope(value as "single" | "multi")}
                  disabled={uploading}
                >
                  <SelectTrigger className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                    <SelectValue placeholder="단일/다중 선택" />
                  </SelectTrigger>
                  <SelectContent className="border border-gray-200 business-radius-card shadow-md">
                    <SelectItem value="single" className="text-[11px]">단일 발주</SelectItem>
                    <SelectItem value="multi" className="text-[11px]">다중 발주</SelectItem>
                  </SelectContent>
                </Select>
                {!poScope && (
                  <span className="text-[10px] text-red-500 font-medium">단일/다중을 선택해주세요.</span>
                )}
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="modal-label text-gray-600">실입고일</div>
              <div className="flex flex-col items-end gap-1">
                <DateQuantityPickerPopover
                  onConfirm={(date) => setActualReceiptDate(date)}
                  placeholder="입고일을 선택하세요"
                  align="end"
                  side="bottom"
                  hideQuantityInput={true}
                  disabled={uploading}
                >
                  <button className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                    {actualReceiptDate ? format(actualReceiptDate, 'yyyy-MM-dd') : '실입고일 선택'}
                  </button>
                </DateQuantityPickerPopover>
                {!actualReceiptDate && (
                  <span className="text-[10px] text-red-500 font-medium">실입고일을 입력해주세요.</span>
                )}
              </div>
            </div>
          </div>

          {/* 안내 문구 - 입고수량 전용 */}
          <div className="mt-4 p-3 bg-orange-50 business-radius-card border border-orange-100">
            <p className="text-[10px] text-orange-700 leading-relaxed">
              📦 월말결제 업체용 입고수량 확인 기능입니다.
              거래명세서에서 수량만 추출하여 실입고수량을 기록합니다.
              (금액 정보는 추출하지 않습니다)
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-gray-100 pt-3 gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
            className="button-base h-8 text-[11px]"
          >
            취소
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || !actualReceiptDate || !poScope || uploading}
            className="button-base h-8 text-[11px] bg-orange-600 hover:bg-orange-700 text-white"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                업로드 중...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                업로드
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
