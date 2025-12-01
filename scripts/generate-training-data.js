/**
 * 학습 데이터 생성 스크립트
 * 원본 BOM + 정답 BOM 쌍을 ChatGPT 학습 형식으로 변환
 */

import * as XLSX from 'xlsx';
import fs from 'fs/promises';
import path from 'path';

const TRAINING_PAIRS_FILE = './scripts/complete-training-sets.json';
const OUTPUT_FILE = './scripts/training-dataset.jsonl';

/**
 * 파일을 텍스트로 변환 (Excel, TXT, CSV 지원)
 */
async function fileToText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.txt' || ext === '.csv') {
    // 텍스트 파일은 그대로 읽음
    // 인코딩 이슈가 있을 수 있으므로 fs.readFile 사용 (기본 utf-8)
    return await fs.readFile(filePath, 'utf-8');
  }
  
  // 엑셀 파일인 경우
  try {
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // 탭으로 구분된 텍스트로 변환 (학습용 포맷)
    const rows = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cells = [];
      // 10개 컬럼까지만 읽음
      for (let C = range.s.c; C <= Math.min(range.e.c, 10); ++C) {
        const cell_address = { c: C, r: R };
        const cell_ref = XLSX.utils.encode_cell(cell_address);
        const cell = sheet[cell_ref];
        
        if (cell && cell.v !== undefined) {
          cells.push(String(cell.v).trim());
        } else {
          cells.push('');
        }
      }
      // 빈 행 제외
      if (cells.some(c => c !== '')) {
        rows.push(cells.join('\t'));
      }
    }
    
    return rows.join('\n');
  } catch (e) {
    console.warn(`파일 읽기 실패 (${path.basename(filePath)}): ${e.message}`);
    return null;
  }
}

/**
 * 학습 데이터 1쌍 생성
 */
async function createTrainingPair(pair) {
  try {
    // 경로 구성 (24_25_SOCKET 폴더만 사용)
    const basePath = './sample-data/24_25_SOCKET';
    const projectPath = path.join(basePath, pair.year, pair.boardName);
    
    const rawBOMPath = path.join(projectPath, pair.bom);
    const rawCoordPath = path.join(projectPath, pair.coordinate); // 좌표 파일 추가
    const cleanedPath = path.join(projectPath, pair.cleaned);
    
    // 파일 존재 여부 확인
    try {
      await fs.access(rawBOMPath);
      await fs.access(rawCoordPath); // 좌표 파일도 확인
      await fs.access(cleanedPath);
    } catch (e) {
      // console.warn(`파일 없음 (건너뜀): ${pair.boardName}`);
      return null;
    }
    
    // 원본 BOM 텍스트화
    const rawBOMText = await fileToText(rawBOMPath);
    // 원본 좌표 텍스트화
    const rawCoordText = await fileToText(rawCoordPath);
    
    if (!rawBOMText || !rawCoordText) return null;

    // 정리된 BOM 텍스트화 (정답)
    const cleanedText = await fileToText(cleanedPath);
    
    if (!cleanedText) return null;
    
    // ChatGPT 학습 형식으로 변환
    const trainingExample = {
      messages: [
        {
          role: 'system',
          content: `당신은 PCB BOM 데이터 정리 전문가입니다. CAD에서 내려온 원본 BOM 파일과 좌표 파일을 분석하여 회사 표준 양식으로 정리합니다.

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
6. 품명에서 불필요한 공백/특수문자 제거
7. 좌표 파일에서 Ref를 매칭하여 위치 정보 활용 가능`
        },
        {
          role: 'user',
          content: `다음 BOM과 좌표 파일을 표준 양식으로 정리해주세요:

[BOM]
${rawBOMText}

[COORDINATE]
${rawCoordText}`
        },
        {
          role: 'assistant',
          content: cleanedText
        }
      ]
    };
    
    return trainingExample;
    
  } catch (error) {
    console.error(`오류 (${pair.boardName}):`, error.message);
    return null;
  }
}

/**
 * 메인 실행
 */
async function main() {
  console.log('🤖 학습 데이터 생성 시작 (xlsx 라이브러리 사용)...\n');
  
  // 1. 학습 쌍 로드
  const pairs = JSON.parse(await fs.readFile(TRAINING_PAIRS_FILE, 'utf-8'));
  console.log(`총 ${pairs.length}쌍 발견\n`);
  
  // 2. 전체 데이터 처리
  console.log('전체 데이터 처리 중...\n');
  const trainingExamples = [];
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pairs.length; i++) {
    process.stdout.write(`진행: ${i + 1}/${pairs.length}\r`);
    const example = await createTrainingPair(pairs[i]);
    if (example) {
      trainingExamples.push(example);
      successCount++;
    } else {
      failCount++;
    }
  }
  
  console.log(`\n✅ ${trainingExamples.length}개 생성 완료 (성공: ${successCount}, 실패: ${failCount})\n`);
  
  // 3. JSONL 형식으로 저장 (ChatGPT 파인튜닝 형식)
  const jsonlContent = trainingExamples.map(ex => JSON.stringify(ex)).join('\n');
  await fs.writeFile(OUTPUT_FILE, jsonlContent, 'utf-8');
  
  console.log(`✅ 저장: ${OUTPUT_FILE}`);
  console.log(`파일 크기: ${(jsonlContent.length / 1024).toFixed(2)} KB`);
  
  console.log('\n✨ 완료! 이제 ChatGPT 파인튜닝 가능합니다.');
}

main().catch(console.error);
