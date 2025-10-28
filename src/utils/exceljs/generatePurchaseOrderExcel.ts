// hanslwebapp과 동일한 코드 기반 Excel 생성

export interface PurchaseOrderData {
  purchase_order_number: string;
  request_date: string;
  delivery_request_date: string;
  requester_name: string;
  vendor_name: string;
  vendor_contact_name?: string;
  vendor_phone?: string;
  vendor_fax?: string;
  project_vendor: string;
  sales_order_number: string;
  project_item: string;
  items: PurchaseOrderItem[];
  vendor_payment_schedule?: string;
}

export interface PurchaseOrderItem {
  line_number: number;
  item_name: string;
  specification: string;
  quantity: number;
  unit_price_value: number;
  amount_value: number;
  remark: string;
  currency: string;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Helper: currency code to symbol
function getCurrencySymbol(currency: string) {
  if (!currency) return '';
  if (['KRW', '원', '₩'].includes(currency)) return '₩';
  if (['USD', '$', '달러'].includes(currency)) return '$';
  if (['EUR', '€'].includes(currency)) return '€';
  if (['JPY', '엔', '¥'].includes(currency)) return '¥';
  if (['CNY', '위안', '元'].includes(currency)) return '¥';
  return currency;
}

/**
 * 엑셀 발주서 생성 (ExcelJS) - hanslwebapp과 동일한 방식
 * @param data PurchaseOrderData
 * @returns Blob (xlsx)
 */
export async function generatePurchaseOrderExcelJS(data: PurchaseOrderData): Promise<Blob> {
  // ExcelJS를 동적으로 import하여 초기 번들 크기 감소
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  
  const sheet = workbook.addWorksheet('발주서', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      verticalCentered: true,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2
      }
    }
  });

  // 행 높이 고정: 1행 39.75px(≈29.8pt), 2행부터 18px(≈13.5pt)
  sheet.getRow(1).height = 29.8; // 39.75px
  for (let r = 2; r <= 60; r++) {
    sheet.getRow(r).height = 15.75; // 21px≈15.75pt
  }
  // 폰트 기본값: 맑은고딕, 크기 11 (2행부터), 1행은 20
  // 1행
  sheet.getRow(1).eachCell(cell => {
    cell.font = { ...(cell.font || {}), name: '맑은 고딕', size: 20 };
  });

  // 나머지 행 기본 폰트 설정 (필요시 뒤에서 개별 셀에서 다시 bold 지정)
  for (let r = 2; r <= 60; r++) {
    sheet.getRow(r).eachCell(cell => {
      cell.font = { ...(cell.font || {}), name: '맑은 고딕', size: 11 };
    });
  }

  // 1. 병합 범위 템플릿과 1:1 적용
  sheet.mergeCells('A1:G1');
  sheet.mergeCells('A2:B2'); sheet.mergeCells('C2:D2'); sheet.mergeCells('F2:G2');
  sheet.mergeCells('A3:B3'); sheet.mergeCells('C3:D3'); sheet.mergeCells('F3:G3');
  sheet.mergeCells('A4:B4'); sheet.mergeCells('C4:D4'); sheet.mergeCells('F4:G4');
  sheet.mergeCells('A5:B5'); sheet.mergeCells('C5:D5'); sheet.mergeCells('F5:G5');
  sheet.mergeCells('A6:B6'); sheet.mergeCells('C6:D6'); sheet.mergeCells('F6:G6');
  sheet.mergeCells('A7:B7'); sheet.mergeCells('C7:D7'); sheet.mergeCells('F7:G7');
  // 8~46행(헤더/품목/합계) 병합 없음
  // 합계가 들어가는 행에 맞춰 병합 범위도 동적으로 이동
  // (아래에서 sumRow 계산 후 병합)

  try {
    const response = await fetch('/logo_KOR.png');
    const arrayBuffer = await response.arrayBuffer();
    const imageId = workbook.addImage({
      buffer: arrayBuffer,
      extension: 'png',
    });
    // 로고(이모티콘)는 너비 0.58col, '발주서' 글자 바로 왼쪽에 딱 붙게 배치
    // D열 width가 undefined/null/0이면 기본값 22로 대체
    const dWidth = sheet.getColumn('D').width || 22;
    const logoWidth = Math.max(1, dWidth * 7.2 * 0.58) + 4; // 기존보다 4px 더 크게
    const logoHeight = 30 + 4; // 기존 30에서 4px 더 크게
    // D1 셀 중앙(3.5, 0.5)에서 왼쪽 2px(0.28col), 위로 2px(0.13row) 이동
    const logoCol = 3.5 - 0.50;
    const logoRow = 0.5 - 0.20;
    sheet.addImage(imageId, {
      tl: { col: logoCol, row: logoRow }, // D1 셀 중앙에서 왼쪽 2px, 위로 2px 이동
      ext: { width: logoWidth, height: logoHeight },
    });
  } catch (e) {}

  // 2. 제목 (B1:H1 병합, 중앙정렬)
  sheet.getCell('D1').value = '                발 주 서';
  sheet.getCell('D1').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getCell('D1').font = { bold: true, size: 20 };

  // 3. 상단 정보 고정 라벨 적용 (공백 포함)
  sheet.getCell('A2').value = '업   체   명';
  sheet.getCell('A2').font = { bold: true };
  sheet.getCell('A3').value = '담   당   자';
  sheet.getCell('A3').font = { bold: true };
  sheet.getCell('A4').value = '청   구   일';
  sheet.getCell('A4').font = { bold: true };
  sheet.getCell('A5').value = 'TEL.';
  sheet.getCell('A5').font = { bold: true };
  sheet.getCell('A6').value = 'FAX.';
  sheet.getCell('A6').font = { bold: true };
  sheet.getCell('A7').value = '입고요청일';
  sheet.getCell('A7').font = { bold: true };

  sheet.getCell('E2').value = '구매요청자';
  sheet.getCell('E2').font = { bold: true };
  sheet.getCell('E3').value = '주         소';
  sheet.getCell('E3').font = { bold: true };
  sheet.getCell('E4').value = '발 주 번 호';
  sheet.getCell('E4').font = { bold: true };
  sheet.getCell('E5').value = 'TEL.';
  sheet.getCell('E5').font = { bold: true };
  sheet.getCell('E6').value = 'FAX.';
  sheet.getCell('E6').font = { bold: true };
  sheet.getCell('E7').value = '지출 예정일';
  sheet.getCell('E7').font = { bold: true };

  sheet.getCell('F7').value = data.vendor_payment_schedule || '';

  // 데이터 매핑(예시)
  sheet.getCell('C2').value = data.vendor_name;
  sheet.getCell('C3').value = data.vendor_contact_name || '';
  sheet.getCell('C4').value = formatDate(data.request_date);
  sheet.getCell('C5').value = data.vendor_phone || '';
  sheet.getCell('C6').value = data.vendor_fax || '';
  sheet.getCell('C7').value = formatDate(data.delivery_request_date);

  sheet.getCell('F2').value = data.requester_name;
  sheet.getCell('F3').value = '대구광역시 달서구 성서공단북로305';
  sheet.getCell('F4').value = data.purchase_order_number;
  sheet.getCell('F5').value = '(053) 626-7805';
  sheet.getCell('F6').value = '(053) 657-7905';
  sheet.getCell('F5').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('F6').alignment = { horizontal: 'center', vertical: 'middle' };

  // 8행: 테이블 헤더
  const tableHeaders = ['No', '품명', '규격', '수량', '단가', '금액', '비고'];
  for (let i = 0; i < tableHeaders.length; i++) {
    sheet.getCell(String.fromCharCode(65 + i) + '8').value = tableHeaders[i];
    sheet.getCell(String.fromCharCode(65 + i) + '8').font = { bold: true };
    if(i===6){
       sheet.getCell('G8').alignment = { horizontal:'center', vertical:'middle' };
    }
  }

  // 품목이 45개를 넘으면 아래로 밀어서 합계/하단 정보 출력
  const baseRow = 9;
  const minRows = 45;
  // --- 품목 데이터 line_number 기준 정렬 ---
  const sortedItems = [...data.items].sort((a, b) => a.line_number - b.line_number);
  const itemRows = sortedItems.length;
  const sumRow = baseRow + Math.max(itemRows, minRows); // 합계 위치

  // 품목 데이터
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const rowIdx = baseRow + i;
    sheet.getCell('A' + rowIdx).value = item.line_number;
    const bCell = sheet.getCell('B' + rowIdx);
    bCell.value = item.item_name;
    bCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getCell('C' + rowIdx).value = item.specification;
    sheet.getCell('C' + rowIdx).alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getCell('D' + rowIdx).value = item.quantity;
    // 단가(E열) - 통화 기호 포함
    const unitSymbol = getCurrencySymbol(item.currency);
    const unitWithCurrency = (item.unit_price_value !== undefined && item.unit_price_value !== null)
      ? `${item.unit_price_value.toLocaleString()} ${unitSymbol}`.trim()
      : '';
    sheet.getCell('E' + rowIdx).value = unitWithCurrency;
    sheet.getCell('E' + rowIdx).alignment = { horizontal: 'right', vertical: 'middle' };

    // 금액(F열) - 통화 기호 포함
    const amountSymbol = getCurrencySymbol(item.currency);
    const amountWithCurrency = (item.amount_value !== undefined && item.amount_value !== null)
      ? `${item.amount_value.toLocaleString()} ${amountSymbol}`.trim()
      : '';
    sheet.getCell('F' + rowIdx).value = amountWithCurrency;
    sheet.getCell('F' + rowIdx).alignment = { horizontal: 'right', vertical: 'middle' };
    // G열은 비워둠
    const gCell = sheet.getCell('G' + rowIdx);
    gCell.value = (item.remark !== undefined && item.remark !== null) ? String(item.remark) : '';
    gCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false, shrinkToFit: true };
  }

  // 품목이 45개보다 적으면 빈 행 추가
  for (let i = itemRows; i < minRows; i++) {
    const rowIdx = baseRow + i;
    for (let c = 0; c < 7; c++) {
      sheet.getCell(String.fromCharCode(65 + c) + rowIdx).value = '';
    }
  }

  // 합계
  sheet.mergeCells(`A${sumRow}:E${sumRow}`);
  sheet.getCell('A' + sumRow).value = '합계';
  sheet.getCell('A' + sumRow).font = { bold: true };
  const totalSymbol = getCurrencySymbol(data.items[0]?.currency);
  const totalAmount = data.items.reduce((sum, item) => sum + (item.amount_value || 0), 0);
  sheet.getCell('F' + sumRow).value = `${totalAmount.toLocaleString()} ${totalSymbol}`.trim();
  sheet.getCell('F' + sumRow).alignment = { horizontal: 'right', vertical: 'middle' };

  // 실제 마지막 데이터가 들어간 행까지 동적으로 테두리 적용 (합계까지만)
  const lastRow = sumRow;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= 7; c++) {
      const col = String.fromCharCode(64 + c); // A~G
      const cellAddr = col + r;
      const cell = sheet.getCell(cellAddr);
      // E(5), F(6)열의 품목 데이터 행(단가/금액)과 합계행, C(3)열의 품목 데이터 행(규격)은 alignment를 덮어쓰지 않음
      const isPriceCol = (c === 5 || c === 6);
      const isSpecCol = (c === 3);
      const isItemRow = (r >= baseRow && r < sumRow);
      const isSumRow = (r === sumRow);
      if (!((isPriceCol && (isItemRow || isSumRow)) || (isSpecCol && isItemRow))) {
        // 나머지 셀만 중앙 정렬
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      // 기존 스타일: 2행/8행/합계행(sumRow) 위, 8행 아래, 마지막행만 굵은선
      cell.border = {
        top:    { style: (r === 1) ? 'medium' : (r === 2 || r === 8 || r === sumRow) ? 'medium' : 'thin' },
        left:   { style: c === 1 ? 'medium' : 'thin' },
        right:  { style: c === 7 ? 'medium' : 'thin' },
        bottom: { style: (r === 8 || r === sumRow || r === lastRow) ? 'medium' : 'thin' }
      };
    }
  }
  // 규격(C열) 입력란(품목 데이터 행)은 마지막에 좌측 정렬로 덮어쓴다
  for (let i = 0; i < itemRows; i++) {
    const rowIdx = baseRow + i;
    sheet.getCell('C' + rowIdx).alignment = { horizontal: 'left', vertical: 'middle' };
  }

  // B2:B7, D2:D7, E2:E6 오른쪽 테두리 굵게
  for (let r = 2; r <= 7; r++) {
    sheet.getCell('B' + r).border = {
      ...sheet.getCell('B' + r).border,
      right: { style: 'medium' }
    };
    sheet.getCell('D' + r).border = {
      ...sheet.getCell('D' + r).border,
      right: { style: 'medium' }
    };
    if (r <= 6) {
      sheet.getCell('E' + r).border = {
        ...sheet.getCell('E' + r).border,
        right: { style: 'medium' }
      };
    }
  }
  // E7, G7 위쪽 테두리 일반(얇게)
  sheet.getCell('E7').border = {
    ...sheet.getCell('E7').border,
    top: { style: 'thin' },
    right: { style: 'medium' }
  };
  sheet.getCell('G7').border = {
    ...sheet.getCell('G7').border,
    top: { style: 'thin' }
  };

  // A1~A7 왼쪽 테두리 굵게 명시적 설정 (덮어쓰기 방지)
  for (let r = 1; r <= 7; r++) {
    const currentBorder = sheet.getCell('A' + r).border || {};
    sheet.getCell('A' + r).border = {
      ...currentBorder,
      left: { style: 'medium' }
    };
  }

  // 합계 행(A열) 왼쪽 테두리 굵게 명시적 설정
  const sumCellBorder = sheet.getCell('A' + sumRow).border || {};
  sheet.getCell('A' + sumRow).border = {
    ...sumCellBorder,
    left: { style: 'medium' }
  };

  // 열 너비 (템플릿 기준)
  const colWidths = { A:4.7, B:23, C:30, D:11, E:15, F:16, G:37 };
  Object.entries(colWidths).forEach(([col, width]) => {
    sheet.getColumn(col).width = width;
  });

  /* -----------------------------------
      최종 행 높이/폰트 일괄 적용
      1행 : 39.75pt
      2행~lastRow : 18pt
  ----------------------------------- */
  sheet.getRow(1).height = 29.8; // 39.75px≈29.8pt
  sheet.getRow(1).eachCell(c => { c.font = { ...(c.font || {}), name: '맑은 고딕', size: 20 }; });

  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    row.height = 15.75; // 21px≈15.75pt
    row.eachCell(c => {
      c.font = { ...(c.font || {}), name: '맑은 고딕', size: 11 };
    });
  }

  // G열 전체 좌측 정렬 및 자동 줄바꿈 보장
  for (let r = 9; r <= lastRow; r++) {
    sheet.getCell('G' + r).alignment = { horizontal: 'left', vertical: 'middle', wrapText: false, shrinkToFit: true };
    sheet.getCell('B' + r).alignment = { horizontal: 'left', vertical: 'middle' };
  }

  // 9. 파일 생성
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}