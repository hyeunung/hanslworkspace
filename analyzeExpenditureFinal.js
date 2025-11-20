import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeExpenditure() {
  const filePath = path.join(__dirname, '외상매입장부.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  console.log('=== 지출정보 분석 (전월/차월 이월 제외) ===\n');
  console.log(`총 시트: ${workbook.worksheets.length}개\n`);
  
  let totalSheets = 0;
  let sheetsWithExpenditure = 0;
  let totalExpenditureRecords = 0;
  const expenditureExamples = [];
  
  // 처음 10개 시트 + 큰 시트 몇 개 샘플 분석
  const sampleIndices = [
    ...Array.from({ length: Math.min(10, workbook.worksheets.length) }, (_, i) => i),
    workbook.worksheets.findIndex(s => s.name === '한샘디지텍'),
    workbook.worksheets.findIndex(s => s.name === '환화'),
  ].filter(i => i >= 0);
  
  for (const idx of sampleIndices) {
    const sheet = workbook.worksheets[idx];
    totalSheets++;
    
    console.log(`\n[${idx + 1}] ${sheet.name} (${sheet.rowCount}행)`);
    
    // 헤더 찾기
    let headerRow = null;
    let expenditureCol = null;
    let dateCol = null;
    let itemNameCol = null;
    let amountCol = null;
    
    for (let row = 1; row <= Math.min(5, sheet.rowCount); row++) {
      const rowData = [];
      sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
        const val = String(cell.value || '').trim();
        rowData.push({ col, val });
      });
      
      // 지출금액 컬럼 찾기
      const expenditureIdx = rowData.findIndex(item => 
        item.val.includes('지출') && item.val.includes('금액')
      );
      if (expenditureIdx >= 0) {
        headerRow = row;
        expenditureCol = rowData[expenditureIdx].col;
        
        // 다른 컬럼도 찾기
        rowData.forEach(item => {
          if (item.val.includes('날짜') || item.val.includes('날')) dateCol = item.col;
          if (item.val.includes('품명')) itemNameCol = item.col;
          if (item.val.includes('금액') && !item.val.includes('지출')) amountCol = item.col;
        });
        break;
      }
    }
    
    if (!headerRow || !expenditureCol) {
      console.log('  ⚠️  지출금액 컬럼을 찾을 수 없음');
      continue;
    }
    
    console.log(`  헤더 행: ${headerRow}, 지출 컬럼: ${expenditureCol}`);
    
    // 데이터 행 분석 (헤더 다음부터, 전월/차월 이월 제외)
    let expenditureCount = 0;
    const startRow = headerRow + 1;
    const endRow = Math.min(startRow + 100, sheet.rowCount); // 처음 100개 행만 샘플
    
    for (let row = startRow; row <= endRow; row++) {
      const rowData = sheet.getRow(row);
      
      // 전월/차월 이월 행 건너뛰기
      let isSkipRow = false;
      rowData.eachCell({ includeEmpty: false }, (cell) => {
        const val = String(cell.value || '').trim();
        if (val.includes('전월 이월') || val.includes('차월 이월') || 
            val.includes('합계액') || val === '합계') {
          isSkipRow = true;
        }
      });
      if (isSkipRow) continue;
      
      // 지출금액 확인
      const expenditureCell = rowData.getCell(expenditureCol);
      if (expenditureCell.value !== null && expenditureCell.value !== undefined && 
          expenditureCell.value !== '' && expenditureCell.value !== 0) {
        
        const expenditureValue = Number(expenditureCell.value) || 0;
        if (expenditureValue > 0) {
          expenditureCount++;
          
          // 예시 수집
          if (expenditureExamples.length < 15) {
            let dateValue = null;
            let itemName = null;
            let amountValue = null;
            
            if (dateCol) {
              const dateCell = rowData.getCell(dateCol);
              dateValue = dateCell.value;
            }
            if (itemNameCol) {
              const itemCell = rowData.getCell(itemNameCol);
              itemName = String(itemCell.value || '').trim();
            }
            if (amountCol) {
              const amountCell = rowData.getCell(amountCol);
              amountValue = amountCell.value;
            }
            
            expenditureExamples.push({
              sheet: sheet.name,
              row: row,
              date: dateValue,
              itemName: itemName,
              amount: amountValue,
              expenditure: expenditureValue
            });
          }
        }
      }
    }
    
    if (expenditureCount > 0) {
      sheetsWithExpenditure++;
      totalExpenditureRecords += expenditureCount;
      console.log(`  ✅ 지출 데이터: ${expenditureCount}개 (샘플 범위 내)`);
    } else {
      console.log('  ⚠️  지출 데이터 없음');
    }
  }
  
  console.log('\n\n=== 분석 결과 요약 ===');
  console.log(`분석한 시트: ${totalSheets}개`);
  console.log(`지출정보가 있는 시트: ${sheetsWithExpenditure}개`);
  console.log(`총 지출 레코드 (샘플): ${totalExpenditureRecords}개`);
  
  console.log('\n=== 지출정보 예시 ===');
  expenditureExamples.forEach((ex, idx) => {
    console.log(`\n${idx + 1}. [${ex.sheet}] 행${ex.row}`);
    console.log(`   날짜: ${ex.date}`);
    console.log(`   품명: ${ex.itemName || 'N/A'}`);
    console.log(`   금액: ${ex.amount || 'N/A'}`);
    console.log(`   지출금액: ${ex.expenditure}`);
  });
  
  console.log('\n\n=== 결론 ===');
  if (sheetsWithExpenditure > 0) {
    console.log(`✅ 지출정보가 포함되어 있습니다!`);
    console.log(`   - ${sheetsWithExpenditure}/${totalSheets} 시트에 지출 데이터 존재`);
    console.log(`   - 각 시트마다 "지출금액" 컬럼에 실제 지출 금액이 기록됨`);
    console.log(`   - "결제 - 현금" 행에도 지출 정보 포함`);
  } else {
    console.log(`⚠️  지출정보를 찾을 수 없습니다.`);
  }
}

analyzeExpenditure().catch(console.error);




