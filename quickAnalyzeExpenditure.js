import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function quickAnalyze() {
  const filePath = path.join(__dirname, '외상매입장부.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  console.log('=== 지출정보 빠른 분석 ===\n');
  console.log(`총 시트: ${workbook.worksheets.length}개\n`);
  
  // 처음 3개 시트만 샘플 분석
  for (let i = 0; i < Math.min(3, workbook.worksheets.length); i++) {
    const sheet = workbook.worksheets[i];
    console.log(`\n[시트 ${i+1}] ${sheet.name}`);
    
    // 처음 10행만 확인
    for (let row = 1; row <= Math.min(10, sheet.rowCount); row++) {
      const rowData = [];
      sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
        const val = String(cell.value || '').trim();
        if (val && (val.includes('지출') || val.includes('결제') || val.includes('현금') || 
            val.match(/^\d{4}년/) || val.match(/^\d+$/) && Number(val) > 1000)) {
          rowData.push(`C${col}:${val.substring(0, 30)}`);
        }
      });
      if (rowData.length > 0) {
        console.log(`  행${row}: ${rowData.join(' | ')}`);
      }
    }
  }
}

quickAnalyze().catch(console.error);






