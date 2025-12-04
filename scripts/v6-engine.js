/**
 * V6 Engine - BOM/좌표 데이터 추출 학습 엔진
 * 
 * 주요 개선사항 (V5 대비):
 * 1. TP 필터링 자동 적용
 * 2. 숫자만 있는 RefDes 필터링
 * 3. 성공한 보드만 학습
 * 4. Round 중복 증가 버그 수정
 * 5. 로그 형식 개선
 */

import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { config } from 'dotenv';

// 환경변수 로드
const envPath = path.resolve(process.cwd(), '.env.local');
config({ path: envPath });
if (!process.env.OPENAI_API_KEY && !process.env.VITE_OPENAI_API_KEY) {
  config({ path: path.resolve(process.cwd(), '.env') });
}

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌ 오류: API Key가 없습니다.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

// ===== 설정 =====
const BASE_PATH = path.resolve(process.cwd(), 'sample-data/24_25_SOCKET');
const DATASET_FILE = path.resolve(process.cwd(), 'scripts/v6_dataset.jsonl');
const LAST_MODEL_FILE = path.resolve(process.cwd(), 'scripts/v6_last_model.txt');
const PROGRESS_FILE = path.resolve(process.cwd(), 'scripts/v6_progress.json');

const INITIAL_MODEL = 'gpt-4o-mini-2024-07-18';  // 추출용 모델
const VERIFIER_MODEL = 'gpt-4o';                  // 검증용 모델
const BATCH_SIZE = 5;

// ===== 유틸리티 함수 =====
const normalize = (s) => String(s || '').trim().toUpperCase().replace(/[\s\-_]/g, '');

// TP로 시작하는 Reference 필터링
const isTPRef = (ref) => {
  const upper = String(ref || '').toUpperCase().trim();
  return upper.startsWith('TP') || upper.match(/^TP[\d_]/);
};

// 숫자만 있는 RefDes 필터링
const isNumericOnly = (ref) => /^\d+$/.test(String(ref || '').trim());

/**
 * 파일을 텍스트로 변환
 */
async function fileToText(filePath, checkOnly = false) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    // 텍스트 파일 처리
    if (['.txt', '.csv', '.cpl', '.pnp', '.bom'].includes(ext)) {
      const content = await fs.readFile(filePath, 'utf-8');
      if (checkOnly) return content.substring(0, 1000);
      return content;
    }
    
    // 엑셀 파일 처리
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (checkOnly) return workbook.SheetNames.join(' ');

    const rows = [];
    for (const sheetName of workbook.SheetNames) {
      rows.push(`[SHEET: ${sheetName}]`);
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
      
      let emptyRowCount = 0;
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const cells = [];
        let hasValue = false;
        
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = sheet[XLSX.utils.encode_cell({c: C, r: R})];
          if (cell && cell.v !== undefined) {
            const val = String(cell.v).trim();
            cells.push(val);
            if (val.length > 0) hasValue = true;
          } else {
            cells.push('');
          }
        }
        
        if (hasValue) {
          emptyRowCount = 0;
          rows.push(cells.join('\t'));
        } else {
          emptyRowCount++;
          if (emptyRowCount >= 5) break;
        }
      }
      rows.push('\n');
    }
    return rows.join('\n');
  } catch (e) { 
    return ''; 
  }
}

/**
 * 디렉토리에서 파일 분류
 * - BOM: 파일명에 'bom', 'part' 포함
 * - 좌표: 파일명에 '좌표' 포함
 * - 정리본: 파일명에 (숫자) 패턴
 */
async function classifyFiles(dirPath) {
  const files = (await fs.readdir(dirPath)).map(f => f.normalize('NFC'));
  const candidates = files.filter(f => 
    !f.startsWith('.') && !f.startsWith('~$') && 
    (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.txt') || 
     f.toLowerCase().endsWith('.bom') || f.toLowerCase().endsWith('.csv'))
  );

  let bomFiles = [];
  let coordFiles = [];
  let answerFile = null;

  for (const f of candidates) {
    const lower = f.toLowerCase();
    
    // 정리본(정답지) 식별: 파일명에 (숫자) 패턴
    if (lower.match(/\(\d+\)/)) {
      answerFile = f;
    } 
    // BOM 파일: 'bom', 'part' 포함
    else if (lower.includes('bom') || lower.includes('part')) {
      bomFiles.push(f);
    } 
    // 좌표 파일: '좌표' 포함
    else if (lower.includes('좌표')) {
      coordFiles.push(f);
    }
  }

  // 정답지가 없으면 내용 기반으로 탐색
  if (!answerFile) {
    for (const f of candidates) {
      if (f.endsWith('.txt') || f.toLowerCase().endsWith('.bom')) continue;
      const content = await fileToText(path.join(dirPath, f), false);
      if ((content.includes('품명') || content.includes('Part')) && 
          (content.includes('Ref') || content.includes('Reference')) && 
          (content.includes('SET') || content.includes('Qty'))) {
        answerFile = f;
        break;
      }
    }
  }

  // 중복 제거
  bomFiles = bomFiles.filter(f => f !== answerFile);
  coordFiles = coordFiles.filter(f => f !== answerFile);

  // BOM 파일이 없으면 내용 기반 탐색
  let finalBom = bomFiles.length > 0 ? bomFiles[0] : null;
  if (!finalBom) {
    for (const f of candidates) {
      if (f === answerFile || coordFiles.includes(f)) continue;
      const content = await fileToText(path.join(dirPath, f), false);
      if (content.includes('Footprint') || content.includes('Designator') || 
          content.includes('Comment') || content.includes('규격')) {
        finalBom = f;
        break;
      }
    }
  }

  // 좌표 파일이 없으면 내용 기반 탐색
  let finalCoord = coordFiles.length > 0 ? coordFiles[0] : null;
  if (!finalCoord) {
    for (const f of candidates) {
      if (f === answerFile || f === finalBom) continue;
      const content = await fileToText(path.join(dirPath, f), false);
      if (content.includes('RefDes') || content.includes('Location') || 
          content.includes('Rotation')) {
        finalCoord = f;
        break;
      }
    }
  }

  // 필수 파일 체크
  if (!finalBom || !finalCoord || !answerFile) {
    const missing = [];
    if (!finalBom) missing.push('BOM');
    if (!finalCoord) missing.push('좌표');
    if (!answerFile) missing.push('정리본');
    return { warning: `필수 파일 누락: ${missing.join(', ')}` };
  }

  return {
    bom: path.join(dirPath, finalBom),
    coord: path.join(dirPath, finalCoord),
    answer: path.join(dirPath, answerFile)
  };
}

/**
 * GPT-4o 호출 (검증용)
 */
async function callGPT4o(prompt) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await openai.chat.completions.create({
        model: VERIFIER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1
      });
      return JSON.parse(res.choices[0].message.content);
    } catch (e) { 
      await new Promise(r => setTimeout(r, 2000)); 
    }
  }
  return {};
}

/**
 * 학습 모델로 BOM 데이터 추출
 */
async function extractBOM(modelId, bomText) {
  const prompt = `
BOM 파일에서 부품 데이터를 추출하세요.

### 규칙
1. 'PCB Footprint' 또는 'Partnumber' 또는 제목없는 첫번째 칼럼 → itemName (품명)
2. 'Reference' 또는 'Designator' → refs (Ref 목록)
3. 'Quantity' 또는 'Qty' → qty (SET)
4. **중요**: TP로 시작하는 Reference는 제외 (예: TP1, TP_VD, TP_DOVOD)

### 입력 BOM
${bomText.substring(0, 15000)}

### 출력 형식 (JSON)
{
  "items": [
    { "itemName": "R1005", "qty": "5", "refs": ["R1","R2","R3","R4","R5"] }
  ]
}
`;

  try {
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });
    const result = JSON.parse(res.choices[0].message.content);
    
    // TP 필터링 적용
    if (result.items) {
      result.items = result.items.map(item => ({
        ...item,
        refs: (item.refs || []).filter(ref => !isTPRef(ref))
      })).filter(item => item.refs.length > 0);
      
      // qty 재계산
      result.items = result.items.map(item => ({
        ...item,
        qty: String(item.refs.length)
      }));
    }
    
    return result.items || [];
  } catch (e) { 
    return []; 
  }
}

/**
 * 학습 모델로 좌표 데이터 추출
 */
async function extractCoords(modelId, coordText) {
  const prompt = `
좌표 파일에서 부품 위치 데이터를 추출하세요.

### 규칙
1. RefDes → 부품 참조 번호
2. Layer → Top 또는 Bottom
3. LocationX, LocationY → X, Y 좌표
4. Rotation → 회전 각도
5. **중요**: RefDes가 순수 숫자만인 항목 제외 (예: 1, 2, 3)

### 입력 좌표
${coordText.substring(0, 15000)}

### 출력 형식 (JSON)
{
  "R1": { "x": "10.5", "y": "20.3", "rot": "90", "layer": "Top" },
  "C1": { "x": "15.0", "y": "25.0", "rot": "0", "layer": "Bottom" }
}
`;

  try {
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });
    const result = JSON.parse(res.choices[0].message.content);
    
    // 숫자만 있는 RefDes 필터링 & TP 필터링
    const filtered = {};
    for (const [ref, coord] of Object.entries(result)) {
      if (!isNumericOnly(ref) && !isTPRef(ref)) {
        filtered[ref] = coord;
      }
    }
    
    return filtered;
  } catch (e) { 
    return {}; 
  }
}

/**
 * GPT-4o로 정답지에서 BOM 데이터 추출
 */
async function getTrueBOM(answerText) {
  const prompt = `
정답지(수동정리본)에서 BOM 데이터를 추출하세요.

### 대상 위치
- 첫 번째 시트 또는 보드명 시트
- TOP, BOTTOM 시트는 좌표용이므로 제외

### 추출 칼럼
- 종류 (ItemType): 맨 앞 칼럼, 제목 없을 수 있음, 위에서 상속
- 품명 (itemName)
- SET (qty): 수량
- Ref: 참조 번호 목록

### 주의
- TP로 시작하는 Ref 제외
- 테이블 테두리 밖 데이터 무시
- 종류가 빈칸이면 위 행에서 상속

### 입력
${answerText.substring(0, 20000)}

### 출력 형식 (JSON)
{
  "items": [
    { "itemName": "R1005", "itemType": "C/C(1005)", "qty": "5", "refs": ["R1","R2","R3","R4","R5"] }
  ],
  "typeOrder": ["IC(SMD)", "DIODE(SMD)", "C/C(1005)", "커넥터"]
}
`;
  return await callGPT4o(prompt);
}

/**
 * GPT-4o로 정답지에서 좌표 데이터 추출
 */
async function getTrueCoords(answerText) {
  const prompt = `
정답지(수동정리본)에서 좌표 데이터를 추출하세요.

### 대상 위치
- TOP 시트: Top Layer 부품
- BOTTOM 시트: Bottom Layer 부품

### 추출 칼럼
- RefDes: 부품 참조 번호
- Layer: Top 또는 Bottom
- LocationX, LocationY: X, Y 좌표
- Rotation: 회전 각도

### 주의
- 순수 숫자만인 RefDes 제외 (1, 2, 3 등)
- TP로 시작하는 RefDes 제외
- 종류 칼럼은 맨 앞, 비고 칼럼은 맨 뒤 (제목 없음)

### 입력
${answerText.substring(0, 30000)}

### 출력 형식 (JSON)
{
  "R1": { "x": "10.5", "y": "20.3", "rot": "90", "layer": "Top" },
  "C1": { "x": "15.0", "y": "25.0", "rot": "0", "layer": "Bottom" }
}
`;
  return await callGPT4o(prompt);
}

/**
 * 결과 비교
 */
function compare(studentBOM, studentCoords, trueBOM, trueCoords, round) {
  const stats = {
    SET: { match: 0, total: 0, errors: [] },
    품명: { match: 0, total: 0, errors: [] },
    Ref: { match: 0, total: 0, errors: [] },
    종류: { match: 0, total: 0, errors: [] },
    좌표: { match: 0, total: 0, errors: [] }
  };

  const trueItems = trueBOM.items || [];
  const trueBOMMap = new Map(trueItems.map(i => [normalize(i.itemName), i]));
  
  // === BOM 비교 ===
  
  // SET 총합 비교
  const studentTotalQty = studentBOM.reduce((sum, item) => sum + parseInt(item.qty || 0), 0);
  const trueTotalQty = trueItems.reduce((sum, item) => sum + parseInt(item.qty || 0), 0);
  stats.SET.total = 1;
  if (studentTotalQty === trueTotalQty) {
    stats.SET.match = 1;
  } else {
    stats.SET.errors.push(`총합 불일치: AI(${studentTotalQty}) vs 정답(${trueTotalQty})`);
  }

  // 품명 비교
  const studentNames = new Set(studentBOM.map(i => normalize(i.itemName)));
  const trueNames = new Set(trueItems.map(i => normalize(i.itemName)));
  stats.품명.total = trueNames.size;
  
  for (const name of trueNames) {
    if (studentNames.has(name)) {
      stats.품명.match++;
    } else {
      const original = trueItems.find(i => normalize(i.itemName) === name);
      stats.품명.errors.push(original?.itemName || name);
    }
  }

  // Ref 비교
  const studentRefs = new Set();
  studentBOM.forEach(item => (item.refs || []).forEach(ref => studentRefs.add(normalize(ref))));
  
  const trueRefs = new Set();
  trueItems.forEach(item => (item.refs || []).forEach(ref => trueRefs.add(normalize(ref))));
  
  stats.Ref.total = trueRefs.size;
  for (const ref of trueRefs) {
    if (studentRefs.has(ref)) {
      stats.Ref.match++;
    } else {
      stats.Ref.errors.push(ref);
    }
  }

  // 종류 비교 (Round 2부터)
  if (round >= 2) {
    stats.종류.total = trueItems.length;
    for (const sItem of studentBOM) {
      const key = normalize(sItem.itemName);
      const truth = trueBOMMap.get(key);
      if (truth) {
        if (normalize(sItem.itemType) === normalize(truth.itemType)) {
          stats.종류.match++;
        } else {
          stats.종류.errors.push(`${sItem.itemName}: AI(${sItem.itemType || '없음'}) vs 정답(${truth.itemType})`);
        }
      }
    }
  }

  // === 좌표 비교 ===
  const trueCoordKeys = Object.keys(trueCoords).filter(k => !isTPRef(k) && !isNumericOnly(k));
  stats.좌표.total = trueCoordKeys.length;
  
  for (const ref of trueCoordKeys) {
    const normRef = normalize(ref);
    const studentCoord = Object.entries(studentCoords).find(([k]) => normalize(k) === normRef)?.[1];
    const trueCoord = trueCoords[ref];
    
    if (studentCoord) {
      // X, Y, Rotation, Layer 비교
      const xMatch = Math.abs(parseFloat(studentCoord.x || 0) - parseFloat(trueCoord.x || 0)) < 0.1;
      const yMatch = Math.abs(parseFloat(studentCoord.y || 0) - parseFloat(trueCoord.y || 0)) < 0.1;
      const rotMatch = String(studentCoord.rot || '0') === String(trueCoord.rot || '0');
      
      if (xMatch && yMatch && rotMatch) {
        stats.좌표.match++;
      } else {
        stats.좌표.errors.push(`${ref}: 좌표/회전 불일치`);
      }
    } else {
      stats.좌표.errors.push(`${ref}: 누락`);
    }
  }

  return stats;
}

/**
 * 학습 데이터 저장 (성공한 보드만)
 */
async function saveTrainingData(bomText, coordText, trueBOM, trueCoords) {
  const bomCompletion = JSON.stringify({ items: trueBOM.items, typeOrder: trueBOM.typeOrder });
  const coordCompletion = JSON.stringify(trueCoords);
  
  const bomLine = JSON.stringify({
    messages: [
      { role: 'system', content: 'BOM 파일에서 품명, SET, Ref를 추출하고 종류를 분류합니다. TP로 시작하는 Ref는 제외합니다.' },
      { role: 'user', content: bomText.substring(0, 15000) },
      { role: 'assistant', content: bomCompletion }
    ]
  });
  
  const coordLine = JSON.stringify({
    messages: [
      { role: 'system', content: '좌표 파일에서 RefDes, Layer, X, Y, Rotation을 추출합니다. 숫자만 있는 RefDes와 TP는 제외합니다.' },
      { role: 'user', content: coordText.substring(0, 15000) },
      { role: 'assistant', content: coordCompletion }
    ]
  });
  
  await fs.appendFile(DATASET_FILE, bomLine + '\n' + coordLine + '\n');
}

/**
 * 로그 출력
 */
function printLog(boardName, stats, round) {
  const parts = [];
  
  // SET
  const setRate = stats.SET.total > 0 ? Math.round((stats.SET.match / stats.SET.total) * 100) : 0;
  parts.push(setRate === 100 ? `✅ SET:일치` : `❌ SET:불일치`);
  
  // 품명
  const nameRate = stats.품명.total > 0 ? Math.round((stats.품명.match / stats.품명.total) * 100) : 0;
  parts.push(nameRate === 100 ? `✅ 품명:일치` : `❌ 품명:${stats.품명.errors.length}건 누락`);
  
  // Ref
  const refRate = stats.Ref.total > 0 ? Math.round((stats.Ref.match / stats.Ref.total) * 100) : 0;
  parts.push(refRate === 100 ? `✅ Ref:일치` : `❌ Ref:${stats.Ref.errors.length}건 누락`);
  
  // 종류 (Round 2부터)
  if (round >= 2) {
    const typeRate = stats.종류.total > 0 ? Math.round((stats.종류.match / stats.종류.total) * 100) : 0;
    parts.push(typeRate === 100 ? `✅ 종류:일치` : `❌ 종류:${stats.종류.errors.length}건 불일치`);
  } else {
    parts.push(`⏸️ 종류:학습전`);
  }
  
  // 좌표
  const coordRate = stats.좌표.total > 0 ? Math.round((stats.좌표.match / stats.좌표.total) * 100) : 0;
  parts.push(coordRate === 100 ? `✅ 좌표:일치` : `❌ 좌표:${stats.좌표.errors.length}건 불일치`);
  
  // 전체 성공 여부
  const isSuccess = stats.SET.errors.length === 0 && 
                    stats.품명.errors.length === 0 && 
                    stats.Ref.errors.length === 0 &&
                    stats.좌표.errors.length === 0 &&
                    (round < 2 || stats.종류.errors.length === 0);
  
  const icon = isSuccess ? '✅' : '❌';
  console.log(`   ${icon} ${boardName}`);
  console.log(`      ${parts.join(' ')}`);
  
  return isSuccess;
}

/**
 * 보드 처리
 */
async function processBoard(boardInfo, round, currentModel) {
  try {
    const bomText = await fileToText(boardInfo.bom);
    const coordText = await fileToText(boardInfo.coord);
    const answerText = await fileToText(boardInfo.answer);

    // 병렬 처리: 학생 모델 추출 & 정답 추출
    const [studentBOM, studentCoords, trueBOM, trueCoords] = await Promise.all([
      extractBOM(currentModel, bomText),
      extractCoords(currentModel, coordText),
      getTrueBOM(answerText),
      getTrueCoords(answerText)
    ]);

    // 비교
    const stats = compare(studentBOM, studentCoords, trueBOM, trueCoords, round);
    
    // 로그 출력
    const isSuccess = printLog(boardInfo.name, stats, round);

    return { 
      success: isSuccess, 
      stats, 
      name: boardInfo.name,
      bomText,
      coordText,
      trueBOM,
      trueCoords
    };
  } catch (e) {
    console.log(`   ❌ ${boardInfo.name}: 오류 발생 - ${e.message}`);
    return { success: false, name: boardInfo.name, error: e.message };
  }
}

/**
 * Fine-tuning 실행
 */
async function runFineTuning(currentModel) {
  console.log('\n🧠 Fine-tuning 시작...');
  
  try {
    // 데이터셋 파일 체크
    await fs.access(DATASET_FILE);
    
    const { createReadStream } = await import('fs');
    const file = await openai.files.create({ 
      file: createReadStream(DATASET_FILE), 
      purpose: 'fine-tune' 
    });
    
    const job = await openai.fineTuning.jobs.create({ 
      training_file: file.id, 
      model: currentModel, 
      hyperparameters: { n_epochs: 3 } 
    });
    
    console.log(`   ⏳ 학습 대기 중 (Job: ${job.id})...`);
    
    while (true) {
      const status = await openai.fineTuning.jobs.retrieve(job.id);
      
      if (status.status === 'succeeded') {
        const newModel = status.fine_tuned_model;
        await fs.writeFile(LAST_MODEL_FILE, newModel);
        console.log(`   ✨ 새 모델: ${newModel}`);
        return newModel;
      }
      
      if (status.status === 'failed') {
        console.log('   ⚠️ 학습 실패, 기존 모델 유지');
        return currentModel;
      }
      
      // 30초 대기
      await new Promise(r => setTimeout(r, 30000));
    }
  } catch (e) {
    console.log(`   ⚠️ Fine-tuning 오류: ${e.message}`);
    return currentModel;
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log('🚀 V6 Engine - BOM/좌표 학습 모드');
  console.log('=========================================\n');

  // 진행 상황 로드
  let progress = { round: 1, completedBoards: [], successBoards: [] };
  try {
    progress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf-8'));
    console.log(`📂 이전 진행: Round ${progress.round}, 완료 ${progress.completedBoards.length}개, 성공 ${progress.successBoards?.length || 0}개\n`);
  } catch {}

  // 현재 모델 로드
  let currentModel = INITIAL_MODEL;
  try {
    currentModel = (await fs.readFile(LAST_MODEL_FILE, 'utf-8')).trim();
  } catch {}

  let round = progress.round;

  // 메인 루프
  while (true) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🔄 Round ${round} 시작`);
    console.log(`   모델: ${currentModel}`);
    console.log(`${'='.repeat(50)}`);

    // 새 라운드 시작 시 데이터셋 초기화
    if (progress.completedBoards.length === 0) {
      try { await fs.unlink(DATASET_FILE); } catch {}
      progress.successBoards = [];
    }

    // 보드 목록 수집
    const boards = [];
    try {
      const years = await fs.readdir(BASE_PATH);
      for (const year of years) {
        if (year.startsWith('.')) continue;
        const yearPath = path.join(BASE_PATH, year);
        const stat = await fs.stat(yearPath);
        if (!stat.isDirectory()) continue;

        const boardDirs = await fs.readdir(yearPath);
        for (const board of boardDirs) {
          if (progress.completedBoards.includes(board)) continue;
          
          const boardPath = path.join(yearPath, board);
          const boardStat = await fs.stat(boardPath);
          if (!boardStat.isDirectory()) continue;

          const files = await classifyFiles(boardPath);
          if (files.warning) {
            // console.log(`   ⚠️ ${board}: ${files.warning}`);
          } else {
            boards.push({ name: board, ...files });
          }
        }
      }
    } catch (e) {
      console.error('보드 목록 수집 오류:', e);
    }

    console.log(`\n📌 처리할 보드: ${boards.length}개\n`);

    if (boards.length === 0) {
      // 모든 보드 처리 완료
      const successCount = progress.successBoards?.length || 0;
      const totalCount = progress.completedBoards.length;
      
      if (successCount === totalCount && totalCount > 0) {
        console.log('\n🏆 축하합니다! 모든 보드 100% 일치 달성!');
        break;
      }
      
      // 실패한 보드가 있으면 다음 라운드
      console.log(`\n📊 Round ${round} 완료: 성공 ${successCount}/${totalCount}`);
      
      if (round >= 2 && successCount < totalCount) {
        // Fine-tuning 후 다음 라운드
        currentModel = await runFineTuning(currentModel);
      }
      
      // 다음 라운드 준비
      round++;
      progress.round = round;
      progress.completedBoards = [];
      progress.successBoards = [];
      await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      continue;
    }

    // 배치 처리
    let roundSuccess = 0;
    let roundFail = 0;

    for (let i = 0; i < boards.length; i += BATCH_SIZE) {
      const batch = boards.slice(i, i + BATCH_SIZE);
      console.log(`\n⚡ Batch [${i + 1}~${i + batch.length}/${boards.length}]`);

      const results = await Promise.all(
        batch.map(board => processBoard(board, round, currentModel))
      );

      for (const result of results) {
        progress.completedBoards.push(result.name);
        
        if (result.success) {
          roundSuccess++;
          progress.successBoards.push(result.name);
          
          // 성공한 보드만 학습 데이터 저장
          if (result.trueBOM?.items?.length > 0) {
            await saveTrainingData(
              result.bomText, 
              result.coordText, 
              result.trueBOM, 
              result.trueCoords
            );
          }
        } else {
          roundFail++;
        }
      }

      // 진행 상황 저장
      await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      
      // API 제한 방지
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n📊 현재 진행: 성공 ${roundSuccess}, 실패 ${roundFail}`);
  }

  console.log('\n✅ V6 Engine 학습 완료');
}

// 실행
main().catch(console.error);

