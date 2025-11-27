import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Upload, FileText, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface BomUploadSectionProps {
  onUploadComplete: (bomFileUrl: string, coordFileUrl: string, bomFileName: string, coordFileName: string) => void;
}

export default function BomUploadSection({ onUploadComplete }: BomUploadSectionProps) {
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [coordFile, setCoordFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState<string | null>(null);

  const supabase = createClient();

  const handleDrag = useCallback((e: React.DragEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(type);
    } else if (e.type === 'dragleave') {
      setDragActive(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, type: 'bom' | 'coord') => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (type === 'bom') {
        if (file.name.match(/\.(xlsx|xls|bom)$/i)) {
          setBomFile(file);
        } else {
          toast.error('BOM 파일은 Excel(.xlsx, .xls) 형식이어야 합니다.');
        }
      } else {
        if (file.name.match(/\.(xlsx|xls|txt|csv)$/i)) {
          setCoordFile(file);
        } else {
          toast.error('좌표 파일은 Excel(.xlsx, .xls) 또는 텍스트(.txt, .csv) 형식이어야 합니다.');
        }
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>, type: 'bom' | 'coord') => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (type === 'bom') {
        setBomFile(file);
      } else {
        setCoordFile(file);
      }
    }
  }, []);

  const handleRemoveFile = useCallback((type: 'bom' | 'coord') => {
    if (type === 'bom') {
      setBomFile(null);
    } else {
      setCoordFile(null);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!bomFile || !coordFile) {
      toast.error('BOM 파일과 좌표 파일을 모두 선택해주세요.');
      return;
    }

    try {
      setUploading(true);
      setProgress(10);

      // 현재 사용자 정보
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      // 파일명 생성 (timestamp + safe_filename)
      const timestamp = Date.now();
      
      // 파일명을 안전하게 변환 (한글 및 특수문자 제거)
      const sanitizeFileName = (fileName: string) => {
        // 확장자 분리
        const lastDotIndex = fileName.lastIndexOf('.');
        const extension = lastDotIndex > -1 ? fileName.slice(lastDotIndex) : '';
        const nameWithoutExt = lastDotIndex > -1 ? fileName.slice(0, lastDotIndex) : fileName;
        
        // 파일명에서 영문자, 숫자, 하이픈, 언더스코어만 남기고 나머지는 제거
        const safeName = nameWithoutExt
          .replace(/[^a-zA-Z0-9\-_]/g, '_') // 특수문자와 한글을 언더스코어로 변환
          .replace(/_+/g, '_') // 연속된 언더스코어를 하나로
          .replace(/^_|_$/g, ''); // 앞뒤 언더스코어 제거
        
        // 파일명이 비어있으면 기본값 사용
        const finalName = safeName || 'file';
        
        return finalName + extension;
      };
      
      const safeBomFileName = sanitizeFileName(bomFile.name);
      const safeCoordFileName = sanitizeFileName(coordFile.name);
      
      const bomPath = `raw/${timestamp}_bom_${safeBomFileName}`;
      const coordPath = `raw/${timestamp}_coord_${safeCoordFileName}`;
      
      setProgress(30);

      // Supabase Storage에 업로드
      try {
        // 순차적으로 업로드하여 에러 추적 용이하게 함
        const bomResult = await supabase.storage
          .from('bom-files')
          .upload(bomPath, bomFile, {
            cacheControl: '3600',
            upsert: true // 같은 이름 파일이 있으면 덮어쓰기
          });

        if (bomResult.error) {
          console.error('BOM upload error:', bomResult.error);
          // 버킷이 없거나 권한 문제일 수 있음
          if (bomResult.error.message?.includes('not found') || bomResult.error.message?.includes('bucket')) {
            throw new Error('Storage 버킷이 설정되지 않았습니다. 관리자에게 문의하세요.');
          }
          throw bomResult.error;
        }
        
        setProgress(50);
        const coordResult = await supabase.storage
          .from('bom-files')
          .upload(coordPath, coordFile, {
            cacheControl: '3600',
            upsert: true
          });

        if (coordResult.error) {
          console.error('Coordinate upload error:', coordResult.error);
          // BOM 파일 롤백
          await supabase.storage.from('bom-files').remove([bomPath]);
          throw coordResult.error;
        }

        setProgress(70);
      } catch (uploadError) {
        console.error('Upload failed:', uploadError);
        throw uploadError;
      }

      // Public URL 생성 (또는 Signed URL)
      // bucket이 public이 아니므로 getPublicUrl보다는 createSignedUrl을 쓰거나
      // 백엔드(Edge Function)에서 처리하기 위해 path만 넘길 수도 있음.
      // 여기서는 Edge Function에서 다운로드받기 위해 createSignedUrl을 사용하거나
      // 버킷 정책을 authenticated read로 설정했으므로 getPublicUrl을 사용해도 됨 (단 public: false면 signed url 권장)
      
      // Signed URL 생성 (버킷이 private이므로)
      
      const { data: bomUrlData, error: bomUrlError } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(bomPath, 60 * 60); // 1시간 유효

      if (bomUrlError) {
        console.error('BOM URL creation error:', bomUrlError);
        throw new Error('BOM 파일 URL 생성 실패');
      }

      const { data: coordUrlData, error: coordUrlError } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(coordPath, 60 * 60); // 1시간 유효

      if (coordUrlError) {
        console.error('Coordinate URL creation error:', coordUrlError);
        throw new Error('좌표 파일 URL 생성 실패');
      }

      if (!bomUrlData?.signedUrl || !coordUrlData?.signedUrl) {
        throw new Error('파일 URL 생성 실패');
      }

      setProgress(100);
      toast.success('파일 업로드 완료');
      
      // 콜백 함수 호출
      onUploadComplete(
        bomUrlData.signedUrl, 
        coordUrlData.signedUrl,
        bomFile.name,
        coordFile.name
      );

    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(`업로드 실패: ${error.message}`);
    } finally {
      setUploading(false);
    }
  }, [bomFile, coordFile, supabase, onUploadComplete]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>파일 업로드</CardTitle>
        <CardDescription>
          BOM 파일(Excel)과 좌표 파일(Excel/TXT)을 업로드해주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* BOM 파일 업로드 영역 */}
          <div 
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer relative min-h-[200px] flex flex-col items-center justify-center",
              dragActive === 'bom' ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300",
              bomFile ? "bg-green-50 border-green-200" : ""
            )}
            onDragEnter={(e) => handleDrag(e, 'bom')}
            onDragLeave={(e) => handleDrag(e, 'bom')}
            onDragOver={(e) => handleDrag(e, 'bom')}
            onDrop={(e) => handleDrop(e, 'bom')}
            onClick={() => document.getElementById('bom-upload')?.click()}
          >
            <input 
              id="bom-upload" 
              type="file" 
              className="hidden" 
              accept=".xlsx,.xls" 
              onChange={(e) => handleFileSelect(e, 'bom')}
            />
            
            {bomFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                  <FileText size={24} />
                </div>
                <p className="font-medium text-green-700 truncate max-w-[200px]">{bomFile.name}</p>
                <p className="text-xs text-green-600">{(bomFile.size / 1024).toFixed(1)} KB</p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2 h-8 w-8 p-0 text-gray-500 hover:text-red-500"
                  onClick={(e) => { e.stopPropagation(); handleRemoveFile('bom'); }}
                >
                  <X size={16} />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <Upload size={24} />
                </div>
                <div>
                  <p className="font-medium text-gray-700">BOM 파일 업로드</p>
                  <p className="text-xs text-gray-400 mt-1">클릭하거나 드래그하여 업로드</p>
                </div>
                <div className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500">
                  .xlsx, .xls
                </div>
              </div>
            )}
          </div>

          {/* 좌표 파일 업로드 영역 */}
          <div 
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer relative min-h-[200px] flex flex-col items-center justify-center",
              dragActive === 'coord' ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300",
              coordFile ? "bg-blue-50 border-blue-200" : ""
            )}
            onDragEnter={(e) => handleDrag(e, 'coord')}
            onDragLeave={(e) => handleDrag(e, 'coord')}
            onDragOver={(e) => handleDrag(e, 'coord')}
            onDrop={(e) => handleDrop(e, 'coord')}
            onClick={() => document.getElementById('coord-upload')?.click()}
          >
            <input 
              id="coord-upload" 
              type="file" 
              className="hidden" 
              accept=".xlsx,.xls,.txt,.csv" 
              onChange={(e) => handleFileSelect(e, 'coord')}
            />
            
            {coordFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <FileText size={24} />
                </div>
                <p className="font-medium text-blue-700 truncate max-w-[200px]">{coordFile.name}</p>
                <p className="text-xs text-blue-600">{(coordFile.size / 1024).toFixed(1)} KB</p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2 h-8 w-8 p-0 text-gray-500 hover:text-red-500"
                  onClick={(e) => { e.stopPropagation(); handleRemoveFile('coord'); }}
                >
                  <X size={16} />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <Upload size={24} />
                </div>
                <div>
                  <p className="font-medium text-gray-700">좌표 파일 업로드</p>
                  <p className="text-xs text-gray-400 mt-1">클릭하거나 드래그하여 업로드</p>
                </div>
                <div className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500">
                  .xlsx, .txt, .csv
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 업로드 진행률 및 버튼 */}
        <div className="flex flex-col gap-4 mt-4">
          {uploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>업로드 중...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
          
          <div className="flex justify-end">
            <Button 
              onClick={handleUpload} 
              disabled={uploading || !bomFile || !coordFile}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? '업로드 중...' : '다음 단계로'}
            </Button>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-700">
            <p className="font-medium mb-1">파일 업로드 시 주의사항</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>BOM 파일은 반드시 <strong>.xlsx</strong> 또는 <strong>.xls</strong> 형식이어야 합니다.</li>
              <li>좌표 파일은 <strong>Pick & Place</strong> 데이터가 포함된 파일이어야 합니다.</li>
              <li>두 파일이 같은 보드(Board)의 데이터인지 확인해주세요.</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


