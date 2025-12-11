/**
 * BOM 템플릿 기반 엑셀 생성기
 * 
 * BOM_Template.xlsx를 기반으로 정리된 BOM 데이터를 채워서 생성
 * 
 * === BOM 시트 구조 ===
 * A2: Artwork 담당자
 * C2: 생산 담당자
 * H3: 품번 (보드명)
 * A7: "보드명  |  SET : 수량"
 * Row 8~: BOM 데이터
 *   - A: 번호 (1, 2, 3...)
 *   - B: 종류
 *   - C: 품명
 *   - D: SET
 *   - E: 수량 (생산수량 × SET)
 *   - H: Ref
 *   - J: 비고
 */

import ExcelJS from 'exceljs';
import type { BOMItem, CoordinateItem } from './v7-generator';

// ============================================================
// 타입 정의
// ============================================================

export interface ExcelMetadata {
  boardName: string;
  artworkManager: string;
  productionManager: string;
  productionQuantity: number;
}

// ============================================================
// 메인 함수: 템플릿 기반 엑셀 생성
// ============================================================

export async function generateBOMExcelFromTemplate(
  bomItems: BOMItem[],
  topCoordinates: CoordinateItem[],
  bottomCoordinates: CoordinateItem[],
  metadata: ExcelMetadata
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  
  try {
    // 템플릿 로드
    const response = await fetch('/templates/BOM_Template.xlsx');
    if (!response.ok) {
      throw new Error('템플릿 파일을 찾을 수 없습니다.');
    }
    
      const buffer = await response.arrayBuffer();
      await workbook.xlsx.load(buffer);
    console.log('✅ 템플릿 로드 완료');
    
  } catch (error) {
    console.error('템플릿 로드 실패:', error);
    throw new Error('템플릿 파일 로드에 실패했습니다.');
  }

  // 워크북 메타데이터
  workbook.creator = 'HANSL BOM System';
  workbook.modified = new Date();

  // BOM 시트 채우기
  fillBOMSheet(workbook, bomItems, metadata);

  // 좌표 시트 채우기
  fillCoordinateSheet(workbook, 'TOP', topCoordinates);
  fillCoordinateSheet(workbook, 'BOTTOM', bottomCoordinates);

  // Blob으로 반환
  const outBuffer = await workbook.xlsx.writeBuffer();
  return new Blob([outBuffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
}

// ============================================================
// BOM 시트 채우기
// ============================================================

function fillBOMSheet(
  workbook: ExcelJS.Workbook, 
  bomItems: BOMItem[], 
  metadata: ExcelMetadata
) {
  // 첫 번째 시트 (BOM 시트)
  const bomSheet = workbook.worksheets[0];
  if (!bomSheet) {
    throw new Error('BOM 시트를 찾을 수 없습니다.');
  }

  // 보드명에서 _정리본 및 날짜 패턴(_YYMMDD) 제거 (엑셀 내부에는 제외)
  // 순서 중요: 복합 패턴 먼저 제거
  const cleanBoardName = (metadata.boardName || '')
    .trim()
    .replace(/_\d{6}_정리본$/, '')      // _YYMMDD_정리본 형식 먼저 제거
    .replace(/_정리본$/, '')            // _정리본 제거
    .replace(/_\d{6}$/, '');            // _YYMMDD 형식 제거 (예: _250722)
  
  // 시트 이름 변경 (보드명, 31자 제한)
  if (cleanBoardName) {
    bomSheet.name = cleanBoardName.substring(0, 31);
  }

  // === 상단 정보 ===
  // A2: Artwork 담당자
  bomSheet.getCell('A2').value = metadata.artworkManager || '';
  
  // C2: 생산 담당자
  bomSheet.getCell('C2').value = metadata.productionManager || '';
  
  // H3: 품번 (보드명, _정리본 제외)
  bomSheet.getCell('H3').value = cleanBoardName;
  
  // H5: 보드명 + 부품리스트
  bomSheet.getCell('H5').value = `${cleanBoardName} 부품리스트`;

  // === A7: 보드명 | SET : 수량 (A7~J7 병합, _정리본 제외) ===
  bomSheet.mergeCells('A7:J7');
  const infoCell = bomSheet.getCell('A7');
  infoCell.value = `${cleanBoardName}  |  SET : ${metadata.productionQuantity}`;
  infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
  infoCell.font = { bold: true };

  // === Row 8~: BOM 데이터 ===
  const dataStartRow = 8;
  
  // 테두리 스타일
  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
  
  // 이전 종류 추적 (같은 종류가 연속이면 빈칸 처리)
  let prevItemType = '';

  bomItems.forEach((item, index) => {
    const rowNum = dataStartRow + index;
    const row = bomSheet.getRow(rowNum);
    
    // A: 번호 (1, 2, 3...)
    row.getCell('A').value = index + 1;
    
    // B: 종류 (같은 종류가 연속이면 첫 번째만 표시, 나머지는 빈칸)
    const currentType = item.itemType || '';
    if (currentType !== prevItemType) {
      row.getCell('B').value = currentType;
      prevItemType = currentType;
    } else {
      row.getCell('B').value = ''; // 빈칸
    }
    
    // C: 품명
    row.getCell('C').value = item.itemName || '';
    
    // D: SET
    row.getCell('D').value = item.setCount || 0;
    
    // 미삽 여부 확인 
    // 1. remark에 '미삽'이 있거나
    // 2. 품명에 _OPEN, OPEN_, _POGO, POGO_, _PAD, PAD_, _NC, NC_ 등 키워드가 _로 구분되어 포함된 경우
    const itemNameUpper = (item.itemName || '').toUpperCase();
    const remarkUpper = (item.remark || '').toUpperCase();
    const isMisap = remarkUpper.includes('미삽') || 
      itemNameUpper.includes('_OPEN') || itemNameUpper.includes('OPEN_') ||
      itemNameUpper.includes('_POGO') || itemNameUpper.includes('POGO_') ||
      itemNameUpper.includes('_PAD') || itemNameUpper.includes('PAD_') ||
      itemNameUpper.includes('_NC') || itemNameUpper.includes('NC_');
    
    // E: 수량 (미삽이면 0, 아니면 생산수량 × SET)
    const setCount = item.setCount || 0;
    row.getCell('E').value = isMisap ? 0 : metadata.productionQuantity * setCount;
    
    // F: 비움 (재고)
    
    // G: CHECK
    row.getCell('G').value = '□양호 □불량';
    
    // H: Ref
    row.getCell('H').value = item.refList || '';
    
    // I: 비움 (대체품)
    
    // J: 비고 (미삽이면 '미삽' 표시)
    row.getCell('J').value = isMisap ? '미삽' : (item.remark || '');

    // 데이터가 있는 모든 셀에 테두리 및 스타일 적용 (A~J열)
    // 중앙 정렬 열: A(1), D(4), E(5), G(7), J(10)
    const centerAlignCols = [1, 4, 5, 7, 10];
    
    // 기본 폰트 (theme 색상 제거하고 argb 직접 지정)
    const baseFont: Partial<ExcelJS.Font> = {
      size: 11,
      name: '굴림체',
      family: 3,
      charset: 129,
      color: isMisap ? { argb: 'FFFF0000' } : { argb: 'FF000000' },
    };
    
    // 다음 행의 종류 확인 (B열 테두리 조정용)
    const nextItemType = index < bomItems.length - 1 ? (bomItems[index + 1].itemType || '') : '';
    const isLastOfGroup = currentType !== nextItemType; // 같은 종류 그룹의 마지막 행인지
    const isFirstOfGroup = currentType !== (index > 0 ? (bomItems[index - 1].itemType || '') : ''); // 같은 종류 그룹의 첫 행인지
    
    for (let col = 1; col <= 10; col++) {
      const cell = row.getCell(col);
      
      // B열(col 2)은 같은 종류 그룹 내에서 중간 테두리 제거
      let cellBorder = border;
      if (col === 2) {
        cellBorder = {
                left: { style: 'thin' },
          right: { style: 'thin' },
          top: isFirstOfGroup ? { style: 'thin' } : undefined,
          bottom: isLastOfGroup ? { style: 'thin' } : undefined,
        };
      }
      
      // style 객체 전체를 새로 할당 (템플릿 스타일 완전 덮어쓰기)
      cell.style = {
        font: baseFont,
        border: cellBorder,
        alignment: {
          vertical: 'middle',
          horizontal: centerAlignCols.includes(col) ? 'center' : 'left',
          wrapText: true,
        },
      };
    }
    
    // H열(Ref)은 특히 줄바꿈이 필요하므로 행 높이 자동 조정
    const refText = item.refList || '';
    const refLength = refText.length;
    if (refLength > 50) {
      // Ref 텍스트가 길면 행 높이 자동 증가 (대략적 계산)
      const estimatedLines = Math.ceil(refLength / 50);
      row.height = Math.max(15, estimatedLines * 15);
            }
    
    row.commit();
  });
}

// ============================================================
// 좌표 시트 채우기
// ============================================================

function fillCoordinateSheet(
  workbook: ExcelJS.Workbook,
  sheetName: 'TOP' | 'BOTTOM',
  coordinates: CoordinateItem[]
) {
  if (coordinates.length === 0) return;

  // 시트 가져오기
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    console.warn(`${sheetName} 시트를 찾을 수 없습니다.`);
    return;
  }

  // Row 2부터 데이터 입력 (Row 1은 헤더)
  // 연속된 동일 종류는 첫 번째만 표시
  let prevType = '';
  
  coordinates.forEach((coord, index) => {
    const row = sheet.getRow(2 + index);
    
    const currentType = coord.type || '';
    const nextType = index < coordinates.length - 1 ? (coordinates[index + 1].type || '') : '';
    const isFirstOfGroup = currentType !== prevType; // 종류 그룹 첫 행
    const isLastRow = index === coordinates.length - 1; // 마지막 데이터 행
    
    // 같은 종류가 연속이면 빈칸, 아니면 표시
    if (isFirstOfGroup) {
      row.getCell('A').value = currentType;
      prevType = currentType;
    } else {
      row.getCell('A').value = '';
    }
    
    row.getCell('B').value = coord.partName || '';    // Type (품명)
    row.getCell('C').value = coord.refDes || '';      // RefDes
    row.getCell('D').value = coord.layer || sheetName; // Layer
    row.getCell('E').value = coord.locationX || 0;    // LocationX
    row.getCell('F').value = coord.locationY || 0;    // LocationY
    row.getCell('G').value = coord.rotation || 0;     // Rotation
    row.getCell('H').value = coord.remark || '';      // 비고

    // 미삽 여부 확인 (BOM과 동일한 조건)
    const partNameUpper = (coord.partName || '').toUpperCase();
    const coordRemarkUpper = (coord.remark || '').toUpperCase();
    const isCoordMisap = coordRemarkUpper.includes('미삽') || 
      partNameUpper.includes('_OPEN') || partNameUpper.includes('OPEN_') ||
      partNameUpper.includes('_POGO') || partNameUpper.includes('POGO_') ||
      partNameUpper.includes('_PAD') || partNameUpper.includes('PAD_') ||
      partNameUpper.includes('_NC') || partNameUpper.includes('NC_');

    // 테두리 및 스타일 설정
    for (let col = 1; col <= 8; col++) {
      const cell = row.getCell(col);
      cell.style = {
        font: { 
          size: 10, 
          name: '굴림체',
          color: isCoordMisap ? { argb: 'FFFF0000' } : { argb: 'FF000000' },
        },
        alignment: { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'center' },
        border: {
          top: isFirstOfGroup ? { style: 'thick' } : undefined,
          bottom: isLastRow ? { style: 'thick' } : undefined,
          left: undefined,
          right: undefined,
        },
      };
    }

    row.commit();
  });
}

// ============================================================
// 파일 다운로드 헬퍼
// ============================================================

export async function downloadExcelBlob(blob: Blob, filename: string) {
  // showSaveFilePicker API 지원 여부 확인 (Chrome/Edge에서만 지원)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Excel 파일',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // 사용자가 취소한 경우
      if (err.name === 'AbortError') {
        return;
      }
      // 다른 오류면 fallback으로 진행
      console.warn('showSaveFilePicker 실패, fallback 사용:', err);
    }
  }
  
  // Fallback: 기존 방식 (바로 다운로드)
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
