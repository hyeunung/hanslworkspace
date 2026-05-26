/**
 * 회귀 테스트: 엑셀 다운로드 시 템플릿 더미 데이터 잔존 방지
 *
 * 사고 이력:
 * - B260526_002 (DB BOTTOM 1건) 엑셀 다운로드 시 템플릿의 D16/D20/J2/J3 더미 4행이 잔존
 * - PR #54로 fillCoordinateSheet에 더미 셀 명시적 비우기 추가
 * - 이 테스트는 그 사고가 재발하지 않도록 안전망을 잠가둠
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { generateBOMExcelFromTemplate } from '../excel-generator';
import type { BOMItem, CoordinateItem } from '../v7-generator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

// generateBOMExcelFromTemplate 내부에서 fetch('/templates/BOM_Template.xlsx') 호출
// → 로컬 파일에서 읽도록 패치
beforeAll(() => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/templates/BOM_Template.xlsx') || url.startsWith('/templates/')) {
      const localPath = join(REPO_ROOT, 'public/templates/BOM_Template.xlsx');
      const buf = readFileSync(localPath);
      return new Response(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

async function readGeneratedExcel(blob: Blob): Promise<ExcelJS.Workbook> {
  const buf = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

function makeBOMItem(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    lineNumber: 1,
    itemType: 'CAPACITOR(SMD)',
    itemName: '0.1uF',
    setCount: 1,
    totalQuantity: 1,
    checkStatus: '',
    refList: 'C1',
    remark: '',
    isManualRequired: false,
    isNewPart: false,
    ...overrides,
  };
}

function makeCoord(overrides: Partial<CoordinateItem> = {}): CoordinateItem {
  return {
    type: 'CAPACITOR(SMD)',
    partName: '0.1uF',
    refDes: 'C1',
    layer: 'TOP',
    locationX: 10,
    locationY: 10,
    rotation: 0,
    ...overrides,
  };
}

// 템플릿의 BOTTOM 시트에 더미 행이 몇 개 박혀 있는지 (현재 4행: D16, D20, J2, J3)
function countDataRowsByRefPattern(sheet: ExcelJS.Worksheet): number {
  let count = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= 1) return; // 헤더 제외
    const ref = row.getCell('C').value;
    const refStr = ref ? String(ref).trim() : '';
    if (refStr && /^[A-Z]{1,3}\d+/i.test(refStr)) count++;
  });
  return count;
}

describe('엑셀 생성: 템플릿 더미 잔존 방지 (B260526_002 사고 회귀)', () => {
  const metadata = {
    boardName: 'TEST_BOARD_V1.0',
    artworkManager: '테스트',
    productionManager: '테스트',
    productionQuantity: 5,
  };

  it('BOTTOM 좌표 1건만 있을 때 BOTTOM 시트에 1행만 출력 (템플릿 더미 4행 제거)', async () => {
    const bomItems = [makeBOMItem()];
    const topCoords: CoordinateItem[] = [];
    const bottomCoords = [makeCoord({ refDes: 'J99', partName: 'TEST_BOTTOM', layer: 'BOTTOM' })];

    const blob = await generateBOMExcelFromTemplate(bomItems, topCoords, bottomCoords, metadata);
    const wb = await readGeneratedExcel(blob);

    const bottomSheet = wb.getWorksheet('BOTTOM');
    expect(bottomSheet).toBeDefined();
    const refRows = countDataRowsByRefPattern(bottomSheet!);
    expect(refRows).toBe(1); // 템플릿 더미 D16/D20/J2/J3가 모두 제거되고 J99만 남아야 함

    // 명시적으로 첫 데이터 행에 J99가 있는지 확인
    expect(bottomSheet!.getRow(2).getCell('C').value).toBe('J99');

    // 잔여 더미 행 (R3~)에 테두리/배경 같은 스타일도 남아있지 않아야 함
    const lastRow = bottomSheet!.lastRow?.number ?? 0;
    for (let r = 3; r <= lastRow; r++) {
      const row = bottomSheet!.getRow(r);
      for (let c = 1; c <= 8; c++) {
        const cell = row.getCell(c);
        const hasBorder = cell.border && (cell.border.top || cell.border.bottom || cell.border.left || cell.border.right);
        if (hasBorder) {
          throw new Error(`BOTTOM R${r}C${c}에 테두리 잔존: ${JSON.stringify(cell.border)}`);
        }
      }
    }
  });

  it('TOP 좌표 1건만 있을 때 TOP 시트에 1행만 출력 (템플릿 더미 63행 제거)', async () => {
    const bomItems = [makeBOMItem()];
    const topCoords = [makeCoord({ refDes: 'U99', partName: 'TEST_TOP', layer: 'TOP' })];
    const bottomCoords: CoordinateItem[] = [];

    const blob = await generateBOMExcelFromTemplate(bomItems, topCoords, bottomCoords, metadata);
    const wb = await readGeneratedExcel(blob);

    const topSheet = wb.getWorksheet('TOP');
    expect(topSheet).toBeDefined();
    const refRows = countDataRowsByRefPattern(topSheet!);
    expect(refRows).toBe(1);
    expect(topSheet!.getRow(2).getCell('C').value).toBe('U99');
  });

  it('TOP/BOTTOM 좌표 모두 0건이면 두 시트 모두 제거 (BOM-only)', async () => {
    const bomItems = [makeBOMItem()];
    const blob = await generateBOMExcelFromTemplate(bomItems, [], [], metadata);
    const wb = await readGeneratedExcel(blob);

    expect(wb.getWorksheet('TOP')).toBeUndefined();
    expect(wb.getWorksheet('BOTTOM')).toBeUndefined();
  });

  it('BOTTOM 좌표가 많아도 (10건) BOTTOM 시트가 정확히 10행만 출력', async () => {
    const bomItems = [makeBOMItem()];
    const bottomCoords = Array.from({ length: 10 }, (_, i) =>
      makeCoord({ refDes: `R${i + 1}`, partName: '10K', type: 'RESISTOR(SMD)', layer: 'BOTTOM' }),
    );

    const blob = await generateBOMExcelFromTemplate(bomItems, [], bottomCoords, metadata);
    const wb = await readGeneratedExcel(blob);

    const bottomSheet = wb.getWorksheet('BOTTOM');
    expect(countDataRowsByRefPattern(bottomSheet!)).toBe(10);
  });

  it('BOM 시트도 더미 잔존 안전망 작동 — 1건 BOM만 있을 때 R8에만 데이터, 그 이후는 모두 빈 셀', async () => {
    const bomItems = [makeBOMItem({ itemName: 'TEST_ITEM', refList: 'C1' })];
    const blob = await generateBOMExcelFromTemplate(bomItems, [], [], metadata);
    const wb = await readGeneratedExcel(blob);

    // 첫 시트가 BOM 시트
    const bomSheet = wb.worksheets[0];
    // R8에 TEST_ITEM이 있어야 함
    expect(bomSheet.getRow(8).getCell('C').value).toBe('TEST_ITEM');

    // R9 이후 (BOM 항목 이후) 모든 데이터 셀이 비어있어야 함
    // 단, R9는 합계/footer 같은 게 있을 수 있으니 R10부터 보수적으로 검사
    const lastRow = bomSheet.lastRow?.number ?? 0;
    for (let r = 10; r <= lastRow; r++) {
      const row = bomSheet.getRow(r);
      // 데이터 cell (A~J)에 ref 패턴이 있으면 잔존 더미
      const ref = row.getCell('H').value;
      const itemName = row.getCell('C').value;
      const isGhost =
        (ref && /^[A-Z]{1,3}\d+/i.test(String(ref))) ||
        (itemName && /^[A-Z]{1,3}\d+/i.test(String(itemName)));
      if (isGhost) {
        throw new Error(`R${r}에 잔존 더미 데이터: H=${ref}, C=${itemName}`);
      }
    }
  });
});
