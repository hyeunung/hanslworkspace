/**
 * BOM 좌표 자동 정리 엔진 v7
 * 
 * 목적: BOM, 좌표 원본 파일 → 정리본 파일 자동 생성
 * 학습: GPT-4o를 사용하여 종류, 품명, 미삽항목, 정렬순서 학습
 */

import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env.local 파일 로드 (프로젝트 루트 기준)
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// ============================================================
// 설정
// ============================================================
const CONFIG = {
  sampleDataPath: path.join(__dirname, '../sample-data/24_25_SOCKET'),
  learningDataPath: path.join(__dirname, 'v7_학습데이터'),
  analysisResultPath: path.join(__dirname, 'v7_분석결과'),
  
  // OpenAI 모델 (mini 사용 금지!)
  openaiModel: 'gpt-4o',
  
  // 기본 미삽 키워드
  defaultMisapKeywords: ['OPEN', 'NC', 'POGO', 'PAD'],
  
  // TP 제외 패턴
  tpPattern: /^TP/i,
  
  // 숫자만 RefDes 패턴
  numericOnlyPattern: /^\d+$/,
  
  // 최대 라운드
  maxRounds: 10,
};

// ============================================================
// OpenAI 클라이언트
// ============================================================
let openai = null;

function initOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    console.error('   export OPENAI_API_KEY="your-api-key"');
    process.exit(1);
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('✅ OpenAI 클라이언트 초기화 완료 (모델: ' + CONFIG.openaiModel + ')');
}

// ============================================================
// 학습 데이터 저장소
// ============================================================
const LearningData = {
  // 품명 → 종류 매핑
  typeMapping: {},
  
  // 종류 정렬 순서
  typeSortOrder: [],
  
  // 원본 품명 → 정리본 품명 매핑 (PCB Footprint 메인)
  partNameMapping: {},
  
  // Footprint 충돌 목록 (같은 footprint인데 다른 품명)
  partNameConflicts: {},
  
  // 품명 변환 규칙 (유사도 기반 매칭용)
  partNameTransformRules: [],
  
  // 정답지에 있는 모든 품명 목록 (유사도 매칭용)
  knownPartNames: [],
  
  // 미삽 키워드 목록
  misapKeywords: [...CONFIG.defaultMisapKeywords],
  
  // 수동 작성 필요 조합 (10V/16V/50V 충돌로 자동 판단 불가)
  // 정규화된 Part|Footprint 조합
  manualInputRequired: [
    '1u/1005|C1UF_1005',      // 10V 59개 vs 16V 44개
    '10u/1005|C10UF_1005',    // 10V 91개 vs 16V 1개
    '1u/1608|C1UF_1608',      // 10V 40개 vs 16V 22개
    '0.01u/1005|C0.01UF_1005', // 10V 33개 vs 16V 15개
    '0.1u/1005|C0.1UF_1005',  // 10V 8개 vs 16V 14개
    '10uf/1608|C10UF_1608',   // 10V 7개 vs 16V 8개
    '10pf/1005|C10PF_1005',   // 10V 7개 vs 16V 1개
    '10nf/1005|C10NF_1005',   // 10V 7개 vs 16V 1개
    '220pf/1005|C220PF_1005', // 10V vs 50V 충돌
    // 추가 10V/16V/50V 충돌
    '47u/2012|C47UF_16V_2012',   // 10V vs 16V
    '2.2u/1005|C2.2UF_16V_1005', // 10V vs 16V
    '0.001u/1005|C0.001UF_1005', // 10V vs 50V
    '4.7u/1005|C4.7UF_1005',     // 10V 표기 변형
    // 저항 동률 충돌 (1:1)
    '|R1K_1005_0.1%',            // R1KB_1005 vs R1K_1005_0.1%
  ],
  
  // 학습 완료 여부
  learningComplete: false,
  
  load() {
    const files = {
      typeMapping: '종류_매핑.json',
      typeSortOrder: '종류_정렬순서.json',
      partNameMapping: '품명_매핑.json',
      partNameConflicts: '품명_충돌목록.json',
      partNameTransformRules: '품명_변환규칙.json',
      knownPartNames: '정답지_품명목록.json',
      misapKeywords: '미삽항목.json',
    };
    
    for (const [key, filename] of Object.entries(files)) {
      const filePath = path.join(CONFIG.learningDataPath, filename);
      if (fs.existsSync(filePath)) {
        try {
          this[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
          // 파일 손상시 무시
        }
      }
    }
    
    // 학습 데이터가 있으면 학습 완료로 표시
    if (Object.keys(this.typeMapping).length > 0) {
      this.learningComplete = true;
    }
    
    // 고정 매핑 적용 (다수결로 결정된 항목들 - 덮어씀)
    this.applyFixedMappings();
  },
  
  // 다수결로 고정된 매핑 (매번 적용)
  applyFixedMappings() {
    const fixedMappings = {
      // 커넥터 (HF vs HFA 다수결)
      'FI-RE41S-HF': 'FI-RE41S-HF-R1500',
      'FI-RE51S-HF': 'FI-RE51S-HF-R1500',
      // IC 다수결
      '24LC256ISN': '24LC256-I/SN',
      'TLP3107': 'TLP3107',
      'AD5175BRMZ-10-RL7': 'AD5175BRMZ-10-RL7',
      'AD5175BCPZ-10-RL7': 'AD5175BCPZ-10-RL7',
      // 정규화: _ vs / 통일
      'ADS7828E_250': 'ADS7828E/250',
      // OPEN 표기 (원본 BOM에 OPEN 있으면 그대로 유지)
      'TPD2EUSB30DRTR_OPEN': 'TPD2EUSB30DRTR_OPEN',
      'TPD2EUSB30DRTR': 'TPD2EUSB30DRTR',
      'C10PF_50V_1005_OPEN': 'C10pF/50V_1005_OPEN',
      'C10PF_1005_OPEN': 'C10PF/10V_1005_OPEN',
      'R0_1005_OPEN': 'R0_1005_OPEN',
      'C0.1UF_16V_1005_OPEN': 'C0.1uF/16V_1005_OPEN',
      'W25Q16JVSSIQ_OPEN': 'W25Q16JVSSIQ_OPEN',
      // OPEN (_1903은 부가정보로 생략 가능)
      'R1K_1005_OPEN_1903': 'R1K_1005_OPEN',
      'R10K_1005_OPEN_1903': 'R10K_1005_OPEN',
      'R10K_1005_OPEN': 'R10K_1005_OPEN',
      // 저항 _1% 표기 추가 (정답지는 전부 _1% 붙음)
      'R4.7K_1005': 'R4.7K_1005_1%',
      'R10_1005': 'R10_1005_1%',
      'R15_1005': 'R15_1005_1%',
      // _NEW 제거 (49건)
      'MAX3373EEKA+T_NEW': 'MAX3373EEKA+T',
      // 기타 다수결
      'C0.1UF_16V_1005': 'C0.1uF/16V_1005',
      'T47UF_16V-B': 'T47uF/16V "B"',
      'SN65DP141RLJR_R-PWQFN-N38_RLJ': 'SN65DP141RLJR',
      'TSM6963SD_TSSOP-8': 'TSM6963SD',
      'SW-DJMM-12V': 'SW-DJMM-12V',
      'BOI_C70_CUBE_Z-CAL_POGO': 'BOI_C70_CUBE_Z-CAL_POGO',
      // B2B (Part 이름에서 유래)
      'MGL_G1_AA_MASTER_SENSOR_POGO': 'B2B',
      // Part에 /OPEN 있으면 _OPEN 붙여야 함
      'TPD2EUSB30DRTR/OPEN|TPD2EUSB30DRTR': 'TPD2EUSB30DRTR_OPEN',
    };
    
    // 고정 매핑 적용 (기존 학습 데이터보다 우선)
    this.partNameMapping = { ...this.partNameMapping, ...fixedMappings };
    
    // 고정된 footprint들은 충돌 목록에서 제거 (그래야 고정 매핑이 적용됨)
    const fixedFootprints = Object.keys(fixedMappings);
    for (const fp of fixedFootprints) {
      if (this.partNameConflicts && this.partNameConflicts[fp]) {
        delete this.partNameConflicts[fp];
      }
    }
  },
  
  save() {
    if (!fs.existsSync(CONFIG.learningDataPath)) {
      fs.mkdirSync(CONFIG.learningDataPath, { recursive: true });
    }
    
    const files = {
      typeMapping: '종류_매핑.json',
      typeSortOrder: '종류_정렬순서.json',
      partNameMapping: '품명_매핑.json',
      partNameTransformRules: '품명_변환규칙.json',
      knownPartNames: '정답지_품명목록.json',
      misapKeywords: '미삽항목.json',
    };
    
    for (const [key, filename] of Object.entries(files)) {
      const filePath = path.join(CONFIG.learningDataPath, filename);
      fs.writeFileSync(filePath, JSON.stringify(this[key], null, 2), 'utf-8');
    }
    
    // partNameConflicts는 Set을 포함하므로 별도 처리
    if (this.partNameConflicts && Object.keys(this.partNameConflicts).length > 0) {
      const conflictsForSave = {};
      for (const [key, val] of Object.entries(this.partNameConflicts)) {
        conflictsForSave[key] = val instanceof Set ? [...val] : val;
      }
      const conflictPath = path.join(CONFIG.learningDataPath, '품명_충돌목록.json');
      fs.writeFileSync(conflictPath, JSON.stringify(conflictsForSave, null, 2), 'utf-8');
    }
  },
};

// ============================================================
// 유틸리티 함수
// ============================================================
const Utils = {
  // 셀 값 추출
  getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    let val = cell.value;
    if (typeof val === 'object' && val.richText) {
      val = val.richText.map(rt => rt.text).join('');
    }
    if (typeof val === 'object' && val.result !== undefined) {
      val = val.result;
    }
    return String(val).trim();
  },
  
  // 소수점 정규화 (4.00 → 4, 0.400 → 0.4)
  normalizeNumber(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return String(num);
  },
  
  // 종류 정규화 (오타, 약어 통일)
  normalizeType(typeVal) {
    if (!typeVal) return '';
    let normalized = typeVal.trim();
    
    // 약어 → 정식 명칭
    const typeMapping = {
      'TP/DIP': 'TEST POINT/DIP',
      'TP/SMD': 'TEST POINT/SMD',
      'TP/dip': 'TEST POINT/DIP',
      'TP/smd': 'TEST POINT/SMD',
      'SENSOR': 'SENSOR(SMD)',
      'PEM NUT': 'PEMNUT',
      'BEAD(012)': 'BEAD(2012)',
      'TEST POINT': 'TEST POINT/SMD',  // 기본값 SMD
      // 오타 수정
      'CONNECTGOR': 'CONNECTOR',
      'CONNECTO4R': 'CONNECTOR',
      'CONNECTROR': 'CONNECTOR',
      'DIOODE(SMD)': 'DIODE(SMD)',
      // X-TAL 정규화
      'X-TAL': 'X-TAL(SMD)',
    };
    
    if (typeMapping[normalized]) {
      return typeMapping[normalized];
    }
    
    return normalized;
  },
  
  // 품명 정규화 (대소문자, 구분자 통일)
  // C1uF/10V_1005 = C1UF_10V_1005 = C1UF/10V_1005 → c1uf10v1005
  normalizePartName(partName) {
    if (!partName) return '';
    return partName
      .toLowerCase()           // 소문자 통일
      .replace(/[\/\-_\s]/g, '') // 구분자 제거 (/, -, _, 공백)
      .replace(/"/g, '')       // 따옴표 제거
      .trim();
  },
  
  // Part|Footprint 조합 정규화 (수동 작성 필요 조합 체크용)
  // 1uF/1005 = 1u/1005, C1UF_1005 = c1uf_1005
  normalizePartFootprintCombo(part, footprint) {
    let normPart = (part || '')
      .toLowerCase()
      .replace(/uf/g, 'u')
      .replace(/pf/g, 'p')
      .replace(/nf/g, 'n')
      .replace(/\s/g, '');
    // Part 앞의 c 접두사 제거 (c10u/1608 → 10u/1608)
    if (/^c\d/.test(normPart)) {
      normPart = normPart.substring(1);
    }
    const normFp = (footprint || '').toUpperCase();
    return `${normPart}|${normFp}`;
  },
  
  // 수동 작성 필요 조합인지 체크 (Footprint 기준)
  isManualInputRequired(part, footprint) {
    const fpUpper = (footprint || '').toUpperCase();
    
    // Footprint만으로 체크 (Part에 사이즈가 없는 경우 대응)
    return LearningData.manualInputRequired.some(m => {
      const [mPart, mFp] = m.split('|');
      // Footprint 일치하면 수동 작성
      if (mFp && fpUpper === mFp.toUpperCase()) {
        return true;
      }
      // 기존 방식도 유지 (Part|Footprint 조합)
      const combo = this.normalizePartFootprintCombo(part, footprint);
      const normM = this.normalizePartFootprintCombo(mPart, mFp);
      return combo === normM;
    });
  },
  
  // Ref 파싱 ("U1,U2,U3" 또는 "C49-C67" → ["U1", "U2", "U3"] 또는 ["C49", "C50", ..., "C67"])
  // 구분자: 콤마(,), 공백, 마침표(.) - 오타 대응
  parseRefs(refStr) {
    if (!refStr) return [];
    const refs = [];
    const parts = refStr.split(/[,.\s]+/).map(r => r.trim()).filter(r => r.length > 0);
    
    for (const part of parts) {
      // 구분선 필터링 (----, ____, ==== 등)
      if (/^[-_=]+$/.test(part)) continue;
      
      // 범위 패턴: C49-C67, R1-R10, U1-U5, D26~D30 등 (- 또는 ~ 사용)
      const rangeMatch = part.match(/^([A-Z]+)(\d+)[-~]([A-Z]*)(\d+)$/i);
      if (rangeMatch) {
        const prefix = rangeMatch[1];
        const start = parseInt(rangeMatch[2]);
        const end = parseInt(rangeMatch[4]);
        // 범위 확장
        for (let i = start; i <= end; i++) {
          refs.push(prefix + i);
        }
      } else {
        refs.push(part);
      }
    }
    
    return refs;
  },
  
  // TP 여부
  isTP(ref) {
    return CONFIG.tpPattern.test(ref);
  },
  
  // 숫자만인 RefDes 여부
  isNumericOnly(ref) {
    return CONFIG.numericOnlyPattern.test(ref);
  },
};

// ============================================================
// 파서: BOM 원본
// ============================================================
const BOMParser = {
  async parse(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      return this.parseExcel(filePath);
    } else if (ext === '.txt' || ext === '.bom') {
      return this.parseText(filePath);
    }
    return { items: [] };
  },
  
  async parseExcel(filePath) {
    // 먼저 xlsx 패키지로 시도 (구형 .xls 지원)
    try {
      const xlsxResult = this.parseWithXLSX(filePath);
      if (xlsxResult.items.length > 0) {
        return xlsxResult;
      }
    } catch (e) {
      // xlsx 실패시 ExcelJS로 시도
    }
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { items: [] };
    const items = [];
    
    // 헤더 찾기
    let headerRow = -1;
    let colMap = {};
    const refKeywords = ['reference', 'references', 'ref', 'designator'];
    const qtyKeywords = ['quantity', 'qty'];
    const partKeywords = ['part', 'part number', 'partnumber'];  // footprint 제외
    const footprintKeywords = ['pcb footprint', 'footprint'];
    
    for (let r = 1; r <= Math.min(30, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        vals.push({ col: colNum, val: Utils.getCellValue(cell).toLowerCase().trim() });
      });
      
      const refCol = vals.find(v => refKeywords.some(kw => v.val === kw));
      if (refCol) {
        headerRow = r;
        vals.forEach(v => {
          if (v.val === 'item' || v.val === 'no') colMap.item = v.col;
          if (qtyKeywords.some(kw => v.val === kw)) colMap.quantity = v.col;
          if (refKeywords.some(kw => v.val === kw)) colMap.reference = v.col;
          // part와 footprint 별도 처리
          if (partKeywords.some(kw => v.val === kw)) colMap.part = v.col;
          if (footprintKeywords.some(kw => v.val === kw)) colMap.footprint = v.col;
        });
        break;
      }
    }
    
    if (headerRow === -1) return { items: [] };
    
    // 데이터 파싱
    let currentItem = null;
    
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const itemNum = Utils.getCellValue(row.getCell(colMap.item || 1));
      const quantity = Utils.getCellValue(row.getCell(colMap.quantity || 2));
      const reference = Utils.getCellValue(row.getCell(colMap.reference || 3));
      const part = Utils.getCellValue(row.getCell(colMap.part || 4));
      const footprint = Utils.getCellValue(row.getCell(colMap.footprint || 5));
      
      // 구분선 스킵
      if (reference.startsWith('_')) continue;
      
      // 새 아이템
      if (itemNum && /^\d+$/.test(itemNum)) {
        if (currentItem && currentItem.refs.length > 0) {
          items.push(currentItem);
        }
        const refs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
        currentItem = {
          quantity: parseInt(quantity) || refs.length,
          refs: refs,
          part: part,
          footprint: footprint || part,  // footprint가 없으면 part 사용
        };
      } else if (currentItem && reference) {
        // 연속 행 (Reference가 여러 줄)
        const additionalRefs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
        currentItem.refs.push(...additionalRefs);
      }
    }
    
    if (currentItem && currentItem.refs.length > 0) {
      items.push(currentItem);
    }
    
    return { items };
  },
  
  parseWithXLSX(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const items = [];
    
    // 헤더 찾기
    let headerRow = -1;
    let colMap = { item: 0, ref: 1, qty: 2, part: 3, footprint: -1 };
    const refKeywords = ['reference', 'references', 'ref', 'designator'];
    const partKeywords = ['part', 'part number', 'partnumber'];
    const footprintKeywords = ['pcb footprint', 'footprint'];
    
    for (let r = 0; r < Math.min(30, data.length); r++) {
      const row = data[r];
      if (!row) continue;
      
      const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
      if (refKeywords.some(kw => rowStr.includes(kw))) {
        headerRow = r;
        row.forEach((cell, idx) => {
          const val = String(cell || '').toLowerCase().trim();
          if (val === 'item' || val === 'no') colMap.item = idx;
          if (refKeywords.some(kw => val === kw)) colMap.ref = idx;
          if (val === 'quantity' || val === 'qty') colMap.qty = idx;
          if (partKeywords.some(kw => val === kw)) colMap.part = idx;
          if (footprintKeywords.some(kw => val === kw)) colMap.footprint = idx;
        });
        break;
      }
    }
    
    if (headerRow === -1) return { items: [] };
    
    let currentItem = null;
    
    for (let r = headerRow + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.length === 0) continue;
      
      const itemNum = String(row[colMap.item] || '').trim();
      const reference = String(row[colMap.ref] || '').trim();
      const quantity = String(row[colMap.qty] || '').trim();
      const part = String(row[colMap.part] || '').trim();
      const footprint = colMap.footprint >= 0 ? String(row[colMap.footprint] || '').trim() : '';
      
      if (reference.startsWith('_')) continue;
      
      if (itemNum && /^\d+$/.test(itemNum)) {
        if (currentItem && currentItem.refs.length > 0) {
          items.push(currentItem);
        }
        const refs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
        currentItem = {
          quantity: parseInt(quantity) || refs.length,
          refs: refs,
          part: part,
          footprint: footprint || part,  // footprint가 없으면 part 사용
        };
      } else if (currentItem && reference) {
        const additionalRefs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
        currentItem.refs.push(...additionalRefs);
      }
    }
    
    if (currentItem && currentItem.refs.length > 0) {
      items.push(currentItem);
    }
    
    return { items };
  },
  
  parseText(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const items = [];
    
    let headerFound = false;
    let colMap = { item: 0, qty: 1, part: 2, ref: -1, footprint: -1 };
    let currentItem = null;
    let delimiter = '\t';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('_')) continue;
      if (trimmed.toLowerCase().includes('total parts')) continue;
      
      // 헤더 찾기
      if (!headerFound) {
        const lowerLine = trimmed.toLowerCase();
        // item이 있고, reference나 references가 있으면 헤더
        if (lowerLine.includes('item') && 
            (lowerLine.includes('reference') || lowerLine.includes('references'))) {
          headerFound = true;
          
          // 구분자 결정 (| 또는 탭)
          if (trimmed.includes('|')) {
            delimiter = '|';
          }
          
          // 칼럼 위치 찾기
          const cols = trimmed.split(delimiter).map(c => c.trim().toLowerCase());
          cols.forEach((col, idx) => {
            if (col === 'item') colMap.item = idx;
            if (col === 'qty' || col === 'quantity') colMap.qty = idx;
            if (col === 'part number' || col === 'part' || col === 'partnumber') colMap.part = idx;
            if (col === 'reference' || col === 'references') colMap.ref = idx;
            // PCB Footprint 칼럼 추가
            if (col === 'pcb footprint' || col === 'footprint') colMap.footprint = idx;
          });
        }
        continue;
      }
      
      const parts = line.split(delimiter).map(p => p.trim());
      const itemNum = parts[colMap.item] || '';
      
      if (itemNum && /^\d+$/.test(itemNum)) {
        if (currentItem && currentItem.refs.length > 0) {
          items.push(currentItem);
        }
        const quantity = parts[colMap.qty] || '';
        const reference = colMap.ref >= 0 ? (parts[colMap.ref] || '') : '';
        const part = parts[colMap.part] || '';
        const footprint = colMap.footprint >= 0 ? (parts[colMap.footprint] || '') : '';
        
        const refs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
        currentItem = {
          quantity: parseInt(quantity) || refs.length,
          refs: refs,
          part: part,
          footprint: footprint || part,  // footprint가 없으면 part 사용
        };
      } else if (currentItem) {
        // 연속 행
        const continuedRef = colMap.ref >= 0 ? (parts[colMap.ref] || '') : (parts[0] || '');
        if (continuedRef && !continuedRef.toLowerCase().includes('total')) {
          const additionalRefs = Utils.parseRefs(continuedRef).filter(ref => !Utils.isTP(ref));
          currentItem.refs.push(...additionalRefs);
        }
      }
    }
    
    if (currentItem && currentItem.refs.length > 0) {
      items.push(currentItem);
    }
    
    return { items };
  },
};

// ============================================================
// 파서: 좌표 원본
// ============================================================
const CoordinateParser = {
  parse(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    // Excel 파일인 경우 xlsx로 파싱
    if (ext === '.xls' || ext === '.xlsx') {
      return this.parseExcel(filePath);
    }
    
    // 텍스트 파일 파싱
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const items = [];
    
    let headerFound = false;
    let colMap = { refDes: 0, layer: 2, x: 3, y: 4, rotation: 5 };
    
    // 헤더 키워드 매핑 (다양한 이름 지원)
    const refDesKeywords = ['refdes', 'refdesignator', 'ref', 'reference', 'designator'];
    const layerKeywords = ['layer', 'side'];
    const xKeywords = ['locationx', 'x', 'posx', 'pos x', 'location x'];
    const yKeywords = ['locationy', 'y', 'posy', 'pos y', 'location y'];
    const rotKeywords = ['rotation', 'rot', 'angle', 'orient', 'orientation'];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // 구분선 스킵
      if (trimmed.startsWith('---') || trimmed.startsWith('===')) {
        continue;
      }
      
      const lowerLine = trimmed.toLowerCase();
      
      // 헤더 찾기 (RefDes와 Layer가 있으면 헤더)
      if (!headerFound && refDesKeywords.some(kw => lowerLine.includes(kw)) && 
          layerKeywords.some(kw => lowerLine.includes(kw))) {
        headerFound = true;
        
        // 동적으로 칼럼 위치 찾기
        const parts = trimmed.split(/\s+/);
        parts.forEach((part, idx) => {
          const lowerPart = part.toLowerCase();
          if (refDesKeywords.some(kw => lowerPart === kw)) colMap.refDes = idx;
          if (layerKeywords.some(kw => lowerPart === kw)) colMap.layer = idx;
          if (xKeywords.some(kw => lowerPart === kw)) colMap.x = idx;
          if (yKeywords.some(kw => lowerPart === kw)) colMap.y = idx;
          if (rotKeywords.some(kw => lowerPart === kw)) colMap.rotation = idx;
        });
        continue;
      }
      
      if (!headerFound) continue;
      
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 5) {
        // 따옴표 제거
        const refDes = (parts[colMap.refDes] || '').replace(/"/g, '');
        const layer = (parts[colMap.layer] || '').replace(/"/g, '');
        const x = Utils.normalizeNumber((parts[colMap.x] || '').replace(/"/g, ''));
        const y = Utils.normalizeNumber((parts[colMap.y] || '').replace(/"/g, ''));
        const rotation = Utils.normalizeNumber((parts[colMap.rotation] || '').replace(/"/g, ''));
        
        // 숫자만인 RefDes 제외, TP도 제외, 메타정보도 제외
        if (!refDes || Utils.isNumericOnly(refDes)) continue;
        if (Utils.isTP(refDes)) continue;
        const lowerRefDes = refDes.toLowerCase();
        if (lowerRefDes.includes('qty') || lowerRefDes.includes('quantity')) continue;
        if (lowerRefDes.includes('total') || lowerRefDes.includes('report')) continue;
        if (lowerRefDes.includes('origin') || lowerRefDes.includes('units')) continue;
        if (lowerRefDes === 'refdes' || lowerRefDes === 'ref' || lowerRefDes === 'refdesignator' || lowerRefDes === 'reference') continue;
        if (lowerRefDes.includes('p-cad')) continue;
        
        items.push({ refDes, layer, x, y, rotation });
      }
    }
    
    return { items };
  },
  
  parseExcel(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const items = [];
    
    // 헤더 키워드
    const refDesKeywords = ['refdes', 'refdesignator', 'ref', 'reference', 'designator'];
    const layerKeywords = ['layer', 'side'];
    const xKeywords = ['locationx', 'x', 'posx'];
    const yKeywords = ['locationy', 'y', 'posy'];
    const rotKeywords = ['rotation', 'rot', 'angle'];
    
    // 헤더 찾기
    let headerRow = -1;
    let colMap = { refDes: 0, layer: 2, x: 3, y: 4, rotation: 5 };
    
    for (let r = 0; r < Math.min(30, data.length); r++) {
      const row = data[r];
      if (!row) continue;
      
      const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
      if (refDesKeywords.some(kw => rowStr.includes(kw)) && layerKeywords.some(kw => rowStr.includes(kw))) {
        headerRow = r;
        row.forEach((cell, idx) => {
          const val = String(cell || '').toLowerCase().trim();
          if (refDesKeywords.some(kw => val === kw)) colMap.refDes = idx;
          if (layerKeywords.some(kw => val === kw)) colMap.layer = idx;
          if (xKeywords.some(kw => val === kw)) colMap.x = idx;
          if (yKeywords.some(kw => val === kw)) colMap.y = idx;
          if (rotKeywords.some(kw => val === kw)) colMap.rotation = idx;
        });
        break;
      }
    }
    
    if (headerRow === -1) return { items: [] };
    
    for (let r = headerRow + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.length < 5) continue;
      
      const refDes = String(row[colMap.refDes] || '').trim();
      const layer = String(row[colMap.layer] || '').trim();
      const x = Utils.normalizeNumber(String(row[colMap.x] || ''));
      const y = Utils.normalizeNumber(String(row[colMap.y] || ''));
      const rotation = Utils.normalizeNumber(String(row[colMap.rotation] || ''));
      
      // 필터링
      if (!refDes || Utils.isNumericOnly(refDes)) continue;
      if (Utils.isTP(refDes)) continue;
      const lowerRefDes = refDes.toLowerCase();
      if (lowerRefDes.includes('qty') || lowerRefDes.includes('total')) continue;
      if (lowerRefDes.includes('report') || lowerRefDes.includes('origin')) continue;
      if (lowerRefDes.includes('units') || lowerRefDes.includes('p-cad')) continue;
      if (lowerRefDes === 'refdes' || lowerRefDes === 'ref' || lowerRefDes === 'refdesignator' || lowerRefDes === 'reference') continue;
      if (refDes.startsWith('---') || refDes.startsWith('===') || refDes.includes('======')) continue;
      
      items.push({ refDes, layer, x, y, rotation });
    }
    
    return { items };
  },
};

// ============================================================
// 파서: 정답지
// ============================================================
const AnswerSheetParser = {
  async parse(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const result = { bom: [], top: [], bottom: [] };
    
    for (const sheet of workbook.worksheets) {
      const sheetName = sheet.name.toUpperCase();
      if (sheetName === 'TOP') {
        result.top = this.parseCoordinateSheet(sheet);
      } else if (sheetName === 'BOTTOM' || sheetName === 'BOT') {
        result.bottom = this.parseCoordinateSheet(sheet);
      } else {
        // BOM 시트는 첫 번째로 발견된 것만 사용 (덮어쓰기 방지)
        if (result.bom.length === 0) {
          result.bom = this.parseBOMSheet(sheet);
        }
      }
    }
    
    return result;
  },
  
  parseBOMSheet(sheet) {
    const items = [];
    let currentType = '';
    
    // 헤더 찾기
    let headerRow = -1;
    let colMap = { type: 2, partName: 3, set: 4, ref: 8, remark: 10 };
    
    for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 15; c++) {
        const val = Utils.getCellValue(row.getCell(c)).toLowerCase().trim();
        if (val === 'ref' || val === 'refdes') {
          headerRow = r;
          colMap.ref = c;
          for (let cc = 1; cc <= 15; cc++) {
            const colVal = Utils.getCellValue(row.getCell(cc)).toLowerCase().trim();
            if (colVal === '종류') colMap.type = cc;
            if (colVal === '품명' || colVal === 'part' || colVal === 'type') colMap.partName = cc;
            if (colVal === 'set') colMap.set = cc;
            if (colVal === '비고' || colVal === 'remark') colMap.remark = cc;
          }
          break;
        }
      }
      if (headerRow !== -1) break;
    }
    
    if (headerRow === -1) return items;
    
    // 데이터 파싱 (연속 빈 행 감지로 테이블 끝 판단)
    let emptyRowCount = 0;
    const MAX_EMPTY_ROWS = 3; // 연속 빈 행 3개 이상이면 테이블 끝으로 판단
    
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const typeVal = Utils.getCellValue(row.getCell(colMap.type));
      const partName = Utils.getCellValue(row.getCell(colMap.partName));
      const setVal = Utils.getCellValue(row.getCell(colMap.set));
      const refVal = Utils.getCellValue(row.getCell(colMap.ref));
      const remark = Utils.getCellValue(row.getCell(colMap.remark));
      
      // 빈 행 감지 (테이블 끝 판단)
      if (!partName && !refVal && !typeVal) {
        emptyRowCount++;
        if (emptyRowCount >= MAX_EMPTY_ROWS) {
          break; // 테이블 끝 - 파싱 중단
        }
        continue;
      }
      emptyRowCount = 0; // 데이터가 있으면 카운터 리셋
      
      if (!partName && !refVal) continue;
      if (partName.toLowerCase().includes('부품리스트')) continue;
      
      // 종류 값 검증 (메타정보, 담당자명 등 제외)
      if (typeVal && !typeVal.includes('종류')) {
        // ** 로 시작하는 보드명/메타정보 제외
        if (typeVal.startsWith('**') || typeVal.startsWith('*')) continue;
        // 담당자명 제외
        if (typeVal.includes('과장') || typeVal.includes('대리') || typeVal.includes('실장') || typeVal.includes('담당자')) continue;
        // 날짜 패턴 제외 (2024.01 등)
        if (/^\d{4}\.\d{2}/.test(typeVal)) continue;
        // 너무 긴 값 제외 (종류는 보통 20자 이내)
        if (typeVal.length > 25) continue;
        // 구분선 제외
        if (typeVal.startsWith('-') || typeVal.startsWith('=')) continue;
        // 헤더 텍스트가 잘못 들어간 경우 제외 (작업자 실수)
        if (typeVal === '종류' || typeVal === '품명' || typeVal === 'Type') continue;
        
        currentType = Utils.normalizeType(typeVal);
      }
      
      // 헤더 이름이 Ref로 파싱되는 것 방지
      const refs = Utils.parseRefs(refVal).filter(ref => {
        const lowerRef = ref.toLowerCase();
        return lowerRef !== 'refdes' && lowerRef !== 'ref' && lowerRef !== 'reference';
      });
      if (refs.length > 0) {
        items.push({
          type: currentType,
          partName: partName,
          set: parseInt(setVal) || refs.length,
          refs: refs,
          remark: remark,
        });
      }
    }
    
    return items;
  },
  
  parseCoordinateSheet(sheet) {
    const items = [];
    let currentType = '';
    
    // 동적 헤더 찾기
    let headerRow = -1;
    let colMap = { type: 1, partName: 2, refDes: 3, layer: 4, x: 5, y: 6, rotation: 7, remark: 8 };
    
    const refDesKeywords = ['refdes', 'refdesignator', 'ref', 'reference', 'designator'];
    const layerKeywords = ['layer', 'side'];
    
    for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const rowVals = [];
      for (let c = 1; c <= 10; c++) {
        rowVals.push({ col: c, val: Utils.getCellValue(row.getCell(c)).toLowerCase().trim() });
      }
      
      // RefDes와 Layer가 있으면 헤더
      const hasRefDes = rowVals.some(v => refDesKeywords.some(kw => v.val === kw));
      const hasLayer = rowVals.some(v => layerKeywords.some(kw => v.val === kw));
      
      if (hasRefDes && hasLayer) {
        headerRow = r;
        rowVals.forEach(v => {
          if (refDesKeywords.some(kw => v.val === kw)) colMap.refDes = v.col;
          if (layerKeywords.some(kw => v.val === kw)) colMap.layer = v.col;
          if (v.val === 'locationx' || v.val === 'x') colMap.x = v.col;
          if (v.val === 'locationy' || v.val === 'y') colMap.y = v.col;
          if (v.val === 'rotation' || v.val === 'rot') colMap.rotation = v.col;
          if (v.val === 'type' || v.val === '품명') colMap.partName = v.col;
        });
        break;
      }
    }
    
    // 헤더 못 찾으면 기본값 (Row 2부터 데이터)
    const startRow = headerRow > 0 ? headerRow + 2 : 3; // 헤더 다음줄이 구분선일 수 있으므로 +2
    
    for (let r = startRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const typeVal = Utils.getCellValue(row.getCell(colMap.type));
      const partName = Utils.getCellValue(row.getCell(colMap.partName));
      const refDes = Utils.getCellValue(row.getCell(colMap.refDes));
      const layer = Utils.getCellValue(row.getCell(colMap.layer));
      const x = Utils.normalizeNumber(Utils.getCellValue(row.getCell(colMap.x)));
      const y = Utils.normalizeNumber(Utils.getCellValue(row.getCell(colMap.y)));
      const rotation = Utils.normalizeNumber(Utils.getCellValue(row.getCell(colMap.rotation)));
      const remark = Utils.getCellValue(row.getCell(colMap.remark));
      
      // 구분선, 빈 값, 메타정보 스킵
      if (!refDes || refDes.startsWith('---') || refDes.startsWith('===')) continue;
      if (refDes.includes('======')) continue;
      if (refDes.toLowerCase().includes('report') || refDes.toLowerCase().includes('units')) continue;
      if (refDes.toLowerCase().includes('qty') || refDes.toLowerCase().includes('quantity')) continue;
      if (refDes.toLowerCase().includes('total') || refDes.toLowerCase().includes('origin')) continue;
      if (refDes.toLowerCase().includes('p-cad')) continue;
      // 헤더 키워드 필터링
      const refDesLower = refDes.toLowerCase();
      if (refDesLower === 'refdes' || refDesLower === 'ref' || refDesLower === 'refdesignator' || refDesLower === 'reference') continue;
      
      // 숫자로만 이루어진 RefDes 제외, TP도 제외
      if (Utils.isNumericOnly(refDes)) continue;
      if (Utils.isTP(refDes)) continue;
      
      if (typeVal && !typeVal.startsWith('-')) currentType = Utils.normalizeType(typeVal);
      
      items.push({ type: currentType, partName, refDes, layer, x, y, rotation, remark });
    }
    
    return items;
  },
};

// ============================================================
// GPT-4o 학습 모듈
// ============================================================
const AILearner = {
  /**
   * 종류 학습: 품명 → 종류 매핑 규칙 학습
   */
  /**
   * 종류 매핑: 정답지에서 파싱한 값을 그대로 저장 (GPT 사용 안 함)
   * - GPT가 값을 변경할 수 있으므로 파싱 값 그대로 저장
   * - 충돌 시 기록해두고 나중에 사용자 확인
   */
  async learnTypes(bomDataList) {
    console.log('📋 종류 매핑 수집 시작 (파싱 값 그대로 저장)...');
    
    // 작업자 실수로 헤더가 값으로 들어간 경우 제외
    const invalidTypes = ['종류', '품명', 'Type', 'type', '', '번호', 'SET', 'REF'];
    
    // 품명별 종류 수집 (충돌 감지용)
    const typesByPartName = {};
    
    for (const data of bomDataList) {
      for (const item of data.bom) {
        if (item.partName && item.type && !invalidTypes.includes(item.type)) {
          const partName = item.partName;
          const type = item.type;
          
          if (!typesByPartName[partName]) {
            typesByPartName[partName] = {};
          }
          
          // 해당 종류가 몇 번 나왔는지 카운트
          if (!typesByPartName[partName][type]) {
            typesByPartName[partName][type] = 0;
          }
          typesByPartName[partName][type]++;
        }
      }
    }
    
    // 충돌 감지 및 매핑 저장
    const conflicts = [];
    let savedCount = 0;
    
    for (const [partName, types] of Object.entries(typesByPartName)) {
      const typeList = Object.keys(types);
      
      if (typeList.length === 1) {
        // 충돌 없음 - 그대로 저장
        LearningData.typeMapping[partName] = typeList[0];
        savedCount++;
      } else {
        // 충돌 발생 - 가장 많이 나온 종류 선택 (임시), 충돌 기록
        const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
        const mostCommon = sorted[0][0];
        LearningData.typeMapping[partName] = mostCommon;
        savedCount++;
        
        conflicts.push({
          partName,
          types: sorted.map(([t, count]) => `${t}(${count}회)`).join(' vs ')
        });
      }
    }
    
    console.log(`   ✅ ${savedCount}개 품명-종류 매핑 저장 완료`);
    
    if (conflicts.length > 0) {
      console.log(`   ⚠️ ${conflicts.length}개 품명에서 종류 충돌 발견 (가장 많이 나온 값으로 임시 저장):`);
      conflicts.slice(0, 10).forEach(c => {
        console.log(`      - ${c.partName}: ${c.types}`);
      });
      if (conflicts.length > 10) {
        console.log(`      ... 외 ${conflicts.length - 10}건`);
      }
      
      // 충돌 목록 파일로 저장
      if (!fs.existsSync(CONFIG.analysisResultPath)) {
        fs.mkdirSync(CONFIG.analysisResultPath, { recursive: true });
      }
      const conflictPath = path.join(CONFIG.analysisResultPath, '종류_충돌목록.json');
      fs.writeFileSync(conflictPath, JSON.stringify(conflicts, null, 2), 'utf-8');
      console.log(`   📁 충돌 목록 저장: ${conflictPath}`);
    }
  },
  
  /**
   * 품명 매핑 학습: PCB Footprint → 정리본 품명 (메인)
   * 충돌 시 Part + PCB Footprint 조합으로 구분
   */
  async learnPartNameMapping(bomOriginalList, answerDataList) {
    console.log('📋 품명 매핑 파싱 시작 (PCB Footprint 메인, 충돌 시 Part 추가)...');
    
    const footprintMapping = {};  // footprint → 정리본품명 (메인)
    const footprintConflicts = {};  // footprint → Set of 다른 품명들
    const comboMapping = {};  // "part|footprint" → 정리본품명 (충돌 시 사용)
    const answerPartNames = new Set();
    
    // 1차: 모든 매핑 수집
    for (let i = 0; i < bomOriginalList.length; i++) {
      const bomItems = bomOriginalList[i].items;
      const answerBom = answerDataList[i].bom;
      
      for (const answerItem of answerBom) {
        if (answerItem.partName) answerPartNames.add(answerItem.partName);
      }
      
      for (const bomItem of bomItems) {
        for (const answerItem of answerBom) {
          const overlap = bomItem.refs.some(ref => answerItem.refs.includes(ref));
          if (overlap && answerItem.partName) {
            const part = (bomItem.part || '').trim();
            const footprint = (bomItem.footprint || '').trim();
            
            // 수동 작성 필요 조합은 저장하지 않음 (10V/16V 충돌)
            if (Utils.isManualInputRequired(part, footprint)) {
              continue;
            }
            
            if (footprint) {
              // footprint 매핑 충돌 체크
              if (footprintMapping[footprint] && footprintMapping[footprint] !== answerItem.partName) {
                // 충돌 발생! 충돌 목록에 추가
                if (!footprintConflicts[footprint]) {
                  footprintConflicts[footprint] = new Set([footprintMapping[footprint]]);
                }
                footprintConflicts[footprint].add(answerItem.partName);
                // 충돌 시 덮어쓰지 않음! Part|Footprint 조합만 사용
              } else if (!footprintMapping[footprint]) {
                // 첫 번째 매핑만 저장 (충돌 없을 때)
                footprintMapping[footprint] = answerItem.partName;
              }
              
              // Part + Footprint 조합도 항상 저장
              if (part) {
                const comboKey = `${part}|${footprint}`;
                comboMapping[comboKey] = answerItem.partName;
              } else {
                // part 없으면 |footprint 형태로 저장
                const comboKey = `|${footprint}`;
                comboMapping[comboKey] = answerItem.partName;
              }
            } else if (part) {
              // footprint 없으면 part만 사용
              if (!footprintMapping[part]) {
                footprintMapping[part] = answerItem.partName;
              }
            }
          }
        }
      }
    }
    
    // 충돌 있는 footprint는 단독 매핑에서 제거 (Part|Footprint로만 구분 가능)
    for (const fp of Object.keys(footprintConflicts)) {
      delete footprintMapping[fp];
    }
    
    // 충돌 로그
    const conflictCount = Object.keys(footprintConflicts).length;
    if (conflictCount > 0) {
      console.log(`   ⚠️ ${conflictCount}개 footprint 충돌 발견 (Part|Footprint 조합으로만 구분)`);
    }
    
    // 매핑 저장: 기존 매핑 유지 + footprint 매핑 + combo 매핑 합치기
    // 기존 매핑(고정 매핑)이 우선, 새로 학습한 건 덮어쓰지 않음
    const existingMapping = LearningData.partNameMapping || {};
    LearningData.partNameMapping = { ...footprintMapping, ...comboMapping, ...existingMapping };
    LearningData.partNameConflicts = footprintConflicts;  // 충돌 목록 저장
    
    console.log(`   ✅ ${Object.keys(footprintMapping).length}개 Footprint 매핑`);
    console.log(`   ✅ ${Object.keys(comboMapping).length}개 Part|Footprint 조합 매핑`);
    
    LearningData.knownPartNames = [...answerPartNames];
    console.log(`   📁 ${LearningData.knownPartNames.length}개 정답지 품명 저장`);
    
    // 고정 매핑 적용 (학습 후에도 덮어씀)
    LearningData.applyFixedMappings();
    console.log(`   🔒 고정 매핑 적용 완료`);
  },
  
  /**
   * 종류 정렬순서 학습
   */
  async learnTypeSortOrder(answerDataList) {
    console.log('🤖 GPT-4o: 종류 정렬순서 학습 시작...');
    
    // 모든 정답지에서 종류 순서 수집
    const orderExamples = [];
    
    for (const data of answerDataList) {
      const types = [];
      for (const item of data.bom) {
        if (item.type && !types.includes(item.type)) {
          types.push(item.type);
        }
      }
      if (types.length > 0) {
        orderExamples.push(types);
      }
    }
    
    if (orderExamples.length === 0) {
      console.log('   학습할 데이터가 없습니다.');
      return;
    }
    
    const prompt = `당신은 전자부품 정렬 전문가입니다.
아래는 여러 보드의 부품 종류 나열 순서입니다.

순서 예시 (각 줄이 하나의 보드):
${orderExamples.slice(0, 20).map(o => o.join(' → ')).join('\n')}

위 데이터를 분석하여, 부품 종류의 표준 정렬 순서를 파악하세요.
일반적으로 IC가 맨 위, CONNECTOR가 맨 아래에 옵니다.

표준 정렬 순서를 JSON 배열로 반환하세요.
형식: ["종류1", "종류2", "종류3", ...]

주의:
- 입력된 종류명을 그대로 사용하세요
- JSON 배열만 반환하세요`;

    try {
      const response = await openai.chat.completions.create({
        model: CONFIG.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0,
      });
      
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        LearningData.typeSortOrder = JSON.parse(jsonMatch[0]);
        console.log(`   ✅ ${LearningData.typeSortOrder.length}개 종류 정렬순서 학습 완료`);
      }
    } catch (error) {
      console.error('   ❌ 정렬순서 학습 오류:', error.message);
    }
  },
  
  /**
   * 미삽 항목 학습
   */
  async learnMisapKeywords(answerDataList) {
    console.log('🤖 GPT-4o: 미삽 항목 학습 시작...');
    
    // 비고에서 미삽 관련 내용 수집
    const misapExamples = [];
    
    for (const data of answerDataList) {
      for (const item of data.bom) {
        if (item.remark && item.remark.includes('미삽')) {
          misapExamples.push({
            partName: item.partName,
            remark: item.remark,
          });
        }
      }
    }
    
    // 품명에서 미삽 키워드 추출
    const keywordsFromPartName = new Set();
    for (const data of answerDataList) {
      for (const item of data.bom) {
        if (item.partName) {
          const match = item.partName.match(/_(OPEN|NC|POGO|PAD|DNP|DNI|NM)$/i);
          if (match) {
            keywordsFromPartName.add(match[1].toUpperCase());
          }
        }
      }
    }
    
    // 기존 + 새로 발견된 키워드 합치기
    const allKeywords = new Set([...CONFIG.defaultMisapKeywords, ...keywordsFromPartName]);
    LearningData.misapKeywords = [...allKeywords];
    
    console.log(`   ✅ 미삽 키워드: ${LearningData.misapKeywords.join(', ')}`);
  },
};

// ============================================================
// 검증 모듈
// ============================================================
const Validator = {
  compareRefs(bomItems, answerBomItems) {
    const bomRefs = new Set();
    for (const item of bomItems) {
      item.refs.forEach(ref => bomRefs.add(ref));
    }
    
    const answerRefs = new Set();
    for (const item of answerBomItems) {
      item.refs.forEach(ref => {
        if (!Utils.isTP(ref)) answerRefs.add(ref);
      });
    }
    
    const missing = [...answerRefs].filter(ref => !bomRefs.has(ref));
    const extra = [...bomRefs].filter(ref => !answerRefs.has(ref));
    
    const total = answerRefs.size;
    const matched = total - missing.length;
    const matchRate = total > 0 ? (matched / total * 100).toFixed(1) : 100;
    
    return {
      // 정답지에 있는 Ref가 모두 원본에 있으면 match
      // extra(원본에만 있는 것)는 무시
      match: missing.length === 0,
      missing, extra,
      matchRate: parseFloat(matchRate),
      total,
    };
  },
  
  // 소수점 정규화: 4.00 -> 4, 0.0 -> 0, 0.400 -> 0.4
  normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return '';
    const num = parseFloat(value);
    if (isNaN(num)) return String(value);
    return String(num); // 자동으로 trailing zero 제거
  },
  
  // Rotation 비교용 정규화: 0과 빈값을 동일하게 처리
  normalizeRotation(value) {
    if (value === null || value === undefined || value === '') return '0';
    const num = parseFloat(value);
    if (isNaN(num)) return '0';
    return String(num);
  },
  
  compareCoordinates(coordItems, answerCoordItems) {
    const coordRefs = new Map();
    for (const item of coordItems) {
      coordRefs.set(item.refDes, item);
    }
    
    const answerRefs = new Map();
    for (const item of answerCoordItems) {
      answerRefs.set(item.refDes, item);
    }
    
    const missing = [];
    const mismatch = [];
    
    for (const [refDes, answerItem] of answerRefs) {
      const coordItem = coordRefs.get(refDes);
      if (!coordItem) {
        missing.push(refDes);
        continue;
      }
      
      // 소수점 정규화 후 비교 (rotation은 0과 빈값을 동일하게)
      const coordX = this.normalizeNumber(coordItem.x);
      const coordY = this.normalizeNumber(coordItem.y);
      const coordRot = this.normalizeRotation(coordItem.rotation);
      const answerX = this.normalizeNumber(answerItem.x);
      const answerY = this.normalizeNumber(answerItem.y);
      const answerRot = this.normalizeRotation(answerItem.rotation);
      
      if (coordX !== answerX || coordY !== answerY || coordRot !== answerRot) {
        mismatch.push({ refDes, coord: coordItem, answer: answerItem });
      }
    }
    
    const extra = [...coordRefs.keys()].filter(ref => !answerRefs.has(ref));
    const total = answerRefs.size;
    const matched = total - missing.length - mismatch.length;
    const matchRate = total > 0 ? (matched / total * 100).toFixed(1) : 100;
    
    return {
      // 정답지에 있는 항목이 모두 원본에 있고, 값도 일치하면 match
      // extra(원본에만 있는 것)는 무시
      match: missing.length === 0 && mismatch.length === 0,
      missing, extra, mismatch,
      matchRate: parseFloat(matchRate),
      total,
    };
  },
  
  compareTypes(answerBomItems) {
    let matched = 0, total = 0;
    const mismatches = [];
    
    for (const item of answerBomItems) {
      if (!item.partName) continue;
      total++;
      const learnedType = LearningData.typeMapping[item.partName];
      if (learnedType === item.type) {
        matched++;
      } else if (learnedType) {
        mismatches.push({ partName: item.partName, expected: item.type, actual: learnedType });
      } else {
        matched++; // 학습 안된 건 일단 패스
      }
    }
    
    const matchRate = total > 0 ? (matched / total * 100).toFixed(1) : 100;
    return { match: mismatches.length === 0, mismatches, matchRate: parseFloat(matchRate), total };
  },
  
  comparePartNames(bomItems, answerBomItems) {
    // Ref를 기준으로 원본 BOM과 정답지 BOM 매칭
    const bomByRef = {};
    for (const item of bomItems) {
      for (const ref of item.refs) {
        bomByRef[ref] = {
          footprint: item.footprint,
          part: item.part,
        };
      }
    }
    
    let matched = 0;
    let total = 0;
    const mismatches = [];
    
    for (const answerItem of answerBomItems) {
      if (!answerItem.partName) continue;
      
      for (const ref of answerItem.refs) {
        total++;
        const bomItem = bomByRef[ref];
        
        if (!bomItem) {
          matched++;
          continue;
        }
        
        const answerPartName = answerItem.partName;
        const answerNormalized = Utils.normalizePartName(answerPartName);
        const part = (bomItem.part || '').trim();
        const footprint = (bomItem.footprint || '').trim();
        
        // 0. 수동 작성 필요 조합은 비교 제외 (10V/16V 충돌)
        if (Utils.isManualInputRequired(part, footprint)) {
          matched++;  // 일치로 처리 (비교 제외)
          continue;
        }
        
        // 1. 직접 일치 (정규화 비교)
        if (Utils.normalizePartName(footprint) === answerNormalized || 
            Utils.normalizePartName(part) === answerNormalized) {
          matched++;
          continue;
        }
        
        // 2. 충돌 여부 확인
        const hasConflict = footprint && LearningData.partNameConflicts && LearningData.partNameConflicts[footprint];
        
        if (hasConflict) {
          // 충돌 있으면 Part|Footprint 조합으로만 확인
          const comboKey = part ? `${part}|${footprint}` : `|${footprint}`;
          const learnedPartName = LearningData.partNameMapping[comboKey];
          if (learnedPartName && Utils.normalizePartName(learnedPartName) === answerNormalized) {
            matched++;
            continue;
          }
        } else {
          // 충돌 없으면 Footprint 단독 매핑 확인 (정규화 비교)
          const learnedPartName = footprint && LearningData.partNameMapping[footprint];
          if (learnedPartName && Utils.normalizePartName(learnedPartName) === answerNormalized) {
            matched++;
            continue;
          }
        }
        
        // 3. Part 매핑도 확인 (footprint 없는 경우, 정규화 비교)
        const partMapped = part && LearningData.partNameMapping[part];
        if (partMapped && Utils.normalizePartName(partMapped) === answerNormalized) {
          matched++;
          continue;
        }
        
        // 불일치
        mismatches.push({
          ref,
          bomPartName: footprint || part,
          answerPartName,
        });
      }
    }
    
    const matchRate = total > 0 ? (matched / total * 100).toFixed(1) : 100;
    return { 
      match: mismatches.length === 0, 
      mismatches: mismatches.slice(0, 20),
      matchRate: parseFloat(matchRate), 
      total 
    };
  },
};

// ============================================================
// 불일치 분석 (GPT-4o)
// ============================================================
const DiscrepancyAnalyzer = {
  results: [],
  
  async analyze(boardName, discrepancy) {
    const prompt = `BOM/좌표 정리 불일치 분석:

보드: ${boardName}
불일치 내용:
${JSON.stringify(discrepancy, null, 2)}

가능한 원인을 분석해주세요.
원인을 파악할 수 없다면 "해당 부품이 어디서 어떻게 추가/수정됐는지 알 수 없습니다. 수동 확인이 필요합니다."라고 답변하세요.`;

    try {
      const response = await openai.chat.completions.create({
        model: CONFIG.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0,
      });
      
      return response.choices[0].message.content;
    } catch (error) {
      return `분석 실패: ${error.message}`;
    }
  },
  
  save() {
    if (!fs.existsSync(CONFIG.analysisResultPath)) {
      fs.mkdirSync(CONFIG.analysisResultPath, { recursive: true });
    }
    const filePath = path.join(CONFIG.analysisResultPath, '불일치_분석.json');
    fs.writeFileSync(filePath, JSON.stringify(this.results, null, 2), 'utf-8');
  },
};

// ============================================================
// 폴더 스캐너
// ============================================================
const FolderScanner = {
  async scanAllBoards() {
    const boards = [];
    const basePaths = [
      path.join(CONFIG.sampleDataPath, '2024'),
      path.join(CONFIG.sampleDataPath, '2025'),
    ];
    
    for (const basePath of basePaths) {
      if (!fs.existsSync(basePath)) continue;
      
      const folders = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      
      for (const folder of folders) {
        const folderPath = path.join(basePath, folder);
        const files = fs.readdirSync(folderPath);
        
        // macOS NFD 유니코드 정규화 적용
        const bomFile = files.find(f => /part|bom/i.test(f.normalize('NFC')) && /\.(xlsx|xls|txt|bom)$/i.test(f));
        const coordFile = files.find(f => /좌표/.test(f.normalize('NFC')) && /\.(xlsx|xls|txt)$/i.test(f));
        const answerFile = files.find(f => /\(\d{4}\)\.xlsx?$/i.test(f));
        
        if (answerFile) {
          boards.push({
            name: folder,
            path: folderPath,
            bomFile: bomFile ? path.join(folderPath, bomFile) : null,
            coordFile: coordFile ? path.join(folderPath, coordFile) : null,
            answerFile: path.join(folderPath, answerFile),
          });
        }
      }
    }
    
    return boards;
  },
};

// ============================================================
// 메인 엔진
// ============================================================
const Engine = {
  round: 1,
  boards: [],
  bomDataList: [],
  coordDataList: [],
  answerDataList: [],
  results: [],
  
  async initialize() {
    console.log('🚀 BOM 좌표 자동 정리 엔진 v7 시작\n');
    
    // OpenAI 초기화
    initOpenAI();
    
    // 학습 데이터 로드
    LearningData.load();
    
    // 보드 스캔
    console.log('\n📂 보드 폴더 스캔 중...');
    this.boards = await FolderScanner.scanAllBoards();
    console.log(`✅ ${this.boards.length}개 보드 발견\n`);
    
    if (this.boards.length === 0) {
      console.log('❌ 처리할 보드가 없습니다.');
      process.exit(1);
    }
  },
  
  async parseAllFiles() {
    console.log('📄 파일 파싱 중...');
    
    this.bomDataList = [];
    this.coordDataList = [];
    this.answerDataList = [];
    
    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      process.stdout.write(`\r   파싱: ${i + 1}/${this.boards.length}`);
      
      try {
        // BOM 파싱
        if (board.bomFile) {
          this.bomDataList[i] = await BOMParser.parse(board.bomFile);
        } else {
          this.bomDataList[i] = { items: [] };
        }
        
        // 좌표 파싱
        if (board.coordFile) {
          this.coordDataList[i] = CoordinateParser.parse(board.coordFile);
        } else {
          this.coordDataList[i] = { items: [] };
        }
        
        // 정답지 파싱
        this.answerDataList[i] = await AnswerSheetParser.parse(board.answerFile);
      } catch (error) {
        this.bomDataList[i] = { items: [] };
        this.coordDataList[i] = { items: [] };
        this.answerDataList[i] = { bom: [], top: [], bottom: [] };
      }
    }
    
    console.log('\n✅ 파싱 완료\n');
  },
  
  async runLearning() {
    console.log('\n' + '='.repeat(60));
    console.log('📚 GPT-4o 학습 시작');
    console.log('='.repeat(60) + '\n');
    
    // 종류 학습
    await AILearner.learnTypes(this.answerDataList);
    
    // 품명 매핑 학습
    await AILearner.learnPartNameMapping(this.bomDataList, this.answerDataList);
    
    // 종류 정렬순서 학습
    await AILearner.learnTypeSortOrder(this.answerDataList);
    
    // 미삽 항목 학습
    await AILearner.learnMisapKeywords(this.answerDataList);
    
    // 학습 데이터 저장
    LearningData.learningComplete = true;
    LearningData.save();
    
    console.log('\n💾 학습 데이터 저장 완료\n');
  },
  
  async runValidation() {
    console.log('\n' + '='.repeat(60));
    console.log(`🔄 Round ${this.round} 검증 시작`);
    console.log('='.repeat(60) + '\n');
    
    this.results = [];
    
    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      const bomData = this.bomDataList[i];
      const coordData = this.coordDataList[i];
      const answerData = this.answerDataList[i];
      
      const log = {
        name: board.name,
        type: { status: 'unknown', matchRate: 0, mismatches: [] },
        partName: { status: 'unknown', matchRate: 0 },
        ref: { status: 'unknown', matchRate: 0, missing: [], extra: [] },
        coord: { status: 'unknown', matchRate: 0, missing: [], extra: [] },
      };
      
      // Round 1: 학습중 표시
      if (this.round === 1 && !LearningData.learningComplete) {
        log.type.status = 'learning';
        log.partName.status = 'learning';
      } else {
        // Round 2+: 종류/품명 비교
        const typeResult = Validator.compareTypes(answerData.bom);
        log.type.status = typeResult.match ? 'match' : 'mismatch';
        log.type.matchRate = typeResult.matchRate;
        log.type.mismatches = typeResult.mismatches || [];
        
        const partNameResult = Validator.comparePartNames(bomData.items, answerData.bom);
        log.partName.status = partNameResult.match ? 'match' : 'mismatch';
        log.partName.matchRate = partNameResult.matchRate;
      }
      
      // Ref 비교
      if (bomData.items.length > 0) {
        const refResult = Validator.compareRefs(bomData.items, answerData.bom);
        log.ref.status = refResult.match ? 'match' : 'mismatch';
        log.ref.matchRate = refResult.matchRate;
        log.ref.missing = refResult.missing;
        log.ref.extra = refResult.extra;
      } else {
        log.ref.status = 'no_file';
      }
      
      // 좌표 비교
      if (coordData.items.length > 0) {
        const answerCoords = [...answerData.top, ...answerData.bottom];
        const coordResult = Validator.compareCoordinates(coordData.items, answerCoords);
        log.coord.status = coordResult.match ? 'match' : 'mismatch';
        log.coord.matchRate = coordResult.matchRate;
        log.coord.missing = coordResult.missing;
        log.coord.extra = coordResult.extra;
      } else {
        log.coord.status = 'no_file';
      }
      
      this.results.push(log);
    }
    
    // 결과 출력
    this.printResults();
    
    // 통계
    this.printStats();
    
    // 100% 달성 여부 (종류, 품명, Ref, 좌표 전부 체크)
    const allMatch = this.results.every(r => 
      (r.type.status === 'match') &&
      (r.partName.status === 'match') &&
      (r.ref.status === 'match' || r.ref.status === 'no_file') &&
      (r.coord.status === 'match' || r.coord.status === 'no_file')
    );
    
    return allMatch;
  },
  
  printResults() {
    const icons = {
      learning: '📚',
      match: '✅',
      mismatch: '❌',
      no_file: '⚪',
      unknown: '❓',
    };
    
    for (const log of this.results) {
      console.log(`\n${log.name}`);
      
      // 종류
      if (log.type.status === 'learning') {
        console.log(`  ${icons.learning} 종류: 학습중`);
      } else {
        let typeLine = `  ${icons[log.type.status]} 종류: ${log.type.status === 'match' ? '일치' : '불일치'} (${log.type.matchRate}%)`;
        if (log.type.status === 'mismatch' && log.type.mismatches && log.type.mismatches.length > 0) {
          // 불일치 항목 상세 출력
          const details = log.type.mismatches.slice(0, 5).map(m => 
            `${m.partName}: 정답=${m.expected}, 학습=${m.actual}`
          );
          typeLine += `\n      📋 불일치(${log.type.mismatches.length}건): ${details.join(' | ')}`;
          if (log.type.mismatches.length > 5) {
            typeLine += ` ...외 ${log.type.mismatches.length - 5}건`;
          }
        }
        console.log(typeLine);
      }
      
      // 품명
      if (log.partName.status === 'learning') {
        console.log(`  ${icons.learning} 품명: 학습중`);
      } else {
        console.log(`  ${icons[log.partName.status]} 품명: ${log.partName.status === 'match' ? '일치' : '불일치'} (${log.partName.matchRate}%)`);
      }
      
      // Ref
      if (log.ref.status === 'no_file') {
        console.log(`  ${icons.no_file} Ref: BOM 파일 없음`);
      } else {
        let refLine = `  ${icons[log.ref.status]} Ref: ${log.ref.status === 'match' ? '일치' : '불일치'} (${log.ref.matchRate}%)`;
        if (log.ref.status === 'mismatch' && log.ref.matchRate >= 90) {
          // 90% 이상인 불일치 항목은 상세 표시
          if (log.ref.missing.length > 0) {
            refLine += `\n      📋 누락(${log.ref.missing.length}건): ${log.ref.missing.join(', ')}`;
          }
        } else if (log.ref.missing.length > 0) {
          const preview = log.ref.missing.slice(0, 5).join(', ');
          refLine += ` - 누락: ${preview}${log.ref.missing.length > 5 ? '...' : ''}`;
        }
        console.log(refLine);
      }
      
      // 좌표
      if (log.coord.status === 'no_file') {
        console.log(`  ${icons.no_file} 좌표: 좌표 파일 없음`);
      } else {
        let coordLine = `  ${icons[log.coord.status]} 좌표: ${log.coord.status === 'match' ? '일치' : '불일치'} (${log.coord.matchRate}%)`;
        if (log.coord.status === 'mismatch' && log.coord.matchRate >= 90) {
          // 90% 이상인 불일치 항목은 상세 표시
          if (log.coord.missing.length > 0) {
            coordLine += `\n      📋 누락(${log.coord.missing.length}건): ${log.coord.missing.join(', ')}`;
          }
          if (log.coord.mismatch && log.coord.mismatch.length > 0) {
            const mismatchPreview = log.coord.mismatch.slice(0, 5).map(m => m.refDes).join(', ');
            coordLine += `\n      ⚠️ 값불일치(${log.coord.mismatch.length}건): ${mismatchPreview}${log.coord.mismatch.length > 5 ? '...' : ''}`;
          }
        } else if (log.coord.missing.length > 0) {
          const preview = log.coord.missing.slice(0, 5).join(', ');
          coordLine += ` - 누락: ${preview}${log.coord.missing.length > 5 ? '...' : ''}`;
        }
        console.log(coordLine);
      }
    }
  },
  
  printStats() {
    const stats = {
      total: this.results.length,
      refMatch: this.results.filter(r => r.ref.status === 'match').length,
      coordMatch: this.results.filter(r => r.coord.status === 'match').length,
      typeMatch: this.results.filter(r => r.type.status === 'match').length,
      partNameMatch: this.results.filter(r => r.partName.status === 'match').length,
    };
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Round ${this.round} 통계`);
    console.log('='.repeat(60));
    console.log(`  총 보드: ${stats.total}`);
    console.log(`  종류 일치: ${stats.typeMatch}/${stats.total} (${(stats.typeMatch/stats.total*100).toFixed(1)}%)`);
    console.log(`  품명 일치: ${stats.partNameMatch}/${stats.total} (${(stats.partNameMatch/stats.total*100).toFixed(1)}%)`);
    console.log(`  Ref 일치: ${stats.refMatch}/${stats.total} (${(stats.refMatch/stats.total*100).toFixed(1)}%)`);
    console.log(`  좌표 일치: ${stats.coordMatch}/${stats.total} (${(stats.coordMatch/stats.total*100).toFixed(1)}%)`);
    
    // 불일치 결과 파일로 저장
    this.saveMismatchReport();
  },
  
  saveMismatchReport() {
    const mismatches = {
      round: this.round,
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.length,
        typeMatch: this.results.filter(r => r.type.status === 'match').length,
        partNameMatch: this.results.filter(r => r.partName.status === 'match').length,
        refMatch: this.results.filter(r => r.ref.status === 'match').length,
        coordMatch: this.results.filter(r => r.coord.status === 'match').length,
      },
      details: {
        type: [],
        partName: [],
        ref: [],
        coord: [],
      }
    };
    
    for (const log of this.results) {
      // 종류 불일치
      if (log.type.status === 'mismatch') {
        mismatches.details.type.push({
          board: log.name,
          matchRate: log.type.matchRate,
          mismatches: log.type.mismatches?.slice(0, 20) || []
        });
      }
      
      // 품명 불일치
      if (log.partName.status === 'mismatch') {
        mismatches.details.partName.push({
          board: log.name,
          matchRate: log.partName.matchRate,
        });
      }
      
      // Ref 불일치
      if (log.ref.status === 'mismatch') {
        mismatches.details.ref.push({
          board: log.name,
          matchRate: log.ref.matchRate,
          missing: log.ref.missing?.slice(0, 20) || [],
          extra: log.ref.extra?.slice(0, 20) || [],
        });
      }
      
      // 좌표 불일치
      if (log.coord.status === 'mismatch') {
        mismatches.details.coord.push({
          board: log.name,
          matchRate: log.coord.matchRate,
          missing: log.coord.missing?.slice(0, 20) || [],
        });
      }
    }
    
    // 파일 저장
    if (!fs.existsSync(CONFIG.analysisResultPath)) {
      fs.mkdirSync(CONFIG.analysisResultPath, { recursive: true });
    }
    const filePath = path.join(CONFIG.analysisResultPath, '불일치_상세보고서.json');
    fs.writeFileSync(filePath, JSON.stringify(mismatches, null, 2), 'utf-8');
    console.log(`\n📁 불일치 상세보고서 저장: ${filePath}`);
  },
  
  /**
   * 불일치 분석 및 매핑 수정
   * GPT로 원인 분석 → 매핑 자동 수정
   */
  async analyzeAndFixMismatches() {
    console.log(`\n🔍 Round ${this.round} 불일치 분석 및 자동 수정 시작...`);
    
    let fixedCount = 0;
    
    // 1. 종류 불일치 분석 및 수정
    const typeMismatches = this.results.filter(r => r.type.status === 'mismatch' && r.type.mismatches?.length > 0);
    if (typeMismatches.length > 0) {
      console.log(`\n📊 종류 불일치 ${typeMismatches.length}개 보드 분석...`);
      
      // 모든 불일치를 수집해서 다수결 분석
      const partNameTypeCounts = {}; // partName → { type → count }
      
      for (const log of typeMismatches) {
        for (const mm of log.type.mismatches) {
          if (!partNameTypeCounts[mm.partName]) {
            partNameTypeCounts[mm.partName] = {};
          }
          // 정답지 값 (expected)을 카운트
          if (!partNameTypeCounts[mm.partName][mm.expected]) {
            partNameTypeCounts[mm.partName][mm.expected] = 0;
          }
          partNameTypeCounts[mm.partName][mm.expected]++;
        }
      }
      
      // 다수결로 올바른 종류 결정 및 매핑 수정
      for (const [partName, typeCounts] of Object.entries(partNameTypeCounts)) {
        const currentType = LearningData.typeMapping[partName];
        const entries = Object.entries(typeCounts);
        const maxEntry = entries.reduce((a, b) => a[1] > b[1] ? a : b);
        const expectedType = maxEntry[0];
        const count = maxEntry[1];
        
        if (currentType !== expectedType && count >= 2) {
          // 2개 이상 보드에서 같은 종류로 나왔으면 수정
          console.log(`   🔧 ${partName}: ${currentType || '없음'} → ${expectedType} (${count}개 보드 일치)`);
          LearningData.typeMapping[partName] = expectedType;
          fixedCount++;
        }
      }
    }
    
    // 2. 품명 불일치 분석 및 수정
    const partNameMismatches = this.results.filter(r => r.partName.status === 'mismatch');
    if (partNameMismatches.length > 0) {
      console.log(`\n📊 품명 불일치 ${partNameMismatches.length}개 보드 분석...`);
      
      // 불일치 패턴 수집
      const missingMappings = {}; // bomPartName → { answerPartName → count }
      
      for (let i = 0; i < this.bomDataList.length; i++) {
        const log = this.results[i];
        if (log.partName.status !== 'mismatch') continue;
        
        const bomItems = this.bomDataList[i].items;
        const answerBom = this.answerDataList[i].bom;
        
        // Ref 매칭으로 누락된 매핑 찾기
        const bomByRef = {};
        for (const item of bomItems) {
          for (const ref of item.refs) {
            bomByRef[ref] = { part: item.part, footprint: item.footprint };
          }
        }
        
        for (const answerItem of answerBom) {
          if (!answerItem.partName) continue;
          
          for (const ref of answerItem.refs) {
            const bomItem = bomByRef[ref];
            if (!bomItem) continue;
            
            const footprint = (bomItem.footprint || '').trim();
            const part = (bomItem.part || '').trim();
            const answerPartName = answerItem.partName;
            
            // 현재 매핑 확인
            const hasConflict = footprint && LearningData.partNameConflicts?.[footprint];
            let currentMapping = null;
            
            if (hasConflict) {
              const comboKey = part ? `${part}|${footprint}` : `|${footprint}`;
              currentMapping = LearningData.partNameMapping[comboKey];
            } else if (footprint) {
              currentMapping = LearningData.partNameMapping[footprint];
            }
            
            // 매핑이 없거나 다르면 추가 후보
            if (currentMapping !== answerPartName && footprint) {
              const key = footprint;
              if (!missingMappings[key]) {
                missingMappings[key] = { part, counts: {} };
              }
              if (!missingMappings[key].counts[answerPartName]) {
                missingMappings[key].counts[answerPartName] = 0;
              }
              missingMappings[key].counts[answerPartName]++;
            }
          }
        }
      }
      
      // 누락된 매핑 추가 (다수결)
      for (const [footprint, data] of Object.entries(missingMappings)) {
        const entries = Object.entries(data.counts);
        if (entries.length === 1) {
          // 하나의 품명만 있으면 바로 추가
          const answerPartName = entries[0][0];
          const count = entries[0][1];
          if (!LearningData.partNameMapping[footprint]) {
            console.log(`   ➕ 매핑 추가: ${footprint} → ${answerPartName} (${count}건)`);
            LearningData.partNameMapping[footprint] = answerPartName;
            fixedCount++;
          }
        } else if (entries.length > 1) {
          // 여러 품명 - 충돌! Part|Footprint 조합으로 처리
          // 수동 작성 목록에 있으면 로그 숨김
          const isManual = LearningData.manualInputRequired.some(m => {
            const [, mFp] = m.split('|');
            return mFp && footprint.toUpperCase() === mFp.toUpperCase();
          });
          if (!isManual) {
            console.log(`   ⚠️ ${footprint} 충돌 발견: ${entries.map(e => `${e[0]}(${e[1]})`).join(', ')}`);
          }
          
          // 충돌 목록에 추가
          if (!LearningData.partNameConflicts) {
            LearningData.partNameConflicts = {};
          }
          if (!LearningData.partNameConflicts[footprint]) {
            LearningData.partNameConflicts[footprint] = new Set();
          }
          entries.forEach(e => LearningData.partNameConflicts[footprint].add(e[0]));
          
          // footprint 단독 매핑 제거
          delete LearningData.partNameMapping[footprint];
        }
      }
    }
    
    // 수정된 학습 데이터 저장
    if (fixedCount > 0) {
      console.log(`\n💾 ${fixedCount}건 수정 완료, 학습 데이터 저장...`);
      LearningData.save();
    } else {
      console.log(`\n⚪ 자동 수정 가능한 항목 없음`);
    }
    
    return fixedCount;
  },
  
  async run() {
    await this.initialize();
    await this.parseAllFiles();
    
    // Round 1: 파싱 → 학습 → 검증
    await this.runLearning();
    let allMatch = await this.runValidation();
    
    if (allMatch) {
      console.log(`\n🎉 Round ${this.round}에서 100% 일치 달성!`);
    } else {
      // Round 2+: 불일치 분석 → 매핑 수정 → 재검증
      while (this.round < CONFIG.maxRounds && !allMatch) {
        // 불일치 분석 및 자동 수정
        const fixedCount = await this.analyzeAndFixMismatches();
        
        if (fixedCount === 0) {
          console.log(`\n⚠️ 더 이상 자동 수정 가능한 항목이 없습니다.`);
          break;
        }
        
        // 다음 라운드
        this.round++;
        allMatch = await this.runValidation();
        
        if (allMatch) {
          console.log(`\n🎉 Round ${this.round}에서 100% 일치 달성!`);
          break;
        }
      }
    }
    
    if (!allMatch) {
      console.log(`\n⚠️ ${this.round} 라운드 후 100% 미달성`);
      
      // 최종 불일치 보고
      console.log('\n📋 최종 불일치 목록:');
      for (const log of this.results) {
        const issues = [];
        if (log.type.status === 'mismatch') issues.push(`종류 ${log.type.matchRate}%`);
        if (log.partName.status === 'mismatch') issues.push(`품명 ${log.partName.matchRate}%`);
        if (log.ref.status === 'mismatch') issues.push(`Ref ${log.ref.matchRate}%`);
        if (log.coord.status === 'mismatch') issues.push(`좌표 ${log.coord.matchRate}%`);
        
        if (issues.length > 0) {
          console.log(`   ❌ ${log.name}: ${issues.join(', ')}`);
        }
      }
    }
    
    console.log('\n✅ 엔진 종료');
  },
};

// ============================================================
// 실행
// ============================================================
Engine.run().catch(console.error);
