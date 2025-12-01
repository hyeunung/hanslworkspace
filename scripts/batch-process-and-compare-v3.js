import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';

// 환경 변수 로드
import { config } from 'dotenv';
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

// [초기화] 순정 모델 (백지 상태에서 시작)
const MODEL_ID = 'ft:gpt-4o-mini-2024-07-18:personal::ChkzWg6l'; 

const openai = new OpenAI({ apiKey });

const SETS_FILE = path.resolve(process.cwd(), 'scripts/training-pairs.json'); // 기존 파일 대체 (백업본 사용)
const REPORT_FILE = path.resolve(process.cwd(), 'scripts/error-report.json');
const RETRAINING_FILE = path.resolve(process.cwd(), 'scripts/retraining-dataset.jsonl');
const HISTORY_FILE = path.resolve(process.cwd(), 'scripts/success-history.json');
const BASE_PATH = path.resolve(process.cwd(), 'sample-data/24_25_SOCKET');

// ------------------------------------------------------------------
// 1. 데이터 처리 유틸리티 (정답지 읽기 - 헤더 제거 강화)
// ------------------------------------------------------------------

async function fileToText(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.csv') {
      return await fs.readFile(filePath, 'utf-8');
    }
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cells = [];
      for (let C = range.s.c; C <= Math.min(range.e.c, 10); ++C) {
        const cell = sheet[XLSX.utils.encode_cell({c: C, r: R})];
        cells.push(cell && cell.v !== undefined ? String(cell.v).trim() : '');
      }
      if (cells.some(c => c !== '')) rows.push(cells.join('\t'));
    }
    return rows.join('\n');
  } catch (e) {
    return '';
  }
}

// 정답 엑셀 읽기 (V3: 헤더/찌꺼기 제거 강화 + 좌표 정보 읽기 [TOP/BOTTOM 탭 지원])
async function excelToJson(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // 1. 좌표 데이터 수집 (TOP/BOTTOM 탭)
    const coordMap = new Map();
    
    for (const sheetName of workbook.SheetNames) {
        const upperName = sheetName.toUpperCase();
        if (upperName.includes('TOP') || upperName.includes('BOTTOM')) {
            const sheet = workbook.Sheets[sheetName];
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
            
            // 헤더 찾기 (Ref, X, Y, Rot)
            // 보통 1번째 줄이나 2번째 줄에 있음.
            // 헤더가 없으면 0:Ref, 1:X, 2:Y, 3:Rot 라고 가정해볼 수도 있지만, 위험함.
            // 일단 텍스트로 변환해서 패턴 매칭
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            
            let headerRowIdx = -1;
            let colIdx = { ref: -1, x: -1, y: -1, rot: -1 };
            
            for (let i = 0; i < Math.min(json.length, 10); i++) {
                const row = json[i].map(c => String(c).toUpperCase());
                const refIdx = row.findIndex(c => c.includes('REF') || c.includes('DESIGNATOR'));
                const xIdx = row.findIndex(c => c === 'X' || c === 'MID X' || c === 'X-AXIS');
                const yIdx = row.findIndex(c => c === 'Y' || c === 'MID Y' || c === 'Y-AXIS');
                const rotIdx = row.findIndex(c => c.includes('ROT'));
                
                if (refIdx !== -1 && xIdx !== -1) {
                    headerRowIdx = i;
                    colIdx = { ref: refIdx, x: xIdx, y: yIdx, rot: rotIdx };
                    break;
                }
            }
            
            if (headerRowIdx !== -1) {
                const side = upperName.includes('TOP') ? 'Top' : 'Bottom';
                for (let i = headerRowIdx + 1; i < json.length; i++) {
                    const row = json[i];
                    const ref = String(row[colIdx.ref] || '').trim();
                    if (!ref) continue;
                    
                    coordMap.set(ref, {
                        ref,
                        x: row[colIdx.x],
                        y: row[colIdx.y],
                        rot: colIdx.rot !== -1 ? row[colIdx.rot] : '0',
                        side
                    });
                }
            }
        }
    }

    // 2. BOM 데이터 파싱 (첫 번째 시트 사용)
    // 단, TOP/BOTTOM 시트가 첫 번째일 수도 있으므로, 이름 확인 필요
    let bomSheetName = workbook.SheetNames[0];
    for (const name of workbook.SheetNames) {
        if (name.toUpperCase().includes('BOM') || name.toUpperCase().includes('LIST')) {
            bomSheetName = name;
            break;
        }
    }
    // 만약 첫 번째 시트가 TOP/BOTTOM 이라면, BOM 시트를 찾아야 함. 
    // 보통 BOM이 맨 앞에 있거나 이름이 명확함. 
    // 여기서는 첫 번째 시트가 TOP/BOTTOM이 아니면 그냥 첫 번째 씀.
    if (bomSheetName.toUpperCase().includes('TOP') || bomSheetName.toUpperCase().includes('BOTTOM')) {
        // 다른 시트 찾기
        const candidate = workbook.SheetNames.find(n => !n.toUpperCase().includes('TOP') && !n.toUpperCase().includes('BOTTOM'));
        if (candidate) bomSheetName = candidate;
    }

    const sheet = workbook.Sheets[bomSheetName];
    const items = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    
    // 헤더 행 찾기
    let startRow = 0;
    for (let R = range.s.r; R <= Math.min(range.e.r, 20); ++R) {
        const cell = sheet[XLSX.utils.encode_cell({c: 0, r: R})];
        if (cell && (String(cell.v).includes('번호') || String(cell.v).includes('No'))) {
            startRow = R + 1;
            break;
        }
    }

    for (let R = startRow; R <= range.e.r; ++R) {
      const getVal = (c) => {
          const cell = sheet[XLSX.utils.encode_cell({c, r: R})];
          return cell ? String(cell.v).trim() : '';
      };

      const item = {
        lineNumber: getVal(0),
        itemType: getVal(1),
        itemName: getVal(2),
        setCount: getVal(3),
        totalQuantity: getVal(4),
        refList: getVal(7),
        remark: getVal(9),
        coordinates: [] 
      };
      
      // [V3 핵심] 찌꺼기 데이터 필터링 (테이블 밖 노이즈 제거)
      // 1. 필수 컬럼(품명, 종류)이 비어있으면 무시
      if (!item.itemName || !item.itemType) continue;

      // 2. 헤더 텍스트 필터링
      if (!item.lineNumber || item.lineNumber === 'No' || item.lineNumber === '번호') continue;
      if (item.itemType === '종류' || item.itemType === 'Item') continue;
      if (item.itemName === '품명' || item.itemName === 'Part') continue;

      // 3. [신규] 이상한 주석 필터링 (테이블 밖 텍스트)
      const noiseKeywords = ['담당자', '작성일', 'Rev', 'Note', '비고', 'Total', '합계', 'Page'];
      if (noiseKeywords.some(kw => item.itemName.includes(kw) || item.itemType.includes(kw))) {
          continue;
      }
      
      // 4. [신규] 너무 긴 텍스트 필터링 (보통 주석임)
      if (item.itemName.length > 50 || item.itemType.length > 50) {
          continue;
      }
      
      // 5. 좌표 데이터 매핑 (RefList 파싱 후 매칭)
      if (item.refList) {
          const refs = item.refList.split(/[, ]+/).map(r => r.trim()).filter(r => r);
          const coords = [];
          for (const ref of refs) {
              if (ref.includes('~') || ref.includes('-')) continue; // 범위 무시
              if (coordMap.has(ref)) {
                  coords.push(coordMap.get(ref));
              }
          }
          if (coords.length > 0) {
              item.coordinates = coords;
          }
      }

      items.push(item);
    }
    return items;
  } catch (e) {
    return [];
  }
}

async function findAnswerFile(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (!file.match(/\.(xlsx|xls)$/i)) continue;
      if (file.includes('AI_Generated')) continue;
      const filePath = path.join(dirPath, file);
      const content = await fileToText(filePath);
      if (content.includes('Artwork 담당자') || content.includes('부품리스트')) return filePath;
    }
  } catch (e) {}
  return null;
}

// ------------------------------------------------------------------
// 1.5. 좌표 파일 파싱 및 정답 데이터 병합 (Ground Truth 생성)
// ------------------------------------------------------------------

function parseCoordinateFile(content) {
    const map = new Map();
    const lines = content.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // 헤더 건너뛰기 (RefDesignator, Part No 등이 포함된 경우)
        if (trimmed.match(/^(Ref|Part|Designator)/i)) continue;

        // 공백 또는 탭으로 분리 (따옴표 제거)
        // 예: "R1" 10.5 20.0 90 "Top"
        // 정규식으로 유연하게 파싱
        // 1. Ref (따옴표 허용)
        // 2. X, Y, Rot (숫자)
        // 3. Side (Top/Bottom, 따옴표 허용)
        const match = trimmed.match(/"?([a-zA-Z0-9_\-]+)"?\s+([0-9\.\-]+)\s+([0-9\.\-]+)\s+([0-9\.\-]+)\s+"?(TOP|BOTTOM|T|B)"?/i);
        
        if (match) {
            const ref = match[1];
            const x = match[2];
            const y = match[3];
            const rot = match[4];
            const side = match[5].toUpperCase();
            
            map.set(ref, {
                ref, x, y, rot, 
                side: (side === 'T' || side === 'TOP') ? 'Top' : 'Bottom'
            });
        } else {
            // CSV 형식일 수도 있음 (쉼표 분리)
            const parts = trimmed.split(',').map(s => s.trim().replace(/"/g, ''));
            if (parts.length >= 5) {
                 // 보통 CSV는 순서가 다를 수 있으니 주의. 
                 // 일반적인 Pick Place 파일: Ref, MidX, MidY, Rot, Side
                 const ref = parts[0];
                 const x = parts[1];
                 const y = parts[2];
                 const rot = parts[3];
                 const side = parts[4];
                 if (!isNaN(parseFloat(x)) && !isNaN(parseFloat(y))) {
                     map.set(ref, {
                         ref, x, y, rot,
                         side: (side.toUpperCase().startsWith('T')) ? 'Top' : 'Bottom'
                     });
                 }
            }
        }
    }
    return map;
}

function injectCoordinatesIntoAnswer(answerItems, coordMap) {
    let matchedCount = 0;
    for (const item of answerItems) {
        if (!item.refList) continue;
        
        // Ref 리스트 파싱 (쉼표, 공백, ~ 범위 처리 필요할 수 있음)
        // 일단 쉼표와 공백 기준으로 분리
        const refs = item.refList.split(/[, ]+/).map(r => r.trim()).filter(r => r);
        
        const coords = [];
        for (const ref of refs) {
            // 범위 처리 (예: R1~R3)
            if (ref.includes('~') || ref.includes('-')) {
                // 범위 처리는 복잡하므로 일단 패스하거나 단순 구현
                // 여기서는 스킵 (정확성을 위해 개별 나열 권장)
                continue; 
            }
            
            if (coordMap.has(ref)) {
                coords.push(coordMap.get(ref));
                matchedCount++;
            }
        }
        
        if (coords.length > 0) {
            item.coordinates = coords;
        }
    }
    // console.log(`   (Ground Truth 좌표 매핑: ${matchedCount}개 Refs)`);
}

// ------------------------------------------------------------------
// 2. AI 요청 (TSV 확장형)
// ------------------------------------------------------------------

const PROMPT_GUIDE = `
Analyze the provided BOM and Coordinate data and generate a structured TSV output.

### MAPPING RULES (Follow this STRICTLY!)
1. **ItemName**: Must come from **'PCB Footprint'** column in BOM.
2. **ItemType**: Infer based on Ref/Part info (e.g. 'IC(SMD)', '저항(1005)').
3. **SetCount**: Must come from **'Quantity'** column in BOM.
4. **RefList**: Must come from **'Reference'** column in BOM.
5. **Coordinates**: Extract X, Y, Rotation, Side (Top/Bottom) for EACH Reference.

### OUTPUT FORMAT
Respond ONLY with the data rows (no header, no markdown). Columns are separated by TAB.
Format: LineNumber | ItemType | ItemName | SetCount | TotalQuantity | Stock | Check | RefList | Alternative | Remark | Coordinate_JSON_String

**Important**: The last column (Coordinate_JSON_String) must be a valid JSON array string containing coordinate info for each Ref.
Example: [{"ref":"U1","x":"10.5","y":"20.1","rot":"90","side":"Top"}]

### Example Output (Tab Separated)
1\tIC(SMD)\tSN65DP141RLJR\t1\t6\t\t□양호\tU1\t\t\t[{"ref":"U1","x":"10.5","y":"20.1","rot":"90","side":"Top"}]
2\t저항(1005)\tR1005\t2\t12\t\t□양호\tR1, R2\t\t\t[{"ref":"R1","x":"5.0","y":"10.0","rot":"0","side":"Top"},{"ref":"R2","x":"5.5","y":"10.0","rot":"0","side":"Top"}]
`;

async function requestAI(bomText, coordText) {
  const prompt = `${PROMPT_GUIDE}

### INPUT DATA
**BOM Content**:
${bomText.substring(0, 15000)}

**Coordinate Content**:
${coordText.substring(0, 15000)}
`;

  const response = await openai.chat.completions.create({
    model: MODEL_ID,
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs structured TSV data with embedded JSON for coordinates.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  });

  const content = response.choices[0].message.content;
  const lines = content.split('\n');
  const bomItems = [];
  
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 3) continue; // 최소한의 컬럼 확인

    let coordinates = [];
    try {
        // 마지막 컬럼(인덱스 10)에 있는 JSON 문자열 파싱
        const coordStr = cols[10]?.trim();
        if (coordStr && (coordStr.startsWith('[') || coordStr.startsWith('{'))) {
            coordinates = JSON.parse(coordStr);
        }
    } catch (e) {
        // 좌표 파싱 실패해도 BOM 정보는 살림
        console.warn(`[Warning] Coordinate Parse Error at Line ${cols[0]}: ${e.message}`);
    }

    bomItems.push({
      lineNumber: cols[0]?.trim(),
      itemType: cols[1]?.trim(),
      itemName: cols[2]?.trim(),
      setCount: cols[3]?.trim(),
      totalQuantity: cols[4]?.trim(),
      refList: cols[7]?.trim(),
      remark: cols[9]?.trim(),
      coordinates: coordinates
    });
  }
  return { bomItems };
}

async function appendToRetraining(bomText, coordText, answerItems) {
  // 정답 데이터를 TSV 포맷으로 변환 (마지막 컬럼에 좌표 JSON 추가)
  const tsvOutput = answerItems.map(item => {
      const coordJson = JSON.stringify(item.coordinates || []);
      return [
          item.lineNumber, item.itemType, item.itemName, item.setCount, 
          item.totalQuantity, '', '□양호', item.refList, '', item.remark, coordJson
      ].join('\t');
  }).join('\n');

  const prompt = `${PROMPT_GUIDE}

### INPUT DATA
**BOM Content**:
${bomText.substring(0, 15000)}

**Coordinate Content**:
${coordText.substring(0, 15000)}
`;

  const data = {
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs structured TSV data with embedded JSON for coordinates.' },
      { role: 'user', content: prompt },
      { role: 'assistant', content: tsvOutput }
    ]
  };
  await fs.appendFile(RETRAINING_FILE, JSON.stringify(data) + '\n');
}

// ------------------------------------------------------------------
// 3. V3 비교 로직 (스마트 매칭 + 유연한 기준)
// ------------------------------------------------------------------

// 정규화: 대소문자/공백/특수문자/슬래시 무시
const normalize = (str) => {
    if (!str) return '';
    return String(str).toUpperCase()
        .replace(/\s/g, '')
        .replace(/_NEW/g, '')
        .replace(/\\/g, '')
        .replace(/"/g, '')
        .replace(/'/g, '')
        .replace(/_OPEN/g, '')
        .replace(/\/\//g, '/'); // // -> / 변환
};

// [수정] 비교 키 생성 시 ItemType 제외 -> ItemName(품명)만으로 1차 식별
// 이유: 품명이 같으면 같은 부품으로 보고, 그 안에서 종류/수량/Ref가 맞는지 디테일하게 따지기 위함.
const makeKey = (item) => normalize(item.itemName);

function compareResults(aiItems, answerItems) {
    const answerMap = new Map();
    const diffs = [];

    // 정답지 매핑 (Key: 품명)
    for (const item of answerItems) {
        const key = makeKey(item);
        if (!answerMap.has(key)) answerMap.set(key, []);
        answerMap.get(key).push(item);
    }

    // AI 결과 확인
    for (const aiItem of aiItems) {
        const key = makeKey(aiItem);
        
        if (answerMap.has(key)) {
            const candidates = answerMap.get(key);
            
            // 1. 종류(ItemType) 비교
            // 품명은 같은데 종류를 다르게 적었는지 확인 (틀려도 계속 진행)
            const typeMatchIdx = candidates.findIndex(cand => normalize(cand.itemType) === normalize(aiItem.itemType));
            
            let candidate;
            if (typeMatchIdx === -1) {
                // 종류가 일치하는 게 없으면, 품명이 같은 첫 번째 후보를 가져와서 비교 대상으로 삼음
                candidate = candidates[0];
                const correctTypes = [...new Set(candidates.map(c => c.itemType))].join(', ');
                diffs.push(`[종류 불일치] ${aiItem.itemName}: AI='${aiItem.itemType}' vs 정답='${correctTypes}'`);
            } else {
                candidate = candidates[typeMatchIdx];
            }

            // 2. 수량(SetCount) 비교
            const aiSetCount = parseInt(aiItem.setCount) || 0;
            const candSetCount = parseInt(candidate.setCount) || 0;

            if (Math.abs(candSetCount - aiSetCount) >= 1) {
                diffs.push(`[수량 불일치] ${aiItem.itemName} (${aiItem.itemType}): AI=${aiSetCount} vs 정답=${candSetCount}`);
            }

            // 3. RefList 비교
            const aiRefs = (aiItem.refList || '').split(',').map(r => r.trim()).sort().join(',');
            const candRefs = (candidate.refList || '').split(',').map(r => r.trim()).sort().join(',');

            if (aiRefs !== candRefs) {
                diffs.push(`[Ref 불일치] ${aiItem.itemName} (${aiItem.itemType}): AI=[${aiRefs}] vs 정답=[${candRefs}]`);
            }

            // 4. [신규] 좌표(Coordinate) 비교
            // AI가 반환한 coordinates 배열과 정답지의 coordinates를 비교해야 함.
            if (aiItem.coordinates && candidate.coordinates && candidate.coordinates.length > 0) {
                aiItem.coordinates.forEach(aiCoord => {
                    const candCoord = candidate.coordinates.find(c => c.ref === aiCoord.ref);
                    if (candCoord) {
                        // 좌표 값 유효성 검사 (정답지 값이 숫자가 아니거나 이상한 경우)
                        const candX = parseFloat(candCoord.x);
                        const candY = parseFloat(candCoord.y);
                        
                        if (isNaN(candX) || isNaN(candY)) {
                             diffs.push(`[정답지 데이터 오류(수동확인)] ${aiCoord.ref}: 정답지의 좌표 값('${candCoord.x}', '${candCoord.y}')이 숫자가 아닙니다.`);
                             return;
                        }

                        const isXMatch = Math.abs(parseFloat(aiCoord.x) - candX) < 0.05;
                        const isYMatch = Math.abs(parseFloat(aiCoord.y) - candY) < 0.05;
                        
                        // Rotation 비교 (360도 정규화)
                        const aiRot = parseFloat(aiCoord.rot || '0');
                        const candRot = parseFloat(candCoord.rot || '0');
                        const normAiRot = (aiRot % 360 + 360) % 360;
                        const normCandRot = (candRot % 360 + 360) % 360;
                        const isRotMatch = Math.abs(normAiRot - normCandRot) < 1.0;

                        // Side 비교 (대소문자 및 약어 처리)
                        const normalizeSide = (s) => {
                            const str = String(s || '').toUpperCase();
                            return (str === 'T' || str === 'TOP') ? 'TOP' : 
                                   (str === 'B' || str === 'BOTTOM') ? 'BOTTOM' : str;
                        };
                        const isSideMatch = normalizeSide(aiCoord.side) === normalizeSide(candCoord.side);

                        if (!isXMatch || !isYMatch || !isRotMatch || !isSideMatch) {
                            diffs.push(`[좌표 불일치] ${aiCoord.ref}: AI(${aiCoord.x},${aiCoord.y},${aiCoord.rot},${aiCoord.side}) vs 정답(${candCoord.x},${candCoord.y},${candCoord.rot},${candCoord.side})`);
                        }
                    } else {
                        // 정답지에는 해당 Ref의 좌표 정보가 없는 경우
                        diffs.push(`[정답지 누락(수동확인)] ${aiCoord.ref}: 정답지에 해당 Ref의 좌표 정보가 없습니다. (AI는 추출함)`);
                    }
                });
            } else if (aiItem.coordinates?.length > 0) {
                 // 정답지 전체에 좌표가 없는데 AI는 좌표를 가져온 경우
                 // diffs.push(`[정답지 전체 누락(수동확인)] ${aiItem.itemName}: 정답지에 좌표 데이터가 아예 없습니다.`);
                 // -> 현재 정답지 파싱 로직이 미구현 상태이므로, 이 로그는 너무 많이 뜰 것임. 일단 주석 처리하거나 경고 레벨을 낮춤.
            }

            // 매칭된 정답 항목 제거 (중복 매칭 방지)
            // 종류가 맞았으면 그 인덱스를 제거하고, 종류가 틀렸으면 그냥 첫 번째 후보를 제거 (일단 품명 기준으로 하나 깠다고 침)
            if (typeMatchIdx !== -1) {
                candidates.splice(typeMatchIdx, 1);
            } else {
                candidates.splice(0, 1);
            }
            if (candidates.length === 0) answerMap.delete(key);

        } else {
            // 아예 품명 자체가 없는 경우 (진짜 유령)
            diffs.push(`[AI 유령 항목] ${aiItem.itemName} (품명 불일치)`);
        }
    }

    // 남은 정답 (AI가 아예 못 가져온 품명)
    for (const [key, items] of answerMap) {
        for (const item of items) {
            diffs.push(`[AI 누락 항목] ${item.itemName} (${item.itemType})`);
        }
    }

    return { isMatch: diffs.length === 0, diffs };
}

// ------------------------------------------------------------------
// 4. 메인 실행
// ------------------------------------------------------------------

async function main() {
  console.log(`🚀 V3 검증 시작 (Model: ${MODEL_ID})`);
  
  // [강력 초기화]
  try { await fs.unlink(RETRAINING_FILE); } catch (e) {} 

  // [데이터 세트 동적 생성] (파일 의존성 제거)
  const sets = [];
  try {
      const years = await fs.readdir(BASE_PATH);
      for (const year of years) {
          if (year.startsWith('.')) continue;
          const yearPath = path.join(BASE_PATH, year);
          if (!(await fs.stat(yearPath)).isDirectory()) continue;

          const boards = await fs.readdir(yearPath);
          for (const board of boards) {
              if (board.startsWith('.')) continue;
              const boardPath = path.join(yearPath, board);
              if (!(await fs.stat(boardPath)).isDirectory()) continue;

              const files = await fs.readdir(boardPath);
              let bom = null, coord = null, cleaned = null;

              for (const file of files) {
                  if (file.startsWith('.')) continue;
                  const lower = file.toLowerCase();
                  if (lower.includes('part') || lower.includes('bom')) bom = file;
                  else if (lower.includes('좌표') || lower.includes('pick') || lower.endsWith('.txt')) coord = file;
                  else if ((lower.endsWith('.xlsx') || lower.endsWith('.xls')) && !file.includes('ai_generated')) cleaned = file;
              }

              // [수정] 중복 방지: 세트가 완성되면 더 이상 파일을 뒤지지 않고 다음 보드로 넘어감
              if (bom && coord && cleaned) {
                  sets.push({ year, boardName: board, bom, coordinate: coord, cleaned });
                  // break; // <--- 여기서 break를 하면 안 됨! (파일 루프는 끝났지만, 혹시 다른 로직 영향 있을 수 있음)
                  // 사실 for (const file of files) 루프 밖이니까 break 할 필요 없음.
                  // 그냥 push만 하면 됨. (어차피 board 단위로 도니까)
              }
          }
      }
  } catch (e) {
      console.error('❌ 데이터 세트 생성 실패:', e);
      process.exit(1);
  }
  
  console.log(`📊 총 ${sets.length}개 데이터 세트 로드 완료`);

  // 히스토리 로드
  let successHistory = [];
  try { successHistory = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf-8')); } catch(e) {}

  const report = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    process.stdout.write(`[${i + 1}/${sets.length}] ${set.boardName} ... `);

    try {
        const dirPath = path.join(BASE_PATH, set.year, set.boardName);
        const bomPath = path.join(dirPath, set.bom);
        const coordPath = path.join(dirPath, set.coordinate);
        let answerPath = path.join(dirPath, set.cleaned);

        // 파일 확인
        try { await fs.access(bomPath); await fs.access(coordPath); } 
        catch { console.log('❌ 파일 없음'); failCount++; continue; }

        // 정답 파일 찾기
        try { await fs.access(answerPath); } 
        catch { 
            answerPath = await findAnswerFile(dirPath);
            if (!answerPath) { console.log('⚠️ 정답 파일 없음'); continue; }
        }

        // 실행
        const bomText = await fileToText(bomPath);
        const coordText = await fileToText(coordPath);
        const answerItems = await excelToJson(answerPath); // 이제 여기서 좌표까지 다 긁어옴

        // [제거] 외부 좌표 파일 병합 로직 제거 (Excel 내부에 있으므로)
        // const coordMap = parseCoordinateFile(coordText);
        // injectCoordinatesIntoAnswer(answerItems, coordMap);

        const aiResult = await requestAI(bomText, coordText);

        // ★ V3 비교
        const { isMatch, diffs } = compareResults(aiResult.bomItems, answerItems);

        // ★ 학습 데이터 저장 (전체 복습)
        await appendToRetraining(bomText, coordText, answerItems);

        // ★ 퇴보 방지 (성공 이력 있으면 2배 저장)
        const isHistory = successHistory.includes(set.boardName);
        if (isHistory) await appendToRetraining(bomText, coordText, answerItems);

        if (isMatch) {
            console.log('✅ 일치');
            successCount++;
            if (!isHistory) {
                successHistory.push(set.boardName);
                await fs.writeFile(HISTORY_FILE, JSON.stringify(successHistory, null, 2));
            }
            report.push({ boardName: set.boardName, status: 'SUCCESS' });

            // [추가] 100% 일치 시 템플릿에 저장 (사용자 요구사항)
            // 일단 템플릿 파일이 존재하는지 확인
            // const TEMPLATE_PATH = path.resolve(process.cwd(), 'public/templates/BOM_Template.xlsx');
            // const outputPath = path.join(dirPath, `AI_Generated_${set.boardName}.xlsx`);
            // if (await fs.stat(TEMPLATE_PATH).catch(() => false)) {
            //     // 템플릿 복사 및 데이터 주입 로직 (추후 구현)
            //     // console.log('   └─ 템플릿 생성 저장 완료');
            // }

        } else {
            if (isHistory) console.log('❌ 불일치 (🚨 퇴보)');
            else console.log('❌ 불일치');
            
            // 상세 로그 출력
            if (diffs.length > 0) {
                diffs.forEach(d => console.log(`     └─ ${d}`));
            }

            failCount++;
            report.push({ boardName: set.boardName, status: 'FAIL', diffs });
        }

    } catch (e) {
        console.log(`⚠️ 에러: ${e.message}`);
        failCount++;
    }
  }

  // 저장
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  await fs.writeFile('./scripts/loop-status.json', JSON.stringify({
      success: successCount, fail: failCount, timestamp: new Date().toISOString()
  }, null, 2));

  console.log(`\n📊 완료: 성공 ${successCount} / 실패 ${failCount}`);
}

main();
