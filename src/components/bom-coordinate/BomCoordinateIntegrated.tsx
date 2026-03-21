import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { Package, Upload, FileText, X, AlertCircle, Loader2, Download, Eye, Plus, Check, ChevronsUpDown, RotateCcw, Save, Link2, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import GeneratedPreviewPanel, { type GeneratedPreviewPanelRef } from './GeneratedPreviewPanel';
import CoordinatePreviewPanel from './CoordinatePreviewPanel';
import BomDetailModal from './BomDetailModal';
import { 
  processBOMAndCoordinates, 
  type BOMItem, 
  type CoordinateItem,
  type ProcessedResult,
  sortBOMItems,
  sortCoordinateItems
} from '@/utils/v7-generator';
import { 
  generateBOMExcelFromTemplate, 
  downloadExcelBlob,
  type ExcelMetadata 
} from '@/utils/excel-generator';

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

interface ProcessedResultState {
  id?: string;
  cadDrawingId?: string;
  isEditMode?: boolean;
  processedData: {
    bomItems: BOMItem[];
    topCoordinates: CoordinateItem[];
    bottomCoordinates: CoordinateItem[];
    coordinates: CoordinateItem[];
    coordinatesProvided?: boolean;
    summary: ProcessedResult['summary'];
  };
  status?: string;
  production_manager?: string;
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
    productionQuantity: 0
  });
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openArtworkManager, setOpenArtworkManager] = useState(false);
  const [openProductionManager, setOpenProductionManager] = useState(false);
  const [processedResult, setProcessedResult] = useState<ProcessedResultState | null>(null);
  const [dragActive, setDragActive] = useState<string | null>(null);
  const [savedBoards, setSavedBoards] = useState<Array<{
    id: string;
    board_name: string;
    created_at: string;
    artwork_manager?: string;
    production_manager?: string;
    status?: 'pending' | 'completed';
  }>>([]);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null); // pending 상태 편집 중인 보드 ID
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [uploadedFilePaths, setUploadedFilePaths] = useState<{ bomPath: string; coordPath?: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('');
  const [isMerged, setIsMerged] = useState(false);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [detailModalBoardId, setDetailModalBoardId] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [skipTempDataLoad, setSkipTempDataLoad] = useState(false);

  // REF 불일치 수 계산 (BOM vs 좌표)
  const { mismatchCount, missingInCoord, missingInBom } = useMemo(() => {
    const bomItems = processedResult?.processedData?.bomItems ?? [];
    const coords = processedResult?.processedData?.coordinates ?? [];
    const coordinatesProvided = processedResult?.processedData?.coordinatesProvided !== false;

    // 좌표 파일이 제공되지 않은 경우엔 불일치 계산을 하지 않음 (BOM-only 지원)
    if (!coordinatesProvided) {
      return { mismatchCount: 0, missingInCoord: 0, missingInBom: 0 };
    }

    const bomRefs = new Set<string>();
    bomItems.forEach((item: BOMItem) => {
      const refs = (item.refList || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
      refs.forEach(ref => bomRefs.add(ref));
    });

    const coordRefs = new Set<string>();
    coords.forEach((coord: CoordinateItem) => {
      // refDes 또는 ref 필드 모두 확인
      const ref = coord?.refDes || (coord as CoordinateItem & { ref?: string })?.ref;
      if (ref) coordRefs.add(ref.trim().toUpperCase());
    });

    let missingInCoord = 0;
    bomRefs.forEach(ref => {
      if (!coordRefs.has(ref)) missingInCoord += 1;
    });

    let missingInBom = 0;
    coordRefs.forEach(ref => {
      if (!bomRefs.has(ref)) missingInBom += 1;
    });

    return {
      mismatchCount: missingInCoord + missingInBom,
      missingInCoord,
      missingInBom
    };
  }, [processedResult?.processedData?.bomItems, processedResult?.processedData?.coordinates]);

  // 합칠 수 있는 동일 항목이 있는지 체크
  const hasMergeableItems = (() => {
    const bomItems = processedResult?.processedData?.bomItems || [];
    if (bomItems.length === 0) return false;
    
    const grouped = new Map<string, number>();
    bomItems.forEach((item: BOMItem) => {
      if (item.itemName?.includes('데이터 없음') || item.itemType === '데이터 없음') return;
      const key = `${item.itemType}|${item.itemName}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    
    return Array.from(grouped.values()).some(count => count > 1);
  })();

  const supabase = createClient();
  const previewPanelRef = useRef<GeneratedPreviewPanelRef>(null);
  const { currentUserRoles } = useAuth();
  
  // 관리자 권한 확인
  const isAdmin = currentUserRoles.includes('app_admin');

  const normalizeName = (name?: string | null) => (name || '').trim();

  // 삭제 권한: 관리자 또는 최종점검(완료) 처리자
  // 주의: production_manager가 과거 데이터에서 "이름"이 아니라 "직원ID"로 저장된 케이스가 있을 수 있어 둘 다 허용
  const canDeleteBoard = useCallback((board: { status?: 'pending' | 'completed'; production_manager?: string }) => {
    if (isAdmin) return true;
    if (board.status !== 'completed') return false;

    const inspectorRaw = normalizeName(board.production_manager);
    const myName = normalizeName(currentUser?.name);
    const myId = normalizeName((currentUser as { email: string; name: string; id?: string } | null)?.id);

    if (!inspectorRaw) return false;

    // 1) DB에 이름이 저장된 경우
    if (myName && inspectorRaw === myName) return true;
    // 2) DB에 사용자/직원 ID가 저장된 경우
    if (myId && inspectorRaw === myId) return true;
    // 3) inspector가 직원ID인데 내 이름과 매칭되어야 하는 경우 (employees로 역매핑)
    if (myName && employees?.length) {
      const inspectorNameById = employees.find(emp => normalizeName(emp.id) === inspectorRaw)?.name;
      if (normalizeName(inspectorNameById) && normalizeName(inspectorNameById) === myName) return true;
    }

    return false;
  }, [isAdmin, currentUser, employees]);
  
  // localStorage 키 생성 (사용자별 분리)
  const getTempStorageKey = (userId: string) => `bom_temp_data_${userId}`;
  
  // 임시 데이터 저장
  const saveTempData = (userId: string) => {
    if (!processedResult || !userId) return;
    
    try {
      const tempData = {
        step,
        metadata,
        processedResult,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(getTempStorageKey(userId), JSON.stringify(tempData));
      logger.debug('✅ 임시 데이터 저장됨');
    } catch (error) {
      logger.error('임시 데이터 저장 실패:', error);
    }
  };
  
  // 임시 데이터 불러오기
  const loadTempData = async (userId: string, skipIfEmpty = false) => {
    try {
      // skipTempDataLoad 플래그가 설정되어 있으면 복원하지 않음
      if (skipTempDataLoad) {
        logger.debug('⏭️ 새로 만들기로 인해 임시 데이터 복원 건너뜀');
        return;
      }
      
      const saved = localStorage.getItem(getTempStorageKey(userId));
      if (!saved) return;
      
      const tempData = JSON.parse(saved);
      
      // skipIfEmpty가 true이고 현재 상태가 비어있지 않으면 복원하지 않음
      if (skipIfEmpty) {
        const hasData = processedResult || 
                       (metadata.boardName || metadata.productionManager || metadata.productionQuantity > 0) ||
                       fileInfo.bomFile || fileInfo.coordFile;
        if (hasData) {
          logger.debug('⏭️ 현재 데이터가 있어 임시 데이터 복원 건너뜀');
          return;
        }
      }
      
      // 24시간 이상 된 데이터는 삭제
      const savedAt = new Date(tempData.savedAt);
      const now = new Date();
      const hoursDiff = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff > 24) {
        localStorage.removeItem(getTempStorageKey(userId));
        logger.debug('⏰ 24시간 지난 임시 데이터 삭제됨');
        return;
      }
      
      // 데이터 복원 (좌표 데이터의 refDes가 비어있으면 ref 필드 사용)
      let restoredResult = tempData.processedResult;
      if (restoredResult?.processedData?.coordinates) {
        restoredResult = {
          ...restoredResult,
          processedData: {
            ...restoredResult.processedData,
            coordinates: restoredResult.processedData.coordinates.map((coord: CoordinateItem & { ref?: string }) => ({
              ...coord,
              refDes: coord.refDes || coord.ref || ''
            }))
          }
        };
      }
      
      setStep(tempData.step);
      setMetadata(tempData.metadata);
      setProcessedResult(restoredResult);
      setViewMode('create');
      logger.debug('✅ 임시 데이터 복원됨');
    } catch (error) {
      logger.error('임시 데이터 불러오기 실패:', error);
    }
  };
  
  // 임시 데이터 삭제
  const clearTempData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        localStorage.removeItem(getTempStorageKey(user.id));
        logger.debug('🗑️ 임시 데이터 삭제됨');
      }
    } catch (error) {
      logger.error('임시 데이터 삭제 실패:', error);
    }
  };

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
            .select('id, name')
            .eq('email', user.email)
            .single();
          
          setCurrentUser({
            email: user.email,
            name: userData?.name || user.email.split('@')[0]
          });
          
          // Artwork 담당자 초기값을 현재 사용자 ID로 설정 (metadata가 비어있을 때만)
          setMetadata(prev => {
            if (!prev.boardName && !prev.productionManager && prev.productionQuantity === 0 && !skipTempDataLoad) {
              return {
            ...prev,
                artworkManager: userData?.id || ''
              };
            }
            return prev;
          });
          
          // 임시 저장 데이터 복원 (초기 로드 시에만, 현재 데이터가 없을 때만, skipTempDataLoad가 false일 때만)
          if (!skipTempDataLoad) {
            loadTempData(user.id, true);
          }
        }
      } catch (error) {
        logger.error('Error loading data:', error);
      }
    };

    loadData();
  }, [supabase]);

  // processedResult 변경 시 임시 저장
  useEffect(() => {
    const saveTemp = async () => {
      if (!processedResult || step !== 'preview') return;
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        saveTempData(user.id);
      }
    };
    
    saveTemp();
  }, [processedResult, metadata, step]);

  // 저장된 보드 목록 로드
  useEffect(() => {
    const loadSavedBoards = async () => {
      if (viewMode !== 'list') return;
      
      try {
        setLoadingBoards(true);
        const { data: boards, error } = await supabase
          .from('cad_drawings')
          .select('id, board_name, created_at, artwork_manager, production_manager, status')
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        setSavedBoards(boards || []);
      } catch (error) {
        logger.error('Error loading saved boards:', error);
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
      let name = fileInfo.bomFile.name;
      // 확장자 제거
      name = name.replace(/\.(xlsx|xls|csv)$/i, '');
      // .part.BOM, .BOM, _BOM, part.BOM 등 불필요한 접미사 제거 (대소문자 무관)
      name = name.replace(/(\.|_|\s)?(part)?(\.|_|\s)?bom$/i, '');
      // 앞부분의 타임스탬프나 불필요한 접두사 제거
      name = name.replace(/^\d+_bom_/, '');
      
      // 날짜 포맷 (YYMMDD) 및 _정리본 추가
      const today = new Date();
      const dateStr = today.getFullYear().toString().slice(2) + 
        (today.getMonth() + 1).toString().padStart(2, '0') + 
        today.getDate().toString().padStart(2, '0');
      
      name = `${name}_${dateStr}_정리본`;

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
    if (!fileInfo.bomFile) {
      toast.error('BOM 파일을 선택해주세요.');
      return;
    }

    if (!metadata.boardName.trim()) {
      toast.error('보드 이름을 입력해주세요.');
      return;
    }

    if (metadata.productionQuantity <= 0) {
      toast.error('생산 수량을 입력해주세요 (1 이상).');
      return;
    }

    const coordinatesProvided = Boolean(fileInfo.coordFile);
    let timer: NodeJS.Timeout | null = null;
    let textTimer: NodeJS.Timeout | null = null;

    try {
      setUploading(true);
      setStep('processing');
      setErrorMessage(null);
      setProgress(0);
      setLoadingText('파일 업로드 준비 중...');

      // 예상 소요 시간 계산
      const totalSize = (fileInfo.bomFile?.size || 0) + (fileInfo.coordFile?.size || 0);
      const estimatedDuration = 15000 + (totalSize / 1024) * 50; 
      
      const updateInterval = 500;
      const totalSteps = estimatedDuration / updateInterval;
      const incrementPerStep = 90 / totalSteps;

      // 진행률 애니메이션 시작
      timer = setInterval(() => {
        setProgress((oldProgress) => {
          if (oldProgress >= 95) {
            return oldProgress;
          }
          const randomFactor = Math.random() * 0.5 + 0.8;
          return Math.min(oldProgress + (incrementPerStep * randomFactor), 95);
        });
      }, updateInterval);

      // 텍스트 변경 타이머
      textTimer = setInterval(() => {
        setLoadingText((current) => {
          if (current === '파일 업로드 준비 중...') return 'BOM 파일 읽는 중...';
          if (current === 'BOM 파일 읽는 중...') return '데이터 구조 분석 중...';
          if (current === '데이터 구조 분석 중...') return coordinatesProvided ? '좌표 데이터 매칭 중...' : 'BOM 정리 중...';
          if (current === '좌표 데이터 매칭 중...') return 'AI가 최종 정리 중입니다...';
          if (current === 'AI가 최종 정리 중입니다...') return '거의 다 되었습니다. 잠시만요!';
          return current;
        });
      }, estimatedDuration / 5);

      // 1. 파일 업로드 (Storage) - 로직 유지
      // ... (파일 업로드 코드는 그대로 둠) ...
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
      const bomPath = `raw/${timestamp}_bom_${safeBomFileName}`;

      // 파일 업로드
      const bomResult = await supabase.storage
        .from('bom-files')
        .upload(bomPath, fileInfo.bomFile, { cacheControl: '3600', upsert: true });

      if (bomResult.error) throw bomResult.error;

      let coordPath: string | undefined;
      if (fileInfo.coordFile) {
        const safeCoordFileName = sanitizeFileName(fileInfo.coordFile.name);
        coordPath = `raw/${timestamp}_coord_${safeCoordFileName}`;

        const coordResult = await supabase.storage
          .from('bom-files')
          .upload(coordPath, fileInfo.coordFile, { cacheControl: '3600', upsert: true });

        if (coordResult.error) {
          await supabase.storage.from('bom-files').remove([bomPath]);
          throw coordResult.error;
        }
      }

      // Signed URL 생성
      const { data: bomUrlData } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(bomPath, 60 * 60);

      const coordUrlData = coordPath
        ? (await supabase.storage.from('bom-files').createSignedUrl(coordPath, 60 * 60)).data
        : undefined;

      if (!bomUrlData?.signedUrl || (coordPath && !coordUrlData?.signedUrl)) {
        throw new Error('파일 URL 생성 실패');
      }

      // 업로드된 파일 경로 저장 (나중에 DB에 저장할 때 사용)
      setUploadedFilePaths({ bomPath, ...(coordPath ? { coordPath } : {}) });

      // 2. v7 엔진으로 BOM/좌표 처리 (학습 데이터 기반)
      logger.debug('Processing BOM with v7 engine...');
      setLoadingText('학습 데이터 기반 분석 중...');
      
      // v7-generator로 처리
      const processedData = await processBOMAndCoordinates(
        fileInfo.bomFile,
        fileInfo.coordFile,
        metadata.productionQuantity
      );

      if (timer) clearInterval(timer);
      if (textTimer) clearInterval(textTimer);
      setProgress(100);
      setLoadingText('완료!');

      if (!processedData || !processedData.bomItems) {
        throw new Error('BOM 처리 결과가 올바르지 않습니다.');
      }

      // 3. 결과 데이터 구조화 (임시 ID 부여)
      const resultWithId = {
        cadDrawingId: `cad_${Date.now()}`,
        processedData: {
          bomItems: processedData.bomItems,
          topCoordinates: processedData.topCoordinates,
          bottomCoordinates: processedData.bottomCoordinates,
          coordinates: [...processedData.topCoordinates, ...processedData.bottomCoordinates],
          coordinatesProvided,
          summary: processedData.summary
        }
      };

      setProcessedResult(resultWithId);
      
      // 100% 완료 표시를 사용자가 볼 수 있도록 약간의 지연 후 화면 전환
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast.success('BOM 분석 및 정리가 완료되었습니다.');
      setStep('preview');

    } catch (error: unknown) {
      logger.error('Processing error:', error);
      const msg = `처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`;
      setErrorMessage(msg);
      
      if (timer) clearInterval(timer);
      if (textTimer) clearInterval(textTimer);
      
      setUploading(false);
      setStep('input'); 
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      // 성공 시에는 위에서 clearInterval 등을 처리했음
      // 실패 시에만 여기가 실행될 수 있는데, 중복 실행 방지
      if (step === 'processing' && errorMessage) {
         setUploading(false);
      }
    }
  };

  const handleSaveBOM = async (items: BOMItem[]) => {
    if (!processedResult?.cadDrawingId) return;
    if (isSaving) return;

    setIsSaving(true);

    // processedResult.isEditMode를 사용 (stale closure 문제 방지)
    const isEditMode = processedResult.isEditMode === true;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      // 1. cad_drawings 테이블에 보드 정보 저장/업데이트
      let cadDrawingId = processedResult.cadDrawingId;
      
      // 담당자 이름 가져오기 (ID로 저장되어 있으므로 employees에서 이름 찾기)
      const artworkManagerName = employees.find(emp => emp.id === metadata.artworkManager)?.name || currentUser?.name || '';
      const productionManagerName = employees.find(emp => emp.id === metadata.productionManager)?.name || metadata.productionManager;
      
      // 상태값 결정 (isEditMode면 최종 저장, 아니면 검토 요청)
      const saveStatus = isEditMode ? 'completed' : 'pending';
      // 최종 저장 시에만 현재 사용자를 생산담당자로 설정
      const finalProductionManager = isEditMode ? currentUser?.name : null;

      // 기존 보드 업데이트 (isEditMode = pending에서 불러와서 최종 저장)
      if (isEditMode) {
        // cadDrawingId는 이미 processedResult.cadDrawingId에서 가져옴 (boardId)
        const { data: updatedRows, error: updateError } = await supabase
          .from('cad_drawings')
          .update({ 
            artwork_manager: artworkManagerName,
            production_manager: finalProductionManager,
            production_quantity: metadata.productionQuantity,
            status: saveStatus
          })
          .eq('id', cadDrawingId)
          .select('id, status, production_manager');

        if (updateError) {
          logger.error('❌ 상태 업데이트 실패:', updateError);
          throw updateError;
        }
        // RLS로 UPDATE가 막히면 error 없이 0행 업데이트가 나올 수 있음 (이 경우가 현재 현상과 일치)
        if (!updatedRows || updatedRows.length === 0) {
          logger.error('❌ cad_drawings UPDATE가 0행 적용됨 (RLS 정책으로 차단 가능성 큼)', { cadDrawingId, saveStatus });
          toast.error('상태 업데이트가 차단되었습니다(RLS). 관리자에게 cad_drawings UPDATE 정책 추가가 필요합니다.');
          throw new Error('cad_drawings update blocked (0 rows updated)');
        }
      } else if (cadDrawingId.startsWith('cad_')) {
        // cadDrawingId가 임시 ID인 경우 (새로 생성) - 검토 요청
        // 보드명에서 기존 날짜/정리본 패턴 제거 후 새 날짜 추가
        const today = new Date();
        const dateStr = today.getFullYear().toString().slice(2) + 
          String(today.getMonth() + 1).padStart(2, '0') + 
          String(today.getDate()).padStart(2, '0');
        
        // 기존 패턴 제거 후 새 날짜 추가
        const cleanBoardName = metadata.boardName.trim()
          .replace(/_\d{6}_정리본$/, '')
          .replace(/_정리본$/, '')
          .replace(/_\d{6}$/, '');
        const saveBoardName = `${cleanBoardName}_${dateStr}_정리본`;

        logger.debug('📝 검토 요청 모드: 새 보드 생성', { saveBoardName, saveStatus });
        // 항상 새로 생성 (날짜로 구분되므로)
          const { data: newBoard, error: boardError } = await supabase
            .from('cad_drawings')
          .insert({ 
            board_name: saveBoardName,
            artwork_manager: artworkManagerName,
            production_manager: finalProductionManager,
            production_quantity: metadata.productionQuantity,
            status: saveStatus
          })
            .select('id')
            .single();

          if (boardError) throw boardError;
          cadDrawingId = newBoard.id;
        const { data: afterInsertRow, error: afterInsertReadError } = await supabase
          .from('cad_drawings')
          .select('id, status, production_manager, created_at')
          .eq('id', cadDrawingId)
          .single();
        logger.debug('🔎 after insert readback (cad_drawings)', { afterInsertRow, afterInsertReadError });
      } else if (!processedResult.cadDrawingId.startsWith('cad_')) {
        // 담당자 정보 업데이트 (기존 보드인 경우에만)
        const { error: updateExistingError } = await supabase
          .from('cad_drawings')
          .update({ 
            artwork_manager: artworkManagerName,
            production_manager: finalProductionManager,
            production_quantity: metadata.productionQuantity,
            status: saveStatus
          })
          .eq('id', cadDrawingId);
        if (updateExistingError) throw updateExistingError;
      }

      // 2. 원본 파일 정보 저장 (bom_raw_files)
      // NOTE: bom_raw_files 스키마가 coordinate_file_* NOT NULL이라
      // 좌표 파일 미업로드(BOM-only) 케이스에선 raw file 저장을 건너뜀.
      if (fileInfo.bomFile && fileInfo.coordFile && uploadedFilePaths?.bomPath && uploadedFilePaths?.coordPath) {
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
            items.map((item: BOMItem) => ({
              cad_drawing_id: cadDrawingId,
              line_number: item.lineNumber,
            item_type: item.itemType,
            item_name: item.itemName,
            specification: item.originalFootprint || '',
            set_count: item.setCount,
            total_quantity: item.totalQuantity,
            stock_quantity: item.stockQuantity || 0,
            check_status: item.checkStatus,
            ref_list: Array.isArray(item.refList) ? item.refList : (item.refList ? item.refList.split(',').map((r: string) => r.trim()) : []),
            alternative_item: item.alternativeItem || '',
            remark: item.remark || ''
          }))
        );

      if (insertError) throw insertError;

      // 4. 좌표 데이터도 저장 (part_placements)
      if (Array.isArray(processedResult.processedData?.coordinates) && processedResult.processedData.coordinates.length > 0) {
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
              ref: coord.refDes,
              part_name: coord.partName,
              part_type: coord.type,
              side: coord.layer,
              x_coordinate: coord.locationX || 0,
              y_coordinate: coord.locationY || 0,
              angle: coord.rotation || null
            }))
          );

        if (insertCoordError) throw insertCoordError;
      }

      // cadDrawingId 업데이트
      setProcessedResult((prev: ProcessedResultState | null) => prev ? ({
        ...prev,
        processedData: {
          ...prev.processedData,
          bomItems: items
        }
      }) : null);

      // 저장 완료 시 임시 데이터 삭제 및 로컬 상태 초기화
      clearTempData();
      setEditingBoardId(null); // 편집 중인 보드 ID 초기화
      // UI 즉시 반영: savedBoards에 해당 id가 있으면 status를 갱신 (목록이 stale이어도 화면이 바로 바뀌도록)
      setSavedBoards(prev => prev.map(b => (
        b.id === cadDrawingId
          ? { ...b, status: saveStatus as 'pending' | 'completed' | undefined, production_manager: (finalProductionManager ?? b.production_manager) }
          : b
      )));
      
      // 목록 뷰로 즉시 전환 (handleReset 전에 viewMode 변경)
        setViewMode('list');
      
      // 상태 초기화 (다음 새로만들기를 위해)
      setStep('input');
      setFileInfo({ bomFile: null, coordFile: null });
      setMetadata({
        boardName: '',
        artworkManager: '',
        productionManager: '',
        productionQuantity: 0
      });
      setProcessedResult(null);
      
      // 상태에 따른 토스트 메시지 (isEditMode 사용)
      if (isEditMode) {
        toast.success('최종 저장이 완료되었습니다.');
      } else {
        toast.success('검토 요청이 완료되었습니다. 생산 담당자의 확인을 기다려주세요.');
      }

    } catch (error: unknown) {
      logger.error('Save error:', error);
      toast.error(`저장에 실패했습니다: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setStep('input');
    setFileInfo({ bomFile: null, coordFile: null });
    // artworkManager는 빈 문자열로 두고, useEffect에서 자동으로 현재 사용자로 설정됨
    setMetadata({
      boardName: '',
      artworkManager: '',
      productionManager: '',
      productionQuantity: 0
    });
    setProcessedResult(null);
    setUploadedFilePaths(null);
    setErrorMessage(null);
    setProgress(0);
    setLoadingText('');
    setIsMerged(false);
    // 새로 만들기 시 임시 데이터 로드 방지 플래그 설정
    setSkipTempDataLoad(true);
    // 초기화 시에는 임시 데이터 유지 (저장/24시간 경과만 삭제)
  };

  // BOM 수정 시 좌표 데이터 실시간 동기화
  const handleBomChange = (updatedBomItems: BOMItem[]) => {
    if (!processedResult?.processedData?.coordinates) return;
    
    // BOM의 refList에서 각 Ref별 종류/품명 매핑 생성
    const refToItemMap = new Map<string, { type: string; partName: string }>();
    
    updatedBomItems.forEach(item => {
      const refs = (item.refList || '').split(',').map(r => r.trim()).filter(r => r);
      refs.forEach(ref => {
        refToItemMap.set(ref.toUpperCase(), {
          type: item.itemType || '',
          partName: item.itemName || ''
        });
      });
    });
    
    // 좌표 데이터 업데이트
    const updatedCoordinates = processedResult.processedData.coordinates.map((coord: CoordinateItem) => {
      const refKey = (coord.refDes || '').toUpperCase();
      const bomInfo = refToItemMap.get(refKey);
      
      if (bomInfo) {
        return {
          ...coord,
          type: bomInfo.type,
          partName: bomInfo.partName
        };
      }
      return coord;
    });
    
    // processedResult 업데이트
    setProcessedResult((prev: ProcessedResultState | null) => prev ? ({
      ...prev,
      processedData: {
        ...prev.processedData,
        bomItems: updatedBomItems,
        coordinates: updatedCoordinates
      }
    }) : null);
  };

  // 좌표 미리보기에서 직접 수정한 값들을 processedResult에 반영 (Full Edit)
  const handleCoordinatesChange = useCallback((nextCoordinates: CoordinateItem[]) => {
    setProcessedResult((prev: ProcessedResultState | null) => {
      if (!prev?.processedData) return prev;
      return {
        ...prev,
        processedData: {
          ...prev.processedData,
          coordinates: nextCoordinates
        }
      };
    });
  }, []);

  // 미리보기에서 행 삭제 (refDes 기준으로 BOM/좌표 동기 삭제)
  const handleDeleteRefs = useCallback(
    (refs: string[]) => {
      const normalizedToDelete = new Set(
        (refs || [])
          .map(r => (r || '').trim().toUpperCase())
          .filter(Boolean)
      );
      if (normalizedToDelete.size === 0) return;

      setProcessedResult((prev: ProcessedResultState | null) => {
        if (!prev?.processedData) return prev;

        const prevBom: BOMItem[] = prev.processedData?.bomItems ?? [];
        const prevCoords: CoordinateItem[] = prev.processedData?.coordinates ?? [];
        const prevTop: CoordinateItem[] = prev.processedData?.topCoordinates ?? [];
        const prevBottom: CoordinateItem[] = prev.processedData?.bottomCoordinates ?? [];

        const normalizeRef = (v?: string | null) => (v || '').trim().toUpperCase();
        const parseRefs = (refList?: string) =>
          (refList || '')
            .split(',')
            .map(r => r.trim())
            .filter(Boolean);

        // 1) 좌표에서 refDes 매칭되는 행 제거
        const nextCoords = prevCoords.filter(c => !normalizedToDelete.has(normalizeRef(c.refDes)));
        const nextTop = prevTop.filter(c => !normalizedToDelete.has(normalizeRef(c.refDes)));
        const nextBottom = prevBottom.filter(c => !normalizedToDelete.has(normalizeRef(c.refDes)));

        // 2) BOM에서 refList 내 ref 제거 (없으면 해당 ref만 제거하고, ref가 0개면 행 삭제)
        const nextBom: BOMItem[] = [];
        for (const item of prevBom) {
          const refsInRow = parseRefs(item.refList);
          if (refsInRow.length === 0) {
            nextBom.push(item);
            continue;
          }

          const remaining = refsInRow.filter(r => !normalizedToDelete.has(normalizeRef(r)));
          if (remaining.length === 0) {
            // 해당 BOM 행 전체 삭제
            continue;
          }

          // ref가 일부만 남는 케이스도 지원 (ref 유일하지만 merge로 한 행에 여러 ref가 있을 수 있어 안전 처리)
          const nextSetCount = remaining.length;
          const nextTotalQty = metadata.productionQuantity > 0 ? nextSetCount * metadata.productionQuantity : item.totalQuantity;
          nextBom.push({
            ...item,
            refList: remaining.join(', '),
            setCount: nextSetCount,
            totalQuantity: nextTotalQty,
          });
        }

        // lineNumber 재정렬
        const renumberedBom = nextBom.map((it, idx) => ({ ...it, lineNumber: idx + 1 }));

        return {
          ...prev,
          processedData: {
            ...prev.processedData,
            bomItems: renumberedBom,
            coordinates: nextCoords,
            ...(prev.processedData?.topCoordinates ? { topCoordinates: nextTop } : {}),
            ...(prev.processedData?.bottomCoordinates ? { bottomCoordinates: nextBottom } : {}),
          },
        };
      });
    },
    [metadata.productionQuantity]
  );

  const handleDeleteRef = useCallback((refDes: string) => handleDeleteRefs([refDes]), [handleDeleteRefs]);

  // 저장된 BOM 다운로드
  const handleDownloadSavedBOM = async (boardId: string, boardName: string) => {
    try {
      // 보드 정보 가져오기 (담당자 정보 포함)
      const { data: boardInfo, error: boardError } = await supabase
        .from('cad_drawings')
        .select('artwork_manager, production_manager, production_quantity')
        .eq('id', boardId)
        .single();
      
      if (boardError) throw boardError;

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
      const convertedBOMItems: BOMItem[] = (bomItems || []).map((item: Record<string, unknown>) => ({
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

      // CoordinateItem 형식으로 변환 (엑셀 생성기에서 기대하는 필드명에 맞춤)
      const normalizeLayer = (layer?: string | null) => {
        const v = (layer || '').trim().toUpperCase();
        if (!v) return '';
        if (v === 'TOP' || v === 'T' || v === 'TOPSIDE' || v === 'FRONT' || v === 'F') return 'TOP';
        if (v === 'BOTTOM' || v === 'BOT' || v === 'B' || v === 'BOTTOMSIDE' || v === 'BACK') return 'BOTTOM';
        return v;
      };

      const convertedCoords: CoordinateItem[] = (coordinates || []).map((coord: Record<string, unknown>) => ({
        type: coord.part_type || '',
        partName: coord.part_name || '',
        refDes: coord.ref || '',
        layer: normalizeLayer(coord.side as string | null) || (coord.side as string) || '',
        locationX: Number(coord.x_coordinate ?? 0) || 0,
        locationY: Number(coord.y_coordinate ?? 0) || 0,
        rotation: Number(coord.angle ?? 0) || 0,
        remark: coord.remark || '',
      }));

      // Excel 생성 및 다운로드 - DB에서 가져온 담당자 정보 사용
      const excelMetadata: ExcelMetadata = {
        boardName,
        artworkManager: boardInfo?.artwork_manager || currentUser?.name || '',
        productionManager: boardInfo?.production_manager || '',
        productionQuantity: boardInfo?.production_quantity || (convertedBOMItems[0]?.totalQuantity && convertedBOMItems[0]?.setCount 
          ? Math.round(convertedBOMItems[0].totalQuantity / convertedBOMItems[0].setCount)
          : 0)
      };

      // TOP/BOTTOM 분리
      const topCoords = convertedCoords.filter((c) => (c.layer || '').toUpperCase().includes('TOP'));
      const bottomCoords = convertedCoords.filter((c) => (c.layer || '').toUpperCase().includes('BOT'));

      // 정렬 적용 (종류별 > 품명순 > 미삽은 맨 아래)
      const sortedBomItems = sortBOMItems(convertedBOMItems);
      const sortedTopCoords = sortCoordinateItems(topCoords);
      const sortedBottomCoords = sortCoordinateItems(bottomCoords);

      const blob = await generateBOMExcelFromTemplate(
        sortedBomItems,
        sortedTopCoords,
        sortedBottomCoords,
        excelMetadata
      );
      
      // 파일명: 보드명_YYMMDD_정리본.xlsx (날짜는 저장 시점)
      const today = new Date();
      const dateStr = today.getFullYear().toString().slice(2) + 
        String(today.getMonth() + 1).padStart(2, '0') + 
        String(today.getDate()).padStart(2, '0');
      // 순서 중요: 복합 패턴 먼저 제거
      const cleanName = boardName.trim()
        .replace(/_\d{6}_정리본$/, '')
        .replace(/_정리본$/, '')
        .replace(/_\d{6}$/, '');
      const fileName = `${cleanName}_${dateStr}_정리본.xlsx`;
      
      downloadExcelBlob(blob, fileName);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch (error: unknown) {
      logger.error('Download error:', error);
      toast.error(`다운로드 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
    }
  };


  // 검토대기(pending) 보드 데이터 로드 → 미리보기 화면 표시
  const handleLoadPendingBoard = async (boardId: string) => {
    try {
      setLoading(true);
      setLoadingText('데이터를 불러오는 중...');

      // 1. 보드 정보 가져오기
      const { data: boardInfo, error: boardError } = await supabase
        .from('cad_drawings')
        .select('id, board_name, artwork_manager, production_manager, production_quantity, status')
        .eq('id', boardId)
        .single();
      
      if (boardError) throw boardError;

      // 2. BOM 아이템 가져오기
      const { data: bomItems, error: bomError } = await supabase
        .from('bom_items')
        .select('*')
        .eq('cad_drawing_id', boardId)
        .order('line_number');
      
      if (bomError) throw bomError;

      // 3. 좌표 데이터 가져오기
      const { data: coordinates, error: coordError } = await supabase
        .from('part_placements')
        .select('*')
        .eq('cad_drawing_id', boardId);
      
      if (coordError) throw coordError;

      // 4. BOMItem 형식으로 변환
      const convertedBOMItems: BOMItem[] = (bomItems || []).map((item: Record<string, unknown>) => {
        const itemName = (item.item_name as string) || '';
        const isDataMissing = itemName === '데이터 없음' || itemName.includes('수동 확인');
        return {
        lineNumber: item.line_number,
        itemType: item.item_type || '',
          itemName: itemName,
        specification: item.specification || '',
        setCount: item.set_count,
        totalQuantity: item.total_quantity || 0,
        stockQuantity: item.stock_quantity || 0,
        checkStatus: item.check_status || '□양호',
        refList: Array.isArray(item.ref_list) ? item.ref_list.join(',') : (item.ref_list || ''),
        alternativeItem: item.alternative_item || '',
          remark: item.remark || '',
          isManualRequired: isDataMissing,
          isNewPart: isDataMissing
        };
      });

      // 5. CoordinateItem 형식으로 변환 (DB 컬럼명: ref, 저장 시 ref: coord.refDes로 저장함)
      const convertedCoords: CoordinateItem[] = (coordinates || []).map((coord: Record<string, unknown>) => ({
        type: coord.part_type || '',
        partName: coord.part_name || '',
        refDes: coord.ref || '',  // DB 컬럼명은 'ref'
        ref: coord.ref || '',     // 임시 저장용 (복원 시 fallback으로 사용)
        layer: coord.side || '',
        locationX: coord.x_coordinate || 0,
        locationY: coord.y_coordinate || 0,
        rotation: coord.angle || 0,
        remark: coord.remark || ''
      })) as CoordinateItem[];

      // 6. 상태 설정
      setMetadata({
        boardName: boardInfo.board_name,
        artworkManager: boardInfo.artwork_manager || '',
        productionManager: boardInfo.production_manager || '',
        productionQuantity: boardInfo.production_quantity || 0
      });

      logger.debug('Loaded coordinates:', { count: convertedCoords.length });
      logger.debug('Sample coord:', { coord: convertedCoords[0] });
      
      // 임시 데이터 삭제 (DB에서 새로 로드한 데이터를 사용하도록)
      await clearTempData();
      setSkipTempDataLoad(true); // 임시 데이터 로드 방지

      setProcessedResult({
        cadDrawingId: boardId, // 편집 시 저장에 필요
        isEditMode: true,      // 편집 모드 플래그 (pending → completed)
        processedData: {
          bomItems: convertedBOMItems,
          topCoordinates: convertedCoords.filter((c) => ((c.layer || '') as string).toUpperCase().includes('TOP')),
          bottomCoordinates: convertedCoords.filter((c) => ((c.layer || '') as string).toUpperCase().includes('BOT')),
          coordinates: convertedCoords,
          summary: {
            totalItems: convertedBOMItems.length,
            manualRequiredCount: 0,
            newPartCount: 0,
            misapCount: 0
          }
        }
      });

      setEditingBoardId(boardId); // 편집 중인 보드 ID 저장 (백업용)

      // 플래그 해제
      setTimeout(() => {
        setSkipTempDataLoad(false);
      }, 500);
      setViewMode('create');
      setStep('preview');
      
      toast.success('데이터를 불러왔습니다. 검토 후 최종 저장해주세요.');
    } catch (error: unknown) {
      logger.error('Error loading pending board:', error);
      toast.error(`데이터 로드 실패: ${error instanceof Error ? error.message : error}`);
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  // 저장된 BOM 삭제 (app_admin 또는 최종점검 처리자만 가능)
  const handleDeleteSavedBOM = async (boardId: string, boardName: string) => {
    const targetBoard = savedBoards.find(b => b.id === boardId);
    if (!targetBoard || !canDeleteBoard(targetBoard)) {
      toast.error('삭제 권한이 없습니다.');
      return;
    }

    // 삭제 확인
    const confirmed = window.confirm(`"${boardName}" BOM을 삭제하시겠습니까?\n\n관련된 모든 데이터(BOM 항목, 좌표 데이터, 원본 파일 정보)가 함께 삭제됩니다.`);
    if (!confirmed) return;

    try {
      setDeletingBoardId(boardId);

      // 1. 관련 데이터 삭제 (외래키 관계가 있는 테이블들)
      // bom_items 삭제
      const { error: bomItemsError } = await supabase
        .from('bom_items')
        .delete()
        .eq('cad_drawing_id', boardId);
      
      if (bomItemsError) {
        logger.warn('bom_items 삭제 실패:', { error: bomItemsError });
      }

      // part_placements 삭제
      const { error: placementsError } = await supabase
        .from('part_placements')
        .delete()
        .eq('cad_drawing_id', boardId);
      
      if (placementsError) {
        logger.warn('part_placements 삭제 실패:', { error: placementsError });
      }

      // bom_raw_files에서 파일 경로 가져온 후 삭제
      const { data: rawFilesData } = await supabase
        .from('bom_raw_files')
        .select('bom_file_url, coordinate_file_url')
        .eq('cad_drawing_id', boardId);

      // Storage에서 파일 삭제 (URL에서 경로 추출)
      if (rawFilesData && rawFilesData.length > 0) {
        for (const file of rawFilesData) {
          // URL에서 Storage 경로 추출 (예: bom-files/uploads/xxx.xlsx)
          try {
            if (file.bom_file_url) {
              const bomPath = file.bom_file_url.split('/bom-files/')[1]?.split('?')[0];
              if (bomPath) {
                await supabase.storage.from('bom-files').remove([decodeURIComponent(bomPath)]);
              }
            }
            if (file.coordinate_file_url) {
              const coordPath = file.coordinate_file_url.split('/bom-files/')[1]?.split('?')[0];
              if (coordPath) {
                await supabase.storage.from('bom-files').remove([decodeURIComponent(coordPath)]);
              }
            }
          } catch (storageError) {
            logger.warn('Storage 파일 삭제 실패:', { error: storageError });
          }
        }
      }

      // bom_raw_files 레코드 삭제
      const { error: rawFilesError } = await supabase
        .from('bom_raw_files')
        .delete()
        .eq('cad_drawing_id', boardId);
      
      if (rawFilesError) {
        logger.warn('bom_raw_files 삭제 실패:', { error: rawFilesError });
      }

      // 2. 메인 cad_drawings 삭제
      const { error: cadError } = await supabase
        .from('cad_drawings')
        .delete()
        .eq('id', boardId);

      if (cadError) throw cadError;

      // 3. 로컬 상태 업데이트
      setSavedBoards(prev => prev.filter(board => board.id !== boardId));
      
      toast.success(`"${boardName}" BOM이 삭제되었습니다.`);
    } catch (error: unknown) {
      logger.error('Delete error:', error);
      toast.error(`삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : error}`);
    } finally {
      setDeletingBoardId(null);
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
                onClick={async () => {
                  // 먼저 임시 데이터 삭제
                  await clearTempData();
                  // 플래그 설정하여 임시 데이터 로드 방지
                  setSkipTempDataLoad(true);
                  // 상태 완전 초기화
                  handleReset();
                  setEditingBoardId(null); // 편집 중인 보드 ID 초기화
                  setViewMode('create');
                  setStep('input');
                  // 약간의 지연 후 플래그 해제 (다음 새로고침 시에는 복원 가능하도록)
                  setTimeout(() => {
                    setSkipTempDataLoad(false);
                  }, 1000);
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
                }}
                className={`button-base ${
                  viewMode === 'list' 
                    ? 'bg-hansl-600 hover:bg-hansl-700 text-white' 
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Eye className="w-4 h-4 mr-2" />
                보드별 BOM/좌표 정리
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
                    <div>
                      <h3 className="page-title">보드별 BOM/좌표 정리</h3>
                      <p className="page-subtitle">검토대기 항목을 클릭하여 검토 및 최종 저장하세요.</p>
                  </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <Table className="table-auto">
                        <TableHeader className="bg-gray-50 sticky top-0 z-10">
                          <TableRow className="h-6">
                            <TableHead className="w-[50px] text-center !py-1 !h-auto">
                              <span className="card-description">No</span>
                            </TableHead>
                            <TableHead className="min-w-[200px] !py-1 !h-auto">
                              <span className="card-description">보드명</span>
                            </TableHead>
                            <TableHead className="w-[100px] text-center !py-1 !h-auto">
                              <span className="card-description">아트웍 담당</span>
                            </TableHead>
                            <TableHead className="w-[100px] text-center !py-1 !h-auto">
                              <span className="card-description">생산 담당</span>
                            </TableHead>
                            <TableHead className="w-[80px] text-center !py-1 !h-auto">
                              <span className="card-description">상태</span>
                            </TableHead>
                            <TableHead className="w-[100px] text-center !py-1 !h-auto">
                              <span className="card-description">생성일</span>
                            </TableHead>
                            <TableHead className="w-[120px] text-center !py-1 !h-auto">
                              <span className="card-description">액션</span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {savedBoards.map((board, index) => (
                            <TableRow 
                              key={board.id} 
                              className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => {
                                if (board.status === 'pending') {
                                  // 검토대기 상태 → 미리보기 화면 표시
                                  handleLoadPendingBoard(board.id);
                                } else {
                                  // 완료 상태 → 상세 모달 표시
                                  setDetailModalBoardId(board.id);
                                  setIsDetailModalOpen(true);
                                }
                              }}
                            >
                              <TableCell className="text-center py-1">
                                <span className="card-subtitle">{index + 1}</span>
                              </TableCell>
                              <TableCell className="py-1">
                                <span className="text-[11px] font-medium text-gray-900">{board.board_name}</span>
                              </TableCell>
                              <TableCell className="text-center py-1">
                                <span className="text-[10px] text-gray-600">{board.artwork_manager || '-'}</span>
                              </TableCell>
                              <TableCell className="text-center py-1">
                                <span className="text-[10px] text-gray-600">{board.production_manager || '-'}</span>
                              </TableCell>
                              <TableCell className="text-center py-1">
                                {board.status === 'pending' ? (
                                  <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-[9px] px-1.5 py-0.5">검토대기</Badge>
                                ) : (
                                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[9px] px-1.5 py-0.5">완료</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center py-1">
                                <span className="text-[10px] text-gray-500">
                                {new Date(board.created_at).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit'
                                })}
                                </span>
                              </TableCell>
                              <TableCell className="text-center py-1" onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-1 justify-center">
                            <Button
                                    onClick={() => handleDownloadSavedBOM(board.id, board.board_name)}
                              variant="outline"
                              size="sm"
                                    className="h-6 px-2 text-[10px] text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                            >
                                    <Download className="w-3 h-3 mr-1" />
                                    Excel
                            </Button>
                                  {canDeleteBoard(board) && (
                            <Button
                                      onClick={() => handleDeleteSavedBOM(board.id, board.board_name)}
                              variant="outline"
                              size="sm"
                                      disabled={deletingBoardId === board.id}
                                      className="h-6 px-2 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                            >
                                      {deletingBoardId === board.id ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3 h-3" />
                                      )}
                            </Button>
                                  )}
                          </div>
                              </TableCell>
                            </TableRow>
                    ))}
                        </TableBody>
                        <tfoot className="bg-gray-50 border-t">
                          <tr>
                            <td colSpan={7} className="py-2 px-4">
                              <span className="card-description">총 {savedBoards.length}개 항목</span>
                            </td>
                          </tr>
                        </tfoot>
                      </Table>
                    </div>
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
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg text-sm flex flex-col gap-2 shadow-sm animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
                <span>오류가 발생했습니다</span>
              </div>
              <p className="pl-7">{errorMessage}</p>
              {errorMessage.includes('quota') && (
                <p className="pl-7 text-xs text-red-600 mt-1">
                  * OpenAI 결제 정보가 반영되기까지 최대 10~20분이 소요될 수 있습니다. 잠시 후 다시 시도해주세요.
                </p>
              )}
            </div>
          )}
          
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

                  {/* 좌표 파일 업로드 (선택) */}
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
                        <span className="text-xs font-bold text-gray-400">좌표(선택)</span>
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
                      <Label className="text-[10px] text-gray-500">Artwork 담당자 <span className="text-red-500">*</span></Label>
                      <Popover open={openArtworkManager} onOpenChange={setOpenArtworkManager}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={openArtworkManager}
                            className="w-full justify-between text-xs h-8 min-h-[32px] px-2 bg-white border-[#d2d2d7] shadow-sm hover:bg-gray-50"
                          >
                            {metadata.artworkManager
                              ? employees.find((emp) => emp.id === metadata.artworkManager)?.name || metadata.artworkManager
                              : currentUser?.name || "담당자 선택"}
                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0">
                          <Command>
                            <CommandInput placeholder="이름 검색..." className="h-8 text-xs" />
                            <CommandList>
                              <CommandEmpty>검색 결과 없음</CommandEmpty>
                              <CommandGroup>
                                {employees.map((emp) => (
                                  <CommandItem
                                    key={emp.id}
                                    value={emp.name}
                                    onSelect={() => {
                                      setMetadata(prev => ({ ...prev, artworkManager: emp.id }));
                                      setOpenArtworkManager(false);
                                    }}
                                    className="text-xs"
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-3 w-3",
                                        metadata.artworkManager === emp.id ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {emp.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* 생산 담당자 (최종 저장 시 자동 배정) */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-400">생산 담당자</Label>
                      <Popover open={openProductionManager} onOpenChange={setOpenProductionManager}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={openProductionManager}
                            disabled={true}
                            className="w-full justify-between text-xs h-8 min-h-[32px] px-2 bg-gray-100 border-[#d2d2d7] shadow-sm cursor-not-allowed text-gray-400"
                          >
                            {metadata.productionManager
                              ? employees.find((emp) => emp.id === metadata.productionManager)?.name
                              : "최종 저장 시 자동 배정"}
                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0">
                          <Command>
                            <CommandInput placeholder="이름 검색..." className="h-8 text-xs" />
                            <CommandList>
                              <CommandEmpty>검색 결과 없음</CommandEmpty>
                              <CommandGroup>
                                {employees.map((emp) => (
                                  <CommandItem
                                    key={emp.id}
                                    value={emp.name}
                                    onSelect={() => {
                                      setMetadata(prev => ({ ...prev, productionManager: emp.id }));
                                      setOpenProductionManager(false);
                                    }}
                                    className="text-xs"
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-3 w-3",
                                        metadata.productionManager === emp.id ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {emp.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* 생산 수량 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">생산 수량 <span className="text-red-500">*</span></Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          value={metadata.productionQuantity === 0 ? '' : metadata.productionQuantity}
                          onChange={(e) => setMetadata(prev => ({ ...prev, productionQuantity: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 pr-8"
                          style={{ height: '32px' }}
                          placeholder="0"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium pointer-events-none">SET</span>
                      </div>
                    </div>

                    {/* 생성 버튼 */}
                    <div className="flex items-end">
                      <Button 
                        onClick={handleProcess}
                        disabled={
                          !fileInfo.bomFile || 
                          !metadata.boardName || 
                          metadata.productionQuantity <= 0 ||
                          uploading
                        }
                        className="w-full bg-hansl-500 hover:bg-hansl-600 text-white shadow-sm text-xs disabled:bg-gray-300 disabled:cursor-not-allowed"
                        style={{ height: '32px' }}
                      >
                        정리 및 생성
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
              <p className="text-xs sm:text-sm px-4">BOM 파일을 업로드하여 시작하세요 (좌표 파일은 선택)</p>
            </div>
          )}
        </div>
      )}

      {/* 처리 중 */}
      {step === 'processing' && (
        <Card>
          <CardContent className="py-12 sm:py-16 lg:py-20">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto">
              <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-hansl-600 animate-spin mb-6" />
              <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-center mb-2">{loadingText || 'AI가 BOM을 분석하고 있습니다'}</h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-6 text-center px-4">잠시만 기다려주세요... (약 30초 ~ 1분 소요)</p>
              
              <div className="w-full px-4">
                <Progress value={progress} className="h-2" />
                <p className="text-right text-xs text-gray-500 mt-1">{Math.round(progress)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 결과 미리보기 */}
      {step === 'preview' && processedResult && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-6 w-full max-w-full overflow-hidden">
              {/* 제목 / 부제 + 버튼 */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3 mb-4">
                  <div>
                  <h3 className="page-title">데이터 미리보기 <span className="text-xs font-medium text-gray-500 ml-3">{(metadata.boardName || '').trim().replace(/_\d{6}_정리본$/, '').replace(/_정리본$/, '').replace(/_\d{6}$/, '')}</span></h3>
                  <p className="page-subtitle">데이터 클릭 수정 후 저장 바랍니다.</p>
                  </div>
                <div className="flex gap-2">
                <Button 
                    onClick={() => previewPanelRef.current?.handleMerge()}
                    disabled={!hasMergeableItems && !isMerged}
                    className={`button-base border ${
                      !hasMergeableItems && !isMerged
                        ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                        : isMerged 
                          ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' 
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    {isMerged ? '합치기 해제' : '동일 항목 합치기'}
                  </Button>
                  <Button 
                    onClick={() => previewPanelRef.current?.handleReset()}
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    초기화
                  </Button>
                  <Button 
                    onClick={() => previewPanelRef.current?.handleSave()}
                    disabled={isSaving}
                    className={`button-base text-white ${
                      processedResult?.isEditMode 
                        ? 'bg-green-600 hover:bg-green-700' 
                        : 'bg-hansl-500 hover:bg-hansl-600'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {processedResult?.isEditMode ? '저장 중...' : '요청 중...'}
                      </>
                    ) : (
                      <>
                        {processedResult?.isEditMode ? (
                          <>
                            <Check className="w-4 h-4 mr-2" />
                            최종 저장
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 mr-2" />
                            검토 요청
                          </>
                        )}
                      </>
                    )}
                  </Button>
                  <Button 
                    onClick={() => previewPanelRef.current?.handleDownload()}
                    className="button-base bg-green-500 hover:bg-green-600 text-white"
                >
                    <Download className="w-4 h-4 mr-2" />
                    Excel
                </Button>
              </div>
              </div>

              {/* 탭 */}
              <Tabs defaultValue="bom" className="w-full max-w-full">
                <TabsList className="flex space-x-1 bg-gray-50 p-1 business-radius-card border border-gray-200 mb-4 w-full">
                  <TabsTrigger 
                    value="bom" 
                    className="flex-1 flex items-center justify-center space-x-2 py-1.5 px-3 sm:px-4 business-radius-button !text-xs font-medium transition-colors data-[state=active]:text-hansl-600 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-gray-200 data-[state=inactive]:text-gray-600 data-[state=inactive]:bg-transparent data-[state=inactive]:hover:text-gray-900 data-[state=inactive]:hover:bg-white/50"
                  >
                    <span className="whitespace-nowrap">정리된 BOM</span>
                    <span className="badge-stats data-[state=active]:bg-hansl-50 data-[state=active]:text-hansl-700 bg-gray-100 text-gray-600">
                      {(processedResult.processedData?.bomItems ?? []).reduce(
                        (sum: number, item: BOMItem) => sum + (item.setCount || 0),
                        0
                      )}
                    </span>
                    {(processedResult.processedData?.bomItems?.filter((item: { isManualRequired?: boolean }) => item.isManualRequired).length ?? 0) > 0 && (
                      <span className="badge-stats bg-yellow-100 text-yellow-700 border border-yellow-300">
                        ⚠️ 수동 작성: {processedResult.processedData?.bomItems?.filter((item: { isManualRequired?: boolean }) => item.isManualRequired).length}
                      </span>
                    )}
                    {processedResult?.processedData?.coordinatesProvided !== false && mismatchCount > 0 && (
                      <span className="badge-stats bg-red-100 text-red-700 border border-red-200">
                        REF 불일치: {mismatchCount}
                      </span>
                    )}
                    {processedResult?.processedData?.coordinatesProvided !== false && missingInCoord > 0 && (
                      <span className="badge-stats bg-red-100 text-red-700 border border-red-200">
                        좌표에 없음: {missingInCoord}개
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger 
                    value="coord" 
                    className="flex-1 flex items-center justify-center space-x-2 py-1.5 px-3 sm:px-4 business-radius-button !text-xs font-medium transition-colors data-[state=active]:text-hansl-600 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-gray-200 data-[state=inactive]:text-gray-600 data-[state=inactive]:bg-transparent data-[state=inactive]:hover:text-gray-900 data-[state=inactive]:hover:bg-white/50"
                  >
                    <span className="whitespace-nowrap">좌표 데이터</span>
                    <span className="badge-stats data-[state=active]:bg-hansl-50 data-[state=active]:text-hansl-700 bg-gray-100 text-gray-600">
                      {processedResult.processedData?.coordinates?.filter((c: CoordinateItem) => c.layer === 'TOP').length || 0}
                    </span>
                    <span className="badge-stats data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 bg-gray-100 text-gray-600">
                      {processedResult.processedData?.coordinates?.filter((c: CoordinateItem) => c.layer === 'BOTTOM').length || 0}
                    </span>
                    {(processedResult.processedData?.bomItems?.filter((item: { isManualRequired?: boolean }) => item.isManualRequired).length ?? 0) > 0 && (
                      <span className="badge-stats bg-yellow-100 text-yellow-700 border border-yellow-300">
                        ⚠️ 수동 작성: {processedResult.processedData?.bomItems?.filter((item: { isManualRequired?: boolean }) => item.isManualRequired).length}
                      </span>
                    )}
                    {processedResult?.processedData?.coordinatesProvided !== false && missingInBom > 0 && (
                      <span className="badge-stats bg-red-100 text-red-700 border border-red-200">
                        BOM에 없음: {missingInBom}개
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="bom" forceMount className="mt-0 w-full max-w-full overflow-hidden">
              <GeneratedPreviewPanel 
                    ref={previewPanelRef}
                bomItems={processedResult.processedData?.bomItems || []}
                coordinates={processedResult.processedData?.coordinates || []}
                    coordinatesProvided={processedResult?.processedData?.coordinatesProvided !== false}
                boardName={metadata.boardName || 'Board'}
                productionQuantity={metadata.productionQuantity}
                    artworkManager={employees.find(emp => emp.id === metadata.artworkManager)?.name || currentUser?.name || ''}
                    productionManager={employees.find(emp => emp.id === metadata.productionManager)?.name || ''}
                onSave={handleSaveBOM}
                    onMergeStateChange={setIsMerged}
                    onBomChange={handleBomChange}
                    onDeleteRefs={handleDeleteRefs}
              />
                </TabsContent>

                <TabsContent value="coord" forceMount className="mt-0 w-full max-w-full overflow-hidden">
              <CoordinatePreviewPanel 
                coordinates={processedResult.processedData?.coordinates || []}
                    bomItems={processedResult.processedData?.bomItems || []}
                    onCoordinatesChange={handleCoordinatesChange}
                    onDeleteRef={handleDeleteRef}
              />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}
        </>
      )}

      {/* BOM 상세 모달 */}
      <BomDetailModal
        boardId={detailModalBoardId}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setDetailModalBoardId(null);
        }}
      />
    </div>
  );
}