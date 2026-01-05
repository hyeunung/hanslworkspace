import { useState, useEffect, forwardRef, useImperativeHandle, useRef, useLayoutEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus } from 'lucide-react';
import { 
  generateBOMExcelFromTemplate, 
  downloadExcelBlob,
  type ExcelMetadata 
} from '@/utils/excel-generator';
import { type BOMItem, type CoordinateItem, sortBOMItems, sortCoordinateItems } from '@/utils/v7-generator';
import { toast } from 'sonner';

interface GeneratedPreviewPanelProps {
  bomItems: BOMItem[];
  coordinates: CoordinateItem[];
  boardName: string;
  productionQuantity: number;
  artworkManager?: string;       // Artwork 담당자
  productionManager?: string;    // 생산 담당자
  onSave: (items: BOMItem[]) => void;
  onMergeStateChange?: (isMerged: boolean) => void;
  onBomChange?: (items: BOMItem[]) => void;  // BOM 수정 시 콜백 (좌표 동기화용)
}

export interface GeneratedPreviewPanelRef {
  handleDownload: () => Promise<void>;
  handleSave: () => void;
  handleReset: () => void;
  handleMerge: () => void;
  isMerged: () => boolean;
}

const GeneratedPreviewPanel = forwardRef<GeneratedPreviewPanelRef, GeneratedPreviewPanelProps>(({ 
  bomItems: initialItems, 
  coordinates, 
  boardName,
  productionQuantity,
  artworkManager = '',
  productionManager = '',
  onSave,
  onMergeStateChange,
  onBomChange
}, ref) => {
  const [items, setItems] = useState<BOMItem[]>(initialItems);
  const [beforeMergeItems, setBeforeMergeItems] = useState<BOMItem[] | null>(null); // 합치기 전 상태 저장
  const textareaRefs = useRef<{ [key: string]: HTMLTextAreaElement | null }>({});
  
  // initialItems가 변경되면 items 업데이트
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // textarea 높이 자동 조정
  useLayoutEffect(() => {
    Object.values(textareaRefs.current).forEach(textarea => {
      if (textarea) {
        textarea.style.height = 'auto';
        const newHeight = Math.max(24, textarea.scrollHeight);
        textarea.style.height = newHeight + 'px';
      }
    });
  }, [items]);
  
  // 통계 계산
  const manualRequiredCount = items.filter(i => i.isManualRequired).length;
  const newPartCount = items.filter(i => i.isNewPart).length;
  const misapCount = items.filter(i => i.remark === '미삽').length;
  const totalSetCount = items.reduce((sum, item) => sum + (item.setCount || 0), 0);
  
  // 좌표 REF Set 생성 (빠른 조회를 위해)
  const coordRefSet = useMemo(() => {
    const refSet = new Set<string>();
    coordinates.forEach((coord: CoordinateItem) => {
      if (coord.refDes) {
        refSet.add(coord.refDes.trim().toUpperCase());
      }
    });
    return refSet;
  }, [coordinates]);
  
  // BOM에는 있지만 좌표에 없는 품목 체크
  const hasMissingCoordinate = (item: BOMItem): boolean => {
    if (!item.refList) return false;
    const refs = item.refList.split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
    // 하나라도 좌표에 없으면 true
    return refs.some(ref => !coordRefSet.has(ref));
  };
  
  // 캔버스로 텍스트 실제 너비 측정
  const measureTextWidth = (text: string, fontSize: number = 10): number => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return text.length * 10;
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    return Math.ceil(ctx.measureText(text).width);
  };
  
  // 컬럼 너비 계산 (실제 텍스트 기준 + 여유분)
  const maxTypeWidth = Math.max(
    ...items.map(i => measureTextWidth(i.itemType || '', 10)),
    measureTextWidth('종류', 10),
    50
  ) + 20;
  
  const maxNameWidth = Math.max(
    ...items.map(i => measureTextWidth(i.itemName || '', 10)),
    measureTextWidth('품명', 10),
    100
  ) + 20;
  
  // REF 컬럼 너비 계산 (15~16개 REF가 보이도록)
  // 평균 REF 길이 계산 (예: "C10, C11" 형태에서 개별 REF 길이 평균)
  const allRefs = items.flatMap(i => {
    const refs = (i.refList || '').split(',').map(r => r.trim()).filter(r => r);
    return refs;
  });
  
  const avgRefWidth = allRefs.length > 0
    ? allRefs.reduce((sum, ref) => sum + measureTextWidth(ref, 10), 0) / allRefs.length
    : measureTextWidth('C10', 10); // 기본값
  
  // 15~16개 REF + 쉼표와 공백 고려
  const refWidthPerItem = avgRefWidth + measureTextWidth(', ', 10); // REF + ", "
  const maxRefWidth = Math.ceil(refWidthPerItem * 15.5) + 20; // 15.5개 기준 + 여유분
  
  // NO 컬럼 너비 계산 (최대 항목 수 기준)
  const maxNoWidth = Math.max(
    measureTextWidth(String(items.length), 10),
    measureTextWidth('No', 10),
    30
  ) + 20;
  
  // 엑셀 다운로드 핸들러
  const handleDownload = async () => {
    try {
      console.log('Starting download with:', { 
        itemsCount: items.length, 
        coordsCount: coordinates.length, 
        boardName 
      });
      
      // 데이터 검증
      if (!items || items.length === 0) {
        throw new Error('BOM 데이터가 없습니다. 데이터를 확인해주세요.');
      }
      
      if (!boardName || boardName.trim() === '') {
        throw new Error('보드 이름이 설정되지 않았습니다.');
      }
      
      // 수동 확인 필요 항목 체크
      const unfilledItems = items.filter(item => 
        item.isManualRequired && 
        (item.itemName === '데이터 없음 (수동 확인 필요)' || item.itemType === '데이터 없음')
      );
      
      if (unfilledItems.length > 0) {
        const confirm = window.confirm(
          `수동 확인이 필요한 항목이 ${unfilledItems.length}개 있습니다.\n` +
          '그대로 다운로드하시겠습니까?\n\n' +
          '(해당 항목들은 "데이터 없음"으로 표시됩니다)'
        );
        if (!confirm) return;
      }

      // Excel 생성
      const excelMetadata: ExcelMetadata = {
        boardName,
        artworkManager,
        productionManager,
        productionQuantity
      };

      // TOP/BOTTOM 분리
      const topCoords = coordinates.filter(c => c.layer === 'TOP');
      const bottomCoords = coordinates.filter(c => c.layer === 'BOTTOM');

      // 정렬 적용 (종류별 > 품명순 > 미삽은 맨 아래)
      const sortedItems = sortBOMItems(items);
      const sortedTopCoords = sortCoordinateItems(topCoords);
      const sortedBottomCoords = sortCoordinateItems(bottomCoords);

      const blob = await generateBOMExcelFromTemplate(
        sortedItems,
        sortedTopCoords,
        sortedBottomCoords,
        excelMetadata
      );
      
      console.log('Blob generated:', { size: blob.size, type: blob.type });
      
      if (!blob || blob.size === 0) {
        throw new Error('엑셀 파일 생성에 실패했습니다. (빈 파일)');
      }
      
      // 파일명: 보드명_YYMMDD_정리본.xlsx
      const today = new Date();
      const dateStr = today.getFullYear().toString().slice(2) + 
        String(today.getMonth() + 1).padStart(2, '0') + 
        String(today.getDate()).padStart(2, '0');
      // 순서 중요: 복합 패턴 먼저 제거
      const cleanName = boardName.trim()
        .replace(/_\d{6}_정리본$/, '')
        .replace(/_정리본$/, '')
        .replace(/_\d{6}$/, '');
      downloadExcelBlob(blob, `${cleanName}_${dateStr}_정리본.xlsx`);
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch (error) {
      console.error('Download error details:', error);
      let errorMessage = '알 수 없는 오류';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast.error(`다운로드 중 오류가 발생했습니다: ${errorMessage}`);
    }
  };

  // 초기화 핸들러
  const handleReset = () => {
    if (confirm('모든 수정사항을 초기화하시겠습니까?')) {
      setItems(initialItems);
    }
  };

  // 동일 항목 합치기 핸들러
  const handleMerge = () => {
    // 이미 합친 상태면 해제
    if (beforeMergeItems) {
      setItems(beforeMergeItems);
      setBeforeMergeItems(null);
      onMergeStateChange?.(false);
      toast.success('합치기가 해제되었습니다.');
      return;
    }
    
    // 종류+품명 기준으로 그룹핑
    const grouped = new Map<string, BOMItem[]>();
    
    items.forEach(item => {
      // "데이터 없음" 항목은 합치지 않음
      if (item.itemName.includes('데이터 없음') || item.itemType === '데이터 없음') {
        const uniqueKey = `__unique__${item.lineNumber}`;
        grouped.set(uniqueKey, [item]);
        return;
      }
      
      const key = `${item.itemType}|${item.itemName}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });
    
    // 합칠 항목이 있는지 확인
    let mergeCount = 0;
    grouped.forEach(groupItems => {
      if (groupItems.length > 1) mergeCount++;
    });
    
    if (mergeCount === 0) {
      toast.info('합칠 수 있는 동일 항목이 없습니다.');
      return;
    }
    
    if (!confirm(`동일한 종류+품명 항목 ${mergeCount}건을 합치시겠습니까?`)) {
      return;
    }
    
    // 합치기 전 상태 저장
    setBeforeMergeItems([...items]);
    
    // 합치기 실행
    const mergedItems: BOMItem[] = [];
    let lineNumber = 1;
    
    grouped.forEach(groupItems => {
      if (groupItems.length === 1) {
        // 단일 항목
        mergedItems.push({ ...groupItems[0], lineNumber: lineNumber++ });
      } else {
        // 합치기
        const first = groupItems[0];
        const mergedRefs = groupItems.map(i => i.refList).join(', ');
        const mergedSetCount = groupItems.reduce((sum, i) => sum + (i.setCount || 0), 0);
        const mergedTotalQty = groupItems.reduce((sum, i) => sum + (i.totalQuantity || 0), 0);
        
        mergedItems.push({
          ...first,
          lineNumber: lineNumber++,
          refList: mergedRefs,
          setCount: mergedSetCount,
          totalQuantity: mergedTotalQty,
        });
      }
    });
    
    setItems(mergedItems);
    onMergeStateChange?.(true);
    toast.success(`${mergeCount}건의 동일 항목이 합쳐졌습니다.`);
  };

  // 저장 핸들러 (DB 업데이트용)
  const handleSave = () => {
    onSave(items);
  };

  // 부모에서 호출 가능하도록 메서드 노출
  useImperativeHandle(ref, () => ({
    handleDownload,
    handleSave,
    handleReset,
    handleMerge,
    isMerged: () => beforeMergeItems !== null
  }));

  // 데이터 수정 핸들러
  const handleCellChange = (index: number, field: keyof BOMItem, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[index] };
    
    // 숫자 필드 처리
    if (field === 'setCount' || field === 'totalQuantity' || field === 'stockQuantity') {
      (item as any)[field] = Number(value) || 0;
    } else if (field === 'refList') {
      (item as any)[field] = value;
    } else {
      (item as any)[field] = value;
    }
    
    // 수동 입력 완료 시 플래그 해제
    if (field === 'itemName' && value && value !== '데이터 없음 (수동 확인 필요)') {
      item.isManualRequired = false;
    }
    if (field === 'itemType' && value && value !== '데이터 없음') {
      item.isNewPart = false;
    }
    
    newItems[index] = item;
    setItems(newItems);
    
    // 종류/품명 변경 시 좌표 데이터도 동기화
    if (field === 'itemType' || field === 'itemName') {
      onBomChange?.(newItems);
    }
  };

  // 행 배경색 결정
  const getRowClassName = (item: BOMItem) => {
    if (item.isManualRequired) return 'bg-yellow-50 hover:bg-yellow-100';
    // BOM에는 있지만 좌표에 없는 경우 (빨간색)
    if (hasMissingCoordinate(item)) return 'bg-red-50 hover:bg-red-100';
    // 학습 데이터에 없는 새로운 부품 (회색)
    if (item.isNewPart) return 'bg-gray-100 hover:bg-gray-200';
    if (item.remark === '미삽') return 'bg-gray-50 hover:bg-gray-100';
    return 'hover:bg-gray-50';
  };

  return (
    <div className="space-y-3">

      {/* 테이블 */}
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm w-full">
        <div className="overflow-x-auto w-full max-w-full">
          <Table className="w-full" style={{ tableLayout: 'fixed' }}>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              <TableRow className="h-6">
                <TableHead className="text-center !h-auto !py-0.5 !px-2" style={{ width: `${maxNoWidth}px` }}>
                  <span className="card-description">No</span>
                </TableHead>
                <TableHead className="text-center whitespace-nowrap !h-auto !py-0.5 !px-2" style={{ width: `${maxTypeWidth}px` }}>
                  <span className="card-description">종류</span>
                </TableHead>
                <TableHead className="whitespace-nowrap !h-auto !py-0.5 !px-2" style={{ width: `${maxNameWidth}px` }}>
                  <span className="card-description">품명</span>
                </TableHead>
                <TableHead className="w-[60px] text-center !h-auto !py-0.5 !px-2">
                  <span className="card-description">SET</span>
                </TableHead>
                <TableHead className="w-[70px] text-center !h-auto !py-0.5 !px-2">
                  <span className="card-description">수량</span>
                </TableHead>
                <TableHead className="w-[60px] text-center hidden sm:table-cell !h-auto !py-0.5 !px-2">
                  <span className="card-description">재고</span>
                </TableHead>
                <TableHead className="!h-auto !py-0.5 !px-2" style={{ width: `${Math.min(maxRefWidth, 350)}px` }}>
                  <span className="card-description">REF</span>
                </TableHead>
                <TableHead className="hidden md:table-cell !h-auto !py-0.5 !px-2" style={{ width: '240px' }}>
                  <span className="card-description">대체품</span>
                </TableHead>
                <TableHead className="!h-auto !py-0.5 !px-2">
                  <span className="card-description">비고</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index} className={getRowClassName(item)}>
                  <TableCell className="text-center py-1 px-2">
                    <div className="card-subtitle">{index + 1}</div>
                  </TableCell>
                  
                  {/* 종류 */}
                  <TableCell className="text-center py-1 px-1 whitespace-nowrap">
                    <input 
                      type="text"
                      className={`w-full text-[10px] text-gray-600 text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        item.itemType === '데이터 없음' ? '!text-red-500 font-bold bg-red-50' : 'bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.itemType || ''}
                      onChange={(e) => handleCellChange(index, 'itemType', e.target.value)}
                      placeholder="종류"
                    />
                  </TableCell>

                  {/* 품명 */}
                  <TableCell className="py-1 px-1 whitespace-nowrap">
                    <input 
                      type="text"
                      className={`w-full text-[10px] border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        hasMissingCoordinate(item)
                          ? 'text-gray-500 bg-red-50'
                          : item.isNewPart 
                            ? 'text-gray-500 bg-gray-100' 
                            : item.isManualRequired 
                              ? 'text-red-600 bg-yellow-50' 
                              : 'text-gray-500 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.itemName}
                      onChange={(e) => handleCellChange(index, 'itemName', e.target.value)}
                      placeholder="품명 입력"
                      title={item.originalFootprint ? `원본: ${item.originalFootprint}` : ''}
                    />
                  </TableCell>

                  {/* SET */}
                  <TableCell className="text-center py-1 px-2">
                    <input 
                      type="number"
                      className="w-full text-[10px] font-medium text-gray-900 text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded bg-transparent px-1"
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.setCount}
                      onChange={(e) => handleCellChange(index, 'setCount', e.target.value)}
                    />
                  </TableCell>

                  {/* 수량 */}
                  <TableCell className="text-center py-1 px-2">
                    <input 
                      type="number"
                      className="w-full text-[10px] font-bold text-gray-900 text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded bg-gray-50 px-1"
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.totalQuantity}
                      readOnly
                      onChange={(e) => handleCellChange(index, 'totalQuantity', e.target.value)}
                    />
                  </TableCell>

                  {/* 재고 */}
                  <TableCell className="hidden sm:table-cell text-center py-1 px-2">
                    <input 
                      type="number"
                      className="w-full text-[10px] font-medium text-gray-900 text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded bg-transparent px-1"
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.stockQuantity || ''}
                      placeholder="0"
                      onChange={(e) => handleCellChange(index, 'stockQuantity', e.target.value)}
                    />
                  </TableCell>

                  {/* REF */}
                  <TableCell className="px-1 py-1 align-middle">
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="text-[10px] text-gray-600 outline-none w-full"
                      style={{ 
                        lineHeight: '14px',
                        wordWrap: 'break-word',
                        overflowWrap: 'break-word',
                        whiteSpace: 'pre-wrap'
                      }}
                      onBlur={(e) => handleCellChange(index, 'refList', e.currentTarget.textContent || '')}
                    >
                      {(item.refList || '').split(',').map(r => r.trim()).filter(r => r).join(', ')}
                    </div>
                  </TableCell>

                  {/* 대체품 */}
                  <TableCell className="hidden md:table-cell py-1 px-2">
                    <input 
                      type="text"
                      className="w-full text-[10px] text-gray-500 px-1 border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded bg-transparent"
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.alternativeItem || ''}
                      onChange={(e) => handleCellChange(index, 'alternativeItem', e.target.value)}
                    />
                  </TableCell>

                  {/* 비고 */}
                  <TableCell className="py-1 px-2">
                    <input 
                      type="text"
                      className={`w-full text-[10px] text-gray-500 px-1 border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded ${
                        item.remark === '미삽' ? '!text-gray-500 font-bold bg-gray-50' : 'bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.remark || ''}
                      onChange={(e) => handleCellChange(index, 'remark', e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {/* 푸터 - 본문 테이블과 동일한 구조 */}
            <tfoot className="bg-gray-50 border-t">
              <tr>
                {/* No 칼럼 */}
                <td className="py-2 px-2">
                  <span className="card-description whitespace-nowrap">총 {items.length}개 항목</span>
                </td>
                {/* 종류 */}
                <td></td>
                {/* 품명 - 합계 라벨 */}
                <td className="text-right pr-2">
                  <span className="card-description">합계:</span>
                </td>
                {/* SET - 합계 숫자 */}
                <td className="text-center py-2">
                  <span className="text-[11px] text-gray-700">{totalSetCount}</span>
                </td>
                {/* 수량 */}
                <td></td>
                {/* 재고 */}
                <td className="hidden sm:table-cell"></td>
                {/* REF */}
                <td></td>
                {/* 대체품 */}
                <td className="hidden md:table-cell"></td>
                {/* 비고 + 범례 */}
                <td className="py-2 px-2 text-right">
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
          </Table>
        </div>
      </div>
    </div>
  );
});

GeneratedPreviewPanel.displayName = 'GeneratedPreviewPanel';

export default GeneratedPreviewPanel;
