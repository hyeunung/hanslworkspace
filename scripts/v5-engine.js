import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';

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

const openai = new OpenAI({ apiKey });

const BASE_PATH = path.resolve(process.cwd(), 'sample-data/24_25_SOCKET');
const DATASET_FILE = path.resolve(process.cwd(), 'scripts/v5_dataset.jsonl');
const LAST_MODEL_FILE = path.resolve(process.cwd(), 'scripts/v5_last_model.txt');
const PROGRESS_FILE = path.resolve(process.cwd(), 'scripts/v5_progress.json');

const INITIAL_MODEL = 'gpt-4o-mini-2024-07-18'; 
const VERIFIER_MODEL = 'gpt-4o';
const BATCH_SIZE = 5;

async function fileToText(filePath, checkOnly = false) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.csv' || ext === '.cpl' || ext === '.pnp') {
      const content = await fs.readFile(filePath, 'utf-8');
      if (checkOnly) return content.substring(0, 1000);
      return content;
    }
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
  } catch (e) { return ''; }
}

async function classifyFiles(dirPath) {
    const files = (await fs.readdir(dirPath)).map(f => f.normalize('NFC'));
    const candidates = files.filter(f => !f.startsWith('.') && !f.startsWith('~$') && 
        (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.txt') || f.endsWith('.csv') || 
         f.toLowerCase().endsWith('.bom') || f.toLowerCase().endsWith('.cpl') || f.toLowerCase().endsWith('.pnp'))
    );
    
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    let bomFiles = [];
    let coordFiles = [];
    let answerFile = null;

    for (const f of candidates) {
        const lower = f.toLowerCase();
        if (lower.match(/\(\d+\)/) || lower.includes('완료') || lower.includes('정리')) {
            answerFile = f;
        } else if (lower.includes('bom') || lower.includes('part')) {
            bomFiles.push(f);
        } else if (lower.includes('좌표') || lower.includes('pick') || lower.includes('position') || lower.endsWith('.cpl') || lower.endsWith('.pnp')) {
            coordFiles.push(f);
        }
    }

    // 2. 정답지 검증 (시트 이름 검사 로직 삭제 -> 파일명만 믿음)
    /*
    if (answerFile) {
        const content = await fileToText(path.join(dirPath, answerFile), true);
        if (!content.includes('Main') && !content.includes('TOP')) answerFile = null;
    }
    */
    
    // 정답지가 없으면 다른 엑셀도 뒤져보기 (내용 기반)
    if (!answerFile) {
        for (const f of candidates) {
            if (f.endsWith('.txt') || f.endsWith('.csv') || f.toLowerCase().endsWith('.cpl') || f.toLowerCase().endsWith('.pnp') || f.toLowerCase().endsWith('.bom')) continue;
            // 내용을 읽어서 '품명', 'Ref', 'SET' 같은 단어가 있으면 정답지로 인정
            const content = await fileToText(path.join(dirPath, f), false); 
            if ((content.includes('품명') || content.includes('Part')) && (content.includes('Ref') || content.includes('Reference')) && (content.includes('SET') || content.includes('Qty'))) {
                answerFile = f;
                break;
            }
        }
    }

    let finalBom = null;
    let finalCoord = null;

    bomFiles = bomFiles.filter(f => f !== answerFile);
    coordFiles = coordFiles.filter(f => f !== answerFile);

    if (bomFiles.length > 0) finalBom = bomFiles[0];
    else {
        for (const f of candidates) {
            if (f === answerFile || coordFiles.includes(f)) continue;
            const content = await fileToText(path.join(dirPath, f), false);
            if (content.includes('Footprint') || content.includes('Comment') || content.includes('Designator') || content.includes('품명') || content.includes('규격')) {
                finalBom = f;
                break;
            }
        }
    }

    if (coordFiles.length > 0) finalCoord = coordFiles[0];
    else {
        for (const f of candidates) {
            if (f === answerFile || f === finalBom) continue;
            const content = await fileToText(path.join(dirPath, f), false);
            if (content.includes('RefDes') || content.includes('Location') || content.includes('Rotation')) {
                finalCoord = f;
                break;
            }
        }
    }

    if (!finalBom && pdfFiles.length > 0) {
        return { warning: `[Skip] BOM 없음 (PDF만 ${pdfFiles.length}개)` };
    }
    if (!finalBom || !finalCoord || !answerFile) {
        const reason = [];
        if (!finalBom) reason.push(`BOM 없음`);
        if (!finalCoord) reason.push(`좌표 없음`);
        if (!answerFile) reason.push(`정답지 없음`);
        // console.log(`❌ [Skip] ${path.basename(dirPath)}: ${reason.join(', ')}`);
        return { warning: `[Skip] 필수 파일 누락 (${reason.join(', ')})` };
    }

    return {
        bom: finalBom ? path.join(dirPath, finalBom) : null,
        coord: finalCoord ? path.join(dirPath, finalCoord) : null,
        answer: answerFile ? path.join(dirPath, answerFile) : null
    };
}

async function runStudentModel(modelId, bomText, coordText) {
    const bomPrompt = `
    Analyze the BOM file and extract structured data.
    ### RULES
    1. Group by **'PCB Footprint'** (ItemName).
    2. **Quantity**: Must match the total count of References.
    3. **RefList**: Extract all references (e.g. R1, R2...).
    4. **ItemType**: Infer the component type based on the Part Name. Same ItemName MUST have same ItemType.
    ### INPUT BOM
    ${bomText.substring(0, 15000)}
    ### OUTPUT FORMAT (JSON)
    { "items": [{ "itemName": "R1005", "itemType": "Resistor", "qty": "5", "refs": ["R1","R2"] }] }
    `;

    const coordPrompt = `
    Extract Coordinate Data from the Coordinate File.
    ### RULES
    1. Ignore 'Type' column. Key is **RefDes**.
    ### INPUT COORDS
    ${coordText.substring(0, 15000)}
    ### OUTPUT FORMAT (JSON)
    { "R1": { "x": "10.0", "y": "20.0", "rot": "90", "side": "Top" } }
    `;

    try {
        const [bomRes, coordRes] = await Promise.all([
            openai.chat.completions.create({ model: modelId, messages: [{ role: 'user', content: bomPrompt }], response_format: { type: "json_object" }, temperature: 0.1 }),
            openai.chat.completions.create({ model: modelId, messages: [{ role: 'user', content: coordPrompt }], response_format: { type: "json_object" }, temperature: 0.1 })
        ]);
        return { bom: JSON.parse(bomRes.choices[0].message.content).items || [], coords: JSON.parse(coordRes.choices[0].message.content) };
    } catch (e) { return { bom: [], coords: {} }; }
}

async function getTrueBOM(answerText) {
    const prompt = `
    Extract the **TRUE BOM LIST** from the Answer Sheet.
    
    ### TARGET TABLE LOCATION
    - The BOM table is usually in the **FIRST sheet** (or a sheet named after the Board).
    - It is **NOT** in the 'TOP' or 'BOTTOM' sheets (those are for coordinates).
    
    ### TARGET COLUMNS
    - Columns: No, Type, Part Name, **SET(Qty)**, Ref, Remark.
    - **CRITICAL**: Use **'SET'** column for Quantity. Do NOT use 'Total Qty' or '수량'.
    - **CRITICAL**: If 'Type' is empty, INHERIT from above.
    
    ### INPUT EXCEL
    ${answerText.substring(0, 15000)}
    
    ### OUTPUT (JSON)
    { "items": [{ "itemName": "R1005", "itemType": "Resistor", "qty": "5", "refs": "R1, R2...", "remark": "미삽" }] }
    `;
    return await callGPT4o(prompt);
}

async function getTrueCoords(answerText) {
    const prompt = `
    Extract the **TRUE COORDINATES** from the Answer Sheet.
    ### TARGET
    - **'TOP'** and **'BOTTOM'** sheets.
    - Extract X, Y, Rotation, Side for each Ref.
    ### INPUT EXCEL
    ${answerText.substring(0, 30000)}
    ### OUTPUT (JSON Map)
    { "R1": { "x": "10", "y": "20", "rot": "0", "side": "Top" } }
    `;
    return await callGPT4o(prompt);
}

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
        } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
    }
    return {};
}

function compare(studentBOM, studentCoords, trueBOM, trueCoords, round) {
    const diffs = [];
    const stats = {
        품명: { total: 0, fail: 0 },
        SET: { total: 0, fail: 0 },
        종류: { total: 0, fail: 0 },
        좌표X: { total: 0, fail: 0 },
        좌표Y: { total: 0, fail: 0 },
        회전: { total: 0, fail: 0 },
        면: { total: 0, fail: 0 }
    };
    const trueBOMMap = new Map(trueBOM.items?.map(i => [normalize(i.itemName), i]) || []);

    for (const sItem of studentBOM) {
        const key = normalize(sItem.itemName);
        const truth = trueBOMMap.get(key);

        // 품명 체크
        stats.품명.total++;
        if (!truth) {
            diffs.push(`[유령 항목] ${sItem.itemName}`);
            stats.품명.fail++;
            continue;
        }
        
        // 수량(SET) 체크
        stats.SET.total++;
        if (String(sItem.qty) !== String(truth.qty)) {
            diffs.push(`[수량 불일치] ${sItem.itemName}: AI(${sItem.qty}) vs 정답(${truth.qty})`);
            stats.SET.fail++;
        }
        
        // 종류 체크 (Round 2부터)
        if (round >= 2) {
            stats.종류.total++;
            if (normalize(sItem.itemType) !== normalize(truth.itemType)) {
                diffs.push(`[종류 불일치] ${sItem.itemName}: AI(${sItem.itemType}) vs 정답(${truth.itemType})`);
                stats.종류.fail++;
            }
        }
        
        const refs = sItem.refs || [];
        refs.forEach(ref => {
            const sCoord = studentCoords[ref];
            const tCoord = trueCoords[ref];
            if (!tCoord) return;
            if (!sCoord) {
                diffs.push(`[좌표 누락] ${ref}`);
                stats.좌표X.total++;
                stats.좌표Y.total++;
                stats.좌표X.fail++;
                stats.좌표Y.fail++;
                return;
            }
            
            // 좌표 X 비교
            stats.좌표X.total++;
            const xDiff = Math.abs(parseFloat(sCoord.x) - parseFloat(tCoord.x));
            if (xDiff > 0) {
                diffs.push(`[좌표 불일치] ${ref}: AI(${sCoord.x},${sCoord.y}) vs 정답(${tCoord.x},${tCoord.y})`);
                stats.좌표X.fail++;
            }
            
            // 좌표 Y 비교
            stats.좌표Y.total++;
            const yDiff = Math.abs(parseFloat(sCoord.y) - parseFloat(tCoord.y));
            if (yDiff > 0) {
                if (stats.좌표X.fail === 0 || !diffs.some(d => d.includes(ref) && d.includes('좌표 불일치'))) {
                    diffs.push(`[좌표 불일치] ${ref}: AI(${sCoord.x},${sCoord.y}) vs 정답(${tCoord.x},${tCoord.y})`);
                }
                stats.좌표Y.fail++;
            }
            
            // 회전(Rot) 비교
            if (tCoord.rot !== undefined) {
                stats.회전.total++;
                if (sCoord.rot === undefined || sCoord.rot === null) {
                    diffs.push(`[회전 누락] ${ref}`);
                    stats.회전.fail++;
                } else {
                    const sRot = String(sCoord.rot).trim();
                    const tRot = String(tCoord.rot).trim();
                    if (sRot !== tRot) {
                        diffs.push(`[회전 불일치] ${ref}: AI(${sCoord.rot}) vs 정답(${tCoord.rot})`);
                        stats.회전.fail++;
                    }
                }
            }
            
            // 면(Side) 비교
            if (tCoord.side !== undefined) {
                stats.면.total++;
                if (sCoord.side === undefined || sCoord.side === null) {
                    diffs.push(`[면 누락] ${ref}`);
                    stats.면.fail++;
                } else {
                    const sSide = String(sCoord.side).toUpperCase().trim();
                    const tSide = String(tCoord.side).toUpperCase().trim();
                    const sNormalized = sSide.includes('BOT') ? 'BOTTOM' : (sSide.includes('TOP') || sSide === 'T' ? 'TOP' : sSide);
                    const tNormalized = tSide.includes('BOT') ? 'BOTTOM' : (tSide.includes('TOP') || tSide === 'T' ? 'TOP' : tSide);
                    if (sNormalized !== tNormalized) {
                        diffs.push(`[면 불일치] ${ref}: AI(${sCoord.side}) vs 정답(${tCoord.side})`);
                        stats.면.fail++;
                    }
                }
            }
        });
    }
    return { diffs, stats };
}

async function saveTrainingData(bomText, coordText, trueBOM, trueCoords) {
    const bomCompletion = JSON.stringify({ items: trueBOM.items });
    const coordCompletion = JSON.stringify(trueCoords);
    const bomLine = JSON.stringify({ messages: [{ role: 'system', content: 'Extract structured BOM data.' }, { role: 'user', content: bomText.substring(0, 15000) }, { role: 'assistant', content: bomCompletion }] });
    const coordLine = JSON.stringify({ messages: [{ role: 'system', content: 'Extract Coordinate data.' }, { role: 'user', content: coordText.substring(0, 15000) }, { role: 'assistant', content: coordCompletion }] });
    await fs.appendFile(DATASET_FILE, bomLine + '\n' + coordLine + '\n');
}

const normalize = (s) => String(s || '').toUpperCase().replace(/[\s\-_]/g, '');

async function fillTemplate(templatePath, bomData, coordData, boardName, outputPath) {
    const buffer = await fs.readFile(templatePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const bomSheetName = workbook.SheetNames[0];
    const bomSheet = workbook.Sheets[bomSheetName];
    if (!bomSheet) throw new Error('템플릿에서 BOM 시트를 찾을 수 없습니다.');

    // 헤더 찾기
    const range = XLSX.utils.decode_range(bomSheet['!ref'] || 'A1:J1');
    let headerRow = -1;
    let dataStartRow = -1;

    for (let R = 0; R <= range.e.r; ++R) {
        const row = [];
        for (let C = 0; C <= range.e.c; ++C) {
            const cell = bomSheet[XLSX.utils.encode_cell({c: C, r: R})];
            if (cell && cell.v !== undefined) {
                row.push(String(cell.v).trim());
            }
        }
        if (row.some(v => v.includes('번호') || v.includes('No'))) {
            headerRow = R;
            dataStartRow = R + 1;
            break;
        }
    }

    if (headerRow === -1) throw new Error('템플릿에서 헤더 행을 찾을 수 없습니다.');

    // 기존 데이터 삭제
    const existingRange = XLSX.utils.decode_range(bomSheet['!ref'] || 'A1:J1');
    if (dataStartRow <= existingRange.e.r) {
        for (let R = dataStartRow; R <= existingRange.e.r; ++R) {
            for (let C = 0; C <= 9; ++C) {
                const cellAddr = XLSX.utils.encode_cell({c: C, r: R});
                delete bomSheet[cellAddr];
            }
        }
    }

    // BOM 데이터를 종류별로 그룹화
    const groupedByType = {};
    bomData.forEach(item => {
        const type = item.itemType || '기타';
        if (!groupedByType[type]) groupedByType[type] = [];
        groupedByType[type].push(item);
    });

    const sortedBOM = [];
    Object.keys(groupedByType).sort().forEach(type => {
        sortedBOM.push(...groupedByType[type]);
    });

    // BOM 데이터 채우기
    let currentRow = dataStartRow;
    sortedBOM.forEach((item, index) => {
        const refs = Array.isArray(item.refs) ? item.refs : (item.refs ? [item.refs] : []);
        const refString = refs.join(', ');

        XLSX.utils.sheet_add_aoa(bomSheet, [[
            index + 1, item.itemType || '', item.itemName || '', item.qty || '',
            '', '', '□양호', refString, '', ''
        ]], { origin: XLSX.utils.encode_cell({c: 0, r: currentRow}) });
        currentRow++;
    });

    bomSheet['!ref'] = XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: 9, r: currentRow - 1 }
    });

    // TOP/BOTTOM 시트 처리
    const refToTypeMap = {};
    bomData.forEach(item => {
        const refs = Array.isArray(item.refs) ? item.refs : (item.refs ? [item.refs] : []);
        refs.forEach(ref => { refToTypeMap[ref] = item.itemType || 'SMD'; });
    });

    ['TOP', 'BOTTOM'].forEach(sheetName => {
        let sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            sheet = XLSX.utils.aoa_to_sheet([['', 'Type', 'RefDes', 'Layer', 'LocationX', 'LocationY', 'Rotation', '']]);
            workbook.SheetNames.push(sheetName);
            workbook.Sheets[sheetName] = sheet;
        }

        const coords = [];
        Object.keys(coordData).forEach(ref => {
            const coord = coordData[ref];
            const side = String(coord.side || '').toUpperCase();
            const isTop = sheetName === 'TOP' && (side.includes('TOP') || side === 'T');
            const isBottom = sheetName === 'BOTTOM' && (side.includes('BOT') || side === 'B');
            if (isTop || isBottom) {
                coords.push({
                    ref, type: refToTypeMap[ref] || 'SMD',
                    x: coord.x || '', y: coord.y || '',
                    rot: coord.rot || coord.rotation || '0',
                    side: sheetName === 'TOP' ? 'Top' : 'Bottom'
                });
            }
        });

        const sheetRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1:H1');
        let dataStartRow = 2;
        for (let R = 0; R <= Math.min(5, sheetRange.e.r); ++R) {
            const cell = sheet[XLSX.utils.encode_cell({c: 1, r: R})];
            if (cell && String(cell.v || '').includes('Type')) {
                dataStartRow = R + 2;
                break;
            }
        }

        const existingRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1:H1');
        if (dataStartRow <= existingRange.e.r) {
            for (let R = dataStartRow; R <= existingRange.e.r; ++R) {
                for (let C = 1; C <= 7; ++C) {
                    delete sheet[XLSX.utils.encode_cell({c: C, r: R})];
                }
            }
        }

        coords.forEach((coord, idx) => {
            const row = dataStartRow + idx;
            XLSX.utils.sheet_add_aoa(sheet, [[
                coord.type || '', coord.ref || '', coord.side || '',
                coord.x || '', coord.y || '', coord.rot || '0', ''
            ]], { origin: XLSX.utils.encode_cell({c: 1, r: row}) });
        });

        if (coords.length > 0) {
            sheet['!ref'] = XLSX.utils.encode_range({
                s: { c: 0, r: 0 },
                e: { c: 7, r: dataStartRow + coords.length - 1 }
            });
        }
    });

    XLSX.writeFile(workbook, outputPath, { bookType: 'xlsx' });
}

async function processBoard(set, round, currentModel) {
    try {
        const bomText = await fileToText(set.bom);
        const coordText = await fileToText(set.coord);
        const answerText = await fileToText(set.answer);

        const [studentResult, trueBOM, trueCoords] = await Promise.all([
            runStudentModel(currentModel, bomText, coordText),
            getTrueBOM(answerText),
            getTrueCoords(answerText)
        ]);

        // 템플릿 파일에 데이터 채우기
        const templatePath = path.resolve(process.cwd(), 'public/templates/BOM_Template.xlsx');
        const outputDir = path.join(path.dirname(set.answer), 'generated');
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `${set.name}_generated.xlsx`);
        
        try {
            await fillTemplate(templatePath, studentResult.bom, studentResult.coords, set.name, outputPath);
            console.log(`   📄 생성된 파일: ${outputPath}`);
        } catch (e) {
            console.log(`   ⚠️ 템플릿 채우기 실패: ${e.message}`);
        }

        const { diffs, stats } = compare(studentResult.bom, studentResult.coords, trueBOM, trueCoords, round);
        
        if (trueBOM.items && trueBOM.items.length > 0) {
            await saveTrainingData(bomText, coordText, trueBOM, trueCoords);
        }

        return { success: diffs.length === 0, diffs, stats, name: set.name, round, generatedFile: outputPath };
    } catch (e) {
        return { success: false, diffs: [`Error: ${e.message}`], name: set.name };
    }
}

async function main() {
    console.log('🚀 V5 Auto-Loop Engine (Turbo Mode: Batch 5)');
    let round = 1;
    let currentModel = INITIAL_MODEL;
    
    let progress = { round: 1, completedBoards: [] };
    try { 
        progress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf-8')); 
        round = progress.round;
        console.log(`📂 이전 진행 상황 로드: Round ${round}, 완료된 보드 ${progress.completedBoards.length}개`);
    } catch {}

    try { currentModel = await fs.readFile(LAST_MODEL_FILE, 'utf-8'); } catch {}

    while (true) {
        console.log(`\n==================================================`);
        console.log(`🔄 [Round ${round}] 시작 (Model: ${currentModel})`);
        console.log(`==================================================`);

        if (progress.completedBoards.length === 0) {
            try { await fs.unlink(DATASET_FILE); } catch {}
        }

        const sets = [];
        try {
            const years = await fs.readdir(BASE_PATH);
            for (const year of years) {
                if (year.startsWith('.')) continue;
                const yearPath = path.join(BASE_PATH, year);
                if (!(await fs.stat(yearPath)).isDirectory()) continue;
                const boards = await fs.readdir(yearPath);
                for (const board of boards) {
                    if (progress.completedBoards.includes(board)) continue;

                    const boardPath = path.join(yearPath, board);
                    if (!(await fs.stat(boardPath)).isDirectory()) continue;
                    
                    const files = await classifyFiles(boardPath);
                    
                    if (files.warning) {
                        // console.log(`⚠️ [Warning] ${board}: ${files.warning}`);
                    } else if (files.bom && files.coord && files.answer) {
                        sets.push({ name: board, ...files });
                    }
                }
            }
        } catch (e) { console.log(e); }

        console.log(`📌 처리할 보드: 총 ${sets.length}개`);
        let failCount = 0;
        let results = [];

        for (let i = 0; i < sets.length; i += BATCH_SIZE) {
            const batch = sets.slice(i, i + BATCH_SIZE);
            console.log(`\n⚡ Batch Processing [${i+1}~${i+batch.length}/${sets.length}]`);
            
            const batchResults = await Promise.all(batch.map(set => processBoard(set, round, currentModel)));
            results.push(...batchResults);

            for (const res of batchResults) {
                const stats = res.stats || {};
                const parts = [];
                
                // 종류 (Round 2부터만 표시)
                if (res.round >= 2) {
                    const 종류Fail = stats.종류?.fail || 0;
                    parts.push(종류Fail === 0 ? `✅ 종류:일치` : `❌ 종류:불일치(${종류Fail}건)`);
                } else {
                    parts.push(`⏸️ 종류:학습전`);
                }
                
                // SET (수량)
                const setFail = stats.SET?.fail || 0;
                parts.push(setFail === 0 ? `✅ SET:일치` : `❌ SET:불일치(${setFail}건)`);
                
                // 품명
                const 품명Fail = stats.품명?.fail || 0;
                parts.push(품명Fail === 0 ? `✅ 품명:일치` : `❌ 품명:불일치(${품명Fail}건)`);
                
                // 좌표X
                const 좌표XFail = stats.좌표X?.fail || 0;
                parts.push(좌표XFail === 0 ? `✅ 좌표X:일치` : `❌ 좌표X:불일치(${좌표XFail}건)`);
                
                // 좌표Y
                const 좌표YFail = stats.좌표Y?.fail || 0;
                parts.push(좌표YFail === 0 ? `✅ 좌표Y:일치` : `❌ 좌표Y:불일치(${좌표YFail}건)`);
                
                // 회전
                const 회전Fail = stats.회전?.fail || 0;
                parts.push(회전Fail === 0 ? `✅ 회전:일치` : `❌ 회전:불일치(${회전Fail}건)`);
                
                // 면
                const 면Fail = stats.면?.fail || 0;
                parts.push(면Fail === 0 ? `✅ 면:일치` : `❌ 면:불일치(${면Fail}건)`);
                
                const icon = res.success ? '✅' : '❌';
                console.log(`   ${icon} [${res.name}] ${parts.join(' ')}`);
                
                if (!res.success) {
                    failCount++;
                }
                
                progress.completedBoards.push(res.name);
                await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress));
            }
            await new Promise(r => setTimeout(r, 2000)); 
        }

        console.log(`\n📊 Round ${round} 결과: 실패 ${failCount}건, 처리한 보드: ${results.length}개`);
        
        // 종료 조건 체크
        // Round 2 이상에서 실패 0건이고 모든 보드를 처리했으면 종료
        if (round >= 2 && failCount === 0 && sets.length === 0) {
            console.log('\n🏆 축하합니다! 모든 데이터 검증 성공! (100% 일치)');
            break;
        }
        
        // Round 1에서 실패 0건이고 모든 보드를 처리했으면 Round 2로 진행
        if (round === 1 && failCount === 0 && sets.length === 0) {
            console.log('\n✅ Round 1 완료! Round 2로 진행 (종류 검증 추가)...');
        }
        
        // 아직 처리할 보드가 남아있거나 실패가 있으면 다음 라운드로 진행
        if (sets.length > 0) {
            console.log(`\n⚠️ 아직 처리할 보드가 ${sets.length}개 남아있습니다. 다음 라운드로 진행...`);
        } else if (failCount > 0) {
            console.log(`\n⚠️ Round ${round} 완료, 실패 ${failCount}건 → 다음 라운드로 진행 (재학습)...`);
        }

        progress.round++;
        progress.completedBoards = [];
        await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress));

        // 데이터셋 파일 존재 여부 확인
        let datasetExists = false;
        try {
            await fs.access(DATASET_FILE);
            datasetExists = true;
        } catch {}

        // 학습 진행 조건:
        // 1. Round 1에서 데이터셋이 있으면 반드시 학습 (품명 → 종류 매핑 학습을 위해, 실패 0건이어도 학습)
        // 2. Round 2 이상에서 실패가 있고 데이터셋이 있으면 재학습
        const shouldTrain = (round === 1 && datasetExists) || (round >= 2 && failCount > 0 && datasetExists);

        if (shouldTrain) {
            console.log('\n🧠 학습 요청 중...');
            if (round === 1) {
                console.log('   (Round 1: 정답지의 품명 → 종류 매핑 학습)');
            }
            try {
                const { createReadStream } = await import('fs');
                const file = await openai.files.create({ file: createReadStream(DATASET_FILE), purpose: 'fine-tune' });
                const job = await openai.fineTuning.jobs.create({ training_file: file.id, model: currentModel, hyperparameters: { n_epochs: 3 } });
                
                console.log(`⏳ 학습 대기 중 (Job: ${job.id})...`);
                while(true) {
                    const status = await openai.fineTuning.jobs.retrieve(job.id);
                    if (status.status === 'succeeded') {
                        currentModel = status.fine_tuned_model;
                        await fs.writeFile(LAST_MODEL_FILE, currentModel);
                        console.log(`✨ New Model: ${currentModel}`);
                        break;
                    }
                    if (status.status === 'failed') {
                        console.log('⚠️ 학습 실패, 기본 모델로 계속 진행...');
                        break;
                    }
                    await new Promise(r => setTimeout(r, 30000));
                }
            } catch(e) { 
                console.log('⚠️ 학습 실패:', e.message, '→ 기본 모델로 계속 진행...'); 
            }
        } else if (round === 1 && !datasetExists) {
            // Round 1에서 데이터셋이 없으면 (거의 일어나지 않음)
            console.log('\n⚠️ Round 1 완료했지만 데이터셋 파일이 없습니다. 학습 없이 Round 2로 진행...');
        } else if (round >= 2 && failCount > 0 && !datasetExists) {
            console.log('⚠️ 실패가 있지만 데이터셋 파일이 없어 학습을 건너뜁니다.');
        } else if (round >= 2 && failCount === 0) {
            console.log('\n✅ Round 2 이상 완료 (실패 0건) → 학습 없이 다음 라운드로 진행...');
        }

        round++;
    }
}

main();