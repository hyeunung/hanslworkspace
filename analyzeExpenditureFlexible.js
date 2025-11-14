import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeExpenditure() {
  const filePath = path.join(__dirname, '외상매입장부.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  console.log('=== 지출정보 분석 ===\n');
  
  let totalSheets = 0;
  let sheetsWithExpenditure = 0;
  let totalExpenditureRecords = 0;
  const expenditureExamples = [];
  
  // 처음 10개 시트 샘플
  const sampleCount = Math.min(10, workbook.worksheets.length);
  
  for (let idx = 0; idx < sampleCount; idx++) {
    const sheet = workbook.worksheets[idx];
    totalSheets++;
    
    console.log(`\n[${idx + 1}] ${sheet.name}`);
    
    // 모든 행에서 "지출" 키워드가 있는 컬럼 찾기
    let expenditureCol = null;
    let dateCol = null;
    let itemNameCol = null;
    
    // 처음 5행에서 헤더 찾기
    for (let row = 1; row <= Math.min(5, sheet.rowCount); row++) {
      sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
        const val = String(cell.value || '').trim();
        
        // 지출 관련 컬럼 찾기 (더 유연하게)
        if (!expenditureCol && (
          val.includes('지출') || 
          val.includes('결제') ||
          (val.includes('금액') && row >= 2) // 2행 이상에서 금액은 지출일 가능성
        )) {
          expenditureCol = col;
        }
        
        if (!dateCol && (val.includes('날') || val.includes('일'))) {
          dateCol = col;
        }
        
        if (!itemNameCol && val.includes('품명')) {
          itemNameCol = col;
        }
      });
    }
    
    if (!expenditureCol) {
      console.log('  ⚠️  지출 컬럼을 찾을 수 없음');
      continue;
    }
    
    console.log(`  지출 컬럼: ${expenditureCol}, 날짜 컬럼: ${dateCol || '없음'}`);
    
    // 데이터 행 분석 (6행부터, 전월/차월 이월 제외)
    let expenditureCount = 0;
    const startRow = 6;
    const endRow = Math.min(startRow + 50, sheet.rowCount);
    
    for (let row = startRow; row <= endRow; row++) {
      const rowData = sheet.getRow(row);
      
      // 전월/차월 이월 행 건너뛰기
      let isSkipRow = false;
      let rowText = '';
      rowData.eachCell({ includeEmpty: false }, (cell) => {
        const val = String(cell.value || '').trim();
        rowText += val + ' ';
        if (val.includes('전월 이월') || val.includes('차월 이월') || 
            val.includes('합계액') || val === '합계' || val.includes('합계액')) {
          isSkipRow = true;
        }
      });
      if (isSkipRow) continue;
      
      // 지출금액 확인
      const expenditureCell = rowData.getCell(expenditureCol);
      if (expenditureCell.value !== null && expenditureCell.value !== undefined) {
        const expenditureValue = Number(expenditureCell.value) || 0;
        
        // 숫자이고 0보다 크면 지출 데이터로 간주
        if (expenditureValue > 0) {
          expenditureCount++;
          
          // 예시 수집
          if (expenditureExamples.length < 10) {
            let dateValue = null;
            let itemName = null;
            
            if (dateCol) {
              const dateCell = rowData.getCell(dateCol);
              dateValue = dateCell.value;
            }
            if (itemNameCol) {
              const itemCell = rowData.getCell(itemNameCol);
              itemName = String(itemCell.value || '').trim().substring(0, 30);
            }
            
            expenditureExamples.push({
              sheet: sheet.name,
              row: row,
              date: dateValue,
              itemName: itemName,
              expenditure: expenditureValue,
              rowText: rowText.trim().substring(0, 80)
            });
          }
        }
      }
    }
    
    if (expenditureCount > 0) {
      sheetsWithExpenditure++;
      totalExpenditureRecords += expenditureCount;
      console.log(`  ✅ 지출 데이터: ${expenditureCount}개`);
    } else {
      console.log('  ⚠️  지출 데이터 없음');
    }
  }
  
  console.log('\n\n=== 분석 결과 ===');
  console.log(`분석한 시트: ${totalSheets}개`);
  console.log(`지출정보가 있는 시트: ${sheetsWithExpenditure}개`);
  console.log(`총 지출 레코드: ${totalExpenditureRecords}개`);
  
  if (expenditureExamples.length > 0) {
    console.log('\n=== 지출정보 예시 ===');
    expenditureExamples.forEach((ex, idx) => {
      console.log(`\n${idx + 1}. [${ex.sheet}] 행${ex.row}`);
      console.log(`   날짜: ${ex.date}`);
      console.log(`   품명: ${ex.itemName || 'N/A'}`);
      console.log(`   지출금액: ${ex.expenditure.toLocaleString()}원`);
      console.log(`   행 내용: ${ex.rowText}`);
    });
  }
  
  console.log('\n=== 결론 ===');
  if (sheetsWithExpenditure > 0) {
    console.log(`✅ 지출정보가 포함되어 있습니다!`);
    console.log(`   - 각 시트에 지출금액 컬럼이 있고 실제 지출 데이터가 기록됨`);
  } else {
    console.log(`⚠️  샘플 시트에서 지출정보를 찾을 수 없습니다.`);
    console.log(`   - 다른 형식일 수 있으니 더 자세한 분석이 필요합니다.`);
  }
}

analyzeExpenditure().catch(console.error);

