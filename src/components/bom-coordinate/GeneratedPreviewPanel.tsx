import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Save, RotateCcw } from 'lucide-react';
import { generateCleanedBOMExcel, BOMItem, CoordinateItem } from '@/utils/excel-generator';
import { toast } from 'sonner';

interface GeneratedPreviewPanelProps {
  bomItems: BOMItem[];
  coordinates: CoordinateItem[];
  boardName: string;
  onSave: (items: BOMItem[]) => void;
}

export default function GeneratedPreviewPanel({ 
  bomItems: initialItems, 
  coordinates, 
  boardName,
  onSave 
}: GeneratedPreviewPanelProps) {
  const [items, setItems] = useState<BOMItem[]>(initialItems);
  const [editingCell, setEditingCell] = useState<{ row: number, field: keyof BOMItem } | null>(null);
  
  // 엑셀 다운로드 핸들러
  const handleDownload = async () => {
    try {
      console.log('Starting download with:', { 
        itemsCount: items.length, 
        coordsCount: coordinates.length, 
        boardName 
      });
      
      const blob = await generateCleanedBOMExcel(items, coordinates, boardName);
      
      console.log('Blob generated:', { size: blob.size, type: blob.type });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 파일명 형식: [보드명]_BOM_정리.xlsx
      a.download = `${boardName}_BOM_정리.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch (error) {
      console.error('Download error details:', error);
      toast.error(`다운로드 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`);
    }
  };

  // 데이터 수정 핸들러
  const handleCellChange = (index: number, field: keyof BOMItem, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[index] };
    
    // 숫자 필드 처리
    if (field === 'setCount' || field === 'totalQuantity' || field === 'stockQuantity') {
      (item as any)[field] = Number(value) || 0;
    } else if (field === 'refList') {
      // REF 리스트는 문자열로 저장 (엑셀 생성 시 처리)
      (item as any)[field] = value;
    } else {
      (item as any)[field] = value;
    }
    
    newItems[index] = item;
    setItems(newItems);
  };

  // 초기화 핸들러
  const handleReset = () => {
    if (confirm('모든 수정사항을 초기화하시겠습니까?')) {
      setItems(initialItems);
    }
  };

  // 저장 핸들러 (DB 업데이트용)
  const handleSave = () => {
    onSave(items);
    toast.success('수정사항이 저장되었습니다.');
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex-1">
          <h3 className="text-base sm:text-lg font-semibold">정리된 BOM 미리보기</h3>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            데이터를 클릭하여 직접 수정할 수 있습니다. 확인 후 엑셀로 다운로드하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Button 
            onClick={handleReset}
            className="flex-1 sm:flex-initial button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs sm:text-sm"
          >
            <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            초기화
          </Button>
          <Button 
            onClick={handleSave}
            className="flex-1 sm:flex-initial button-base bg-blue-500 hover:bg-blue-600 text-white text-xs sm:text-sm"
          >
            <Save className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            저장
          </Button>
          <Button 
            onClick={handleDownload} 
            className="flex-1 sm:flex-initial button-base bg-green-500 hover:bg-green-600 text-white text-xs sm:text-sm"
          >
            <Download className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            Excel
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        <div className="overflow-x-auto max-h-[400px] sm:max-h-[500px] lg:max-h-[600px]">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-[40px] sm:w-[50px] text-center text-xs">No</TableHead>
                <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">종류</TableHead>
                <TableHead className="min-w-[120px] sm:min-w-[200px] text-xs">품명</TableHead>
                <TableHead className="w-[50px] sm:w-[60px] text-center text-xs">SET</TableHead>
                <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">수량</TableHead>
                <TableHead className="w-[50px] sm:w-[60px] text-center text-xs hidden sm:table-cell">재고</TableHead>
                <TableHead className="w-[70px] sm:w-[80px] text-center text-xs">CHECK</TableHead>
                <TableHead className="min-w-[120px] sm:min-w-[200px] text-xs">REF</TableHead>
                <TableHead className="w-[100px] sm:w-[150px] text-xs hidden md:table-cell">대체품</TableHead>
                <TableHead className="w-[100px] sm:w-[150px] text-xs">비고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index} className="hover:bg-gray-50">
                  <TableCell className="text-center text-gray-500">{index + 1}</TableCell>
                  
                  {/* 종류 */}
                  <TableCell className="p-1">
                    <Input 
                      className="h-7 sm:h-8 text-center border-transparent hover:border-gray-200 focus:border-primary text-xs"
                      value={item.itemType || ''}
                      onChange={(e) => handleCellChange(index, 'itemType', e.target.value)}
                    />
                  </TableCell>

                  {/* 품명 */}
                  <TableCell className="p-1">
                    <Input 
                      className="h-7 sm:h-8 border-transparent hover:border-gray-200 focus:border-primary font-medium text-xs"
                      value={item.itemName}
                      onChange={(e) => handleCellChange(index, 'itemName', e.target.value)}
                    />
                  </TableCell>

                  {/* SET */}
                  <TableCell className="p-1">
                    <Input 
                      type="number"
                      className="h-7 sm:h-8 text-center border-transparent hover:border-gray-200 focus:border-primary text-xs"
                      value={item.setCount}
                      onChange={(e) => handleCellChange(index, 'setCount', e.target.value)}
                    />
                  </TableCell>

                  {/* 수량 */}
                  <TableCell className="p-1">
                    <Input 
                      type="number"
                      className="h-7 sm:h-8 text-center border-transparent hover:border-gray-200 focus:border-primary bg-gray-50 text-xs"
                      value={item.totalQuantity}
                      readOnly // 수량은 보통 계산값이므로 읽기 전용 (필요 시 해제)
                      onChange={(e) => handleCellChange(index, 'totalQuantity', e.target.value)}
                    />
                  </TableCell>

                  {/* 재고 */}
                  <TableCell className="p-1 hidden sm:table-cell">
                    <Input 
                      type="number"
                      className="h-8 text-center border-transparent hover:border-gray-200 focus:border-primary text-xs"
                      value={item.stockQuantity || ''}
                      placeholder="0"
                      onChange={(e) => handleCellChange(index, 'stockQuantity', e.target.value)}
                    />
                  </TableCell>

                  {/* CHECK */}
                  <TableCell className="p-1">
                    <select 
                      className="w-full h-7 sm:h-8 text-center text-xs border-transparent hover:border-gray-200 focus:border-primary bg-transparent rounded outline-none cursor-pointer"
                      value={item.checkStatus || '□양호'}
                      onChange={(e) => handleCellChange(index, 'checkStatus', e.target.value)}
                    >
                      <option value="□양호">□양호</option>
                      <option value="□불량">□불량</option>
                      <option value="□확인필요">□확인필요</option>
                    </select>
                  </TableCell>

                  {/* REF */}
                  <TableCell className="p-1">
                    <textarea
                      className="w-full min-h-[28px] sm:min-h-[32px] p-1 text-xs border border-transparent hover:border-gray-200 focus:border-primary rounded resize-y bg-transparent outline-none"
                      value={item.refList || ''}
                      onChange={(e) => handleCellChange(index, 'refList', e.target.value)}
                      rows={1}
                    />
                  </TableCell>

                  {/* 대체품 */}
                  <TableCell className="p-1 hidden md:table-cell">
                    <Input 
                      className="h-8 border-transparent hover:border-gray-200 focus:border-primary text-xs"
                      value={item.alternativeItem || ''}
                      onChange={(e) => handleCellChange(index, 'alternativeItem', e.target.value)}
                    />
                  </TableCell>

                  {/* 비고 */}
                  <TableCell className="p-1">
                    <Input 
                      className={`h-7 sm:h-8 border-transparent hover:border-gray-200 focus:border-primary text-xs ${item.remark === '미삽' ? 'text-red-500 font-bold' : ''}`}
                      value={item.remark || ''}
                      onChange={(e) => handleCellChange(index, 'remark', e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="bg-gray-50 p-2 sm:p-3 border-t text-xs text-gray-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <span>총 {items.length}개 항목</span>
          <span className="text-[10px] sm:text-xs">* 셀을 클릭하여 직접 수정할 수 있습니다. 수정 후 '변경사항 저장'을 눌러주세요.</span>
        </div>
      </div>
    </div>
  );
}


