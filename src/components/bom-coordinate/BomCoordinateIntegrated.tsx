import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Package, Upload, FileText, X, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import GeneratedPreviewPanel from './GeneratedPreviewPanel';
import CoordinatePreviewPanel from './CoordinatePreviewPanel';
import { BOMItem } from '@/utils/excel-generator';

interface FileInfo {
  bomFile: File | null;
  coordFile: File | null;
  bomUrl?: string;
  coordUrl?: string;
}

interface Metadata {
  boardName: string;
  artworkManager: string;
  productionManager: string;
  productionQuantity: number;
}

export default function BomCoordinateIntegrated() {
  const [step, setStep] = useState<'input' | 'processing' | 'preview'>('input');
  const [fileInfo, setFileInfo] = useState<FileInfo>({
    bomFile: null,
    coordFile: null
  });
  const [metadata, setMetadata] = useState<Metadata>({
    boardName: '',
    artworkManager: '',
    productionManager: '',
    productionQuantity: 100
  });
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processedResult, setProcessedResult] = useState<any>(null);
  const [dragActive, setDragActive] = useState<string | null>(null);

  const supabase = createClient();

  // 직원 목록 및 현재 사용자 정보 로드
  useEffect(() => {
    const loadData = async () => {
      try {
        // 직원 목록 로드
        const { data: empData } = await supabase
          .from('employees')
          .select('id, name')
          .order('name');
        
        if (empData) {
          setEmployees(empData);
        }

        // 현재 사용자 정보 로드
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data: userData } = await supabase
            .from('employees')
            .select('name')
            .eq('email', user.email)
            .single();
          
          setCurrentUser({
            email: user.email,
            name: userData?.name || user.email.split('@')[0]
          });
          
          setMetadata(prev => ({
            ...prev,
            artworkManager: userData?.name || user.email.split('@')[0]
          }));
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    loadData();
  }, [supabase]);

  // 파일명에서 보드 이름 추측
  useEffect(() => {
    if (fileInfo.bomFile) {
      let name = fileInfo.bomFile.name.replace(/\.(xlsx|xls|bom)$/i, '');
      name = name.replace(/^\d+_bom_/, '');
      setMetadata(prev => ({ ...prev, boardName: name }));
    }
  }, [fileInfo.bomFile]);

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
        setFileInfo(prev => ({ ...prev, bomFile: file }));
      } else {
        setFileInfo(prev => ({ ...prev, coordFile: file }));
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>, type: 'bom' | 'coord') => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (type === 'bom') {
        setFileInfo(prev => ({ ...prev, bomFile: file }));
      } else {
        setFileInfo(prev => ({ ...prev, coordFile: file }));
      }
    }
  }, []);

  const handleRemoveFile = useCallback((type: 'bom' | 'coord') => {
    if (type === 'bom') {
      setFileInfo(prev => ({ ...prev, bomFile: null, bomUrl: undefined }));
    } else {
      setFileInfo(prev => ({ ...prev, coordFile: null, coordUrl: undefined }));
    }
  }, []);

  const handleProcess = async () => {
    if (!fileInfo.bomFile || !fileInfo.coordFile) {
      toast.error('BOM 파일과 좌표 파일을 모두 선택해주세요.');
      return;
    }

    if (!metadata.boardName.trim()) {
      toast.error('보드 이름을 입력해주세요.');
      return;
    }

    if (metadata.productionQuantity <= 0) {
      toast.error('생산 수량은 1개 이상이어야 합니다.');
      return;
    }

    try {
      setUploading(true);
      setStep('processing');

      // 1. 파일 업로드
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      const timestamp = Date.now();
      const sanitizeFileName = (fileName: string) => {
        const lastDotIndex = fileName.lastIndexOf('.');
        const extension = lastDotIndex > -1 ? fileName.slice(lastDotIndex) : '';
        const nameWithoutExt = lastDotIndex > -1 ? fileName.slice(0, lastDotIndex) : fileName;
        const safeName = nameWithoutExt
          .replace(/[^a-zA-Z0-9\-_]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        return (safeName || 'file') + extension;
      };

      const safeBomFileName = sanitizeFileName(fileInfo.bomFile.name);
      const safeCoordFileName = sanitizeFileName(fileInfo.coordFile.name);
      const bomPath = `raw/${timestamp}_bom_${safeBomFileName}`;
      const coordPath = `raw/${timestamp}_coord_${safeCoordFileName}`;

      // 파일 업로드
      const bomResult = await supabase.storage
        .from('bom-files')
        .upload(bomPath, fileInfo.bomFile, { cacheControl: '3600', upsert: true });

      if (bomResult.error) throw bomResult.error;

      const coordResult = await supabase.storage
        .from('bom-files')
        .upload(coordPath, fileInfo.coordFile, { cacheControl: '3600', upsert: true });

      if (coordResult.error) {
        await supabase.storage.from('bom-files').remove([bomPath]);
        throw coordResult.error;
      }

      // Signed URL 생성
      const { data: bomUrlData } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(bomPath, 60 * 60);

      const { data: coordUrlData } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(coordPath, 60 * 60);

      if (!bomUrlData?.signedUrl || !coordUrlData?.signedUrl) {
        throw new Error('파일 URL 생성 실패');
      }

      // 2. 처리 (임시 더미 데이터)
      await new Promise(resolve => setTimeout(resolve, 2000));

      const dummyResult = {
        cadDrawingId: `cad_${Date.now()}`,
        processedData: {
          bomItems: [
            {
              lineNumber: 1,
              itemType: 'Capacitor',
              itemName: 'C0603-100nF',
              specification: 'Ceramic Capacitor 100nF 50V',
              setCount: 1,
              totalQuantity: metadata.productionQuantity * 10,
              stockQuantity: 0,
              checkStatus: '발주필요',
              refList: 'C1,C2,C3,C4,C5,C6,C7,C8,C9,C10',
              alternativeItem: '',
              remark: ''
            },
            {
              lineNumber: 2,
              itemType: 'Resistor',
              itemName: 'R0603-10K',
              specification: 'SMD Resistor 10K 1%',
              setCount: 1,
              totalQuantity: metadata.productionQuantity * 15,
              stockQuantity: 100,
              checkStatus: '재고충분',
              refList: 'R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R14,R15',
              alternativeItem: 'R0603-10K-5%',
              remark: '5% 공차도 사용 가능'
            }
          ],
          coordinates: [
            { refDes: 'C1', x: '10.5', y: '20.3', layer: 'TOP', rotation: '0' },
            { refDes: 'R1', x: '10.5', y: '25.5', layer: 'TOP', rotation: '90' }
          ]
        }
      };

      setProcessedResult(dummyResult);
      toast.success('BOM 분석 및 정리가 완료되었습니다.');
      setStep('preview');

    } catch (error: any) {
      console.error('Processing error:', error);
      toast.error(`처리 중 오류가 발생했습니다: ${error.message}`);
      setStep('input');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveBOM = async (items: BOMItem[]) => {
    if (!processedResult?.cadDrawingId) return;

    try {
      const { error: deleteError } = await supabase
        .from('bom_items')
        .delete()
        .eq('cad_drawing_id', processedResult.cadDrawingId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from('bom_items')
        .insert(
          items.map(item => ({
            cad_drawing_id: processedResult.cadDrawingId,
            line_number: item.lineNumber,
            item_type: item.itemType,
            item_name: item.itemName,
            specification: item.specification,
            set_count: item.setCount,
            total_quantity: item.totalQuantity,
            stock_quantity: item.stockQuantity,
            check_status: item.checkStatus,
            ref_list: item.refList,
            alternative_item: item.alternativeItem,
            remark: item.remark
          }))
        );

      if (insertError) throw insertError;
      
      setProcessedResult((prev: any) => ({
        ...prev,
        processedData: {
          ...prev.processedData,
          bomItems: items
        }
      }));

      toast.success('수정사항이 저장되었습니다.');

    } catch (error) {
      console.error('Save error:', error);
      toast.error('저장에 실패했습니다.');
    }
  };

  const handleReset = () => {
    setStep('input');
    setFileInfo({ bomFile: null, coordFile: null });
    setMetadata(prev => ({
      ...prev,
      boardName: '',
      productionManager: '',
      productionQuantity: 100
    }));
    setProcessedResult(null);
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <div>
          <h1 className="page-title">BOM/좌표 정리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>BOM & Coordinate Management</p>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      {step === 'input' && (
        <div className="space-y-4">
          {/* 파일 업로드 영역 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col lg:flex-row gap-6 items-stretch">
                {/* 왼쪽: 파일 업로드 (50%) */}
                <div className="w-full lg:w-[50%] grid grid-cols-2 gap-3">
                  {/* BOM 파일 업로드 */}
                  <div 
                    className={cn(
                      "border-2 border-dashed rounded-lg p-2 text-center transition-colors cursor-pointer relative flex flex-col items-center justify-center h-full",
                      dragActive === 'bom' ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300",
                      fileInfo.bomFile ? "bg-green-50 border-green-200" : ""
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
                    
                    {fileInfo.bomFile ? (
                      <div className="flex flex-col items-center gap-1 w-full px-1">
                        <span className="text-xs font-bold text-green-600">BOM</span>
                        <p className="text-[10px] font-medium text-green-700 w-full text-center break-all line-clamp-2" title={fileInfo.bomFile.name}>
                          {fileInfo.bomFile.name}
                        </p>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="absolute top-1 right-1 p-0 w-4 h-4 min-w-0"
                          onClick={(e) => { e.stopPropagation(); handleRemoveFile('bom'); }}
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-gray-400">BOM</span>
                        <p className="text-[10px] font-medium text-gray-700">파일 업로드</p>
                      </div>
                    )}
                  </div>

                  {/* 좌표 파일 업로드 */}
                  <div 
                    className={cn(
                      "border-2 border-dashed rounded-lg p-2 text-center transition-colors cursor-pointer relative flex flex-col items-center justify-center h-full",
                      dragActive === 'coord' ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300",
                      fileInfo.coordFile ? "bg-blue-50 border-blue-200" : ""
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
                    
                    {fileInfo.coordFile ? (
                      <div className="flex flex-col items-center gap-1 w-full px-1">
                        <span className="text-xs font-bold text-blue-600">좌표</span>
                        <p className="text-[10px] font-medium text-blue-700 w-full text-center break-all line-clamp-2" title={fileInfo.coordFile.name}>
                          {fileInfo.coordFile.name}
                        </p>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="absolute top-1 right-1 p-0 w-4 h-4 min-w-0"
                          onClick={(e) => { e.stopPropagation(); handleRemoveFile('coord'); }}
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-gray-400">좌표</span>
                        <p className="text-[10px] font-medium text-gray-700">파일 업로드</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 오른쪽: 정보 입력 (50%) */}
                <div className="w-full lg:w-[50%] space-y-1">
                  {/* 1. 보드 이름 (전체 폭) */}
                  <div className="space-y-1 mb-3.5">
                    <Label className="text-[10px] text-gray-500">보드 이름 (자동)</Label>
                    <Input
                      value={metadata.boardName || 'BOM 파일 업로드 시 자동'}
                      disabled
                      className="w-full bg-gray-50 border border-[#d2d2d7] rounded-md text-xs shadow-sm"
                      style={{ height: '32px' }}
                    />
                  </div>

                  {/* 2. Artwork 담당자, 생산 담당자, 생산 수량, 생성 버튼 (같은 행) */}
                  <div className="grid grid-cols-4 gap-2">
                    {/* Artwork 담당자 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Artwork 담당자</Label>
                      <Input
                        value={currentUser?.name || '로딩'}
                        disabled
                        className="w-full bg-gray-50 border border-[#d2d2d7] rounded-md text-xs shadow-sm"
                        style={{ height: '32px' }}
                      />
                    </div>

                    {/* 생산 담당자 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">생산 담당자</Label>
                      <Select 
                        value={metadata.productionManager} 
                        onValueChange={(value) => setMetadata(prev => ({ ...prev, productionManager: value }))}
                      >
                        <SelectTrigger 
                          className="w-full bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 px-2 flex items-center"
                          style={{ height: '32px', minHeight: '32px' }}
                        >
                          <SelectValue placeholder="선택" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="z-[9999]">
                          <SelectItem value="none">선택안함</SelectItem>
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 생산 수량 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">생산 수량</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min="1"
                          value={metadata.productionQuantity}
                          onChange={(e) => setMetadata(prev => ({ ...prev, productionQuantity: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 pr-8"
                          style={{ height: '32px' }}
                          placeholder="수량"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium pointer-events-none">SET</span>
                      </div>
                    </div>

                    {/* 생성 버튼 */}
                    <div className="flex items-end">
                      <Button 
                        onClick={handleProcess}
                        disabled={!fileInfo.bomFile || !fileInfo.coordFile || !metadata.boardName || uploading}
                        className="w-full bg-hansl-600 hover:bg-hansl-700 text-white shadow-sm text-xs"
                        style={{ height: '32px' }}
                      >
                        BOM 생성
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 안내 메시지 */}
          {!fileInfo.bomFile && !fileInfo.coordFile && (
            <div className="text-center py-8 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">BOM 파일과 좌표 파일을 업로드하여 시작하세요</p>
            </div>
          )}
        </div>
      )}

      {/* 처리 중 */}
      {step === 'processing' && (
        <Card>
          <CardContent className="py-20">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-10 h-10 text-hansl-600 animate-spin mb-4" />
              <h3 className="header-title">AI가 BOM을 분석하고 있습니다</h3>
              <p className="page-subtitle mt-2">잠시만 기다려주세요... (약 30초 ~ 1분 소요)</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 결과 미리보기 */}
      {step === 'preview' && processedResult && (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="header-title text-green-900">분석 완료</h3>
                    <p className="page-subtitle text-green-700">
                      보드명: {metadata.boardName} / 생산수량: {metadata.productionQuantity} SET
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleReset} 
                  className="button-base border border-green-200 bg-white text-green-700 hover:bg-green-100"
                >
                  처음부터 다시 하기
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <GeneratedPreviewPanel 
                bomItems={processedResult.processedData?.bomItems || []}
                coordinates={processedResult.processedData?.coordinates || []}
                boardName={metadata.boardName || 'Board'}
                onSave={handleSaveBOM}
              />
            </div>

            <div className="lg:col-span-1">
              <CoordinatePreviewPanel 
                coordinates={processedResult.processedData?.coordinates || []}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}