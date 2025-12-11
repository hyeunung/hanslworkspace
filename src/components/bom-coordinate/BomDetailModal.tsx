import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// native table 태그 사용 (sticky header 지원을 위해)
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { 
  generateBOMExcelFromTemplate, 
  downloadExcelBlob,
  type ExcelMetadata 
} from '@/utils/excel-generator';
import { type BOMItem, type CoordinateItem } from '@/utils/v7-generator';

interface BomDetailModalProps {
  boardId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface BoardData {
  id: string;
  board_name: string;
  artwork_manager: string;
  production_manager: string;
  production_quantity: number;
  created_at: string;
  bomItems: BOMItem[];
  topCoordinates: CoordinateItem[];
  bottomCoordinates: CoordinateItem[];
}

export default function BomDetailModal({ boardId, isOpen, onClose }: BomDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [downloading, setDownloading] = useState(false);
  
  const supabase = createClient();

  useEffect(() => {
    if (isOpen && boardId) {
      loadBoardData();
    }
  }, [isOpen, boardId]);

  const loadBoardData = async () => {
    if (!boardId) return;
    
    setLoading(true);
    try {
      // 보드 정보 가져오기
      const { data: board, error: boardError } = await supabase
        .from('cad_drawings')
        .select('*')
        .eq('id', boardId)
        .single();
      
      if (boardError) throw boardError;

      // BOM 항목 가져오기
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

      // BOM 항목 변환
      const convertedBOMItems: BOMItem[] = (bomItems || []).map((item: any) => ({
        lineNumber: item.line_number,
        itemType: item.item_type || '',
        itemName: item.item_name || '',
        setCount: item.set_count || 0,
        totalQuantity: item.total_quantity || 0,
        stockQuantity: item.stock_quantity || 0,
        checkStatus: item.check_status || '',
        // refList가 배열이면 문자열로 변환
        refList: Array.isArray(item.ref_list) 
          ? item.ref_list.join(', ') 
          : (item.ref_list || ''),
        alternativeItem: item.alternative_item || '',
        remark: item.remark || '',
        isManualRequired: item.is_manual_required || false,
        isNewPart: item.is_new_part || false,
        originalPart: item.original_part || '',
        originalFootprint: item.original_footprint || '',
      }));

      // 좌표 변환 (DB 컬럼명과 일치시킴)
      const topCoords: CoordinateItem[] = [];
      const bottomCoords: CoordinateItem[] = [];
      
      (coordinates || []).forEach((coord: any) => {
        const coordItem: CoordinateItem = {
          refDes: coord.ref || '',           // DB: ref
          type: coord.part_type || '',       // DB: part_type
          partName: coord.part_name || '',   // DB: part_name
          layer: coord.side || 'TOP',        // DB: side
          locationX: coord.x_coordinate || 0, // DB: x_coordinate
          locationY: coord.y_coordinate || 0, // DB: y_coordinate
          rotation: coord.angle || 0,        // DB: angle
          remark: coord.remark || '',
        };
        
        if (coord.side === 'TOP') {
          topCoords.push(coordItem);
        } else {
          bottomCoords.push(coordItem);
        }
      });

      setBoardData({
        id: board.id,
        board_name: board.board_name,
        artwork_manager: board.artwork_manager || '',
        production_manager: board.production_manager || '',
        production_quantity: board.production_quantity || 0,
        created_at: board.created_at,
        bomItems: convertedBOMItems,
        topCoordinates: topCoords,
        bottomCoordinates: bottomCoords,
      });
    } catch (error) {
      console.error('Error loading board data:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!boardData) return;
    
    setDownloading(true);
    try {
      const excelMetadata: ExcelMetadata = {
        boardName: boardData.board_name,
        artworkManager: boardData.artwork_manager,
        productionManager: boardData.production_manager,
        productionQuantity: boardData.production_quantity,
      };

      const blob = await generateBOMExcelFromTemplate(
        boardData.bomItems,
        boardData.topCoordinates,
        boardData.bottomCoordinates,
        excelMetadata
      );

      // 파일명 생성
      const today = new Date();
      const dateStr = today.getFullYear().toString().slice(2) + 
        String(today.getMonth() + 1).padStart(2, '0') + 
        String(today.getDate()).padStart(2, '0');
      const cleanName = boardData.board_name.trim()
        .replace(/_\d{6}_정리본$/, '')
        .replace(/_정리본$/, '')
        .replace(/_\d{6}$/, '');
      const fileName = `${cleanName}_${dateStr}_정리본.xlsx`;

      await downloadExcelBlob(blob, fileName);
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch (error) {
      console.error('Excel download error:', error);
      toast.error('엑셀 다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  };

  // 미삽 체크 함수 (미리보기와 동일)
  const checkIsMisap = (itemName: string, remark: string) => {
    const nameUpper = (itemName || '').toUpperCase();
    const remarkUpper = (remark || '').toUpperCase();
    return remarkUpper.includes('미삽') || 
      nameUpper.includes('_OPEN') || nameUpper.includes('OPEN_') ||
      nameUpper.includes('_POGO') || nameUpper.includes('POGO_') ||
      nameUpper.includes('_PAD') || nameUpper.includes('PAD_') ||
      nameUpper.includes('_NC') || nameUpper.includes('NC_');
  };

  // 보드명 정리
  const cleanBoardName = (name: string) => {
    return (name || '').trim()
      .replace(/_\d{6}_정리본$/, '')
      .replace(/_정리본$/, '')
      .replace(/_\d{6}$/, '');
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent maxWidth="max-w-fit" showCloseButton={false} className="w-fit min-w-[600px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col p-4">
        <DialogHeader className="flex-shrink-0 !p-0 !border-0">
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="text-lg font-semibold text-gray-900">
                {boardData ? cleanBoardName(boardData.board_name) : '로딩 중...'}
              </DialogTitle>
              {boardData && (
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>Artwork: {boardData.artwork_manager || '-'}</span>
                  <span>생산: {boardData.production_manager || '-'}</span>
                  <span>수량: {boardData.production_quantity}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDownloadExcel}
                disabled={downloading || !boardData}
                className="h-8 px-3 text-xs bg-green-600 hover:bg-green-700 text-white"
              >
                {downloading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Download className="w-3 h-3 mr-1" />
                )}
                Excel 다운로드
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden mt-3">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 text-hansl-600 animate-spin mr-2" />
              <span className="text-sm text-gray-600">데이터를 불러오는 중...</span>
            </div>
          ) : boardData ? (
            <Tabs defaultValue="bom" className="h-full flex flex-col">
              <TabsList className="flex-shrink-0 mb-3 grid grid-cols-3 h-8 bg-gray-100 p-1 business-radius-button">
                <TabsTrigger 
                  value="bom" 
                  className="text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:text-hansl-600 data-[state=active]:shadow-sm"
                >
                  정리된 BOM
                  <span className="ml-1 badge-stats bg-gray-100 text-gray-600 data-[state=active]:bg-hansl-50 data-[state=active]:text-hansl-700">
                    {boardData.bomItems.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="top" 
                  className="text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:text-hansl-600 data-[state=active]:shadow-sm"
                >
                  TOP
                  <span className="ml-1 badge-stats bg-gray-100 text-gray-600 data-[state=active]:bg-hansl-50 data-[state=active]:text-hansl-700">
                    {boardData.topCoordinates.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="bottom" 
                  className="text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:text-hansl-600 data-[state=active]:shadow-sm"
                >
                  BOTTOM
                  <span className="ml-1 badge-stats bg-gray-100 text-gray-600 data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700">
                    {boardData.bottomCoordinates.length}
                  </span>
                </TabsTrigger>
              </TabsList>

              {/* BOM 탭 */}
              <TabsContent value="bom" className="flex-1 overflow-auto mt-0">
                <BOMTable items={boardData.bomItems} checkIsMisap={checkIsMisap} productionQuantity={boardData.production_quantity} />
              </TabsContent>

              {/* TOP 탭 */}
              <TabsContent value="top" className="flex-1 overflow-auto mt-0">
                <CoordinateTable coordinates={boardData.topCoordinates} checkIsMisap={checkIsMisap} />
              </TabsContent>

              {/* BOTTOM 탭 */}
              <TabsContent value="bottom" className="flex-1 overflow-auto mt-0">
                <CoordinateTable coordinates={boardData.bottomCoordinates} checkIsMisap={checkIsMisap} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              데이터를 불러올 수 없습니다.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// BOM 테이블 컴포넌트 (GeneratedPreviewPanel과 100% 동일한 디자인)
// ============================================================================
function BOMTable({ 
  items, 
  checkIsMisap,
  productionQuantity 
}: { 
  items: BOMItem[]; 
  checkIsMisap: (name: string, remark: string) => boolean;
  productionQuantity: number;
}) {
  let prevType = '';
  const totalSetCount = items.reduce((sum, item) => sum + (item.setCount || 0), 0);
  
  // 행 배경색 결정 (미리보기와 동일)
  const getRowClassName = (item: BOMItem) => {
    const isMisap = checkIsMisap(item.itemName, item.remark);
    if (item.isManualRequired) return 'bg-yellow-50 hover:bg-yellow-100';
    if (item.isNewPart) return 'bg-red-50 hover:bg-red-100';
    if (isMisap) return 'bg-gray-50 hover:bg-gray-100';
    return 'hover:bg-gray-50';
  };
  
  return (
    <div className="border rounded-lg bg-white shadow-sm max-h-[55vh] overflow-auto">
      <table className="table-auto w-auto border-collapse text-[13px]">
        <thead className="bg-gray-50 sticky top-0 z-20">
            <tr className="h-6 border-b border-gray-200">
              <th className="w-[40px] sm:w-[50px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">No</span>
              </th>
              <th className="text-center whitespace-nowrap py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">종류</span>
              </th>
              <th className="whitespace-nowrap py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">품명</span>
              </th>
              <th className="w-[50px] sm:w-[60px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">SET</span>
              </th>
              <th className="w-[60px] sm:w-[80px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">수량</span>
              </th>
              <th className="w-[50px] sm:w-[60px] text-center hidden sm:table-cell py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">재고</span>
              </th>
              <th className="min-w-[200px] sm:min-w-[300px] py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">REF</span>
              </th>
              <th className="w-[100px] sm:w-[150px] hidden md:table-cell py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">대체품</span>
              </th>
              <th className="w-[100px] sm:w-[150px] py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">비고</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-6 card-description">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const isMisap = checkIsMisap(item.itemName, item.remark);
                const showType = item.itemType !== prevType;
                prevType = item.itemType;
                
                return (
                  <tr key={index} className={`${getRowClassName(item)} border-b border-gray-100`}>
                    {/* No */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-500'}`}>{index + 1}</span>
                    </td>
                    
                    {/* 종류 - 연속 동일 종류는 첫 번째만 표시 */}
                    <td className="text-center py-1 px-1 whitespace-nowrap">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-600'} ${
                        item.itemType === '데이터 없음' ? '!text-red-500 font-bold' : ''
                      }`}>
                        {showType ? (item.itemType || '-') : ''}
                      </span>
                    </td>

                    {/* 품명 */}
                    <td className="py-1 px-1 whitespace-nowrap">
                      <span className={`text-[10px] ${
                        isMisap ? 'text-red-600 font-medium' : 
                        (item.isManualRequired || item.isNewPart) ? 'text-red-600' : 'text-gray-500'
                      }`}>
                        {item.itemName || '-'}
                      </span>
                    </td>

                    {/* SET */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-medium ${isMisap ? 'text-red-600' : 'text-gray-900'}`}>
                        {item.setCount}
                      </span>
                    </td>

                    {/* 수량 */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-bold ${isMisap ? 'text-red-600' : 'text-gray-900'}`}>
                        {item.totalQuantity}
                      </span>
                    </td>

                    {/* 재고 */}
                    <td className="hidden sm:table-cell text-center py-1 px-2">
                      <span className={`text-[10px] font-medium ${isMisap ? 'text-red-600' : 'text-gray-900'}`}>
                        {item.stockQuantity || ''}
                      </span>
                    </td>

                    {/* REF */}
                    <td className="px-1 py-1 align-middle" style={{ width: '300px', maxWidth: '300px' }}>
                      <span 
                        className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-600'}`}
                        style={{ 
                          display: 'block',
                          width: '300px',
                          maxWidth: '300px',
                          lineHeight: '14px',
                          wordWrap: 'break-word',
                          overflowWrap: 'break-word',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {item.refList || '-'}
                      </span>
                    </td>

                    {/* 대체품 */}
                    <td className="hidden md:table-cell py-1 px-2">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-500'}`}>
                        {item.alternativeItem || ''}
                      </span>
                    </td>

                    {/* 비고 */}
                    <td className="py-1 px-2">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {item.remark || ''}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {/* 푸터 - 미리보기와 동일한 구조 (하단 고정) */}
          <tfoot className="bg-gray-50 border-t sticky bottom-0 z-20">
            <tr>
              {/* No 칼럼 */}
              <td className="py-2 px-2 bg-gray-50">
                <span className="card-description whitespace-nowrap">총 {items.length}개 항목</span>
              </td>
              {/* 종류 */}
              <td className="bg-gray-50"></td>
              {/* 품명 - 합계 라벨 */}
              <td className="text-right pr-2 bg-gray-50">
                <span className="card-description">합계:</span>
              </td>
              {/* SET - 합계 숫자 */}
              <td className="text-center py-2 bg-gray-50">
                <span className="text-[11px] text-gray-700">{totalSetCount}</span>
              </td>
              {/* 수량 */}
              <td className="bg-gray-50"></td>
              {/* 재고 */}
              <td className="hidden sm:table-cell bg-gray-50"></td>
              {/* REF */}
              <td className="bg-gray-50"></td>
              {/* 대체품 */}
              <td className="hidden md:table-cell bg-gray-50"></td>
              {/* 비고 + 범례 */}
              <td className="py-2 px-2 text-right bg-gray-50">
                <div className="flex gap-4 card-description justify-end whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-yellow-100 border border-yellow-300 rounded"></span>
                    수동 확인
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-red-50 border border-red-200 rounded"></span>
                    미삽
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
    </div>
  );
}

// ============================================================================
// 좌표 테이블 컴포넌트 (CoordinatePreviewPanel과 100% 동일한 디자인)
// ============================================================================
function CoordinateTable({ 
  coordinates, 
  checkIsMisap 
}: { 
  coordinates: CoordinateItem[]; 
  checkIsMisap: (name: string, remark: string) => boolean;
}) {
  let prevType = '';
  const totalCount = coordinates.length;
  
  return (
    <div className="border rounded-lg bg-white shadow-sm max-h-[55vh] overflow-auto">
      <table className="table-auto w-auto border-collapse text-[13px]">
        <thead className="bg-gray-50 sticky top-0 z-20">
            <tr className="h-6 border-b border-gray-200">
              <th className="w-[40px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">No</span>
              </th>
              <th className="text-center whitespace-nowrap py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">종류</span>
              </th>
              <th className="whitespace-nowrap py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">품명</span>
              </th>
              <th className="w-[80px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">RefDes</span>
              </th>
              <th className="w-[60px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">Layer</span>
              </th>
              <th className="w-[80px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">X</span>
              </th>
              <th className="w-[80px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">Y</span>
              </th>
              <th className="w-[60px] text-center py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">Angle</span>
              </th>
              <th className="w-[80px] py-0.5 px-2 bg-gray-50 text-[12px] font-semibold text-gray-700">
                <span className="card-description">비고</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {coordinates.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-6 card-description">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              coordinates.map((coord, index) => {
                const isMisap = checkIsMisap(coord.partName || '', coord.remark || '');
                const showType = coord.type !== prevType;
                prevType = coord.type || '';
                
                return (
                  <tr 
                    key={index} 
                    className={`hover:bg-gray-50 border-b border-gray-100 ${isMisap ? 'bg-gray-50' : ''}`}
                  >
                    {/* No */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-500'}`}>{index + 1}</span>
                    </td>
                    
                    {/* 종류 - 연속 동일 종류는 첫 번째만 표시 */}
                    <td className="text-center py-1 px-1 whitespace-nowrap">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-600'}`}>
                        {showType ? (coord.type || '-') : ''}
                      </span>
                    </td>
                    
                    {/* 품명 */}
                    <td className="py-1 px-1 whitespace-nowrap">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600' : 'text-gray-600'}`}>
                        {coord.partName || '-'}
                      </span>
                    </td>
                    
                    {/* RefDes */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-medium ${isMisap ? 'text-red-600' : 'text-gray-900'}`}>
                        {coord.refDes}
                      </span>
                    </td>
                    
                    {/* Layer */}
                    <td className="text-center py-1 px-2">
                      <Badge 
                        variant={coord.layer === 'TOP' ? 'default' : 'secondary'} 
                        className="text-[9px] px-1.5 py-0 h-4"
                      >
                        {coord.layer}
                      </Badge>
                    </td>
                    
                    {/* X */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-mono ${isMisap ? 'text-red-600' : 'text-gray-600'}`}>
                        {coord.locationX?.toFixed(2)}
                      </span>
                    </td>
                    
                    {/* Y */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-mono ${isMisap ? 'text-red-600' : 'text-gray-600'}`}>
                        {coord.locationY?.toFixed(2)}
                      </span>
                    </td>
                    
                    {/* Angle */}
                    <td className="text-center py-1 px-2">
                      <span className={`text-[10px] font-mono ${isMisap ? 'text-red-600' : 'text-gray-600'}`}>
                        {coord.rotation || 0}
                      </span>
                    </td>
                    
                    {/* 비고 */}
                    <td className="py-1 px-2">
                      <span className={`text-[10px] ${isMisap ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {coord.remark || ''}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {/* 푸터 (하단 고정) */}
          <tfoot className="bg-gray-50 border-t sticky bottom-0 z-20">
            <tr>
              <td colSpan={9} className="py-2 px-2 bg-gray-50">
                <div className="flex justify-between items-center">
                  <span className="card-description">총 {totalCount}개 항목</span>
                  <div className="flex gap-4 card-description">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></span>
                      미삽
                    </span>
                  </div>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
    </div>
  );
}
