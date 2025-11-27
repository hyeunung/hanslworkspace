import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CoordinateItem } from '@/utils/excel-generator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CoordinatePreviewPanelProps {
  coordinates: CoordinateItem[];
}

export default function CoordinatePreviewPanel({ coordinates }: CoordinatePreviewPanelProps) {
  const topCoords = coordinates.filter(c => c.side?.toUpperCase().includes('TOP'));
  const bottomCoords = coordinates.filter(c => c.side?.toUpperCase().includes('BOT'));

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4">
        <h3 className="text-base sm:text-lg font-semibold">좌표 데이터 미리보기</h3>
        <div className="flex gap-2 text-xs sm:text-sm text-gray-500">
          <Badge variant="outline" className="text-[10px] sm:text-xs">TOP: {topCoords.length}개</Badge>
          <Badge variant="outline" className="text-[10px] sm:text-xs">BOTTOM: {bottomCoords.length}개</Badge>
        </div>
      </div>

      <div className="border rounded-lg bg-white shadow-sm p-3 sm:p-4">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="mb-3 sm:mb-4 w-full grid grid-cols-3">
            <TabsTrigger value="all" className="text-xs sm:text-sm">전체 ({coordinates.length})</TabsTrigger>
            <TabsTrigger value="top" className="text-xs sm:text-sm">TOP ({topCoords.length})</TabsTrigger>
            <TabsTrigger value="bottom" className="text-xs sm:text-sm">BOTTOM ({bottomCoords.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-0">
            <CoordinateTable data={coordinates} />
          </TabsContent>
          <TabsContent value="top" className="mt-0">
            <CoordinateTable data={topCoords} />
          </TabsContent>
          <TabsContent value="bottom" className="mt-0">
            <CoordinateTable data={bottomCoords} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function CoordinateTable({ data }: { data: CoordinateItem[] }) {
  return (
    <div className="overflow-x-auto max-h-[300px] sm:max-h-[400px] border rounded">
      <Table>
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
          <TableRow>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">Ref</TableHead>
            <TableHead className="min-w-[100px] sm:min-w-[150px] text-xs">Part Name</TableHead>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs hidden sm:table-cell">Type</TableHead>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">Side</TableHead>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">X</TableHead>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs">Y</TableHead>
            <TableHead className="w-[60px] sm:w-[80px] text-center text-xs hidden md:table-cell">Angle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-6 sm:py-8 text-gray-500 text-xs sm:text-sm">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            data.map((item, index) => (
              <TableRow key={index} className="hover:bg-gray-50 text-[10px] sm:text-xs">
                <TableCell className="text-center font-medium">{item.ref}</TableCell>
                <TableCell className="truncate max-w-[100px] sm:max-w-[150px]" title={item.partName}>
                  {item.partName}
                </TableCell>
                <TableCell className="text-center hidden sm:table-cell">{item.partType || 'SMD'}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={item.side === 'TOP' ? 'default' : 'secondary'} className="text-[9px] sm:text-[10px] px-1 py-0 h-4 sm:h-5">
                    {item.side}
                  </Badge>
                </TableCell>
                <TableCell className="text-center font-mono text-gray-600">{item.x}</TableCell>
                <TableCell className="text-center font-mono text-gray-600">{item.y}</TableCell>
                <TableCell className="text-center font-mono text-gray-600 hidden md:table-cell">{item.angle}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}


