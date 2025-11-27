import ExcelJS from 'exceljs';

// BOM 아이템 타입 정의
export interface BOMItem {
  lineNumber: number;
  itemType?: string;
  itemName: string;
  specification?: string;
  setCount: number;
  totalQuantity: number;
  stockQuantity?: number;
  checkStatus?: string;
  refList: string | string[];  // 문자열 또는 배열 둘 다 허용
  alternativeItem?: string;
  remark?: string;
}

export interface CoordinateItem {
  refDes?: string;  // 더미 데이터에서 사용하는 필드
  ref?: string;     // 실제 데이터에서 사용할 수 있는 필드
  partName?: string;
  partType?: string;
  side?: string;
  layer?: string;   // TOP/BOTTOM을 나타내는 다른 필드
  x: number | string;
  y: number | string;
  angle?: number | string;
  rotation?: number | string;  // angle 대신 rotation을 사용할 수도 있음
}

/**
 * 템플릿 기반 정리된 BOM 및 좌표 데이터를 Excel 파일로 생성
 */
export async function generateCleanedBOMExcel(
  bomItems: BOMItem[],
  coordinates: CoordinateItem[],
  boardName: string
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  
  try {
    // 1. 템플릿 파일 로드 시도
    const response = await fetch('/templates/BOM_Automation(Default).xlsx');
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await workbook.xlsx.load(buffer);
      console.log('Template loaded successfully');
    } else {
      console.warn('Template not found, creating new workbook');
      // 템플릿이 없으면 새 시트 생성
      const bomSheet = workbook.addWorksheet('BOM');
      // 헤더 추가
      bomSheet.getRow(1).values = ['No', '종류', '품명', 'SET', '수량', '재고', 'CHECK', 'REF', '대체가능품목', '비고'];
      bomSheet.getRow(1).font = { bold: true };
    }
  } catch (error) {
    console.error('Template load error:', error);
    // 오류 발생 시 새 시트 생성
    const bomSheet = workbook.addWorksheet('BOM');
    bomSheet.getRow(1).values = ['No', '종류', '품명', 'SET', '수량', '재고', 'CHECK', 'REF', '대체가능품목', '비고'];
    bomSheet.getRow(1).font = { bold: true };
  }

  // 워크북 메타데이터 설정
  workbook.creator = 'HANSL AI System';
  workbook.modified = new Date();

  // 2. BOM 시트 데이터 채우기
  // 템플릿의 첫 번째 시트를 BOM 시트로 가정하거나 이름으로 찾음
  let bomSheet = workbook.getWorksheet('BOM');
  if (!bomSheet) {
    // 시트가 없으면 첫 번째 시트 사용 또는 생성
    bomSheet = workbook.worksheets[0] || workbook.addWorksheet('BOM');
  }

  // 데이터 시작 행 (헤더가 1행이라고 가정하고 2행부터 시작)
  const startRow = 2;

  // 기존 데이터가 있다면 지우기 (헤더 제외)
  const rowCount = bomSheet.rowCount;
  for (let i = rowCount; i >= startRow; i--) {
    bomSheet.spliceRows(i, 1);
  }

  // 템플릿의 스타일을 가져오기 위해 2행(또는 1행)의 스타일 참조 가능
  // 여기서는 데이터 쓰면서 스타일 적용
  bomItems.forEach((item, index) => {
    const row = bomSheet.getRow(startRow + index);
    
    // 값 설정
    row.getCell(1).value = index + 1;                    // 번호
    row.getCell(2).value = item.itemType || '';          // 종류
    row.getCell(3).value = item.itemName;                // 품명
    row.getCell(4).value = item.setCount;                // SET
    row.getCell(5).value = item.totalQuantity;           // 수량
    row.getCell(6).value = item.stockQuantity || '';     // 재고
    row.getCell(7).value = item.checkStatus || '□양호';  // CHECK
    row.getCell(8).value = Array.isArray(item.refList) ? item.refList.join(', ') : item.refList;      // REF
    row.getCell(9).value = item.alternativeItem || '';   // 대체가능품목
    row.getCell(10).value = item.remark || '';           // 비고

    // 스타일 적용 (모든 셀에 공통 스타일)
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // 1~10 컬럼까지만 스타일 적용
        if (colNumber <= 10) {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            cell.font = { name: '맑은 고딕', size: 10 };
            cell.alignment = { vertical: 'middle', wrapText: true };
            
            // 가운데 정렬 컬럼들 (번호, 종류, SET, 수량, 재고, CHECK, 비고)
            if ([1, 2, 4, 5, 6, 7, 10].includes(colNumber)) {
                cell.alignment = { ...cell.alignment, horizontal: 'center' };
            }
            // 왼쪽 정렬 (품명, REF, 대체품)
            else {
                cell.alignment = { ...cell.alignment, horizontal: 'left' };
            }
        }
    });
  });

  // 3. 좌표 시트 처리 (TOP/BOTTOM)
  // 템플릿에 시트가 있으면 쓰고, 없으면 생성
  const topCoords = coordinates.filter(c => 
    c.side?.toUpperCase().includes('TOP') || c.layer?.toUpperCase().includes('TOP')
  );
  const bottomCoords = coordinates.filter(c => 
    c.side?.toUpperCase().includes('BOT') || c.layer?.toUpperCase().includes('BOT')
  );
  
  await writeCoordinateSheet(workbook, 'TOP', topCoords);
  await writeCoordinateSheet(workbook, 'BOTTOM', bottomCoords);

  // Blob으로 반환
  const outBuffer = await workbook.xlsx.writeBuffer();
  return new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function writeCoordinateSheet(workbook: ExcelJS.Workbook, sheetName: string, coords: CoordinateItem[]) {
  if (coords.length === 0) return;

  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    sheet = workbook.addWorksheet(sheetName);
    // 새 시트인 경우 헤더 생성
    sheet.getRow(1).values = ['Ref', 'Part Name', 'Type', 'Side', 'X', 'Y', 'Angle'];
    sheet.getRow(1).font = { bold: true };
  }

  // 데이터 시작 행
  const startRow = 2;
  
  // 기존 데이터 삭제
  if (sheet.rowCount >= startRow) {
      sheet.spliceRows(startRow, sheet.rowCount - startRow + 1);
  }

  coords.forEach((coord, index) => {
    const row = sheet.getRow(startRow + index);
    row.values = [
      coord.ref || coord.refDes || '',
      coord.partName || '',
      coord.partType || 'SMD',
      coord.side || coord.layer || '',
      coord.x,
      coord.y,
      coord.angle || coord.rotation || 0
    ];
    row.alignment = { horizontal: 'center' };
  });
  
  // 컬럼 너비 자동 조정 (대략적으로)
  sheet.columns.forEach(col => {
      col.width = 15;
  });
  sheet.getColumn(2).width = 30; // Part Name
}
