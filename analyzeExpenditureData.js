import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeExpenditureData() {
  try {
    const filePath = path.join(__dirname, '외상매입장부.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    console.log('=== 지출정보 분석 ===\n');
    console.log(`총 시트 개수: ${workbook.worksheets.length}\n`);
    
    // 샘플로 처음 5개 시트와 큰 시트 몇 개 분석
    const sampleSheets = [
      ...workbook.worksheets.slice(0, 5),
      workbook.worksheets.find(s => s.name === '한샘디지텍'),
      workbook.worksheets.find(s => s.name === '환화'),
      workbook.worksheets.find(s => s.name === '퍼스트코어'),
    ].filter(Boolean);
    
    let totalExpenditureRows = 0;
    let sheetsWithExpenditure = 0;
    const expenditureExamples = [];
    
    for (const sheet of sampleSheets) {
      console.log(`\n--- 시트: ${sheet.name} ---`);
      console.log(`행 개수: ${sheet.rowCount}, 열 개수: ${sheet.columnCount}`);
      
      // 헤더 행 찾기 (보통 2-3행에 있음)
      let headerRow = null;
      let headerCols = {};
      
      for (let row = 1; row <= Math.min(5, sheet.rowCount); row++) {
        const rowData = [];
        sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const value = String(cell.value || '').trim();
          if (value) rowData.push({ col: colNumber, value });
        });
        
        // "지출금액" 또는 "지출"이 포함된 행 찾기
        const hasExpenditureHeader = rowData.some(item => 
          item.value.includes('지출') || item.value.includes('결제')
        );
        
        if (hasExpenditureHeader) {
          headerRow = row;
          rowData.forEach(item => {
            if (item.value.includes('지출')) headerCols.expenditure = item.col;
            if (item.value.includes('날짜') || item.value.includes('날')) headerCols.date = item.col;
            if (item.value.includes('결제')) headerCols.payment = item.col;
            if (item.value.includes('금액')) headerCols.amount = item.col;
          });
          console.log(`헤더 행: ${row}`);
          console.log(`지출 컬럼: ${headerCols.expenditure || '없음'}`);
          console.log(`날짜 컬럼: ${headerCols.date || '없음'}`);
          console.log(`결제 컬럼: ${headerCols.payment || '없음'}`);
          break;
        }
      }
      
      if (!headerRow) {
        console.log('⚠️  지출 관련 헤더를 찾을 수 없음');
        continue;
      }
      
      // 데이터 행 분석 (헤더 다음부터)
      let expenditureCount = 0;
      const startRow = headerRow + 1;
      const endRow = Math.min(startRow + 50, sheet.rowCount); // 처음 50개 행만 샘플
      
      for (let row = startRow; row <= endRow; row++) {
        const rowData = sheet.getRow(row);
        let hasExpenditure = false;
        let expenditureValue = null;
        let dateValue = null;
        let paymentValue = null;
        
        // 지출금액 컬럼 확인
        if (headerCols.expenditure) {
          const cell = rowData.getCell(headerCols.expenditure);
          if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
            expenditureValue = cell.value;
            hasExpenditure = true;
          }
        }
        
        // 결제 컬럼 확인
        if (headerCols.payment) {
          const cell = rowData.getCell(headerCols.payment);
          if (cell.value !== null && cell.value !== undefined) {
            paymentValue = String(cell.value).trim();
            if (paymentValue.includes('결제') || paymentValue.includes('현금')) {
              hasExpenditure = true;
            }
          }
        }
        
        // 날짜 컬럼 확인
        if (headerCols.date) {
          const cell = rowData.getCell(headerCols.date);
          if (cell.value !== null && cell.value !== undefined) {
            dateValue = cell.value;
          }
        }
        
        if (hasExpenditure && (expenditureValue || paymentValue)) {
          expenditureCount++;
          if (expenditureExamples.length < 10) {
            expenditureExamples.push({
              sheet: sheet.name,
              row: row,
              date: dateValue,
              expenditure: expenditureValue,
              payment: paymentValue
            });
          }
        }
      }
      
      if (expenditureCount > 0) {
        sheetsWithExpenditure++;
        totalExpenditureRows += expenditureCount;
        console.log(`✅ 지출 데이터 행: ${expenditureCount}개 (샘플 범위 내)`);
      } else {
        console.log('⚠️  지출 데이터를 찾을 수 없음');
      }
    }
    
    console.log('\n\n=== 분석 결과 요약 ===');
    console.log(`분석한 시트: ${sampleSheets.length}개`);
    console.log(`지출정보가 있는 시트: ${sheetsWithExpenditure}개`);
    console.log(`총 지출 데이터 행 (샘플): ${totalExpenditureRows}개`);
    
    console.log('\n=== 지출정보 예시 (최대 10개) ===');
    expenditureExamples.forEach((ex, idx) => {
      console.log(`\n${idx + 1}. 시트: ${ex.sheet}, 행: ${ex.row}`);
      console.log(`   날짜: ${ex.date}`);
      console.log(`   지출금액: ${ex.expenditure}`);
      console.log(`   결제정보: ${ex.payment}`);
    });
    
    // 전체 시트에서 지출 관련 키워드 검색
    console.log('\n\n=== 전체 시트 지출정보 존재 여부 확인 ===');
    let allSheetsWithExpenditure = 0;
    for (const sheet of workbook.worksheets) {
      // 시트 이름이나 첫 몇 행에서 "지출" 키워드 검색
      let hasExpenditureKeyword = false;
      
      // 시트 이름 확인
      if (sheet.name.includes('지출') || sheet.name.includes('결제')) {
        hasExpenditureKeyword = true;
      }
      
      // 처음 5행에서 키워드 검색
      if (!hasExpenditureKeyword) {
        for (let row = 1; row <= Math.min(5, sheet.rowCount); row++) {
          const rowData = sheet.getRow(row);
          rowData.eachCell({ includeEmpty: false }, (cell) => {
            const value = String(cell.value || '').toLowerCase();
            if (value.includes('지출') || value.includes('결제') || value.includes('현금')) {
              hasExpenditureKeyword = true;
            }
          });
          if (hasExpenditureKeyword) break;
        }
      }
      
      if (hasExpenditureKeyword) {
        allSheetsWithExpenditure++;
      }
    }
    
    console.log(`전체 ${workbook.worksheets.length}개 시트 중 지출정보가 있는 것으로 보이는 시트: ${allSheetsWithExpenditure}개`);
    
  } catch (error) {
    console.error('에러 발생:', error);
    console.error('에러 스택:', error.stack);
  }
}

analyzeExpenditureData();






