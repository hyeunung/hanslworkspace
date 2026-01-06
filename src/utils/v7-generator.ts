/**
 * BOM 좌표 자동 정리 엔진 v7 (웹 버전)
 * 
 * v7-engine.js의 학습 데이터를 활용하여
 * BOM, 좌표 원본 파일 → 정리본 데이터 생성
 */

import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// 타입 정의
// ============================================================

export interface BOMItem {
  lineNumber: number;
  itemType: string;           // 종류
  itemName: string;           // 품명
  setCount: number;           // SET
  totalQuantity: number;      // 수량
  stockQuantity?: number;     // 재고
  checkStatus: string;        // CHECK
  refList: string;            // Ref
  alternativeItem?: string;   // 대체가능품목
  remark: string;             // 비고
  // 상태 플래그
  isManualRequired: boolean;  // 수동 확인 필요
  isNewPart: boolean;         // 새로운 부품 (미등록)
  originalPart?: string;      // 원본 Part
  originalFootprint?: string; // 원본 Footprint
}

export interface CoordinateItem {
  type: string;       // Type (종류)
  partName: string;   // 품명
  refDes: string;     // RefDes
  layer: string;      // Layer (TOP/BOTTOM)
  locationX: number;  // LocationX
  locationY: number;  // LocationY
  rotation: number;   // Rotation
  remark?: string;    // 비고 (미삽 등)
}

export interface ProcessedResult {
  bomItems: BOMItem[];
  topCoordinates: CoordinateItem[];
  bottomCoordinates: CoordinateItem[];
  summary: {
    totalItems: number;
    manualRequiredCount: number;
    newPartCount: number;
    misapCount: number;
  };
}

export interface LearningDataType {
  typeMapping: Record<string, string>;      // 품명 → 종류
  partNameMapping: Record<string, string>;  // footprint → 품명
  partNameConflicts: Record<string, string[]>;
  typeSortOrder: string[];
  misapKeywords: string[];
  manualInputRequired: string[];
}

// ============================================================
// 학습 데이터 캐시
// ============================================================

let learningDataCache: LearningDataType | null = null;

// 수동 작성 필요 조합 (10V/16V/50V 충돌)
const MANUAL_INPUT_REQUIRED = [
  '1u/1005|C1UF_1005',
  '10u/1005|C10UF_1005',
  '1u/1608|C1UF_1608',
  '0.01u/1005|C0.01UF_1005',
  '0.1u/1005|C0.1UF_1005',
  '10uf/1608|C10UF_1608',
  '10pf/1005|C10PF_1005',
  '10nf/1005|C10NF_1005',
  '220pf/1005|C220PF_1005',
  '47u/2012|C47UF_16V_2012',
  '2.2u/1005|C2.2UF_16V_1005',
  '0.001u/1005|C0.001UF_1005',
  '4.7u/1005|C4.7UF_1005',
  '|R1K_1005_0.1%',
];

// 고정 매핑 (다수결로 결정된 항목들)
const FIXED_MAPPINGS: Record<string, string> = {
  'FI-RE41S-HF': 'FI-RE41S-HF-R1500',
  'FI-RE51S-HF': 'FI-RE51S-HF-R1500',
  '24LC256ISN': '24LC256-I/SN',
  'TLP3107': 'TLP3107',
  'AD5175BRMZ-10-RL7': 'AD5175BRMZ-10-RL7',
  'AD5175BCPZ-10-RL7': 'AD5175BCPZ-10-RL7',
  'ADS7828E_250': 'ADS7828E/250',
  'TPD2EUSB30DRTR_OPEN': 'TPD2EUSB30DRTR_OPEN',
  'TPD2EUSB30DRTR': 'TPD2EUSB30DRTR',
  'C10PF_50V_1005_OPEN': 'C10pF/50V_1005_OPEN',
  'C10PF_1005_OPEN': 'C10PF/10V_1005_OPEN',
  'R0_1005_OPEN': 'R0_1005_OPEN',
  'C0.1UF_16V_1005_OPEN': 'C0.1uF/16V_1005_OPEN',
  'W25Q16JVSSIQ_OPEN': 'W25Q16JVSSIQ_OPEN',
  'R1K_1005_OPEN_1903': 'R1K_1005_OPEN',
  'R10K_1005_OPEN_1903': 'R10K_1005_OPEN',
  'R10K_1005_OPEN': 'R10K_1005_OPEN',
  'R4.7K_1005': 'R4.7K_1005_1%',
  'R10_1005': 'R10_1005_1%',
  'R15_1005': 'R15_1005_1%',
  'MAX3373EEKA+T_NEW': 'MAX3373EEKA+T',
  'C0.1UF_16V_1005': 'C0.1uF/16V_1005',
  'T47UF_16V-B': 'T47uF/16V "B"',
  'SN65DP141RLJR_R-PWQFN-N38_RLJ': 'SN65DP141RLJR',
  'TSM6963SD_TSSOP-8': 'TSM6963SD',
  'SW-DJMM-12V': 'SW-DJMM-12V',
  'BOI_C70_CUBE_Z-CAL_POGO': 'BOI_C70_CUBE_Z-CAL_POGO',
  'MGL_G1_AA_MASTER_SENSOR_POGO': 'B2B',
  'TPD2EUSB30DRTR/OPEN|TPD2EUSB30DRTR': 'TPD2EUSB30DRTR_OPEN',
};

// ============================================================
// 학습 데이터 로드
// ============================================================

export async function loadLearningData(): Promise<LearningDataType> {
  if (learningDataCache) {
    return learningDataCache;
  }

  try {
    console.log('📂 학습 데이터 로드 시작...');
    
    // 1. 정적 JSON 파일 로드
    const [
      typeMappingRes,
      partNameMappingRes,
      partNameConflictsRes,
      typeSortOrderRes,
      misapKeywordsRes,
    ] = await Promise.all([
      fetch('/data/종류_매핑.json'),
      fetch('/data/품명_매핑.json'),
      fetch('/data/품명_충돌목록.json'),
      fetch('/data/종류_정렬순서.json'),
      fetch('/data/미삽항목.json'),
    ]);

    // 응답 체크
    if (!typeMappingRes.ok) throw new Error(`종류_매핑.json 로드 실패: ${typeMappingRes.status}`);
    if (!partNameMappingRes.ok) throw new Error(`품명_매핑.json 로드 실패: ${partNameMappingRes.status}`);
    if (!partNameConflictsRes.ok) throw new Error(`품명_충돌목록.json 로드 실패: ${partNameConflictsRes.status}`);
    if (!typeSortOrderRes.ok) throw new Error(`종류_정렬순서.json 로드 실패: ${typeSortOrderRes.status}`);
    if (!misapKeywordsRes.ok) throw new Error(`미삽항목.json 로드 실패: ${misapKeywordsRes.status}`);

    const typeMapping = await typeMappingRes.json();
    const partNameMapping = await partNameMappingRes.json();
    const partNameConflicts = await partNameConflictsRes.json();
    const typeSortOrder = await typeSortOrderRes.json();
    const misapKeywords = await misapKeywordsRes.json();

    // 고정 매핑 적용 (기존 정적 JSON 데이터 + 고정 매핑)
    let mergedPartNameMapping = { ...partNameMapping, ...FIXED_MAPPINGS };
    let mergedTypeMapping = { ...typeMapping };

    // 2. DB에서 사용자가 수동으로 입력한 학습 데이터 로드 및 병합
    try {
      console.log('📊 DB 학습 데이터 로드 중...');
      const supabase = createClient();
      const { data: learningRecords, error: dbError } = await supabase
        .from('ai_learning_records')
        .select('processed_bom_data')
        .not('processed_bom_data', 'is', null)
        .order('created_at', { ascending: false }); // 최신 데이터 우선

      if (dbError) {
        console.warn('⚠️ DB 학습 데이터 로드 실패 (기본 데이터만 사용):', dbError);
      } else if (learningRecords && learningRecords.length > 0) {
        console.log(`📚 ${learningRecords.length}개의 학습 레코드 발견`);
        
        let dbPartNameCount = 0;
        let dbTypeCount = 0;
        
        // 각 레코드에서 학습 데이터 추출
        for (const record of learningRecords) {
          const bomData = record.processed_bom_data;
          if (!Array.isArray(bomData)) continue;

          for (const item of bomData) {
            // 원본 데이터가 있어야 매핑 가능
            if (!item.originalPart && !item.originalFootprint) continue;
            
            const part = (item.originalPart || '').trim();
            const footprint = (item.originalFootprint || '').trim().toUpperCase();
            const itemName = (item.itemName || '').trim();
            const itemType = (item.itemType || '').trim();

            // 품명 매핑 추가 (Footprint → 품명)
            // 사용자가 수동으로 수정한 데이터는 항상 반영
            if (footprint && itemName && itemName !== '데이터 없음 (수동 확인 필요)') {
              // 사용자가 수정한 경우인지 확인 (footprint와 itemName이 다름)
              const isUserModified = itemName !== footprint && itemName.toUpperCase() !== footprint;
              
              // Part|Footprint 조합으로 저장
              if (part) {
                const combo = `${part}|${footprint}`;
                // 사용자가 수정한 경우는 항상 반영, 아니면 기존 데이터가 없을 때만 추가
                if (isUserModified || !mergedPartNameMapping[combo]) {
                  mergedPartNameMapping[combo] = itemName;
                  dbPartNameCount++;
                }
              }
              
              // Footprint만으로도 저장
              // 사용자가 수정한 경우는 항상 반영, 아니면 기존 데이터가 없을 때만 추가
              if (isUserModified || !mergedPartNameMapping[footprint]) {
                mergedPartNameMapping[footprint] = itemName;
                dbPartNameCount++;
              }
            }

            // 종류 매핑 추가 (품명 → 종류)
            // 기존 정적 JSON에 없거나, DB 데이터가 더 최신이면 추가/업데이트
            if (itemName && itemType && itemType !== '데이터 없음') {
              if (!mergedTypeMapping[itemName] || mergedTypeMapping[itemName] !== itemType) {
                mergedTypeMapping[itemName] = itemType;
                dbTypeCount++;
              }
            }
          }
        }
        
        console.log(`✅ DB 학습 데이터 반영 완료 (품명: +${dbPartNameCount}개, 종류: +${dbTypeCount}개)`);
      }
    } catch (dbLoadError) {
      console.warn('⚠️ DB 학습 데이터 로드 중 오류 (기본 데이터만 사용):', dbLoadError);
    }

    learningDataCache = {
      typeMapping: mergedTypeMapping,
      partNameMapping: mergedPartNameMapping,
      partNameConflicts,
      typeSortOrder,
      misapKeywords,
      manualInputRequired: MANUAL_INPUT_REQUIRED,
    };

    console.log('✅ 학습 데이터 로드 완료');
    return learningDataCache;
  } catch (error) {
    console.error('❌ 학습 데이터 로드 실패:', error);
    throw error;
  }
}

// ============================================================
// 유틸리티 함수
// ============================================================

const Utils = {
  // 품명 정규화 (대소문자, 구분자 통일)
  normalizePartName(partName: string): string {
    if (!partName) return '';
    return partName
      .toLowerCase()
      .replace(/[\/\-_\s]/g, '')
      .replace(/"/g, '')
      .trim();
  },

  // Part|Footprint 조합 정규화
  normalizePartFootprintCombo(part: string, footprint: string): string {
    let normPart = (part || '')
      .toLowerCase()
      .replace(/uf/g, 'u')
      .replace(/pf/g, 'p')
      .replace(/nf/g, 'n')
      .replace(/\s/g, '');
    // Part 앞의 c 접두사 제거
    if (/^c\d/.test(normPart)) {
      normPart = normPart.substring(1);
    }
    const normFp = (footprint || '').toUpperCase();
    return `${normPart}|${normFp}`;
  },

  // 수동 작성 필요 조합인지 체크
  isManualInputRequired(part: string, footprint: string, learningData: LearningDataType): boolean {
    const fpUpper = (footprint || '').toUpperCase();
    
    return learningData.manualInputRequired.some(m => {
      const [mPart, mFp] = m.split('|');
      // Footprint만으로도 체크
      if (mFp && fpUpper === mFp.toUpperCase()) {
        return true;
      }
      const combo = this.normalizePartFootprintCombo(part, footprint);
      const normM = this.normalizePartFootprintCombo(mPart, mFp);
      return combo === normM;
    });
  },

  // 미삽 여부 체크 (footprint와 part 모두 체크)
  isMisap(footprint: string, part: string, learningData: LearningDataType): boolean {
    const footprintUpper = (footprint || '').toUpperCase();
    const partUpper = (part || '').toUpperCase();
    
    // footprint 또는 part에 미삽 키워드가 포함되어 있으면 미삽
    return learningData.misapKeywords.some(kw => 
      footprintUpper.includes(kw) || partUpper.includes(kw)
    );
  },

  // Ref 파싱
  parseRefs(refStr: string): string[] {
    if (!refStr) return [];
    const refs: string[] = [];
    const parts = refStr.split(/[,.\s]+/).map(r => r.trim()).filter(r => r.length > 0);
    
    for (const part of parts) {
      if (/^[-_=]+$/.test(part)) continue;
      
      const rangeMatch = part.match(/^([A-Z]+)(\d+)[-~]([A-Z]*)(\d+)$/i);
      if (rangeMatch) {
        const prefix = rangeMatch[1];
        const start = parseInt(rangeMatch[2]);
        const end = parseInt(rangeMatch[4]);
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
  isTP(ref: string): boolean {
    return /^TP/i.test(ref);
  },

  // 종류 정규화
  normalizeType(typeVal: string): string {
    if (!typeVal) return '';
    const normalized = typeVal.trim();
    
    const typeMapping: Record<string, string> = {
      'TP/DIP': 'TEST POINT/DIP',
      'TP/SMD': 'TEST POINT/SMD',
      'SENSOR': 'SENSOR(SMD)',
      'PEM NUT': 'PEMNUT',
      'BEAD(012)': 'BEAD(2012)',
      'TEST POINT': 'TEST POINT/SMD',
      'CONNECTGOR': 'CONNECTOR',
      'CONNECTO4R': 'CONNECTOR',
      'CONNECTROR': 'CONNECTOR',
      'DIOODE(SMD)': 'DIODE(SMD)',
      'X-TAL': 'X-TAL(SMD)',
    };
    
    return typeMapping[normalized] || normalized;
  },
};

// ============================================================
// BOM 파싱
// ============================================================

interface ParsedBOMItem {
  quantity: number;
  refs: string[];
  part: string;
  footprint: string;
}

async function parseBOMFile(file: File): Promise<ParsedBOMItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  
  const items: ParsedBOMItem[] = [];
  
  // 헤더 찾기
  let headerRow = -1;
  let colMap = { item: 0, ref: 1, qty: 2, part: 3, footprint: -1 };
  const refKeywords = ['reference', 'references', 'ref', 'designator'];
  const partKeywords = ['part', 'part number'];
  const footprintKeywords = ['pcb footprint', 'footprint', 'partnumber'];
  
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const row = rows[r];
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
  
  // 2차: 헤더를 못 찾았거나 REF 칼럼을 명확히 못 찾은 경우, 데이터 패턴으로 판별
  let refColumnFoundByKeyword = headerRow !== -1;
  
  if (headerRow === -1) {
    console.warn('헤더를 찾을 수 없습니다. 데이터 패턴으로 REF 칼럼 탐색...');
    headerRow = 0; // 첫 행부터 데이터로 간주
    refColumnFoundByKeyword = false;
  }
  
  // REF 패턴: 알파벳 1~3자 + 숫자 (예: R1, C2, U3, IC1, JP1 등)
  // 또는 쉼표/공백으로 구분된 여러 REF (예: R1, R2, R3)
  // 또는 범위 표현 (예: R1~R10, C1-C5)
  const isRefPattern = (value: string): boolean => {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    
    // 단일 REF 패턴: A1, R12, IC3, JP1 등
    const singleRefPattern = /^[A-Z]{1,3}\d+$/i;
    // 여러 REF 패턴: R1, R2, R3 또는 R1 R2 R3
    const multiRefPattern = /^[A-Z]{1,3}\d+([,.\s]+[A-Z]{1,3}\d+)*$/i;
    // 범위 REF 패턴: R1~R10, C1-C5
    const rangeRefPattern = /^[A-Z]{1,3}\d+[-~][A-Z]*\d+$/i;
    
    return singleRefPattern.test(trimmed) || multiRefPattern.test(trimmed) || rangeRefPattern.test(trimmed);
  };
  
  // REF 칼럼을 키워드로 못 찾았으면 데이터 패턴으로 탐색
  if (!refColumnFoundByKeyword || colMap.ref === 1) { // 기본값이면 패턴 분석 시도
    const sampleRows = rows.slice(headerRow + 1, Math.min(headerRow + 20, rows.length));
    const colScores: number[] = [];
    
    // 각 칼럼별로 REF 패턴 매칭 점수 계산
    const maxCols = Math.max(...sampleRows.map(r => (r ? r.length : 0)));
    for (let col = 0; col < maxCols; col++) {
      let matchCount = 0;
      let totalCount = 0;
      
      for (const row of sampleRows) {
        if (!row || col >= row.length) continue;
        const cellValue = String(row[col] || '').trim();
        if (!cellValue) continue;
        
        totalCount++;
        if (isRefPattern(cellValue)) {
          matchCount++;
        }
      }
      
      // 매칭 비율 계산 (최소 3개 이상 데이터가 있어야 유효)
      const score = totalCount >= 3 ? matchCount / totalCount : 0;
      colScores.push(score);
    }
    
    // 가장 높은 점수의 칼럼을 REF로 설정 (60% 이상 매칭 시)
    const maxScore = Math.max(...colScores);
    if (maxScore >= 0.6) {
      const bestRefCol = colScores.indexOf(maxScore);
      console.log(`📊 데이터 패턴 분석: 칼럼 ${bestRefCol}을(를) REF로 판별 (매칭률: ${(maxScore * 100).toFixed(1)}%)`);
      colMap.ref = bestRefCol;
    } else {
      console.warn('📊 데이터 패턴으로도 REF 칼럼을 찾지 못함. 기본값(1) 사용.');
    }
  }
  
  let currentItem: ParsedBOMItem | null = null;
  
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
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
        refs,
        part,
        footprint: footprint || part,
      };
    } else if (currentItem && reference) {
      const additionalRefs = Utils.parseRefs(reference).filter(ref => !Utils.isTP(ref));
      currentItem.refs.push(...additionalRefs);
    }
  }
  
  if (currentItem && currentItem.refs.length > 0) {
    items.push(currentItem);
  }
  
  return items;
}

// ============================================================
// 좌표 파싱
// ============================================================

interface ParsedCoordItem {
  ref: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
}

async function parseCoordinateFile(file: File): Promise<ParsedCoordItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const items: ParsedCoordItem[] = [];
  
  if (file.name.endsWith('.txt')) {
    // 텍스트 파일 파싱
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    const lines = text.split('\n');
    
    let headerFound = false;
    let colMap = { ref: 0, x: 1, y: 2, rotation: 3, layer: 4 };
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // 헤더 찾기
      if (!headerFound) {
        const lower = trimmed.toLowerCase();
        if (lower.includes('refdes') || lower.includes('ref') || lower.includes('designator')) {
          headerFound = true;
          // 탭 또는 공백으로 분리
          const cols = trimmed.split(/\t|\s{2,}/).map(c => c.trim().replace(/"/g, ''));
          console.log('📍 좌표 헤더 발견:', cols);
          
          cols.forEach((col, idx) => {
            const colLower = col.toLowerCase();
            if (colLower.includes('ref') || colLower.includes('designator')) {
              colMap.ref = idx;
              console.log(`  - Ref 컬럼: ${idx} (${col})`);
            }
            if (colLower.includes('locationx') || colLower === 'x' || (colLower === 'x' && idx === 1)) {
              colMap.x = idx;
              console.log(`  - X 컬럼: ${idx} (${col})`);
            }
            if (colLower.includes('locationy') || colLower === 'y' || (colLower === 'y' && idx === 2)) {
              colMap.y = idx;
              console.log(`  - Y 컬럼: ${idx} (${col})`);
            }
            if (colLower.includes('rotation') || colLower.includes('angle') || colLower.includes('rot')) {
              colMap.rotation = idx;
              console.log(`  - Rotation 컬럼: ${idx} (${col})`);
            }
            if (colLower.includes('layer') || colLower.includes('side')) {
              colMap.layer = idx;
              console.log(`  - Layer 컬럼: ${idx} (${col})`);
            }
          });
          
          console.log('📍 최종 컬럼 매핑:', colMap);
          continue;
        }
        continue;
      }
      
      // 데이터 행 파싱
      // 탭 또는 공백으로 분리 (큰 공백 우선)
      const cols = trimmed.split(/\t|\s{2,}/).map(c => c.trim().replace(/"/g, ''));
      if (cols.length < 3) continue;
      
      const ref = (cols[colMap.ref] || '').trim().toUpperCase().replace(/"/g, '');
      if (!ref || Utils.isTP(ref) || /^\d+$/.test(ref)) continue; // 숫자만 있는 REF 제외
      
      const x = parseFloat(cols[colMap.x] || '0');
      const y = parseFloat(cols[colMap.y] || '0');
      const rotation = parseFloat(cols[colMap.rotation] || '0');
      const layerStr = (cols[colMap.layer] || '').toUpperCase().replace(/"/g, '');
      const layer = layerStr.includes('BOT') ? 'BOTTOM' : 'TOP';
      
      items.push({
        ref,
        x,
        y,
        rotation,
        layer,
      });
    }
    
    console.log(`📍 파싱된 좌표: ${items.length}개`);
    if (items.length > 0) {
      console.log('📍 첫 번째 좌표 샘플:', items[0]);
    }
  } else {
    // 엑셀 파일 파싱
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    
    let headerRow = -1;
    let colMap = { ref: 0, x: 3, y: 4, rotation: 5, layer: 2 };
    
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r];
      if (!row) continue;
      
      const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
      if (rowStr.includes('ref') || rowStr.includes('designator')) {
        headerRow = r;
        row.forEach((cell, idx) => {
          const val = String(cell || '').toLowerCase().trim();
          if (val.includes('ref') || val.includes('designator')) colMap.ref = idx;
          if (val.includes('locationx') || val === 'x') colMap.x = idx;
          if (val.includes('locationy') || val === 'y') colMap.y = idx;
          if (val.includes('rotation') || val.includes('angle')) colMap.rotation = idx;
          if (val.includes('layer') || val.includes('side')) colMap.layer = idx;
        });
        break;
      }
    }
    
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      
      const ref = String(row[colMap.ref] || '').trim().toUpperCase();
      if (!ref || Utils.isTP(ref) || /^\d+$/.test(ref)) continue; // 숫자만 있는 REF 제외
      
      items.push({
        ref,
        x: parseFloat(String(row[colMap.x])) || 0,
        y: parseFloat(String(row[colMap.y])) || 0,
        rotation: parseFloat(String(row[colMap.rotation])) || 0,
        layer: String(row[colMap.layer] || '').toUpperCase().includes('BOT') ? 'BOTTOM' : 'TOP',
      });
    }
  }
  
  return items;
}

// ============================================================
// 매핑 적용
// ============================================================

function mapPartName(
  part: string, 
  footprint: string, 
  learningData: LearningDataType
): { partName: string; isNew: boolean } {
  const fpUpper = footprint.toUpperCase();
  
  // 1. Part|Footprint 조합으로 먼저 체크
  const combo = `${part}|${footprint}`;
  if (learningData.partNameMapping[combo]) {
    return { partName: learningData.partNameMapping[combo], isNew: false };
  }
  
  // 2. Footprint만으로 체크
  if (learningData.partNameMapping[fpUpper]) {
    return { partName: learningData.partNameMapping[fpUpper], isNew: false };
  }
  if (learningData.partNameMapping[footprint]) {
    return { partName: learningData.partNameMapping[footprint], isNew: false };
  }
  
  // 3. Part 이름으로 체크
  if (learningData.partNameMapping[part]) {
    return { partName: learningData.partNameMapping[part], isNew: false };
  }
  
  // 4. 미등록 부품
  return { partName: footprint || part, isNew: true };
}

function mapType(partName: string, learningData: LearningDataType): string {
  // 정규화된 품명으로 종류 찾기
  if (learningData.typeMapping[partName]) {
    return learningData.typeMapping[partName];
  }
  
  // 정규화해서 다시 시도
  const normalized = Utils.normalizePartName(partName);
  for (const [key, value] of Object.entries(learningData.typeMapping)) {
    if (Utils.normalizePartName(key) === normalized) {
      return value;
    }
  }
  
  return '';  // 데이터 없음
}

// Footprint에서 종류 찾기 (품명 충돌이어도 종류는 같으니까!)
function mapTypeFromFootprint(part: string, footprint: string, learningData: LearningDataType): string {
  const fpUpper = footprint.toUpperCase();
  
  // 1. Part|Footprint 조합으로 품명 찾기
  const combo = `${part}|${footprint}`;
  if (learningData.partNameMapping[combo]) {
    const mappedPartName = learningData.partNameMapping[combo];
    const type = mapType(mappedPartName, learningData);
    if (type) return type;
  }
  
  // 2. Footprint만으로 품명 찾기
  const footprintKeys = [fpUpper, footprint];
  for (const key of footprintKeys) {
    if (learningData.partNameMapping[key]) {
      const mappedPartName = learningData.partNameMapping[key];
      const type = mapType(mappedPartName, learningData);
      if (type) return type;
    }
  }
  
  // 3. Part로 품명 찾기
  if (learningData.partNameMapping[part]) {
    const mappedPartName = learningData.partNameMapping[part];
    const type = mapType(mappedPartName, learningData);
    if (type) return type;
  }
  
  // 4. 품명 매핑의 모든 키 중에 footprint 패턴이 포함된 것 찾기
  for (const [key, mappedPartName] of Object.entries(learningData.partNameMapping)) {
    if (key.toUpperCase().includes(fpUpper) || fpUpper.includes(key.toUpperCase())) {
      const type = mapType(mappedPartName, learningData);
      if (type) return type;
    }
  }
  
  return '';  // 못 찾음
}

// ============================================================
// 메인 처리 함수
// ============================================================

export async function processBOMAndCoordinates(
  bomFile: File,
  coordFile: File,
  productionQuantity: number
): Promise<ProcessedResult> {
  console.log('🚀 BOM/좌표 처리 시작...');
  
  // 1. 학습 데이터 로드
  const learningData = await loadLearningData();
  
  // 2. 파일 파싱
  const parsedBOM = await parseBOMFile(bomFile);
  const parsedCoord = await parseCoordinateFile(coordFile);

  // Ref를 대문자로 정규화해 매핑 실패 방지
  parsedBOM.forEach(item => {
    item.refs = item.refs.map(ref => ref.toUpperCase());
  });
  const normalizedCoord = parsedCoord.map(coord => ({
    ...coord,
    ref: coord.ref.toUpperCase(),
  }));
  
  console.log(`📄 BOM 항목: ${parsedBOM.length}개`);
  console.log(`📍 좌표 항목: ${normalizedCoord.length}개`);
  
  // 3. Ref → 좌표 맵 생성
  const coordMap = new Map<string, ParsedCoordItem>();
  for (const coord of normalizedCoord) {
    coordMap.set(coord.ref, coord);
  }
  
  // 4. BOM 처리 및 매핑
  const bomItems: BOMItem[] = [];
  const topCoordinates: CoordinateItem[] = [];
  const bottomCoordinates: CoordinateItem[] = [];
  
  let manualRequiredCount = 0;
  let newPartCount = 0;
  let misapCount = 0;
  
  let lineNumber = 1;
  
  for (const item of parsedBOM) {
    // 수동 확인 필요 여부
    const isManualRequired = Utils.isManualInputRequired(item.part, item.footprint, learningData);
    
    // 품명 매핑
    let mappedPartName: string;
    let isNewPart = false;
    
    if (isManualRequired) {
      mappedPartName = '데이터 없음 (수동 확인 필요)';
      manualRequiredCount++;
    } else {
      const mapping = mapPartName(item.part, item.footprint, learningData);
      mappedPartName = mapping.partName;
      isNewPart = mapping.isNew;
      if (isNewPart) {
        newPartCount++;
      }
    }
    
    // 종류 매핑
    let itemType = mapType(mappedPartName, learningData);
    if (!itemType && !isManualRequired && !isNewPart) {
      // 종류도 못 찾으면 새 부품으로 처리
      isNewPart = true;
      newPartCount++;
    }
    
    // 미삽 여부 (footprint와 part 모두 체크)
    const isMisap = Utils.isMisap(item.footprint, item.part, learningData);
    if (isMisap) {
      misapCount++;
    }
    
    // Footprint/Part에서 종류 추출 (학습 데이터와 무관하게)
    const extractTypeFromFootprint = (part: string, footprint: string, refs: string[]): string => {
      const fp = footprint.toUpperCase();
      const pt = part.toUpperCase();
      const firstRef = (refs[0] || '').toUpperCase();
      const refPrefix = firstRef.replace(/\d+/g, '');
      
      // 사이즈 추출
      let size = '1005'; // 기본값
      if (fp.includes('0603') || pt.includes('0603')) size = '0603';
      else if (fp.includes('1005') || pt.includes('1005')) size = '1005';
      else if (fp.includes('1608') || pt.includes('1608')) size = '1608';
      else if (fp.includes('2012') || pt.includes('2012')) size = '2012';
      else if (fp.includes('3225') || pt.includes('3225')) size = '3225';
      
      // 1. Footprint/Part 패턴으로 먼저 판단
      // 커패시터: C로 시작하거나 UF, PF, NF 포함
      if (/^C\d/.test(pt) || /^C[_-]/.test(pt) || pt.includes('UF') || pt.includes('PF') || pt.includes('NF')) {
        return `C/C(${size})`;
      }
      // 저항: R로 시작하거나 OHM, K_숫자 패턴
      if (/^R\d/.test(pt) || /^R[_-]/.test(pt) || pt.includes('OHM') || /R\d+K/.test(pt)) {
        return `저항(${size})`;
      }
      // IC
      if (pt.includes('IC') || pt.includes('MAX') || pt.includes('LM') || pt.includes('TPS') || 
          pt.includes('STM') || pt.includes('AD5') || pt.includes('ADS') || pt.includes('PCA') ||
          pt.includes('TCA') || pt.includes('SN6') || pt.includes('SN7')) {
        return 'IC(SMD)';
      }
      // 트랜지스터
      if (pt.includes('DMN') || pt.includes('MOSFET') || pt.includes('2N') || /^Q\d/.test(refPrefix)) {
        return 'TR(SMD)';
      }
      // 다이오드
      if (pt.includes('DIODE') || pt.includes('1N') || pt.includes('BAT') || pt.includes('D5V') || pt.includes('D10V') || pt.includes('TPD')) {
        return 'DIODE(SMD)';
      }
      // 비드
      if (pt.includes('BEAD') || pt.includes('BLM') || pt.includes('FB')) {
        return 'BEAD(2012)';
      }
      // 커넥터
      if (pt.includes('CONN') || pt.includes('B2B') || pt.includes('HEADER') || pt.includes('POGO') || 
          pt.includes('PIN') || fp.includes('CONN') || /^\d{5}/.test(pt)) {
        return 'CONNECTOR';
      }
      // LED
      if (pt.includes('LED')) {
        return 'LED(1608)';
      }
      // OSC
      if (pt.includes('OSC') || pt.includes('XTAL') || pt.includes('CRYSTAL')) {
        return 'OSC(SMD)';
      }
      // 스위치
      if (pt.includes('SW') || pt.includes('SWITCH')) {
        return 'S/W(DIP)';
      }
      // T/T (탄탈)
      if (pt.includes('TANT') || pt.includes('T/T')) {
        return 'T/T';
      }
      
      // 2. REF 접두어로 판단 (fallback)
      if (refPrefix === 'C') return `C/C(${size})`;
      if (refPrefix === 'R') return `저항(${size})`;
      if (refPrefix === 'U') return 'IC(SMD)';
      if (refPrefix === 'Q') return 'TR(SMD)';
      if (refPrefix === 'D') return 'DIODE(SMD)';
      if (refPrefix === 'L' || refPrefix === 'FB' || refPrefix === 'BD') return 'BEAD(2012)';
      if (refPrefix === 'LED') return 'LED(1608)';
      if (refPrefix === 'J' || refPrefix === 'CN' || refPrefix === 'CON') return 'CONNECTOR';
      if (refPrefix === 'SW') return 'S/W(DIP)';
      if (refPrefix === 'Y' || refPrefix === 'X') return 'OSC(SMD)';
      
      return '데이터 없음';
    };
    
    // 종류 결정: 1순위 학습데이터, 2순위 footprint 패턴 추출
    let finalItemType: string;
    if (!isManualRequired && !isNewPart && itemType) {
      // 정상 매핑된 경우
      finalItemType = Utils.normalizeType(itemType);
    } else {
      // 수동확인/새부품이어도 종류는 학습 데이터에서 찾기!
      const typeFromLearning = mapTypeFromFootprint(item.part, item.footprint, learningData);
      if (typeFromLearning) {
        finalItemType = Utils.normalizeType(typeFromLearning);
      } else {
        // 학습 데이터에도 없으면 패턴으로 추출
        finalItemType = extractTypeFromFootprint(item.part, item.footprint, item.refs);
      }
    }
    
    // BOM 아이템 생성
    const bomItem: BOMItem = {
      lineNumber,
      itemType: finalItemType,
      itemName: mappedPartName,
      setCount: item.refs.length,
      totalQuantity: item.refs.length * productionQuantity,
      checkStatus: '□양호',
      refList: item.refs.join(', '),
      remark: isMisap ? '미삽' : '',
      isManualRequired,
      isNewPart,
      originalPart: item.part,
      originalFootprint: item.footprint,
    };
    
    bomItems.push(bomItem);
    lineNumber++;
    
    // 좌표 처리
    for (const ref of item.refs) {
      const normRef = ref.toUpperCase();
      const coord = coordMap.get(normRef);
      if (!coord) continue;
      
      const coordItem: CoordinateItem = {
        type: bomItem.itemType,
        partName: bomItem.itemName,
        refDes: ref,
        layer: coord.layer,
        locationX: coord.x,
        locationY: coord.y,
        rotation: coord.rotation,
        remark: isMisap ? '미삽' : undefined,
      };
      
      if (coord.layer === 'TOP') {
        topCoordinates.push(coordItem);
      } else {
        bottomCoordinates.push(coordItem);
      }

      // 매칭된 좌표는 제거하여 나중에 좌표만 존재하는 항목을 분리 처리
      coordMap.delete(normRef);
    }
  }

  // 4-1. BOM에 없는 좌표만 존재하는 REF를 좌표 리스트에 추가
  coordMap.forEach((coord) => {
    const coordItem: CoordinateItem = {
      type: '좌표만 존재',
      partName: 'BOM 없음',
      refDes: coord.ref,
      layer: coord.layer,
      locationX: coord.x,
      locationY: coord.y,
      rotation: coord.rotation,
      remark: 'BOM 미존재',
    };

    if (coord.layer === 'TOP') {
      topCoordinates.push(coordItem);
    } else {
      bottomCoordinates.push(coordItem);
    }
  });
  
  // 5. 종류별 정렬 (대분류 기준으로 그룹핑)
  // 대분류 순서 (세부 사이즈 무시하고 같은 그룹으로 묶음)
  const TYPE_GROUP_ORDER = [
    'IC',       // IC(SMD)
    'SENSOR',   // SENSOR(SMD)
    'TR',       // TR(SMD)
    'DIODE',    // DIODE(SMD)
    'T/T',      // T/T (탄탈)
    'C/C',      // C/C(0603), C/C(1005), C/C(1608), C/C(2012), C/C(3225)
    '저항',     // 저항(1005), 저항(1608), 저항(2012)
    'BEAD',     // BEAD(2012)
    'OSC',      // OSC(SMD)
    'LED',      // LED(1608)
    'S/W',      // S/W(DIP)
    'CONNECTOR',// CONNECTOR
    'PEMNUT',   // PEMNUT
  ];
  
  // 종류에서 대분류 추출
  const getTypeGroup = (itemType: string): string => {
    if (!itemType || itemType === '데이터 없음') return '';
    if (itemType.startsWith('IC')) return 'IC';
    if (itemType.startsWith('SENSOR')) return 'SENSOR';
    if (itemType.startsWith('TR')) return 'TR';
    if (itemType.startsWith('DIODE')) return 'DIODE';
    if (itemType.startsWith('T/T')) return 'T/T';
    if (itemType.startsWith('C/C')) return 'C/C';
    if (itemType.startsWith('저항')) return '저항';
    if (itemType.startsWith('BEAD')) return 'BEAD';
    if (itemType.startsWith('OSC')) return 'OSC';
    if (itemType.startsWith('LED')) return 'LED';
    if (itemType.startsWith('S/W')) return 'S/W';
    if (itemType === 'CONNECTOR') return 'CONNECTOR';
    if (itemType === 'PEMNUT') return 'PEMNUT';
    return itemType;
  };
  
  // 원본 데이터로 대분류 추측
  const guessTypeGroupForSort = (item: BOMItem): string => {
    // 이미 종류가 있으면 대분류 추출
    if (item.itemType && item.itemType !== '데이터 없음') {
      return getTypeGroup(item.itemType);
    }
    
    // REF에서 첫 글자로 대분류 추측 (C1 → C, R10 → R)
    const firstRef = (item.refList || '').split(',')[0].trim().toUpperCase();
    const refPrefix = firstRef.replace(/\d+/g, ''); // 숫자 제거하여 접두어만
    
    // REF 접두어로 분류
    if (refPrefix === 'C') return 'C/C';
    if (refPrefix === 'R') return '저항';
    if (refPrefix === 'U') return 'IC';
    if (refPrefix === 'Q') return 'TR';
    if (refPrefix === 'D') return 'DIODE';
    if (refPrefix === 'L' || refPrefix === 'FB' || refPrefix === 'BD') return 'BEAD';
    if (refPrefix === 'LED') return 'LED';
    if (refPrefix === 'J' || refPrefix === 'CN' || refPrefix === 'CON') return 'CONNECTOR';
    if (refPrefix === 'SW') return 'S/W';
    if (refPrefix === 'Y' || refPrefix === 'X') return 'OSC';
    
    // 원본 데이터로 대분류 추측
    const part = (item.originalPart || item.itemName || '').toUpperCase();
    const footprint = (item.originalFootprint || '').toUpperCase();
    
    // 커패시터 (C로 시작)
    if (/^C\d/.test(part) || /^C[_-]/.test(part) || part.startsWith('CC') || 
        part.includes('PF') || part.includes('UF') || part.includes('NF')) {
      return 'C/C';
    }
    
    // 저항 (R로 시작)
    if (/^R\d/.test(part) || /^R[_-]/.test(part) || part.includes('OHM') || /^\d+[KMR]$/.test(part)) {
      return '저항';
    }
    
    // IC
    if (/^U\d/.test(part) || part.includes('IC') || part.includes('MAX') || part.includes('LM') || 
        part.includes('TPS') || part.includes('STM') || part.includes('MC')) {
      return 'IC';
    }
    
    // 트랜지스터
    if (/^Q\d/.test(part) || part.includes('TR') || part.includes('MOSFET') || part.includes('2N')) {
      return 'TR';
    }
    
    // 다이오드
    if (/^D\d/.test(part) || part.includes('DIODE') || part.includes('1N') || part.includes('BAT')) {
      return 'DIODE';
    }
    
    // LED
    if (part.includes('LED')) {
      return 'LED';
    }
    
    // 센서
    if (part.includes('SENSOR')) {
      return 'SENSOR';
    }
    
    // 비드
    if (part.includes('BEAD') || part.includes('FB')) {
      return 'BEAD';
    }
    
    // 커넥터
    if (part.includes('CONN') || part.includes('B2B') || part.includes('HEADER') || 
        part.includes('USB') || part.includes('PIN') || /^J\d/.test(part)) {
      return 'CONNECTOR';
    }
    
    // 스위치
    if (part.includes('SW') || part.includes('SWITCH') || part.includes('BTN')) {
      return 'S/W';
    }
    
    // 오실레이터/크리스탈
    if (part.includes('OSC') || part.includes('XTAL') || part.includes('CRYSTAL')) {
      return 'OSC';
    }
    
    // 탄탈 커패시터
    if (part.includes('T/T') || part.includes('TANT')) {
      return 'T/T';
    }
    
    // 추측 불가 - 커넥터 앞에 배치
    return 'CONNECTOR';
  };
  
  // 미삽 여부 체크 함수
  const checkIsMisap = (itemName: string, remark: string) => {
    const nameUpper = (itemName || '').toUpperCase();
    const remarkUpper = (remark || '').toUpperCase();
    const result = remarkUpper.includes('미삽') || 
      nameUpper.includes('_OPEN') || nameUpper.includes('OPEN_') ||
      nameUpper.includes('_POGO') || nameUpper.includes('POGO_') ||
      nameUpper.includes('_PAD') || nameUpper.includes('PAD_') ||
      nameUpper.includes('_NC') || nameUpper.includes('NC_');
    return result;
  };
  
  bomItems.sort((a, b) => {
    const groupA = guessTypeGroupForSort(a);
    const groupB = guessTypeGroupForSort(b);
    
    const orderA = TYPE_GROUP_ORDER.indexOf(groupA);
    const orderB = TYPE_GROUP_ORDER.indexOf(groupB);
    
    // 대분류 순서에 없으면 맨 뒤로
    const idxA = orderA === -1 ? 999 : orderA;
    const idxB = orderB === -1 ? 999 : orderB;
    
    if (idxA !== idxB) return idxA - idxB;
    
    // 같은 대분류면 세부 종류순 (C/C(0603) < C/C(1005) < ...)
    if (a.itemType !== b.itemType) {
      return (a.itemType || '').localeCompare(b.itemType || '');
    }
    
    // 같은 종류 내에서 미삽 항목은 맨 아래로
    const aMisap = checkIsMisap(a.itemName, a.remark);
    const bMisap = checkIsMisap(b.itemName, b.remark);
    if (aMisap !== bMisap) {
      return aMisap ? 1 : -1; // 미삽이면 뒤로
    }
    
    // 같은 종류, 같은 미삽 상태면 품명순
    return (a.itemName || '').localeCompare(b.itemName || '');
  });
  
  // 정렬 후 lineNumber 재할당
  bomItems.forEach((item, idx) => {
    item.lineNumber = idx + 1;
  });
  
  // 좌표 데이터도 동일한 정렬 로직 적용
  const sortCoordinates = (coords: CoordinateItem[]) => {
    return coords.sort((a, b) => {
      // type 기준으로 대분류 그룹 결정
      const getGroup = (type: string) => {
        const t = (type || '').toUpperCase();
        if (t.includes('IC')) return 'IC';
        if (t.includes('DIODE')) return 'DIODE';
        if (t.includes('C/C') || t.includes('C_C')) return 'C/C';
        if (t.includes('저항')) return '저항';
        if (t.includes('BEAD')) return 'BEAD';
        if (t.includes('S/W') || t.includes('SW')) return 'S/W';
        if (t.includes('CONNECTOR') || t.includes('CONN')) return 'CONNECTOR';
        return 'ETC';
      };
      
      const groupA = getGroup(a.type || '');
      const groupB = getGroup(b.type || '');
      
      const orderA = TYPE_GROUP_ORDER.indexOf(groupA);
      const orderB = TYPE_GROUP_ORDER.indexOf(groupB);
      
      const idxA = orderA === -1 ? 999 : orderA;
      const idxB = orderB === -1 ? 999 : orderB;
      
      if (idxA !== idxB) return idxA - idxB;
      
      // 같은 대분류면 세부 type 순
      if (a.type !== b.type) {
        return (a.type || '').localeCompare(b.type || '');
      }
      
      // 같은 type 내에서 미삽 항목은 맨 아래로
      const aMisap = checkIsMisap(a.partName, a.remark);
      const bMisap = checkIsMisap(b.partName, b.remark);
      if (aMisap !== bMisap) {
        return aMisap ? 1 : -1; // 미삽이면 뒤로
      }
      
      // 같은 type, 같은 미삽 상태면 품명순
      return (a.partName || '').localeCompare(b.partName || '');
    });
  };
  
  sortCoordinates(topCoordinates);
  sortCoordinates(bottomCoordinates);
  
  // 미삽 정렬 확인용 디버그 로그
  const misapItems = bomItems.filter(item => checkIsMisap(item.itemName, item.remark));
  console.log('🔴 미삽 항목들:', misapItems.map(item => `${item.itemType} - ${item.itemName}`));
  
  console.log('✅ BOM/좌표 처리 완료');
  console.log(`  - 총 항목: ${bomItems.length}`);
  console.log(`  - 수동 확인 필요: ${manualRequiredCount}`);
  console.log(`  - 새 부품: ${newPartCount}`);
  console.log(`  - 미삽: ${misapCount}`);
  
  return {
    bomItems,
    topCoordinates,
    bottomCoordinates,
    summary: {
      totalItems: bomItems.length,
      manualRequiredCount,
      newPartCount,
      misapCount,
    },
  };
}

// ============================================================
// 새 부품 저장 (로컬 스토리지)
// ============================================================

export function saveNewPartMapping(footprint: string, partName: string, itemType: string) {
  try {
    const storageKey = 'v7_new_parts';
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
    
    existing[footprint.toUpperCase()] = {
      partName,
      itemType,
      savedAt: new Date().toISOString(),
    };
    
    localStorage.setItem(storageKey, JSON.stringify(existing));
    console.log(`✅ 새 부품 저장: ${footprint} → ${partName} (${itemType})`);
    
    // 캐시 무효화
    learningDataCache = null;
  } catch (error) {
    console.error('새 부품 저장 실패:', error);
  }
}

// ============================================================
// 학습 데이터 캐시 리셋
// ============================================================

export function resetLearningDataCache() {
  learningDataCache = null;
}

// ============================================================
// 정렬 유틸리티 함수 (외부에서 사용 가능)
// ============================================================

const TYPE_GROUP_ORDER_EXPORT = ['IC', 'DIODE', 'C/C', '저항', 'BEAD', 'S/W', 'CONNECTOR'];

// 미삽 체크 함수
function checkIsMisapExport(partName: string | undefined, remark: string | undefined): boolean {
  const remarkUpper = (remark || '').toUpperCase();
  const nameUpper = (partName || '').toUpperCase();
  return remarkUpper.includes('미삽') ||
    nameUpper.includes('_OPEN') || nameUpper.includes('OPEN_') ||
    nameUpper.includes('_POGO') || nameUpper.includes('POGO_') ||
    nameUpper.includes('_PAD') || nameUpper.includes('PAD_') ||
    nameUpper.includes('_NC') || nameUpper.includes('NC_');
}

// BOM 아이템 정렬 함수
export function sortBOMItems(bomItems: BOMItem[]): BOMItem[] {
  const guessTypeGroup = (item: BOMItem) => {
    const type = (item.itemType || '').toUpperCase();
    if (type.includes('IC')) return 'IC';
    if (type.includes('DIODE')) return 'DIODE';
    if (type.includes('C/C') || type.includes('C_C')) return 'C/C';
    if (type.includes('저항')) return '저항';
    if (type.includes('BEAD')) return 'BEAD';
    if (type.includes('S/W') || type.includes('SW')) return 'S/W';
    if (type.includes('CONNECTOR') || type.includes('CONN')) return 'CONNECTOR';
    return 'ETC';
  };

  return [...bomItems].sort((a, b) => {
    const groupA = guessTypeGroup(a);
    const groupB = guessTypeGroup(b);
    
    const orderA = TYPE_GROUP_ORDER_EXPORT.indexOf(groupA);
    const orderB = TYPE_GROUP_ORDER_EXPORT.indexOf(groupB);
    
    const idxA = orderA === -1 ? 999 : orderA;
    const idxB = orderB === -1 ? 999 : orderB;
    
    if (idxA !== idxB) return idxA - idxB;
    
    // 같은 대분류면 세부 종류순
    if (a.itemType !== b.itemType) {
      return (a.itemType || '').localeCompare(b.itemType || '');
    }
    
    // 같은 종류 내에서 미삽 항목은 맨 아래로
    const aMisap = checkIsMisapExport(a.itemName, a.remark);
    const bMisap = checkIsMisapExport(b.itemName, b.remark);
    if (aMisap !== bMisap) {
      return aMisap ? 1 : -1;
    }
    
    // 같은 종류, 같은 미삽 상태면 품명순
    return (a.itemName || '').localeCompare(b.itemName || '');
  });
}

// 좌표 아이템 정렬 함수
export function sortCoordinateItems(coordinates: CoordinateItem[]): CoordinateItem[] {
  const getGroup = (type: string) => {
    const t = (type || '').toUpperCase();
    if (t.includes('IC')) return 'IC';
    if (t.includes('DIODE')) return 'DIODE';
    if (t.includes('C/C') || t.includes('C_C')) return 'C/C';
    if (t.includes('저항')) return '저항';
    if (t.includes('BEAD')) return 'BEAD';
    if (t.includes('S/W') || t.includes('SW')) return 'S/W';
    if (t.includes('CONNECTOR') || t.includes('CONN')) return 'CONNECTOR';
    return 'ETC';
  };

  return [...coordinates].sort((a, b) => {
    const groupA = getGroup(a.type || '');
    const groupB = getGroup(b.type || '');
    
    const orderA = TYPE_GROUP_ORDER_EXPORT.indexOf(groupA);
    const orderB = TYPE_GROUP_ORDER_EXPORT.indexOf(groupB);
    
    const idxA = orderA === -1 ? 999 : orderA;
    const idxB = orderB === -1 ? 999 : orderB;
    
    if (idxA !== idxB) return idxA - idxB;
    
    // 같은 대분류면 세부 type 순
    if (a.type !== b.type) {
      return (a.type || '').localeCompare(b.type || '');
    }
    
    // 같은 type 내에서 미삽 항목은 맨 아래로
    const aMisap = checkIsMisapExport(a.partName, a.remark);
    const bMisap = checkIsMisapExport(b.partName, b.remark);
    if (aMisap !== bMisap) {
      return aMisap ? 1 : -1;
    }
    
    // 같은 type, 같은 미삽 상태면 품명순
    return (a.partName || '').localeCompare(b.partName || '');
  });
}

