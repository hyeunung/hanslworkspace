import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type CoordinateItem } from '@/utils/v7-generator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CoordinatePreviewPanelProps {
  coordinates: CoordinateItem[];
}

export default function CoordinatePreviewPanel({ coordinates }: CoordinatePreviewPanelProps) {
  const topCoords = coordinates.filter(c => c.layer === 'TOP');
  const bottomCoords = coordinates.filter(c => c.layer === 'BOTTOM');

  return (
    <div className="space-y-3">
      <Tabs defaultValue="top" className="w-full">
        <TabsList className="mb-3 grid grid-cols-2 h-8">
          <TabsTrigger value="top" className="text-[10px] h-7">
            TOP
            <span className="ml-1 text-gray-400">{topCoords.length}</span>
          </TabsTrigger>
          <TabsTrigger value="bottom" className="text-[10px] h-7">
            BOTTOM
            <span className="ml-1 text-gray-400">{bottomCoords.length}</span>
          </TabsTrigger>
          </TabsList>

          <TabsContent value="top" className="mt-0">
            <CoordinateTable data={topCoords} />
          </TabsContent>
          <TabsContent value="bottom" className="mt-0">
            <CoordinateTable data={bottomCoords} />
          </TabsContent>
        </Tabs>
    </div>
  );
}

function CoordinateTable({ data }: { data: CoordinateItem[] }) {
  const totalCount = data.length;
  
  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="overflow-x-auto">
        <Table className="table-auto !w-auto">
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
            <TableRow className="h-6">
              <TableHead className="w-[40px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">No</span>
              </TableHead>
              <TableHead className="text-center whitespace-nowrap !h-auto !py-0.5 !px-2">
                <span className="card-description">종류</span>
              </TableHead>
              <TableHead className="whitespace-nowrap !h-auto !py-0.5 !px-2">
                <span className="card-description">품명</span>
              </TableHead>
              <TableHead className="w-[80px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">RefDes</span>
              </TableHead>
              <TableHead className="w-[60px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Layer</span>
              </TableHead>
              <TableHead className="w-[80px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">X</span>
              </TableHead>
              <TableHead className="w-[80px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Y</span>
              </TableHead>
              <TableHead className="w-[60px] text-center !h-auto !py-0.5 !px-2">
                <span className="card-description">Angle</span>
              </TableHead>
              <TableHead className="w-[80px] !h-auto !py-0.5 !px-2">
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
                
                return (
                <TableRow 
                  key={index} 
                  className={`hover:bg-gray-50 ${item.remark === '미삽' ? 'bg-gray-50' : ''}`}
                >
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] text-gray-500">{index + 1}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-1 whitespace-nowrap">
                    <span className="text-[10px] text-gray-600">{showType ? (item.type || '-') : ''}</span>
                  </TableCell>
                  <TableCell className="py-1 px-1 whitespace-nowrap">
                    <span className={`text-[10px] ${item.remark === '미삽' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {item.partName || '-'}
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] font-medium text-gray-900">{item.refDes}</span>
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <Badge 
                      variant={item.layer === 'TOP' ? 'default' : 'secondary'} 
                      className="text-[9px] px-1.5 py-0 h-4"
                    >
                      {item.layer}
                  </Badge>
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] font-mono text-gray-600">{item.locationX?.toFixed(2)}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] font-mono text-gray-600">{item.locationY?.toFixed(2)}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] font-mono text-gray-600">{item.rotation || 0}</span>
                  </TableCell>
                  <TableCell className="py-1 px-2">
                    <span className={`text-[10px] ${item.remark === '미삽' ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                      {item.remark || ''}
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
