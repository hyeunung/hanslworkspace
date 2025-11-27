import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Package, Upload, FileText, X, AlertCircle, Loader2, Download, Eye, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import GeneratedPreviewPanel from './GeneratedPreviewPanel';
import CoordinatePreviewPanel from './CoordinatePreviewPanel';
import { BOMItem, CoordinateItem, generateCleanedBOMExcel } from '@/utils/excel-generator';

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
  const [viewMode, setViewMode] = useState<'list' | 'create'>('create');
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
  const [savedBoards, setSavedBoards] = useState<Array<{
    id: string;
    board_name: string;
    created_at: string;
    item_count?: number;
  }>>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [selectedBoardForView, setSelectedBoardForView] = useState<string | null>(null);
  const [uploadedFilePaths, setUploadedFilePaths] = useState<{ bomPath: string; coordPath: string } | null>(null);

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

  // 저장된 보드 목록 로드
  useEffect(() => {
    const loadSavedBoards = async () => {
      if (viewMode !== 'list') return;
      
      try {
        setLoadingBoards(true);
        const { data: boards, error } = await supabase
          .from('cad_drawings')
          .select('id, board_name, created_at')
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // 각 보드의 아이템 개수 가져오기
        const boardsWithCount = await Promise.all(
          (boards || []).map(async (board) => {
            const { count } = await supabase
              .from('bom_items')
              .select('*', { count: 'exact', head: true })
              .eq('cad_drawing_id', board.id);
            
            return {
              ...board,
              item_count: count || 0
            };
          })
        );
        
        setSavedBoards(boardsWithCount);
      } catch (error) {
        console.error('Error loading saved boards:', error);
        toast.error('저장된 BOM 목록을 불러오는데 실패했습니다.');
      } finally {
        setLoadingBoards(false);
      }
    };

    loadSavedBoards();
  }, [viewMode, supabase]);

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

      // 업로드된 파일 경로 저장 (나중에 DB에 저장할 때 사용)
      setUploadedFilePaths({ bomPath, coordPath });

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      // 1. cad_drawings 테이블에 보드 정보 저장/업데이트
      let cadDrawingId = processedResult.cadDrawingId;
      
      // cadDrawingId가 임시 ID인 경우 (새로 생성)
      if (cadDrawingId.startsWith('cad_')) {
        const { data: existingBoard, error: checkError } = await supabase
          .from('cad_drawings')
          .select('id')
          .eq('board_name', metadata.boardName)
          .single();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        if (existingBoard) {
          cadDrawingId = existingBoard.id;
        } else {
          const { data: newBoard, error: boardError } = await supabase
            .from('cad_drawings')
            .insert({ board_name: metadata.boardName })
            .select('id')
            .single();

          if (boardError) throw boardError;
          cadDrawingId = newBoard.id;
        }
      }

      // 2. 원본 파일 정보 저장 (bom_raw_files)
      if (fileInfo.bomFile && fileInfo.coordFile && uploadedFilePaths) {
        let bomFileUrl = '';
        let coordFileUrl = '';

        // Storage에서 Signed URL 생성 (1년 유효)
        const { data: bomUrlData } = await supabase.storage
          .from('bom-files')
          .createSignedUrl(uploadedFilePaths.bomPath, 60 * 60 * 24 * 365);

        const { data: coordUrlData } = await supabase.storage
          .from('bom-files')
          .createSignedUrl(uploadedFilePaths.coordPath, 60 * 60 * 24 * 365);

        if (bomUrlData?.signedUrl) bomFileUrl = bomUrlData.signedUrl;
        if (coordUrlData?.signedUrl) coordFileUrl = coordUrlData.signedUrl;

        // bom_raw_files에 저장 (기존 데이터가 있으면 업데이트, 없으면 삽입)
        const { data: existingRawFile } = await supabase
          .from('bom_raw_files')
          .select('id')
          .eq('cad_drawing_id', cadDrawingId)
          .single();

        if (existingRawFile) {
          const { error: updateRawError } = await supabase
            .from('bom_raw_files')
            .update({
              bom_file_url: bomFileUrl,
              coordinate_file_url: coordFileUrl,
              bom_file_name: fileInfo.bomFile.name,
              coordinate_file_name: fileInfo.coordFile.name,
              uploaded_by: user.email || user.id
            })
            .eq('id', existingRawFile.id);

          if (updateRawError) throw updateRawError;
        } else {
          const { error: insertRawError } = await supabase
            .from('bom_raw_files')
            .insert({
              cad_drawing_id: cadDrawingId,
              bom_file_url: bomFileUrl,
              coordinate_file_url: coordFileUrl,
              bom_file_name: fileInfo.bomFile.name,
              coordinate_file_name: fileInfo.coordFile.name,
              uploaded_by: user.email || user.id
            });

          if (insertRawError) throw insertRawError;
        }
      }

      // 3. 기존 bom_items 삭제 후 새로 저장
      const { error: deleteError } = await supabase
        .from('bom_items')
        .delete()
        .eq('cad_drawing_id', cadDrawingId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from('bom_items')
        .insert(
          items.map(item => ({
            cad_drawing_id: cadDrawingId,
            line_number: item.lineNumber,
            item_type: item.itemType,
            item_name: item.itemName,
            specification: item.specification,
            set_count: item.setCount,
            total_quantity: item.totalQuantity,
            stock_quantity: item.stockQuantity,
            check_status: item.checkStatus,
            ref_list: Array.isArray(item.refList) ? item.refList : (item.refList ? item.refList.split(',') : []),
            alternative_item: item.alternativeItem,
            remark: item.remark
          }))
        );

      if (insertError) throw insertError;

      // 4. 좌표 데이터도 저장 (part_placements)
      if (processedResult.processedData?.coordinates) {
        const { error: deleteCoordError } = await supabase
          .from('part_placements')
          .delete()
          .eq('cad_drawing_id', cadDrawingId);

        if (deleteCoordError) throw deleteCoordError;

        const { error: insertCoordError } = await supabase
          .from('part_placements')
          .insert(
            processedResult.processedData.coordinates.map((coord: CoordinateItem) => ({
              cad_drawing_id: cadDrawingId,
              ref: coord.ref,
              part_name: coord.partName,
              part_type: coord.partType,
              side: coord.side,
              x_coordinate: parseFloat(coord.x) || 0,
              y_coordinate: parseFloat(coord.y) || 0,
              angle: coord.angle ? parseFloat(coord.angle) : null
            }))
          );

        if (insertCoordError) throw insertCoordError;
      }
      
      // cadDrawingId 업데이트
      setProcessedResult((prev: any) => ({
        ...prev,
        cadDrawingId: cadDrawingId,
        processedData: {
          ...prev.processedData,
          bomItems: items
        }
      }));

      toast.success('수정사항이 저장되었습니다.');
      
      // 목록 뷰로 전환하여 새로 저장된 항목 확인 가능
      setTimeout(() => {
        setViewMode('list');
      }, 1000);

    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(`저장에 실패했습니다: ${error.message}`);
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
    setUploadedFilePaths(null);
  };

  // 저장된 BOM 다운로드
  const handleDownloadSavedBOM = async (boardId: string, boardName: string) => {
    try {
      // BOM 아이템 가져오기
      const { data: bomItems, error: bomError } = await supabase
        .from('bom_items')
        .select('*')
        .eq('cad_drawing_id', boardId)
        .order('line_number');
      
      if (bomError) throw bomError;

      // 좌표 데이터 가져오기
      const { data: coordinates, error: coordError } = await supabase
        .from('part_placements')
        .select('*')
        .eq('cad_drawing_id', boardId);
      
      if (coordError) throw coordError;

      // BOMItem 형식으로 변환
      const convertedBOMItems: BOMItem[] = (bomItems || []).map(item => ({
        lineNumber: item.line_number,
        itemType: item.item_type || '',
        itemName: item.item_name,
        specification: item.specification || '',
        setCount: item.set_count,
        totalQuantity: item.total_quantity || 0,
        stockQuantity: item.stock_quantity || 0,
        checkStatus: item.check_status || '□양호',
        refList: Array.isArray(item.ref_list) ? item.ref_list.join(',') : (item.ref_list || ''),
        alternativeItem: item.alternative_item || '',
        remark: item.remark || ''
      }));

      // CoordinateItem 형식으로 변환
      const convertedCoords: CoordinateItem[] = (coordinates || []).map(coord => ({
        ref: coord.ref,
        partName: coord.part_name,
        partType: coord.part_type || 'SMD',
        side: coord.side,
        x: coord.x_coordinate.toString(),
        y: coord.y_coordinate.toString(),
        angle: coord.angle?.toString() || '0'
      }));

      // Excel 생성 및 다운로드
      const blob = await generateCleanedBOMExcel(convertedBOMItems, convertedCoords, boardName);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${boardName}_BOM_정리.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch (error: any) {
      console.error('Download error:', error);
      toast.error(`다운로드 중 오류가 발생했습니다: ${error.message}`);
    }
  };

  // 저장된 BOM 상세 보기
  const handleViewSavedBOM = async (boardId: string) => {
    try {
      // BOM 아이템 가져오기
      const { data: bomItems, error: bomError } = await supabase
        .from('bom_items')
        .select('*')
        .eq('cad_drawing_id', boardId)
        .order('line_number');
      
      if (bomError) throw bomError;

      // 좌표 데이터 가져오기
      const { data: coordinates, error: coordError } = await supabase
        .from('part_placements')
        .select('*')
        .eq('cad_drawing_id', boardId);
      
      if (coordError) throw coordError;

      // 보드 정보 가져오기
      const { data: boardData } = await supabase
        .from('cad_drawings')
        .select('board_name')
        .eq('id', boardId)
        .single();

      // BOMItem 형식으로 변환
      const convertedBOMItems: BOMItem[] = (bomItems || []).map(item => ({
        lineNumber: item.line_number,
        itemType: item.item_type || '',
        itemName: item.item_name,
        specification: item.specification || '',
        setCount: item.set_count,
        totalQuantity: item.total_quantity || 0,
        stockQuantity: item.stock_quantity || 0,
        checkStatus: item.check_status || '□양호',
        refList: Array.isArray(item.ref_list) ? item.ref_list.join(',') : (item.ref_list || ''),
        alternativeItem: item.alternative_item || '',
        remark: item.remark || ''
      }));

      // CoordinateItem 형식으로 변환
      const convertedCoords: CoordinateItem[] = (coordinates || []).map(coord => ({
        ref: coord.ref,
        partName: coord.part_name,
        partType: coord.part_type || 'SMD',
        side: coord.side,
        x: coord.x_coordinate.toString(),
        y: coord.y_coordinate.toString(),
        angle: coord.angle?.toString() || '0'
      }));

      setProcessedResult({
        cadDrawingId: boardId,
        processedData: {
          bomItems: convertedBOMItems,
          coordinates: convertedCoords
        }
      });

      setMetadata(prev => ({
        ...prev,
        boardName: boardData?.board_name || ''
      }));

      setSelectedBoardForView(boardId);
      setViewMode('create');
      setStep('preview');
      
      toast.success('저장된 BOM을 불러왔습니다.');
    } catch (error: any) {
      console.error('View error:', error);
      toast.error(`BOM을 불러오는데 실패했습니다: ${error.message}`);
    }
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <div>
          <h1 className="page-title">BOM/좌표 정리</h1>
          <div className="flex justify-between items-center" style={{marginTop:'-2px',marginBottom:'-4px'}}>
            <p className="page-subtitle mb-0">BOM & Coordinate Management</p>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setViewMode('create');
                  setStep('input');
                  setSelectedBoardForView(null);
                  handleReset();
                }}
                className={`button-base ${
                  viewMode === 'create' 
                    ? 'bg-hansl-600 hover:bg-hansl-700 text-white' 
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Plus className="w-4 h-4 mr-2" />
                새로 만들기
              </Button>
              <Button
                onClick={() => {
                  setViewMode('list');
                  setStep('input');
                  setSelectedBoardForView(null);
                }}
                className={`button-base ${
                  viewMode === 'list' 
                    ? 'bg-hansl-600 hover:bg-hansl-700 text-white' 
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Eye className="w-4 h-4 mr-2" />
                저장된 목록
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 저장된 BOM 목록 */}
      {viewMode === 'list' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              {loadingBoards ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-hansl-600 animate-spin mr-2" />
                  <span className="text-sm text-gray-600">목록을 불러오는 중...</span>
                </div>
              ) : savedBoards.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm text-gray-500 mb-4">저장된 BOM이 없습니다.</p>
                  <Button
                    onClick={() => setViewMode('create')}
                    className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    새 BOM 만들기
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base sm:text-lg font-semibold">저장된 BOM 목록</h3>
                    <span className="text-xs sm:text-sm text-gray-500">총 {savedBoards.length}개</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {savedBoards.map((board) => (
                      <Card key={board.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-sm sm:text-base truncate" title={board.board_name}>
                                {board.board_name}
                              </h4>
                              <p className="text-xs text-gray-500 mt-1">
                                {new Date(board.created_at).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit'
                                })}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] sm:text-xs ml-2 flex-shrink-0">
                              {board.item_count || 0}개
                            </Badge>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleViewSavedBOM(board.id)}
                              variant="outline"
                              size="sm"
                              className="flex-1 text-xs"
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              보기
                            </Button>
                            <Button
                              onClick={() => handleDownloadSavedBOM(board.id, board.board_name)}
                              variant="outline"
                              size="sm"
                              className="flex-1 text-xs"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              다운로드
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 새로 만들기 / 미리보기 */}
      {viewMode === 'create' && (
        <>
      {/* 메인 컨텐츠 */}
      {step === 'input' && (
        <div className="space-y-4">
          {/* 파일 업로드 영역 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-stretch">
                {/* 왼쪽: 파일 업로드 (50%) */}
                <div className="w-full lg:w-[50%] grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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
            <div className="text-center py-6 sm:py-8 text-gray-500">
              <Package className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-xs sm:text-sm px-4">BOM 파일과 좌표 파일을 업로드하여 시작하세요</p>
            </div>
          )}
        </div>
      )}

      {/* 처리 중 */}
      {step === 'processing' && (
        <Card>
          <CardContent className="py-12 sm:py-16 lg:py-20">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-hansl-600 animate-spin mb-4" />
              <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-center">AI가 BOM을 분석하고 있습니다</h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-2 text-center px-4">잠시만 기다려주세요... (약 30초 ~ 1분 소요)</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 결과 미리보기 */}
      {step === 'preview' && processedResult && (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-green-900">분석 완료</h3>
                    <p className="text-xs sm:text-sm text-green-700 mt-0.5">
                      보드명: {metadata.boardName} / 생산수량: {metadata.productionQuantity} SET
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleReset} 
                  className="w-full sm:w-auto button-base border border-green-200 bg-white text-green-700 hover:bg-green-100 text-xs sm:text-sm"
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
        </>
      )}
    </div>
  );
}