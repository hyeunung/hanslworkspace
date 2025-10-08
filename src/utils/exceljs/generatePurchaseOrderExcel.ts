// ExcelJS를 dynamic import로 변경하여 번들 크기 최적화

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
 * 엑셀 발주서 생성 (ExcelJS)
 * @param data PurchaseOrderData
 * @returns Blob (xlsx)
 */
export async function generatePurchaseOrderExcelJS(data: PurchaseOrderData): Promise<Blob> {
  // ExcelJS를 동적으로 import하여 초기 번들 크기 감소
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
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

  // 행 높이 고정: 1행 39.75pt, 2행부터 15.75pt
  sheet.getRow(1).height = 39.75;
  for (let r = 2; r <= 60; r++) {
    sheet.getRow(r).height = 15.75;
  }
  // 폰트 기본값 설정은 나중에 개별 적용

  // 1. 병합 범위 템플릿과 1:1 적용
  sheet.mergeCells('A1:G1');
  sheet.mergeCells('A2:B2'); sheet.mergeCells('C2:D2'); sheet.mergeCells('F2:G2');
  sheet.mergeCells('A3:B3'); sheet.mergeCells('C3:D3'); sheet.mergeCells('F3:G3');
  sheet.mergeCells('A4:B4'); sheet.mergeCells('C4:D4'); sheet.mergeCells('F4:G4');
  sheet.mergeCells('A5:B5'); sheet.mergeCells('C5:D5'); sheet.mergeCells('F5:G5');
  sheet.mergeCells('A6:B6'); sheet.mergeCells('C6:D6'); sheet.mergeCells('F6:G6');
  sheet.mergeCells('A7:B7'); sheet.mergeCells('C7:D7'); sheet.mergeCells('E7:F7');
  // 8~46행(헤더/품목/합계) 병합 없음
  // 합계가 들어가는 행에 맞춰 병합 범위도 동적으로 이동
  // (아래에서 sumRow 계산 후 병합)

  // 로고 이미지 처리 (필요 시 활성화)
  // 현재는 로고 없이 템플릿과 동일한 형식으로 처리

  // 2. 제목 (A1:G1 병합, 중앙정렬)
  sheet.getCell('A1').value = '             발 주 서';
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A1').font = { name: 'GulimChe', size: 25, bold: true };

  // 3. 상단 정보 고정 라벨 적용 (템플릿과 동일한 형식)
  sheet.getCell('A2').value = '업 체 명';
  sheet.getCell('A2').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A3').value = '담 당 자';
  sheet.getCell('A3').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A4').value = '청 구 일';
  sheet.getCell('A4').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A5').value = '전화 번호';
  sheet.getCell('A5').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A6').value = '팩스 번호';
  sheet.getCell('A6').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A7').value = '입고 요청일';
  sheet.getCell('A7').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A7').alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.getCell('E2').value = '구매요구자';
  sheet.getCell('E2').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E2').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('E3').value = '주  소';
  sheet.getCell('E3').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E3').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('E4').value = '발주 번호';
  sheet.getCell('E4').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E4').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('E5').value = '전화 번호';
  sheet.getCell('E5').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E5').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('E6').value = '팩스 번호';
  sheet.getCell('E6').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E6').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('E7').value = '지출 예정일';
  sheet.getCell('E7').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E7').alignment = { horizontal: 'center', vertical: 'middle' };

  // E7:F7 병합됨 - 지출 예정일 값은 F7에
  sheet.getCell('F7').value = data.vendor_payment_schedule || '익월말 결제';
  sheet.getCell('F7').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F7').alignment = { horizontal: 'center', vertical: 'middle' };

  // 데이터 매핑 (템플릿과 동일한 형식)
  sheet.getCell('C2').value = data.vendor_name;
  sheet.getCell('C2').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C3').value = data.vendor_contact_name || '';
  sheet.getCell('C3').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C4').value = formatDate(data.request_date);
  sheet.getCell('C4').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C4').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C5').value = data.vendor_phone || '';
  sheet.getCell('C5').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C5').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C6').value = data.vendor_fax || '';
  sheet.getCell('C6').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C6').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C7').value = formatDate(data.delivery_request_date);
  sheet.getCell('C7').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C7').alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.getCell('F2').value = data.requester_name;
  sheet.getCell('F2').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F2').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('F3').value = '대구광역시 달서구 성서공단북로 305';
  sheet.getCell('F3').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F3').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('F4').value = data.purchase_order_number;
  sheet.getCell('F4').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F4').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('F5').value = '(053) 626 - 7805';
  sheet.getCell('F5').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F5').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('F6').value = '(053) 657 - 7905';
  sheet.getCell('F6').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F6').alignment = { horizontal: 'center', vertical: 'middle' };

  // 8행: 테이블 헤더 (템플릿과 동일)
  sheet.getCell('A8').value = '번호';
  sheet.getCell('A8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('A8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('B8').value = '품명';
  sheet.getCell('B8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('B8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('C8').value = '규  격';
  sheet.getCell('C8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('C8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('D8').value = '수 량';
  sheet.getCell('D8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('D8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('E8').value = '단  가';
  sheet.getCell('E8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('E8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('F8').value = '금  액';
  sheet.getCell('F8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F8').alignment = { horizontal: 'center', vertical: 'middle' };
  
  sheet.getCell('G8').value = '비고 (사용 용도)';
  sheet.getCell('G8').font = { name: 'GulimChe', size: 11 };
  sheet.getCell('G8').alignment = { horizontal: 'center', vertical: 'middle' };

  // 품목이 38개를 넘으면 아래로 밀어서 합계/하단 정보 출력 (템플릿에서는 47행에 합계)
  const baseRow = 9;
  const minRows = 38; // 템플릿에서는 A47에 합계가 있으므로 9~46행이 38개
  // --- 품목 데이터 line_number 기준 정렬 ---
  const sortedItems = [...data.items].sort((a, b) => a.line_number - b.line_number);
  const itemRows = sortedItems.length;
  const sumRow = baseRow + Math.max(itemRows, minRows); // 합계 위치

  // 품목 데이터
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const rowIdx = baseRow + i;
    
    sheet.getCell('A' + rowIdx).value = item.line_number;
    sheet.getCell('A' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('A' + rowIdx).alignment = { horizontal: 'center', vertical: 'middle' };
    
    sheet.getCell('B' + rowIdx).value = item.item_name;
    sheet.getCell('B' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('B' + rowIdx).alignment = { horizontal: 'left', vertical: 'middle' };
    
    sheet.getCell('C' + rowIdx).value = item.specification;
    sheet.getCell('C' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('C' + rowIdx).alignment = { horizontal: 'left', vertical: 'middle' };
    
    sheet.getCell('D' + rowIdx).value = item.quantity;
    sheet.getCell('D' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('D' + rowIdx).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // 단가(E열) - 통화 기호 포함
    const unitSymbol = getCurrencySymbol(item.currency);
    const unitWithCurrency = (item.unit_price_value !== undefined && item.unit_price_value !== null)
      ? `${item.unit_price_value.toLocaleString()} ${unitSymbol}`.trim()
      : '';
    sheet.getCell('E' + rowIdx).value = unitWithCurrency;
    sheet.getCell('E' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('E' + rowIdx).alignment = { horizontal: 'right', vertical: 'middle' };

    // 금액(F열) - 통화 기호 포함
    const amountSymbol = getCurrencySymbol(item.currency);
    const amountWithCurrency = (item.amount_value !== undefined && item.amount_value !== null)
      ? `${item.amount_value.toLocaleString()} ${amountSymbol}`.trim()
      : '';
    sheet.getCell('F' + rowIdx).value = amountWithCurrency;
    sheet.getCell('F' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('F' + rowIdx).alignment = { horizontal: 'right', vertical: 'middle' };
    
    // 비고(G열)
    sheet.getCell('G' + rowIdx).value = (item.remark !== undefined && item.remark !== null) ? String(item.remark) : '';
    sheet.getCell('G' + rowIdx).font = { name: 'GulimChe', size: 11 };
    sheet.getCell('G' + rowIdx).alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // 품목이 38개보다 적으면 빈 행 추가
  for (let i = itemRows; i < minRows; i++) {
    const rowIdx = baseRow + i;
    for (let c = 0; c < 7; c++) {
      sheet.getCell(String.fromCharCode(65 + c) + rowIdx).value = '';
    }
  }

  // 합계 (템플릿과 동일한 형식으로 A47처럼 병합)
  const sumMergeRange = itemRows < 38 ? 'A47:E47' : `A${sumRow}:E${sumRow}`;
  sheet.mergeCells(sumMergeRange);
  const actualSumRow = itemRows < 38 ? 47 : sumRow;
  sheet.getCell('A' + actualSumRow).value = '합계';
  sheet.getCell('A' + actualSumRow).font = { name: 'GulimChe', size: 11, bold: true };
  sheet.getCell('A' + actualSumRow).alignment = { horizontal: 'center', vertical: 'middle' };
  
  const totalSymbol = getCurrencySymbol(data.items[0]?.currency);
  const totalAmount = data.items.reduce((sum, item) => sum + (item.amount_value || 0), 0);
  sheet.getCell('F' + actualSumRow).value = `${totalAmount.toLocaleString()} ${totalSymbol}`.trim();
  sheet.getCell('F' + actualSumRow).font = { name: 'GulimChe', size: 11 };
  sheet.getCell('F' + actualSumRow).alignment = { horizontal: 'right', vertical: 'middle' };

  // 실제 마지막 데이터가 들어간 행까지 동적으로 테두리 적용 (합계까지만)
  const lastRow = actualSumRow;
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
        top:    { style: (r === 1) ? 'medium' : (r === 2 || r === 8 || r === actualSumRow) ? 'medium' : 'thin' },
        left:   { style: c === 1 ? 'medium' : 'thin' },
        right:  { style: c === 7 ? 'medium' : 'thin' },
        bottom: { style: (r === 8 || r === actualSumRow || r === lastRow) ? 'medium' : 'thin' }
      };
    }
  }
  // 품목 데이터 정렬은 이미 위에서 설정했으므로 삭제

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
  const sumCellBorder = sheet.getCell('A' + actualSumRow).border || {};
  sheet.getCell('A' + actualSumRow).border = {
    ...sumCellBorder,
    left: { style: 'medium' }
  };

  // 열 너비 (템플릿 기준 정확히 매칭)
  sheet.getColumn('A').width = 6.33203125;
  sheet.getColumn('B').width = 12.6640625;
  sheet.getColumn('C').width = 31.6640625;
  sheet.getColumn('D').width = 12.6640625;
  sheet.getColumn('E').width = 15.6640625;
  sheet.getColumn('F').width = 17.6640625;
  sheet.getColumn('G').width = 39;

  /* -----------------------------------
      행 높이 최종 설정
      1행 : 39.75pt
      2행~lastRow : 15.75pt
  ----------------------------------- */
  sheet.getRow(1).height = 39.75;
  for (let r = 2; r <= lastRow; r++) {
    sheet.getRow(r).height = 15.75;
  }

  // 품목 데이터 행의 폰트 및 정렬은 이미 위에서 설정했으므로 삭제

  // 9. 파일 생성
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}