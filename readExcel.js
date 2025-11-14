import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readExcelFile() {
  try {
    const filePath = path.join(__dirname, '외상매입장부.xlsx');
    
    console.log('파일 읽기 시작:', filePath);
    console.log('파일 존재 여부:', fs.existsSync(filePath));
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    console.log('\n=== 워크북 정보 ===');
    console.log('시트 개수:', workbook.worksheets.length);
    console.log('시트 이름들:', workbook.worksheets.map(sheet => sheet.name));
    
    // 각 시트의 정보 출력
    workbook.worksheets.forEach((sheet, index) => {
      console.log(`\n--- 시트 ${index + 1}: ${sheet.name} ---`);
      console.log('행 개수:', sheet.rowCount);
      console.log('열 개수:', sheet.columnCount);
      
      // 처음 10행의 데이터 샘플 출력
      console.log('\n처음 10행 데이터:');
      for (let row = 1; row <= Math.min(10, sheet.rowCount); row++) {
        const rowData = [];
        sheet.getRow(row).eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const value = cell.value;
          if (value !== null && value !== undefined) {
            rowData.push(`${colNumber}:${value}`);
          }
        });
        if (rowData.length > 0) {
          console.log(`행 ${row}:`, rowData.join(' | '));
        }
      }
      
      // 헤더 행 확인 (첫 번째 행)
      if (sheet.rowCount > 0) {
        console.log('\n헤더 행 (첫 번째 행):');
        const headerRow = [];
        sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
          headerRow.push(`${colNumber}:${cell.value}`);
        });
        console.log(headerRow.join(' | '));
      }
    });
    
  } catch (error) {
    console.error('에러 발생:', error);
    console.error('에러 스택:', error.stack);
  }
}

readExcelFile();

