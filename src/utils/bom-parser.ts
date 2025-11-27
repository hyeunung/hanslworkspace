import ExcelJS from 'exceljs';

export interface BOMRawData {
  headers: string[];
  rows: Record<string, any>[];
  sheetName: string;
}

export interface BOMPattern {
  cadProgramType: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  columnMapping: {
    partName: string; // 품명 (필수)
    ref: string;      // 참조번호 (필수)
    quantity?: string;
    type?: string;
    description?: string;
    // ... 기타 필드
  };
}

/**
 * BOM 파일 파싱 (룰 기반)
 */
export async function parseBOMFile(
  file: File | ArrayBuffer,
  pattern?: BOMPattern
): Promise<BOMRawData> {
  const workbook = new ExcelJS.Workbook();
  
  try {
    if (file instanceof File) {
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
    } else {
      await workbook.xlsx.load(file);
    }
  } catch (error) {
    console.error('Excel file load error:', error);
    throw new Error('엑셀 파일을 읽을 수 없습니다. 올바른 형식인지 확인해주세요.');
  }
  
  // 첫 번째 시트 사용 (대부분의 BOM은 첫 시트에 있음)
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('엑셀 파일에 시트가 없습니다.');
  }

  // 패턴이 있으면 룰 기반 파싱
  if (pattern) {
    return parseWithPattern(sheet, pattern);
  }
  
  // 패턴이 없으면 자동 감지 시도
  return autoDetectAndParse(sheet);
}

/**
 * 패턴 기반 파싱
 */
function parseWithPattern(sheet: ExcelJS.Worksheet, pattern: BOMPattern): BOMRawData {
  // 헤더 읽기
  const headerRow = sheet.getRow(pattern.headerRowIndex);
  // ExcelJS는 1-based index지만 values 배열은 0번이 비어있을 수 있음
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value || '').trim();
  });
  
  // 데이터 읽기
  const rows: Record<string, any>[] = [];
  
  // 데이터가 있는 마지막 행까지 읽기
  const rowCount = sheet.rowCount;
  
  for (let i = pattern.dataStartRowIndex; i <= rowCount; i++) {
    const row = sheet.getRow(i);
    if (isEmptyRow(row)) continue;
    
    const rowData: Record<string, any> = {};
    let hasValidData = false;

    // 매핑된 컬럼만 추출
    Object.entries(pattern.columnMapping).forEach(([key, colName]) => {
      // 헤더 이름으로 컬럼 인덱스 찾기
      const colIndex = headers.findIndex(h => h === colName);
      if (colIndex > 0) { // ExcelJS colNumber is 1-based, but array index matches if we handled it right. 
        // Actually headers array index matches cell.col if we populated it sparsely, 
        // but findIndex works on values. Let's map by name more robustly.
        
        // Find index in headers array where value matches colName
        // Note: headers array might be sparse [empty, 'No', 'Name', ...]
        const targetColIndex = headers.indexOf(colName);
        
        if (targetColIndex > -1) {
            const cellValue = row.getCell(targetColIndex).value;
            rowData[key] = cellValue;
            if (cellValue) hasValidData = true;
        }
      }
    });
    
    if (hasValidData) {
      rows.push(rowData);
    }
  }
  
  return { headers: headers.filter(h => h), rows, sheetName: sheet.name };
}

/**
 * 자동 감지 및 파싱 (패턴을 모를 때)
 * - 헤더 행을 찾아서 전체 데이터를 raw 형태로 반환
 */
function autoDetectAndParse(sheet: ExcelJS.Worksheet): BOMRawData {
  // 헤더 행 찾기 (일반적으로 1-10행 사이)
  let headerRowIndex = -1;
  let maxCols = 0;
  let headers: string[] = [];

  // 1. 헤더 행 추측: 데이터가 가장 많이 채워진 행 또는 특정 키워드('Part', 'Ref', 'Description' 등)가 있는 행
  for (let i = 1; i <= Math.min(10, sheet.rowCount); i++) {
    const row = sheet.getRow(i);
    let colCount = 0;
    const rowValues: string[] = [];
    
    row.eachCell((cell, colNum) => {
      if (cell.value) {
        colCount++;
        rowValues[colNum] = String(cell.value).trim();
      }
    });

    // 간단한 휴리스틱: 'Part' 나 'Ref' 같은 단어가 있으면 헤더일 확률 높음
    const rowString = rowValues.join(' ').toLowerCase();
    if (rowString.includes('part') || rowString.includes('ref') || rowString.includes('item') || rowString.includes('품명')) {
        headerRowIndex = i;
        headers = rowValues;
        break;
    }
    
    // 차선책: 가장 컬럼이 많은 행을 헤더로 간주 (임시)
    if (colCount > maxCols) {
        maxCols = colCount;
        headerRowIndex = i;
        headers = rowValues;
    }
  }

  if (headerRowIndex === -1) {
     // 헤더를 못 찾으면 1행을 헤더로 가정
     headerRowIndex = 1;
     sheet.getRow(1).eachCell((cell, colNum) => {
         headers[colNum] = String(cell.value || '').trim();
     });
  }

  // 데이터 읽기
  const rows: Record<string, any>[] = [];
  for (let i = headerRowIndex + 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (isEmptyRow(row)) continue;

    const rowData: Record<string, any> = {};
    let hasData = false;

    row.eachCell((cell, colNum) => {
        const headerName = headers[colNum];
        if (headerName) {
            rowData[headerName] = cell.value;
            hasData = true;
        }
    });

    if (hasData) {
        rows.push(rowData);
    }
  }

  return { 
    headers: headers.filter(h => h), 
    rows, 
    sheetName: sheet.name 
  };
}

function isEmptyRow(row: ExcelJS.Row): boolean {
  let isEmpty = true;
  row.eachCell((cell) => {
    if (cell.value !== null && cell.value !== '') {
      isEmpty = false;
    }
  });
  return isEmpty;
}


