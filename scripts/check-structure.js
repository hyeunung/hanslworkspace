import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkStructure() {
  const samplePath = path.join(__dirname, '../sample-data/24_25_SOCKET/2025/H25-120_BOI-T_C40_APS_COMMON2.0_6L');
  
  // 폴더 내 파일 목록
  const files = fs.readdirSync(samplePath);
  console.log('📁 폴더 내 파일들:');
  files.forEach(f => console.log(`  - ${f}`));
  
  // 정리본 파일 찾기 (숫자가 괄호 안에 있는 파일)
  const answerFile = files.find(f => /\(\d{4}\)\.xlsx$/.test(f));
  console.log('\n📄 정리본 파일:', answerFile);
  
  if (answerFile) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(samplePath, answerFile));
    
    console.log('\n=== 정리본 구조 분석 ===');
    console.log('시트 개수:', workbook.worksheets.length);
    console.log('시트 이름들:', workbook.worksheets.map(s => s.name));
    
    workbook.worksheets.forEach((sheet, idx) => {
      console.log(`\n--- 시트 ${idx + 1}: "${sheet.name}" ---`);
      console.log(`행: ${sheet.rowCount}, 열: ${sheet.columnCount}`);
      
      // 처음 20행 출력
      console.log('\n처음 20행:');
      for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
        const row = sheet.getRow(r);
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (colNum <= 10) {
            let val = cell.value;
            if (val && typeof val === 'object' && val.richText) {
              val = val.richText.map(rt => rt.text).join('');
            }
            values.push(`[${colNum}]${val ?? ''}`);
          }
        });
        if (values.length > 0) {
          console.log(`R${r}: ${values.join(' | ')}`);
        }
      }
    });
  }
  
  // BOM 원본 파일 확인
  const bomFile = files.find(f => /part|bom/i.test(f) && /\.(xlsx|xls)$/i.test(f));
  console.log('\n\n📄 BOM 원본 파일:', bomFile);
  
  if (bomFile) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(samplePath, bomFile));
    
    console.log('\n=== BOM 원본 구조 분석 ===');
    console.log('시트 이름들:', workbook.worksheets.map(s => s.name));
    
    const sheet = workbook.worksheets[0];
    console.log(`\n--- 시트: "${sheet.name}" ---`);
    console.log(`행: ${sheet.rowCount}, 열: ${sheet.columnCount}`);
    
    // 처음 30행 출력
    console.log('\n처음 30행:');
    for (let r = 1; r <= Math.min(30, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        if (colNum <= 12) {
          let val = cell.value;
          if (val && typeof val === 'object' && val.richText) {
            val = val.richText.map(rt => rt.text).join('');
          }
          values.push(`[${colNum}]${val ?? ''}`);
        }
      });
      if (values.length > 0) {
        console.log(`R${r}: ${values.join(' | ')}`);
      }
    }
  }
}

checkStructure().catch(console.error);






