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
import { Upload, X, FileImage } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useReceiptPermissions } from "@/hooks/useReceiptPermissions";

interface ReceiptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReceiptUploadModal({ isOpen, onClose, onSuccess }: ReceiptUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [memo, setMemo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  const supabase = createClient();
  const { permissions } = useReceiptPermissions();

  // 파일 선택 핸들러 - useCallback으로 최적화
  const handleFileSelect = useCallback((selectedFile: File) => {
    // 이미지 파일만 허용
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    // 파일 크기 제한 (10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('파일 크기는 10MB 이하여야 합니다.');
      return;
    }

    setFile(selectedFile);
  }, []);

  // 드래그 앤 드롭 핸들러
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
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // 업로드 핸들러 - useCallback으로 최적화
  const handleUpload = useCallback(async () => {
    if (!permissions.canUpload) {
      toast.error('업로드 권한이 없습니다.');
      return;
    }

    if (!file) {
      toast.error('파일을 선택해주세요.');
      return;
    }

    try {
      setUploading(true);

      // 현재 사용자 정보 가져오기
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('로그인이 필요합니다.');
      }

      // 사용자 이름 가져오기
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single();

      const userName = employee?.name || '';

      // 파일명 생성
      const now = new Date();
      const fileExtension = file.name.split('.').pop() || 'jpg';
      const fileName = `rec${now.getFullYear().toString().substring(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}.${fileExtension}`;
      
      // 파일 경로
      const filePath = `receipts/web/${now.getTime()}/${fileName}`;

      // Supabase Storage에 업로드
      const { error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Public URL 생성
      const { data: { publicUrl } } = supabase.storage
        .from('receipt-images')
        .getPublicUrl(filePath);

      // DB에 저장 - memo 칼럼 포함
      const { error: dbError } = await supabase
        .from('purchase_receipts')
        .insert({
          receipt_image_url: publicUrl,
          file_name: fileName,
          file_size: file.size,
          uploaded_by: user.email!,
          uploaded_by_name: userName,
          memo: memo || null,
          uploaded_at: new Date().toISOString(),
        });

      if (dbError) throw dbError;

      toast.success('영수증이 성공적으로 업로드되었습니다.');
      handleClose();
      onSuccess();
    } catch (error) {
      toast.error(`업로드 실패: ${error instanceof Error ? error.message : error}`);
    } finally {
      setUploading(false);
    }
  }, [file, memo, permissions.canUpload, onSuccess]);

  // 모달 닫기 - useCallback으로 최적화
  const handleClose = useCallback(() => {
    setFile(null);
    setMemo("");
    setUploading(false);
    setDragOver(false);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="modal-title">📎 영수증 업로드</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-7 w-7 p-0 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <DialogDescription className="modal-subtitle">
            영수증 이미지를 업로드하고 메모를 추가할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* 파일 업로드 영역 */}
          <div className="space-y-2">
            <Label className="modal-label">파일 선택</Label>
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer ${
                dragOver
                  ? 'border-hansl-400 bg-hansl-50 scale-[1.02]'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-hansl-300 hover:bg-gray-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="space-y-3">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <FileImage className="w-8 h-8 text-green-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="modal-value text-green-800 truncate max-w-[200px] mx-auto">{file.name}</p>
                    <p className="badge-text text-green-600">
                      {(file.size / 1024 / 1024).toFixed(2)}MB
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFile(null)}
                    className="mt-3 text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <X className="w-3 h-3 mr-1" />
                    제거
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-8 h-8 text-gray-400" />
                  </div>
                  <div className="space-y-2">
                    <p className="modal-value">
                      이미지를 드래그하여 놓거나 클릭하여 선택하세요
                    </p>
                    <p className="badge-text text-gray-500">
                      JPG, PNG, HEIC, WebP • 최대 10MB
                    </p>
                  </div>
                </div>
              )}
              
              {!file && (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0];
                    if (selectedFile) {
                      handleFileSelect(selectedFile);
                    }
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
              className="resize-none border-gray-200 focus:border-hansl-400 focus:ring-hansl-400"
              rows={3}
            />
          </div>


          {/* 업로드 버튼 */}
          <div className="flex gap-3 pt-6 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1 h-9 border-gray-200 hover:bg-gray-50"
              disabled={uploading}
            >
              취소
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex-1 h-9 bg-hansl-600 hover:bg-hansl-700 text-white badge-text shadow-sm"
            >
              {uploading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  업로드 중...
                </div>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  업로드
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}