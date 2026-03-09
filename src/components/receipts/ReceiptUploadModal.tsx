import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";
import { receiptOcrService } from "@/services/receiptOcrService";
import { logger } from "@/lib/logger";

interface ReceiptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FileWithPreview {
  file: File;
  preview: string;
  id: string;
}

export default function ReceiptUploadModal({ isOpen, onClose, onSuccess }: ReceiptUploadModalProps) {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [memo, setMemo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  const supabase = createClient();
  const { permissions } = useReceiptPermissions();

  const validateAndAddFile = useCallback((selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('파일 크기는 10MB 이하여야 합니다.');
      return;
    }

    const preview = URL.createObjectURL(selectedFile);
    const newFile: FileWithPreview = {
      file: selectedFile,
      preview,
      id: crypto.randomUUID(),
    };

    setFiles(prev => [...prev, newFile]);
  }, []);

  const handleFileSelect = useCallback((selectedFiles: FileList | File[]) => {
    const fileArray = Array.from(selectedFiles);
    fileArray.forEach(f => validateAndAddFile(f));
  }, [validateAndAddFile]);

  const handleRemoveFile = useCallback((id: string) => {
    setFiles(prev => {
      const removed = prev.find(f => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      handleFileSelect(droppedFiles);
    }
  };

  const handleUpload = useCallback(async () => {
    if (!permissions.canUpload) {
      toast.error('업로드 권한이 없습니다.');
      return;
    }

    if (files.length === 0) {
      toast.error('파일을 선택해주세요.');
      return;
    }

    try {
      setUploading(true);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('로그인이 필요합니다.');
      }

      const { data: employee } = await supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single();

      const userName = employee?.name || '';

      // 2장 이상이면 group_id 생성
      const groupId = files.length > 1 ? crypto.randomUUID() : null;

      for (const fileItem of files) {
        const now = new Date();
        const fileExtension = fileItem.file.name.split('.').pop() || 'jpg';
        const fileName = `rec${now.getFullYear().toString().substring(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.${fileExtension}`;
        
        const filePath = `receipts/web/${now.getTime()}_${fileItem.id.slice(0, 8)}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('receipt-images')
          .upload(filePath, fileItem.file, {
            contentType: fileItem.file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('receipt-images')
          .getPublicUrl(filePath);

        const { data: insertedReceipt, error: dbError } = await supabase
          .from('purchase_receipts')
          .insert({
            receipt_image_url: publicUrl,
            file_name: fileName,
            file_size: fileItem.file.size,
            uploaded_by: user.email!,
            uploaded_by_name: userName,
            memo: memo || null,
            uploaded_at: new Date().toISOString(),
            group_id: groupId,
          })
          .select('id')
          .single();

        if (dbError) throw dbError;

        // 독립 영수증 OCR 엔진 비동기 요청 (업로드 자체는 블로킹하지 않음)
        if (insertedReceipt?.id) {
          const createJobResult = await receiptOcrService.createJob({
            imageUrl: publicUrl,
            sourceReceiptId: insertedReceipt.id,
            requestedBy: user.email || undefined,
            requestedByName: userName || undefined,
          });
          if (createJobResult.success && createJobResult.jobId) {
            const triggerResult = await receiptOcrService.trigger(createJobResult.jobId);
            if (!triggerResult.success) {
              logger.warn('영수증 OCR 트리거 실패', { receiptId: insertedReceipt.id, error: triggerResult.error });
            }
          } else {
            logger.warn('영수증 OCR 작업 생성 실패', { receiptId: insertedReceipt.id, error: createJobResult.error });
          }
        }
      }

      const countText = files.length > 1 ? `${files.length}장이` : '영수증이';
      toast.success(`${countText} 성공적으로 업로드되었습니다. OCR 자동기입을 처리 중입니다.`);
      handleClose();
      onSuccess();
    } catch (error) {
      toast.error(`업로드 실패: ${error instanceof Error ? error.message : error}`);
    } finally {
      setUploading(false);
    }
  }, [files, memo, permissions.canUpload, onSuccess]);

  const handleClose = useCallback(() => {
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
    setMemo("");
    setUploading(false);
    setDragOver(false);
    onClose();
  }, [onClose, files]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="modal-title">📎 영수증 업로드</DialogTitle>
          <DialogDescription className="modal-subtitle">
            영수증 이미지를 여러 장 업로드할 수 있습니다. 같은 항목이면 함께 묶어서 관리됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="px-8 py-4 space-y-4">
          {/* 파일 업로드 영역 */}
          <div className="space-y-2">
            <Label className="modal-label">파일 선택 <span className="text-gray-400 badge-text">(여러 장 가능)</span></Label>
            <div
              className={`relative border-2 border-dashed business-radius-card p-6 text-center transition-all duration-200 cursor-pointer ${
                dragOver
                  ? 'border-hansl-400 bg-hansl-50'
                  : files.length > 0
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-hansl-300 hover:bg-gray-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {files.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {files.map((fileItem) => (
                      <div key={fileItem.id} className="relative group">
                        <img
                          src={fileItem.preview}
                          alt={fileItem.file.name}
                          className="w-full h-24 object-cover business-radius-card border border-gray-200"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(fileItem.id);
                          }}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <p className="mt-1 text-[9px] text-gray-500 truncate">{fileItem.file.name}</p>
                      </div>
                    ))}
                    <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-gray-300 business-radius-card cursor-pointer hover:border-hansl-400 hover:bg-hansl-50 transition-colors">
                      <Plus className="w-5 h-5 text-gray-400" />
                      <span className="text-[9px] text-gray-400 mt-1">추가</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          if (e.target.files) handleFileSelect(e.target.files);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-green-600 font-medium">
                    {files.length}장 선택됨 {files.length > 1 && '(하나의 그룹으로 묶입니다)'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-7 h-7 text-gray-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="modal-value">
                      이미지를 드래그하여 놓거나 클릭하여 선택하세요
                    </p>
                    <p className="badge-text text-gray-500">
                      JPG, PNG, HEIC, WebP • 최대 10MB • 여러 장 선택 가능
                    </p>
                  </div>
                </div>
              )}
              
              {files.length === 0 && (
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) handleFileSelect(e.target.files);
                    e.target.value = '';
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              )}
            </div>
          </div>

          {/* 메모 */}
          <div className="space-y-2">
            <Label htmlFor="memo" className="modal-label">
              메모 <span className="text-gray-400 badge-text">(선택사항)</span>
            </Label>
            <Textarea
              id="memo"
              placeholder="영수증에 대한 간단한 메모를 입력하세요"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="resize-none border-gray-200 focus:border-hansl-400 focus:ring-hansl-400 business-radius-input"
              rows={3}
            />
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2 px-8 py-4 border-t border-gray-100">
          <Button
            variant="outline"
            onClick={handleClose}
            className="button-base w-20 border-gray-200 hover:bg-gray-50"
            disabled={uploading}
          >
            취소
          </Button>
          <Button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="button-base w-20 bg-hansl-600 hover:bg-hansl-700 text-white"
          >
            {uploading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                업로드 중...
              </div>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                업로드 {files.length > 1 && `(${files.length}장)`}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
