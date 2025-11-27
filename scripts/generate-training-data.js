/**
 * 학습 데이터 생성 스크립트
 * 원본 BOM + 정답 BOM 쌍을 ChatGPT 학습 형식으로 변환
 */

import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';

const TRAINING_PAIRS_FILE = './scripts/training-pairs.json';
const OUTPUT_FILE = './scripts/training-dataset.jsonl';

/**
 * 엑셀 파일을 텍스트로 변환
 */
async function excelToText(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const sheet = workbook.worksheets[0];
  const rows = [];
  
  sheet.eachRow((row, rowNumber) => {
    const cells = [];
    row.eachCell((cell, colNumber) => {
      if (colNumber <= 10) {
        cells.push(cell.value ? String(cell.value) : '');
      }
    });
    if (cells.some(c => c)) {
      rows.push(cells.join('\t'));
    }
  });
  
  return rows.join('\n');
}

/**
 * 학습 데이터 1쌍 생성
 */
async function createTrainingPair(pair) {
  try {
    const rawBOMPath = path.join(pair.path, pair.rawBOM);
    const cleanedPath = path.join(pair.path, pair.cleaned);
    
    // 원본 BOM 텍스트화
    const rawBOMText = await excelToText(rawBOMPath);
    
    // 정리된 BOM 텍스트화
    const cleanedText = await excelToText(cleanedPath);
    
    // ChatGPT 학습 형식으로 변환
    const trainingExample = {
      messages: [
        {
          role: 'system',
          content: `당신은 PCB BOM 데이터 정리 전문가입니다. CAD에서 내려온 원본 BOM 파일을 회사 표준 양식으로 정리합니다.

표준 양식:
- Row 1-3: 담당자 정보
- Row 5: 프로젝트명
- Row 6: 헤더 (번호|종류|품목|SET|수량|재고|CHECK|Ref|대체가능품목|비고)
- Row 7+: 데이터

정리 규칙:
1. 동일 품명끼리 그룹핑
2. REF 수집 및 정렬
3. SET = REF 개수
4. 수량 = SET × 생산수량
5. "_OPEN" 접미사 → 비고에 "미삽" 표시
6. 품명에서 불필요한 공백/특수문자 제거`
        },
        {
          role: 'user',
          content: `다음 BOM 파일을 표준 양식으로 정리해주세요:\n\n${rawBOMText}`
        },
        {
          role: 'assistant',
          content: cleanedText
        }
      ]
    };
    
    return trainingExample;
    
  } catch (error) {
    console.error(`오류 (${pair.project}):`, error.message);
    return null;
  }
}

/**
 * 메인 실행
 */
async function main() {
  console.log('🤖 학습 데이터 생성 시작...\n');
  
  // 1. 학습 쌍 로드
  const pairs = JSON.parse(await fs.readFile(TRAINING_PAIRS_FILE, 'utf-8'));
  console.log(`총 ${pairs.length}쌍 발견\n`);
  
  // 2. 처음 20쌍으로 학습 데이터 생성
  console.log('처음 20쌍 처리 중...\n');
  const trainingExamples = [];
  
  for (let i = 0; i < Math.min(20, pairs.length); i++) {
    process.stdout.write(`진행: ${i + 1}/20\r`);
    const example = await createTrainingPair(pairs[i]);
    if (example) {
      trainingExamples.push(example);
    }
  }
  
  console.log(`\n✅ ${trainingExamples.length}개 생성 완료\n`);
  
  // 3. JSONL 형식으로 저장 (ChatGPT 파인튜닝 형식)
  const jsonlContent = trainingExamples.map(ex => JSON.stringify(ex)).join('\n');
  await fs.writeFile(OUTPUT_FILE, jsonlContent, 'utf-8');
  
  console.log(`✅ 저장: ${OUTPUT_FILE}`);
  console.log(`파일 크기: ${(jsonlContent.length / 1024).toFixed(2)} KB`);
  
  // 4. 통계
  const avgInputLength = trainingExamples.reduce((sum, ex) => 
    sum + ex.messages[1].content.length, 0) / trainingExamples.length;
  const avgOutputLength = trainingExamples.reduce((sum, ex) => 
    sum + ex.messages[2].content.length, 0) / trainingExamples.length;
  
  console.log(`\n📊 통계:`);
  console.log(`평균 입력 길이: ${avgInputLength.toFixed(0)} 문자`);
  console.log(`평균 출력 길이: ${avgOutputLength.toFixed(0)} 문자`);
  console.log(`예상 토큰: ~${((avgInputLength + avgOutputLength) / 3).toFixed(0)} tokens/쌍`);
  
  console.log('\n✨ 완료! 이제 ChatGPT 파인튜닝 가능합니다.');
}

main().catch(console.error);



