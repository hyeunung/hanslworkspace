import ExcelJS from 'exceljs';

export interface CoordinateRawData {
  ref: string;
  partName: string;
  x: number;
  y: number;
  angle?: number;
  side: 'TOP' | 'BOTTOM';
}

/**
 * 좌표 파일 파싱 (TXT/XLSX/CSV)
 */
export async function parseCoordinateFile(
  file: File | ArrayBuffer,
  fileName: string
): Promise<CoordinateRawData[]> {
  const name = fileName.toLowerCase();
  
  if (name.endsWith('.txt') || name.endsWith('.csv')) {
    return parseTxtCoordinate(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcelCoordinate(file);
  }
  
  throw new Error('지원하지 않는 좌표 파일 형식입니다. (TXT, CSV, XLSX 지원)');
}

/**
 * TXT/CSV 좌표 파일 파싱
 * - 다양한 구분자(탭, 콤마, 공백) 처리
 * - P-CAD, Altium 등 다양한 포맷 대응 필요
 */
async function parseTxtCoordinate(file: File | ArrayBuffer): Promise<CoordinateRawData[]> {
  let text: string;
  
  if (file instanceof File) {
    text = await file.text();
  } else {
    const decoder = new TextDecoder('utf-8'); // 한글 깨짐 방지를 위해 EUC-KR 고려 필요 시 수정
    text = decoder.decode(file);
  }
  
  const lines = text.split(/\r?\n/);
  const coordinates: CoordinateRawData[] = [];
  
  let headerFound = false;
  let xIndex = -1;
  let yIndex = -1;
  let refIndex = -1;
  let angleIndex = -1;
  let sideIndex = -1;
  let partIndex = -1;
  let layer = 'TOP'; // 기본값

  // 헤더 찾기 및 포맷 감지
  for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim().toUpperCase();
      // 일반적인 헤더 키워드
      if (line.includes('REF') && (line.includes('X') || line.includes('Y'))) {
          headerFound = true;
          // 구분자 감지 (콤마, 탭, 공백)
          const delimiter = line.includes(',') ? ',' : (line.includes('\t') ? '\t' : ' ');
          const parts = line.split(delimiter).filter(p => p.trim() !== '').map(p => p.trim());
          
          refIndex = parts.findIndex(p => p.includes('REF') || p.includes('DES'));
          xIndex = parts.findIndex(p => p === 'X' || p.includes('X-COORD') || p.includes('MID X'));
          yIndex = parts.findIndex(p => p === 'Y' || p.includes('Y-COORD') || p.includes('MID Y'));
          angleIndex = parts.findIndex(p => p.includes('ROT') || p.includes('ANGLE'));
          sideIndex = parts.findIndex(p => p.includes('LAYER') || p.includes('SIDE') || p.includes('TB'));
          partIndex = parts.findIndex(p => p.includes('PART') || p.includes('VAL') || p.includes('COMMENT'));
          
          break;
      }
  }

  // 데이터를 한 줄씩 파싱
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) continue;
    
    // 헤더 행은 건너뛰기 (단순 포함 여부로 체크)
    if (trimmedLine.toUpperCase().includes('REF') && trimmedLine.toUpperCase().includes('X')) continue;

    // 구분자로 분리
    const delimiter = line.includes(',') ? ',' : (line.includes('\t') ? '\t' : ' ');
    // 빈 문자열 제거하지 않고 인덱스 유지 (CSV의 경우)
    const parts = line.split(delimiter).map(s => s.trim()).filter(s => s !== ''); 

    // 기본 포맷 (순서가 고정된 경우 fallback)
    // 예: Ref, X, Y, Rot, Side
    if (!headerFound && parts.length >= 3) {
         // 헤더를 못 찾았을 때의 기본 추측 (Ref가 보통 첫 번째)
         const refCandidate = parts[0];
         // Ref가 C1, R1 처럼 생겼으면 유효한 데이터로 간주
         if (/^[A-Z]+[0-9]+/.test(refCandidate)) {
             coordinates.push({
                 ref: parts[0],
                 partName: parts[1] || 'Unknown', // 값이 없으면 Unknown
                 x: parseFloat(parts[2] || '0'),
                 y: parseFloat(parts[3] || '0'),
                 angle: parseFloat(parts[4] || '0'),
                 side: (parts[5]?.toUpperCase().includes('B') || parts[5]?.toUpperCase().includes('BOT')) ? 'BOTTOM' : 'TOP'
             });
         }
         continue;
    }

    if (headerFound && refIndex > -1 && xIndex > -1 && yIndex > -1) {
        const ref = parts[refIndex];
        if (!ref) continue;

        const sideRaw = sideIndex > -1 ? parts[sideIndex] : '';
        const isBottom = sideRaw?.toUpperCase().includes('B') || sideRaw?.toUpperCase().includes('BOT');

        coordinates.push({
            ref: ref,
            partName: partIndex > -1 ? parts[partIndex] : 'Unknown',
            x: parseFloat(parts[xIndex]),
            y: parseFloat(parts[yIndex]),
            angle: angleIndex > -1 ? parseFloat(parts[angleIndex]) : 0,
            side: isBottom ? 'BOTTOM' : 'TOP'
        });
    }
  }
  
  return coordinates;
}

/**
 * Excel 좌표 파일 파싱
 */
async function parseExcelCoordinate(file: File | ArrayBuffer): Promise<CoordinateRawData[]> {
  const workbook = new ExcelJS.Workbook();
  
  if (file instanceof File) {
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer);
  } else {
    await workbook.xlsx.load(file);
  }
  
  const sheet = workbook.worksheets[0];
  const coordinates: CoordinateRawData[] = [];
  
  // 헤더 찾기 (1~5행 검색)
  let headerRowIndex = 1;
  let headers: string[] = [];
  
  for(let i=1; i<=5; i++) {
      const row = sheet.getRow(i);
      const rowValues: string[] = [];
      row.eachCell((cell, col) => {
          rowValues[col] = String(cell.value || '').toUpperCase();
      });
      
      if (rowValues.some(v => v.includes('REF') || v.includes('DESIGNATOR'))) {
          headerRowIndex = i;
          headers = rowValues;
          break;
      }
  }

  // 인덱스 매핑
  const refIdx = headers.findIndex(h => h && (h.includes('REF') || h.includes('DESIGNATOR')));
  const xIdx = headers.findIndex(h => h && (h.includes('MID X') || h === 'X' || h.includes('CENTER-X')));
  const yIdx = headers.findIndex(h => h && (h.includes('MID Y') || h === 'Y' || h.includes('CENTER-Y')));
  const angleIdx = headers.findIndex(h => h && (h.includes('ROT') || h.includes('ANGLE')));
  const sideIdx = headers.findIndex(h => h && (h.includes('LAYER') || h.includes('SIDE')));
  const partIdx = headers.findIndex(h => h && (h.includes('COMMENT') || h.includes('PART')));

  if (refIdx === -1 || xIdx === -1 || yIdx === -1) {
      throw new Error('좌표 파일에서 필수 컬럼(Ref, X, Y)을 찾을 수 없습니다.');
  }

  // 데이터 추출
  for (let i = headerRowIndex + 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      if (isEmptyRow(row)) continue;

      const ref = String(row.getCell(refIdx).value || '').trim();
      if (!ref) continue;

      const sideVal = String(row.getCell(sideIdx).value || '').toUpperCase();
      const isBottom = sideVal.includes('B') || sideVal.includes('BOT');

      coordinates.push({
          ref: ref,
          partName: partIdx > -1 ? String(row.getCell(partIdx).value || '') : 'Unknown',
          x: Number(row.getCell(xIdx).value) || 0,
          y: Number(row.getCell(yIdx).value) || 0,
          angle: angleIdx > -1 ? Number(row.getCell(angleIdx).value) || 0 : 0,
          side: isBottom ? 'BOTTOM' : 'TOP'
      });
  }

  return coordinates;
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


