import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeTemplate() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(__dirname, 'public/templates/발주서(Default)-3.xlsx'));
  
  const worksheet = workbook.getWorksheet('발주서');
  
  console.log('=== 엑셀 템플릿 분석 ===\n');
  
  // 병합된 셀 정보
  console.log('병합된 셀:');
  const merges = worksheet._merges || {};
  Object.keys(merges).forEach(key => {
    console.log(`  ${key}`);
  });
  
  console.log('\n셀 값과 스타일:');
  
  // 주요 셀 정보 출력
  for (let row = 1; row <= 10; row++) {
    for (let col = 1; col <= 7; col++) {
      const cell = worksheet.getCell(row, col);
      if (cell.value) {
        const colLetter = String.fromCharCode(64 + col);
        console.log(`${colLetter}${row}: "${cell.value}"`);
        if (cell.font) {
          console.log(`  Font: ${JSON.stringify(cell.font)}`);
        }
        if (cell.alignment) {
          console.log(`  Alignment: ${JSON.stringify(cell.alignment)}`);
        }
      }
    }
  }
  
  console.log('\n열 너비:');
  for (let col = 1; col <= 7; col++) {
    const colLetter = String.fromCharCode(64 + col);
    const column = worksheet.getColumn(col);
    console.log(`  ${colLetter}: ${column.width}`);
  }
  
  console.log('\n행 높이:');
  for (let row = 1; row <= 10; row++) {
    const rowObj = worksheet.getRow(row);
    console.log(`  Row ${row}: ${rowObj.height}`);
  }
  
  // 하단 정보 확인
  console.log('\n하단 정보 (55행 이후):');
  for (let row = 55; row <= 60; row++) {
    for (let col = 1; col <= 7; col++) {
      const cell = worksheet.getCell(row, col);
      if (cell.value) {
        const colLetter = String.fromCharCode(64 + col);
        console.log(`${colLetter}${row}: "${cell.value}"`);
      }
    }
  }
}

analyzeTemplate().catch(console.error);