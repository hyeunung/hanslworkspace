import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, X, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import transactionStatementService from "@/services/transactionStatementService";

interface MonthlyStatementUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (statementId: string, fileUrl: string) => void;
}

const ACCEPTED_TYPES = [
  'application/vnd.ms-excel',                                                    // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           // .xlsx
  'application/pdf',                                                              // .pdf
  'image/jpeg', 'image/png', 'image/gif', 'image/webp'                          // 이미지
];

const ACCEPTED_EXTENSIONS = ['.xls', '.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

function getFileType(file: File): 'excel' | 'pdf' | 'image' {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (ext === 'pdf') return 'pdf';
  return 'image';
}

/**
 * 거래명세서(월말결제) 업로드 모달
 * 엑셀, PDF, 이미지 파일 모두 지원
 */
export default function MonthlyStatementUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: MonthlyStatementUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaderName, setUploaderName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

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
      // ignore
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUserName();
    }
  }, [isOpen]);

  const handleFileSelect = (selectedFile: File) => {
    const ext = '.' + (selectedFile.name.split('.').pop()?.toLowerCase() || '');
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      toast.error('지원하지 않는 파일 형식입니다. (엑셀, PDF, 이미지)');
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      toast.error('파일 크기는 20MB 이하여야 합니다.');
      return;
    }

    setFile(selectedFile);

    // 이미지인 경우 미리보기
    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setPreview(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
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
    if (selectedFile) handleFileSelect(selectedFile);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('파일을 선택해주세요.');
      return;
    }

    try {
      setUploading(true);
      const fileType = getFileType(file);

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonthlyStatementUploadModal.tsx:handleUpload',message:'upload start',data:{fileName:file.name,fileType,fileSize:file.size},timestamp:Date.now(),runId:'debug7',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion

      const result = await transactionStatementService.uploadMonthlyStatement(
        file,
        uploaderName || '알 수 없음',
        undefined,
        undefined,
        fileType
      );

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonthlyStatementUploadModal.tsx:handleUpload:result',message:'upload result',data:{success:result.success,error:result.error,hasData:Boolean(result.data)},timestamp:Date.now(),runId:'debug7',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion

      if (result.success && result.data) {
        toast.success('월말결제 거래명세서 업로드가 완료되었습니다.');
        onSuccess(result.data.statementId, result.data.fileUrl);
        handleClose();
      } else {
        toast.error(result.error || '업로드에 실패했습니다.');
      }
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonthlyStatementUploadModal.tsx:handleUpload:catch',message:'upload exception',data:{error:String(error)},timestamp:Date.now(),runId:'debug7',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      toast.error('업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (uploading) return;
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const fileType = file ? getFileType(file) : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] business-radius-modal">
        <DialogHeader className="border-b border-gray-100 pb-3">
          <DialogTitle className="flex items-center gap-2 text-[13px] font-bold text-gray-900">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            거래명세서(월말결제) 업로드
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 px-1">
          {/* 드래그앤드롭 영역 */}
          <div
            className={`
              border-2 border-dashed business-radius-card p-6 text-center cursor-pointer transition-colors
              ${file 
                ? 'border-emerald-300 bg-emerald-50' 
                : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={handleClick}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.pdf,image/*"
              onChange={handleInputChange}
              className="hidden"
            />

            {file ? (
              <div className="relative">
                {preview ? (
                  <img
                    src={preview}
                    alt="미리보기"
                    className="max-h-52 mx-auto business-radius-card shadow-sm"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="w-12 h-12 text-emerald-500" />
                    <span className="text-[11px] font-medium text-emerald-700">
                      {fileType === 'excel' ? '엑셀 파일' : fileType === 'pdf' ? 'PDF 파일' : '이미지 파일'}
                    </span>
                  </div>
                )}
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
                  {file.name}
                </p>
              </div>
            ) : (
              <>
                <FileSpreadsheet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-[11px] text-gray-600 mb-1">
                  월말결제 거래명세서를 드래그하거나 클릭하여 선택하세요
                </p>
                <p className="text-[10px] text-gray-400">
                  지원 형식: XLS, XLSX, PDF, JPG, PNG (최대 20MB)
                </p>
              </>
            )}
          </div>


          {/* 안내 문구 */}
          <div className="mt-4 p-3 bg-emerald-50 business-radius-card border border-emerald-100">
            <p className="text-[10px] text-emerald-700 leading-relaxed">
              월말결제 업체의 거래명세서를 업로드하세요.
              엑셀/PDF는 파싱으로 정확하게, 이미지는 OCR로 자동 추출합니다.
              품목명으로 시스템 발주를 매칭하여 단가/합계를 자동 기입합니다.
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
            disabled={!file || uploading}
            className="button-base h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
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
