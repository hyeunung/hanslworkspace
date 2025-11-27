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
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">좌표 데이터 미리보기</h3>
        <div className="flex gap-2 text-sm text-gray-500">
          <Badge variant="outline">TOP: {topCoords.length}개</Badge>
          <Badge variant="outline">BOTTOM: {bottomCoords.length}개</Badge>
        </div>
      </div>

      <div className="border rounded-lg bg-white shadow-sm p-4">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="all">전체 ({coordinates.length})</TabsTrigger>
            <TabsTrigger value="top">TOP ({topCoords.length})</TabsTrigger>
            <TabsTrigger value="bottom">BOTTOM ({bottomCoords.length})</TabsTrigger>
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
    <div className="overflow-x-auto max-h-[400px] border rounded">
      <Table>
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
          <TableRow>
            <TableHead className="w-[80px] text-center">Ref</TableHead>
            <TableHead className="w-[150px]">Part Name</TableHead>
            <TableHead className="w-[80px] text-center">Type</TableHead>
            <TableHead className="w-[80px] text-center">Side</TableHead>
            <TableHead className="w-[80px] text-center">X</TableHead>
            <TableHead className="w-[80px] text-center">Y</TableHead>
            <TableHead className="w-[80px] text-center">Angle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            data.map((item, index) => (
              <TableRow key={index} className="hover:bg-gray-50 text-xs">
                <TableCell className="text-center font-medium">{item.ref}</TableCell>
                <TableCell className="truncate max-w-[150px]" title={item.partName}>
                  {item.partName}
                </TableCell>
                <TableCell className="text-center">{item.partType || 'SMD'}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={item.side === 'TOP' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0 h-5">
                    {item.side}
                  </Badge>
                </TableCell>
                <TableCell className="text-center font-mono text-gray-600">{item.x}</TableCell>
                <TableCell className="text-center font-mono text-gray-600">{item.y}</TableCell>
                <TableCell className="text-center font-mono text-gray-600">{item.angle}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}


