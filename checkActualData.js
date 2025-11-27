import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkActualData() {
  const filePath = path.join(__dirname, '외상매입장부.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  console.log('=== 실제 데이터 구조 확인 ===\n');
  
  // 처음 3개 시트 확인
  for (let idx = 0; idx < Math.min(3, workbook.worksheets.length); idx++) {
    const sheet = workbook.worksheets[idx];
    console.log(`\n[시트 ${idx + 1}] ${sheet.name}\n`);
    
    // 처음 15행 전체 출력
    for (let row = 1; row <= Math.min(15, sheet.rowCount); row++) {
      const rowData = [];
      sheet.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= 10) { // 처음 10개 컬럼만
          const val = cell.value;
          let displayVal = '';
          if (val === null || val === undefined) {
            displayVal = '';
          } else if (val instanceof Date) {
            displayVal = val.toLocaleDateString('ko-KR');
          } else if (typeof val === 'object') {
            displayVal = '[객체]';
          } else {
            displayVal = String(val).substring(0, 20);
          }
          rowData.push(`${col}:${displayVal}`);
        }
      });
      console.log(`행${row}: ${rowData.join(' | ')}`);
    }
  }
  
  console.log('\n\n=== 지출정보 존재 여부 판단 ===');
  console.log('위 데이터를 보면:');
  console.log('- 각 시트에 "지출 금액" 컬럼이 있는지 확인');
  console.log('- "결제 - 현금" 행에 지출금액이 있는지 확인');
  console.log('- 날짜 정보가 있는지 확인');
}

checkActualData().catch(console.error);






