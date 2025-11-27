/**
 * BOM 파일 자동 분석 스크립트
 * 226개 파일의 패턴을 자동으로 식별합니다.
 */

import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOM_DIRECTORY = './sample-data/24_25_SOCKET';
const OUTPUT_FILE = './scripts/analysis-report.json';

// 분석 결과 저장
const analysisResults = {
  totalFiles: 0,
  patterns: {},
  fileDetails: []
};

/**
 * 파일 하나를 분석합니다
 */
async function analyzeFile(filePath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const analysis = {
      filePath,
      fileName: path.basename(filePath),
      sheetCount: workbook.worksheets.length,
      sheetNames: workbook.worksheets.map(ws => ws.name),
      pattern: 'unknown',
      signature: null,
      headerInfo: {}
    };
    
    // 첫 번째 시트 분석
    const firstSheet = workbook.worksheets[0];
    if (firstSheet) {
      // 처음 20행 스캔해서 패턴 감지
      for (let row = 1; row <= Math.min(20, firstSheet.rowCount); row++) {
        const rowData = firstSheet.getRow(row);
        const firstCell = rowData.getCell(1).value?.toString() || '';
        const secondCell = rowData.getCell(2).value?.toString() || '';
        
        // P-CAD 패턴 감지
        if (firstCell.includes('P-CAD') || firstCell.includes('Pick and Place')) {
          analysis.pattern = 'P-CAD';
          analysis.signature = 'P-CAD Pick and Place';
          break;
        }
        
        // Altium 패턴 감지
        if (firstCell.includes('Altium') || secondCell.includes('Designator')) {
          analysis.pattern = 'Altium';
          analysis.signature = 'Altium Designer';
          break;
        }
        
        // OrCAD 패턴 감지
        if (firstCell.includes('OrCAD') || firstCell.includes('Cadence')) {
          analysis.pattern = 'OrCAD';
          analysis.signature = 'OrCAD/Cadence';
          break;
        }
        
        // 헤더 탐지 (Item, Reference, Quantity 등)
        if (firstCell.includes('Item') || secondCell.includes('Reference')) {
          analysis.headerInfo = {
            row: row,
            columns: []
          };
          for (let col = 1; col <= 10; col++) {
            const cellValue = rowData.getCell(col).value?.toString() || '';
            if (cellValue) {
              analysis.headerInfo.columns.push(cellValue);
            }
          }
        }
      }
    }
    
    return analysis;
    
  } catch (error) {
    console.error(`오류 (${filePath}):`, error.message);
    return null;
  }
}

/**
 * 디렉토리 재귀 탐색
 */
async function getAllExcelFiles(dir) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
          // 정리된 파일만 (part.BOM 또는 part.bom 제외)
          if (!entry.name.toLowerCase().includes('part.bom')) {
            files.push(fullPath);
          }
        }
      }
    }
  }
  
  await scan(dir);
  return files;
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('🔍 BOM 파일 분석 시작...\n');
  console.log(`📁 대상 디렉토리: ${BOM_DIRECTORY}\n`);
  
  // 1. 모든 엑셀 파일 찾기
  console.log('1️⃣ 파일 목록 수집 중...');
  const excelFiles = await getAllExcelFiles(BOM_DIRECTORY);
  console.log(`   ✅ 총 ${excelFiles.length}개 파일 발견\n`);
  
  analysisResults.totalFiles = excelFiles.length;
  
  // 2. 각 파일 분석
  console.log('2️⃣ 파일 분석 중...');
  let progress = 0;
  
  for (const file of excelFiles) {
    progress++;
    process.stdout.write(`   진행: ${progress}/${excelFiles.length}\r`);
    
    const analysis = await analyzeFile(file);
    if (analysis) {
      analysisResults.fileDetails.push(analysis);
      
      // 패턴별 그룹화
      const pattern = analysis.pattern;
      if (!analysisResults.patterns[pattern]) {
        analysisResults.patterns[pattern] = {
          count: 0,
          samples: []
        };
      }
      analysisResults.patterns[pattern].count++;
      
      // 샘플로 처음 3개만 저장
      if (analysisResults.patterns[pattern].samples.length < 3) {
        analysisResults.patterns[pattern].samples.push({
          fileName: analysis.fileName,
          filePath: analysis.filePath,
          signature: analysis.signature,
          headerInfo: analysis.headerInfo
        });
      }
    }
  }
  
  console.log(`\n   ✅ 분석 완료\n`);
  
  // 3. 결과 출력
  console.log('3️⃣ 분석 결과:\n');
  console.log(`총 파일 수: ${analysisResults.totalFiles}`);
  console.log(`패턴 종류: ${Object.keys(analysisResults.patterns).length}개\n`);
  
  for (const [pattern, data] of Object.entries(analysisResults.patterns)) {
    const percentage = ((data.count / analysisResults.totalFiles) * 100).toFixed(1);
    console.log(`📊 ${pattern}: ${data.count}개 (${percentage}%)`);
    if (data.samples.length > 0) {
      console.log(`   샘플: ${data.samples[0].fileName}`);
    }
  }
  
  // 4. JSON 파일로 저장
  console.log(`\n4️⃣ 결과 저장 중...`);
  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(analysisResults, null, 2),
    'utf-8'
  );
  console.log(`   ✅ 저장 완료: ${OUTPUT_FILE}\n`);
  
  console.log('✨ 분석 완료!\n');
}

// 실행
main().catch(console.error);

