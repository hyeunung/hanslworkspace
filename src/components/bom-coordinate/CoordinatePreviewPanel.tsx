import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type CoordinateItem, type BOMItem } from '@/utils/v7-generator';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';

interface CoordinatePreviewPanelProps {
  coordinates: CoordinateItem[];
  bomItems?: BOMItem[];
}

export default function CoordinatePreviewPanel({ coordinates, bomItems = [] }: CoordinatePreviewPanelProps) {
  const topCoords = coordinates.filter(c => c.layer === 'TOP');
  const bottomCoords = coordinates.filter(c => c.layer === 'BOTTOM');

  // BOM의 REF Set 생성 (빠른 조회를 위해)
  const bomRefSet = useMemo(() => {
    const refSet = new Set<string>();
    bomItems.forEach((item: BOMItem) => {
      if (item.refList) {
        const refs = item.refList.split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
        refs.forEach(ref => refSet.add(ref));
      }
    });
    return refSet;
  }, [bomItems]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
      {/* 좌측: TOP */}
      <div className="w-full">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-700">TOP</h4>
          <span className="badge-stats bg-gray-100 text-gray-600">{topCoords.length}</span>
        </div>
        <CoordinateTable data={topCoords} bomRefSet={bomRefSet} />
      </div>

      {/* 우측: BOTTOM */}
      <div className="w-full">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-700">BOTTOM</h4>
          <span className="badge-stats bg-gray-100 text-gray-600">{bottomCoords.length}</span>
        </div>
        <CoordinateTable data={bottomCoords} bomRefSet={bomRefSet} />
      </div>
    </div>
  );
}

function CoordinateTable({ data, bomRefSet }: { data: CoordinateItem[]; bomRefSet: Set<string> }) {
  const totalCount = data.length;
  
  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm w-full">
      <div className="overflow-x-auto w-full max-w-full">
        <Table className="w-full table-auto">
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
            <TableRow className="h-6">
              <TableHead className="w-[50px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">No</span>
              </TableHead>
              <TableHead className="text-center whitespace-nowrap !h-auto !py-0.5 !px-2" style={{ minWidth: '80px' }}>
                <span className="card-description">종류</span>
              </TableHead>
              <TableHead className="whitespace-nowrap !h-auto !py-0.5 !px-2" style={{ minWidth: '120px' }}>
                <span className="card-description">품명</span>
              </TableHead>
              <TableHead className="w-[80px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">RefDes</span>
              </TableHead>
              <TableHead className="w-[70px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Layer</span>
              </TableHead>
              <TableHead className="w-[90px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">X</span>
              </TableHead>
              <TableHead className="w-[90px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Y</span>
              </TableHead>
              <TableHead className="w-[70px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Angle</span>
              </TableHead>
              <TableHead className="!h-auto !py-0.5 !px-2" style={{ minWidth: '80px' }}>
                <span className="card-description">비고</span>
              </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
                <TableCell colSpan={9} className="text-center py-6 card-description">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
              data.map((item, index) => {
                // 연속된 동일 종류는 첫 번째만 표시
                const prevType = index > 0 ? data[index - 1].type : null;
                const showType = item.type !== prevType;
                const isMissingBom = item.remark === 'BOM 미존재';
                // 좌표에는 있지만 BOM에는 없는 경우 체크
                const isMissingInBom = item.refDes && !bomRefSet.has(item.refDes.toUpperCase());
                
                return (
                <TableRow 
                  key={index} 
                  className={`hover:bg-gray-50 ${item.remark === '미삽' ? 'bg-gray-50' : ''} ${isMissingBom || isMissingInBom ? 'bg-red-50/60' : ''}`}
                >
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] text-gray-500">{index + 1}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-1 whitespace-nowrap">
                    <span className={`text-[10px] ${isMissingBom || isMissingInBom ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                      {showType ? (item.type || '-') : ''}
                    </span>
                  </TableCell>
                  <TableCell className="py-1 px-1 whitespace-nowrap">
                    <span className={`text-[10px] ${item.remark === '미삽' ? 'text-gray-400' : isMissingBom || isMissingInBom ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                      {item.partName || '-'}
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className={`text-[10px] font-medium ${isMissingBom || isMissingInBom ? 'text-red-700' : 'text-gray-900'}`}>{item.refDes}</span>
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <Badge 
                      variant={item.layer === 'TOP' ? 'default' : 'secondary'} 
                      className={`text-[9px] px-1.5 py-0 h-4 ${isMissingBom || isMissingInBom ? 'bg-red-100 text-red-700 border border-red-200' : ''}`}
                    >
                      {item.layer}
                  </Badge>
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className={`text-[10px] font-mono ${isMissingBom || isMissingInBom ? 'text-red-600' : 'text-gray-600'}`}>{item.locationX?.toFixed(2)}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className={`text-[10px] font-mono ${isMissingBom || isMissingInBom ? 'text-red-600' : 'text-gray-600'}`}>{item.locationY?.toFixed(2)}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className={`text-[10px] font-mono ${isMissingBom || isMissingInBom ? 'text-red-600' : 'text-gray-600'}`}>{item.rotation || 0}</span>
                  </TableCell>
                  <TableCell className="py-1 px-2">
                    <span className={`text-[10px] ${item.remark === '미삽' ? 'text-red-500 font-medium' : isMissingBom || isMissingInBom ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {isMissingInBom && !isMissingBom ? 'BOM에 없음' : (item.remark || '')}
                    </span>
                  </TableCell>
              </TableRow>
              )})
          )}
        </TableBody>
          {/* 푸터 */}
          <tfoot className="bg-gray-50 border-t">
            <tr>
              <td colSpan={9} className="py-2 px-2">
                <div className="flex justify-between items-center">
                  <span className="card-description">총 {totalCount}개 항목</span>
                  <div className="flex gap-4 card-description">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></span>
                      미삽
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-red-50 border border-red-200 rounded"></span>
                      BOM에 없음
                    </span>
                  </div>
                </div>
              </td>
            </tr>
          </tfoot>
      </Table>
      </div>
    </div>
  );
}
