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
  boardName: string,
  productionQuantity?: number
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  
  try {
    // 1. 템플릿 파일 로드 시도
    const response = await fetch('/templates/BOM_Template.xlsx');
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await workbook.xlsx.load(buffer);
      console.log('Template loaded successfully');
    } else {
      console.error('Template loading failed:', response.status, response.statusText);
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
  let bomSheet = workbook.getWorksheet('BOM');
  if (!bomSheet) {
    // 시트가 없으면 첫 번째 시트 사용
    bomSheet = workbook.worksheets[0];
  }

  if (!bomSheet) {
     bomSheet = workbook.addWorksheet('BOM');
  }

  // 데이터 시작 행 찾기 (헤더가 있는 행을 찾음)
  let startRow = 6; // 기본값
  let headerFound = false;
  
  bomSheet.eachRow((row, rowNumber) => {
    if (headerFound) return;
    const values = row.values;
    if (Array.isArray(values)) {
      // '번호' 또는 'No'가 포함된 행을 헤더로 간주
      if (values.some(v => v && v.toString().includes('번호')) || values.some(v => v && v.toString().includes('No'))) {
        startRow = rowNumber + 1;
        headerFound = true;
      }
    }
  });

  // 템플릿의 제목 위치 업데이트 (예: "[보드명] 부품리스트")
  if (boardName) {
      let titleCellFound = false;
      // 제목 찾기 (보통 위쪽에 있음)
      for (let i = 1; i < startRow; i++) {
          const row = bomSheet.getRow(i);
          row.eachCell((cell) => {
              if (cell.value && cell.value.toString().includes('부품리스트')) {
                  // 기존 포맷 유지하면서 보드명만 교체 시도
                  // 예: "H25-133... 부품리스트"
                  cell.value = `${boardName} 부품리스트`;
                  titleCellFound = true;
              }
          });
          if (titleCellFound) break;
      }
  }

  // 데이터 시작 위치 조정 (헤더 아래에 보드 정보 행 추가)
  // 스크린샷을 보면 헤더(번호, 종류...) 바로 아래 행에 "** [보드명]... [수량] SET" 가 있음
  // 따라서 데이터는 헤더 + 2 행부터 시작해야 함
  const infoRowIndex = startRow; // 헤더 바로 다음 행
  const dataStartIndex = startRow + 1; // 그 다음 행부터 데이터

  // 보드 정보 행 내용 작성 (스타일 유지하며 값 입력)
  const infoRow = bomSheet.getRow(infoRowIndex);
  
  // 생산 수량 계산
  let productionQty = productionQuantity || 0;
  if (productionQty === 0 && bomItems.length > 0 && bomItems[0].setCount > 0) {
      productionQty = Math.round(bomItems[0].totalQuantity / bomItems[0].setCount);
  }

  // 3번 컬럼(품명)에 정보 입력
  infoRow.getCell(3).value = `** ${boardName}   ${productionQty} SET`;
  infoRow.getCell(3).font = { bold: true, name: '맑은 고딕', size: 10 };
  infoRow.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };

  bomItems.forEach((item, index) => {
    const currentRowNum = dataStartIndex + index;
    let row = bomSheet.getRow(currentRowNum);
    
    // 템플릿 행의 스타일 복사 (첫 번째 데이터인 경우 템플릿 행 사용, 그 이후는 복사)
    // ExcelJS에서 스타일 복사는 까다로우므로, 기본 스타일을 코드에서 지정하는 게 안전할 수 있음.
    // 하지만 사용자 요청은 "템플릿 그대로" 이므로 최대한 보존 노력.
    
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

    // 스타일 적용 (템플릿 스타일이 없을 경우에만 기본 스타일 적용)
    // 사용자가 "개판"이라고 했으므로 코드로 스타일을 강제하는 게 나을 수 있음 (템플릿 스타일이 깨졌을 수도 있으니)
    // 하지만 "템플릿 그대로"를 원하므로, 
    // border, alignment, font 등을 명시적으로 지정하여 깔끔하게 만듦.
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= 10) {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            cell.alignment = { vertical: 'middle', wrapText: true };
            // 폰트는 템플릿 폰트 유지 또는 지정
            // cell.font = { name: '맑은 고딕', size: 10 }; 
            
            if ([1, 2, 4, 5, 6, 7, 10].includes(colNumber)) {
                cell.alignment = { ...cell.alignment, horizontal: 'center' };
            } else {
                cell.alignment = { ...cell.alignment, horizontal: 'left' };
            }
        }
    });
    
    row.commit();
  });

  // 3. 좌표 시트 처리 (TOP/BOTTOM) - 컬럼 매핑 수정
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
    // 새 시트인 경우 헤더 생성 (수동 파일 양식에 맞춤)
    // Type, RefDes, Layer, LocationX, LocationY, Rotation
    sheet.getRow(1).values = ['Type', 'RefDes', 'Layer', 'LocationX', 'LocationY', 'Rotation'];
    sheet.getRow(1).font = { bold: true };
  } else {
    // 기존 시트가 있으면 헤더는 유지하고 데이터만 추가
    // 만약 헤더가 없다면 추가
    if (sheet.rowCount === 0) {
        sheet.getRow(1).values = ['Type', 'RefDes', 'Layer', 'LocationX', 'LocationY', 'Rotation'];
    }
  }

  // 데이터 시작 행
  const startRow = 2;
  
  // 기존 데이터 삭제 (필요 시)
  // if (sheet.rowCount >= startRow) {
  //     sheet.spliceRows(startRow, sheet.rowCount - startRow + 1);
  // }

  coords.forEach((coord, index) => {
    const row = sheet.getRow(startRow + index);
    // 수동 파일 양식: Type | RefDes | Layer | LocationX | LocationY | Rotation
    row.values = [
      coord.partType || 'SMD',           // Type
      coord.ref || '',                   // RefDes
      coord.side || coord.layer || '',   // Layer (TOP/BOTTOM)
      coord.x,                           // LocationX
      coord.y,                           // LocationY
      coord.angle || coord.rotation || 0 // Rotation
    ];
    
    // 스타일 적용
    row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });
  
  // 컬럼 너비 자동 조정
  sheet.columns.forEach(col => {
      col.width = 15;
  });
}
