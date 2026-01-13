import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type CoordinateItem, type BOMItem } from '@/utils/v7-generator';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface CoordinatePreviewPanelProps {
  coordinates: CoordinateItem[];
  bomItems?: BOMItem[];
  onCoordinatesChange?: (nextCoordinates: CoordinateItem[]) => void;
}

export default function CoordinatePreviewPanel({
  coordinates,
  bomItems = [],
  onCoordinatesChange,
}: CoordinatePreviewPanelProps) {
  const [localCoordinates, setLocalCoordinates] = useState<CoordinateItem[]>(coordinates);

  const normalizeLayer = useCallback((layer?: string | null) => {
    const v = (layer || '').trim().toUpperCase();
    if (!v) return '';
    if (v === 'TOP' || v === 'T' || v === 'TOPSIDE' || v === 'FRONT' || v === 'F') return 'TOP';
    if (v === 'BOTTOM' || v === 'BOT' || v === 'B' || v === 'BOTTOMSIDE' || v === 'BACK') return 'BOTTOM';
    return v;
  }, []);

  // props 변경 시 동기화
  useEffect(() => {
    // layer 값이 TOP/BOTTOM과 정확히 일치하지 않으면 select가 빈칸처럼 보일 수 있어 정규화
    setLocalCoordinates(
      coordinates.map(c => ({
        ...c,
        layer: normalizeLayer(c.layer) || c.layer,
      }))
    );
  }, [coordinates, normalizeLayer]);

  const handleUpdateCoord = useCallback(
    (coordIndex: number, patch: Partial<CoordinateItem>) => {
      setLocalCoordinates(prev => {
        const next = [...prev];
        next[coordIndex] = { ...next[coordIndex], ...patch };
        onCoordinatesChange?.(next);
        return next;
      });
    },
    [onCoordinatesChange]
  );

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

  // BOM에서 "수동 확인 필요"로 표시된 REF Set (좌표에서도 노란색 표시용)
  const manualRefSet = useMemo(() => {
    const refSet = new Set<string>();
    bomItems.forEach((item: BOMItem) => {
      if (!item.isManualRequired) return;
      const refs = (item.refList || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
      refs.forEach(ref => refSet.add(ref));
    });
    return refSet;
  }, [bomItems]);

  const topRows = useMemo(
    () =>
      localCoordinates
        .map((coord, index) => ({ coord, index }))
        .filter(r => normalizeLayer(r.coord.layer) === 'TOP'),
    [localCoordinates]
  );

  const bottomRows = useMemo(
    () =>
      localCoordinates
        .map((coord, index) => ({ coord, index }))
        .filter(r => normalizeLayer(r.coord.layer) === 'BOTTOM'),
    [localCoordinates]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
      {/* 좌측: TOP */}
      <div className="w-full">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-700">TOP</h4>
          <span className="badge-stats bg-gray-100 text-gray-600">{topRows.length}</span>
        </div>
        <CoordinateTable rows={topRows} bomRefSet={bomRefSet} manualRefSet={manualRefSet} onUpdate={handleUpdateCoord} />
      </div>

      {/* 우측: BOTTOM */}
      <div className="w-full">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-700">BOTTOM</h4>
          <span className="badge-stats bg-gray-100 text-gray-600">{bottomRows.length}</span>
        </div>
        <CoordinateTable rows={bottomRows} bomRefSet={bomRefSet} manualRefSet={manualRefSet} onUpdate={handleUpdateCoord} />
      </div>
    </div>
  );
}

function CoordinateTable({
  rows,
  bomRefSet,
  manualRefSet,
  onUpdate,
}: {
  rows: Array<{ coord: CoordinateItem; index: number }>;
  bomRefSet: Set<string>;
  manualRefSet: Set<string>;
  onUpdate: (coordIndex: number, patch: Partial<CoordinateItem>) => void;
}) {
  const totalCount = rows.length;
  const normalizeLayer = (layer?: string | null) => {
    const v = (layer || '').trim().toUpperCase();
    if (!v) return '';
    if (v === 'TOP' || v === 'T' || v === 'TOPSIDE' || v === 'FRONT' || v === 'F') return 'TOP';
    if (v === 'BOTTOM' || v === 'BOT' || v === 'B' || v === 'BOTTOMSIDE' || v === 'BACK') return 'BOTTOM';
    return v;
  };
  const defaultLayerForTable: 'TOP' | 'BOTTOM' = rows[0]?.coord?.layer === 'BOTTOM' ? 'BOTTOM' : 'TOP';
  
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
          {rows.length === 0 ? (
            <TableRow>
                <TableCell colSpan={9} className="text-center py-6 card-description">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
              rows.map(({ coord: item, index: coordIndex }, rowIndex) => {
                const isMissingBom = item.remark === 'BOM 미존재';
                // 좌표에는 있지만 BOM에는 없는 경우 체크
                const isMissingInBom = item.refDes && !bomRefSet.has(item.refDes.toUpperCase());
                const isManualRequired = item.refDes && manualRefSet.has(item.refDes.toUpperCase());
                
                return (
                <TableRow 
                  key={coordIndex} 
                  className={`hover:bg-gray-50 ${item.remark === '미삽' ? 'bg-gray-50' : ''} ${isMissingBom || isMissingInBom ? 'bg-red-50/60' : ''} ${isManualRequired && !(isMissingBom || isMissingInBom) ? 'bg-yellow-50 hover:bg-yellow-100' : ''}`}
                >
                  <TableCell className="text-center py-1 px-2">
                    <span className="text-[10px] text-gray-500">{rowIndex + 1}</span>
                  </TableCell>
                  <TableCell className="text-center py-1 px-1 whitespace-nowrap">
                    <input
                      type="text"
                      className={`w-full text-[10px] text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-600 font-medium bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-600 bg-yellow-50'
                            : 'text-gray-600 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.type || ''}
                      onChange={(e) => onUpdate(coordIndex, { type: e.target.value })}
                      placeholder="-"
                    />
                  </TableCell>
                  <TableCell className="py-1 px-1 whitespace-nowrap">
                    <input
                      type="text"
                      className={`w-full text-[10px] border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        item.remark === '미삽'
                          ? 'text-gray-400 bg-gray-50'
                          : isMissingBom || isMissingInBom
                            ? 'text-red-600 font-medium bg-red-50/40'
                            : isManualRequired
                              ? 'text-red-600 bg-yellow-50'
                              : 'text-gray-600 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.partName || ''}
                      onChange={(e) => onUpdate(coordIndex, { partName: e.target.value })}
                      placeholder="-"
                    />
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <input
                      type="text"
                      className={`w-full text-[10px] text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-700 font-medium bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-700 bg-yellow-50'
                            : 'text-gray-900 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.refDes || ''}
                      onChange={(e) => onUpdate(coordIndex, { refDes: e.target.value })}
                      placeholder="-"
                    />
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <select
                      className={`w-full text-[10px] text-center border border-gray-200 rounded px-1 h-6 bg-white ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-700 border-red-200 bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-700 border-yellow-300 bg-yellow-50'
                            : 'text-gray-700'
                      }`}
                      value={normalizeLayer(item.layer) || defaultLayerForTable}
                      onChange={(e) => onUpdate(coordIndex, { layer: e.target.value })}
                    >
                      <option value="TOP">TOP</option>
                      <option value="BOTTOM">BOTTOM</option>
                    </select>
                </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className={`w-full text-[10px] font-mono text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-600 bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-600 bg-yellow-50'
                            : 'text-gray-600 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={Number.isFinite(item.locationX) ? item.locationX : 0}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        onUpdate(coordIndex, { locationX: Number.isFinite(next) ? next : item.locationX });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className={`w-full text-[10px] font-mono text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-600 bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-600 bg-yellow-50'
                            : 'text-gray-600 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={Number.isFinite(item.locationY) ? item.locationY : 0}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        onUpdate(coordIndex, { locationY: Number.isFinite(next) ? next : item.locationY });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-center py-1 px-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className={`w-full text-[10px] font-mono text-center border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        isMissingBom || isMissingInBom
                          ? 'text-red-600 bg-red-50/40'
                          : isManualRequired
                            ? 'text-red-600 bg-yellow-50'
                            : 'text-gray-600 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={Number.isFinite(item.rotation) ? item.rotation : 0}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        onUpdate(coordIndex, { rotation: Number.isFinite(next) ? next : item.rotation });
                      }}
                    />
                  </TableCell>
                  <TableCell className="py-1 px-2">
                    <input
                      type="text"
                      className={`w-full text-[10px] border border-transparent hover:border-gray-200 focus:border-primary focus:outline-none rounded px-1 ${
                        item.remark === '미삽'
                          ? 'text-red-500 font-medium bg-gray-50'
                          : isMissingBom || isMissingInBom
                            ? 'text-red-600 font-medium bg-red-50/40'
                            : 'text-gray-500 bg-transparent'
                      }`}
                      style={{ fontSize: '10px', height: '24px' }}
                      value={item.remark || ''}
                      onChange={(e) => onUpdate(coordIndex, { remark: e.target.value })}
                      placeholder={isMissingInBom && !isMissingBom ? 'BOM에 없음' : ''}
                    />
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
                      <span className="w-3 h-3 bg-yellow-100 border border-yellow-300 rounded"></span>
                      수동 확인
                    </span>
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
