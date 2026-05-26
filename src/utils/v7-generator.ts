/**
 * BOM 좌표 자동 정리 엔진 v7 (웹 버전)
 * 
 * v7-engine.js의 학습 데이터를 활용하여
 * BOM, 좌표 원본 파일 → 정리본 데이터 생성
 */

import * as XLSX from 'xlsx';
import { logger } from '@/lib/logger';

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
    logger.debug('📂 학습 데이터 로드 시작...');
    
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
    const mergedPartNameMapping = { ...partNameMapping, ...FIXED_MAPPINGS };
    const mergedTypeMapping = { ...typeMapping };

    learningDataCache = {
      typeMapping: mergedTypeMapping,
      partNameMapping: mergedPartNameMapping,
      partNameConflicts,
      typeSortOrder,
      misapKeywords,
      manualInputRequired: MANUAL_INPUT_REQUIRED,
    };

    logger.debug('✅ 학습 데이터 로드 완료');
    return learningDataCache;
  } catch (error) {
    logger.error('❌ 학습 데이터 로드 실패:', error);
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
      .replace(/[/\s_-]/g, '')
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
// 데이터 패턴 검증 함수 (컬럼 매핑 결과 검증용)
// ============================================================

// 단일 ref 패턴 (R23, C17)
const SINGLE_REF_PATTERN = /^[A-Z]{1,3}\d+$/i;
// 다중 ref (R1,R2,R3 / C17, C18, C19 / J9 J11)
const MULTI_REF_PATTERN = /^[A-Z]{1,3}\d+([,.;\s/]+[A-Z]{1,3}\d+)+$/i;
// 범위 ref (R1-R10, C1~C5)
const RANGE_REF_PATTERN = /^[A-Z]{1,3}\d+[-~][A-Z]*\d+$/i;

export function isRefPattern(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return SINGLE_REF_PATTERN.test(trimmed) ||
         MULTI_REF_PATTERN.test(trimmed) ||
         RANGE_REF_PATTERN.test(trimmed);
}

// 수량값: 양의 정수 (소수점 0 허용: 1, 1.0)
export function isQtyValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const m = /^(\d{1,4})(?:\.0+)?$/.exec(trimmed);
  if (!m) return false;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 9999;
}

// 단조 증가 정수 (이전 값 + 1)
export function isMonotonicItemNum(value: string, prev: number | null): { ok: boolean; n: number | null } {
  if (!value || typeof value !== 'string') return { ok: false, n: null };
  const trimmed = value.trim();
  const m = /^(\d{1,5})(?:\.0+)?$/.exec(trimmed);
  if (!m) return { ok: false, n: null };
  const n = parseInt(m[1], 10);
  if (prev === null) return { ok: n >= 1, n };
  return { ok: n === prev + 1, n };
}

// Footprint 같은 구조적 패턴 (R1608, C3225, SOIC8, 0603 등)
const FOOTPRINT_PATTERN = /^([RCL]?\d{4}|\d{4}|SOIC\d*|TQFP\d*|LQFP\d*|QFP\d*|SOT\d+|SOD\d+|DIP\d*|DPAK|SOP\d*|0603|0805|1005|1206|1608|2012|3216|3225|BGA\d*|TSSOP\d*)/i;
export function isFootprintValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  return FOOTPRINT_PATTERN.test(value.trim());
}

export function hasLetters(value: string): boolean {
  return /[A-Za-z]/.test(value || '');
}

// 좌표 검증
export function isCoordValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

// EDA 툴별 layer 표기 다양:
//  - 단순: TOP/BOTTOM/T/B/BOT
//  - Altium: TopLayer/BottomLayer
//  - 일부 툴: Top Side / Bottom Side
// 부분 매칭으로 처리 (포함 여부)
export function isLayerValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const u = value.trim().toUpperCase();
  if (!u) return false;
  // 정확 매칭
  if (u === 'TOP' || u === 'BOTTOM' || u === 'T' || u === 'B' || u === 'BOT') return true;
  // 부분 매칭 (TopLayer, BottomLayer, Top Side 등)
  if (u.includes('TOP') || u.includes('BOT')) return true;
  return false;
}

const ROTATION_VALUES = new Set([0, 45, 90, 135, 180, 225, 270, 315, 360]);
export function isRotationValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return false;
  const n = ((parseFloat(trimmed) % 360) + 360) % 360;
  for (const r of ROTATION_VALUES) {
    if (Math.abs(n - r) < 0.5) return true;
  }
  return n >= 0 && n < 360; // 자유로운 회전각도 일단 통과
}

// 컬럼의 셀들에 대해 검사 함수 매칭 비율 계산
function columnMatchRate(
  rows: (string | number | null | undefined)[][],
  colIdx: number,
  predicate: (v: string) => boolean
): { rate: number; nonEmpty: number } {
  let matchCount = 0;
  let nonEmpty = 0;
  for (const row of rows) {
    if (!row || colIdx < 0 || colIdx >= row.length) continue;
    const cellValue = String(row[colIdx] ?? '').trim();
    if (!cellValue) continue;
    nonEmpty++;
    if (predicate(cellValue)) matchCount++;
  }
  if (nonEmpty < 3) return { rate: 0, nonEmpty };
  return { rate: matchCount / nonEmpty, nonEmpty };
}

// ============================================================
// 파싱 에러 클래스
// ============================================================

export interface ParseDiagnostics {
  fileName: string;
  headerRow: number;
  colMap?: Record<string, number>;
  scores?: Record<string, number>;
  reason: string;
  sampleRows?: (string | number | null | undefined)[][];
}

export class BomParseError extends Error {
  diagnostics: ParseDiagnostics;
  constructor(message: string, diagnostics: ParseDiagnostics) {
    super(message);
    this.name = 'BomParseError';
    this.diagnostics = diagnostics;
  }
}

export class CoordParseError extends Error {
  diagnostics: ParseDiagnostics;
  constructor(message: string, diagnostics: ParseDiagnostics) {
    super(message);
    this.name = 'CoordParseError';
    this.diagnostics = diagnostics;
  }
}

// ============================================================
// BOM 파싱
// ============================================================

interface ParsedBOMItem {
  quantity: number;
  refs: string[];
  part: string;
  footprint: string;
  format: 'item_no' | 'grouped_designator';
}

// AI 컬럼 매핑 타입 (Edge Function bom-column-classifier 응답)
export interface AiColumnMap {
  headerRow: number;
  colMap: {
    item: number;
    ref: number;
    qty: number;
    part: number;
    comment: number;
    description: number;
    footprint: number;
  };
  confidence: number;
  reasoning?: string;
}

export async function parseBOMFile(file: File, aiColMap?: AiColumnMap): Promise<ParsedBOMItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });

  // AI 컬럼 매핑은 필수. 없으면 즉시 에러.
  if (!aiColMap) {
    throw new BomParseError(
      'AI 컬럼 분류기 응답이 없습니다. 자동 인식을 진행할 수 없습니다.',
      {
        fileName: file.name,
        headerRow: -1,
        reason: 'no_ai_classification',
        sampleRows: rows.slice(0, 5),
      },
    );
  }

  const headerRow = aiColMap.headerRow;
  const colMap = {
    item: aiColMap.colMap.item,
    ref: aiColMap.colMap.ref,
    qty: aiColMap.colMap.qty,
    part: aiColMap.colMap.part,
    comment: aiColMap.colMap.comment,
    description: aiColMap.colMap.description,
    footprint: aiColMap.colMap.footprint,
  };
  logger.debug('🤖 AI 컬럼 매핑 적용:', { headerRow, colMap, confidence: aiColMap.confidence, reasoning: aiColMap.reasoning });

  // 데이터 기반 검증
  const sampleRowsForValidation = rows.slice(headerRow + 1, Math.min(headerRow + 21, rows.length));

  // REF 컬럼은 필수 — 미지정 또는 매칭률 부족 시 에러
  if (colMap.ref < 0) {
    throw new BomParseError(
      'REF/Designator 컬럼이 식별되지 않았습니다.',
      { fileName: file.name, headerRow, colMap, reason: 'no_ref_column', sampleRows: rows.slice(0, 5) },
    );
  }
  const refResult = columnMatchRate(sampleRowsForValidation, colMap.ref, isRefPattern);
  if (refResult.nonEmpty < 3 || refResult.rate < 0.6) {
    throw new BomParseError(
      `REF 컬럼이 잘못 인식되었습니다 (매칭률 ${(refResult.rate * 100).toFixed(0)}%).`,
      {
        fileName: file.name,
        headerRow,
        colMap,
        scores: { ref: refResult.rate },
        reason: 'ref_validation_failed',
        sampleRows: rows.slice(0, 5),
      },
    );
  }

  // QTY 검증 (소프트 — 약하면 경고만)
  let qtyRate = 0;
  if (colMap.qty >= 0) {
    qtyRate = columnMatchRate(sampleRowsForValidation, colMap.qty, isQtyValue).rate;
    if (qtyRate < 0.5) {
      logger.warn(`⚠️ Qty 컬럼 검증 약함 (매칭률 ${(qtyRate * 100).toFixed(0)}%). refs 개수로 fallback될 수 있음.`);
    }
  }

  // Footprint 검증 (소프트 — 약하면 경고만)
  if (colMap.footprint >= 0) {
    const fpRate = columnMatchRate(sampleRowsForValidation, colMap.footprint, isFootprintValue).rate;
    if (fpRate < 0.4) {
      logger.warn(`⚠️ Footprint 컬럼 검증 약함 (매칭률 ${(fpRate * 100).toFixed(0)}%).`);
    }
  }

  logger.debug('✅ 컬럼 매핑 검증 통과:', { refRate: refResult.rate, qtyRate });

  // 포맷 판별 (데이터 기반):
  // - item 컬럼이 매핑되어 있고 그 컬럼의 값들이 30% 이상 양의 정수면 ModeA (item_no)
  // - 그 외(item 미매핑 또는 정수 비율 낮음) ModeB (grouped_designator)
  // ⛔ 컬럼 이름 (Designator/Comment/Description 헤더 단어) 일절 참고하지 않음
  let isGroupedDesignatorFormat = true;
  if (colMap.item >= 0) {
    const itemResult = columnMatchRate(
      sampleRowsForValidation,
      colMap.item,
      (v) => /^\d+(?:\.0+)?$/.test(v.trim()),
    );
    isGroupedDesignatorFormat = itemResult.rate < 0.3;
    logger.debug(`📊 포맷 판별: item 컬럼 정수율 ${(itemResult.rate * 100).toFixed(0)}% → ${isGroupedDesignatorFormat ? 'ModeB(grouped)' : 'ModeA(item_no)'}`);
  } else {
    logger.debug('📊 포맷 판별: item 컬럼 미매핑 → ModeB(grouped)');
  }

  const items: ParsedBOMItem[] = [];
  let currentItem: ParsedBOMItem | null = null;

  if (isGroupedDesignatorFormat) {
    // ModeB: 각 row가 이미 1개 품목 (Designator에 REF list)
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const reference = String(row[colMap.ref] ?? '').trim();
      if (!reference) continue;
      if (reference.startsWith('_')) continue;

      const refs = Utils.parseRefs(reference).filter((ref) => !Utils.isTP(ref));
      if (refs.length === 0) continue;

      const quantityStr = colMap.qty >= 0 ? String(row[colMap.qty] ?? '').trim() : '';
      const qty = parseInt(quantityStr) || refs.length;

      const comment = colMap.comment >= 0 ? String(row[colMap.comment] ?? '').trim() : '';
      const description = colMap.description >= 0 ? String(row[colMap.description] ?? '').trim() : '';
      const partFromPartCol = colMap.part >= 0 ? String(row[colMap.part] ?? '').trim() : '';
      // 우선순위: comment → part → description
      const part = (comment || partFromPartCol || description).trim();
      const footprint = colMap.footprint >= 0 ? String(row[colMap.footprint] ?? '').trim() : '';

      items.push({
        quantity: qty,
        refs,
        part,
        footprint: footprint || part,
        format: 'grouped_designator',
      });
    }
  } else {
    // ModeA: Item/No 기반 (Item번호 한 줄 + 후속 ref 연속 줄)
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const itemNum = colMap.item >= 0 ? String(row[colMap.item] ?? '').trim() : '';
      const reference = String(row[colMap.ref] ?? '').trim();
      const quantity = colMap.qty >= 0 ? String(row[colMap.qty] ?? '').trim() : '';
      const part = colMap.part >= 0 ? String(row[colMap.part] ?? '').trim() : '';
      const footprint = colMap.footprint >= 0 ? String(row[colMap.footprint] ?? '').trim() : '';

      if (reference.startsWith('_')) continue;

      // .xls의 1.0/2.0 같은 형식도 정수로 인정
      if (itemNum && /^\d+(?:\.0+)?$/.test(itemNum)) {
        if (currentItem && currentItem.refs.length > 0) {
          items.push(currentItem);
        }
        const refs = Utils.parseRefs(reference).filter((ref) => !Utils.isTP(ref));
        currentItem = {
          quantity: parseInt(quantity) || refs.length,
          refs,
          part,
          footprint: footprint || part,
          format: 'item_no',
        };
      } else if (currentItem && reference) {
        const additionalRefs = Utils.parseRefs(reference).filter((ref) => !Utils.isTP(ref));
        currentItem.refs.push(...additionalRefs);
      }
    }

    if (currentItem && currentItem.refs.length > 0) {
      items.push(currentItem);
    }
  }

  // 0건 결과 가드 — 검증을 통과했음에도 0건이면 실제 데이터에 문제가 있는 것
  if (items.length === 0) {
    throw new BomParseError(
      'BOM 항목을 1개도 추출하지 못했습니다. 파일 구조를 확인해주세요.',
      {
        fileName: file.name,
        headerRow,
        colMap,
        scores: { ref: refResult.rate, qty: qtyRate },
        reason: 'zero_items',
        sampleRows: rows.slice(0, 5),
      },
    );
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

// 텍스트/CSV 파일을 2D 셀 배열로 변환 (구분자 자동 감지)
function splitTextToRows(text: string): string[][] {
  const lines = text.split(/\r?\n/);

  const splitCSV = (line: string): string[] => {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cols.push(current.trim());
    return cols;
  };
  const splitTab = (line: string) => line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
  const splitWS = (line: string) => line.split(/\s{2,}/).map(c => c.trim().replace(/^"|"$/g, ''));

  // 비어있지 않은 라인 중 후반부 샘플로 분리자 평가 (일관된 열 수를 주는 것 선택)
  const sample = lines.filter(l => l.trim().length > 0).slice(5, 30);
  const candidates = [
    { name: 'csv', split: splitCSV },
    { name: 'tab', split: splitTab },
    { name: 'ws', split: splitWS },
  ];

  let best = candidates[0];
  let bestScore = 0;
  for (const cand of candidates) {
    const counts = sample.map(l => cand.split(l).length);
    if (counts.length === 0) continue;
    const maxCount = Math.max(...counts);
    if (maxCount < 3) continue;
    const consistent = counts.filter(c => c === maxCount).length;
    const score = maxCount * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return lines.map(l => (l.trim() ? best.split(l) : []));
}

async function parseCoordinateFile(file: File): Promise<ParsedCoordItem[]> {
  const arrayBuffer = await file.arrayBuffer();

  // 1. 입력 형식에 무관하게 2D 셀 배열로 변환
  let rows: string[][];
  if (file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    rows = splitTextToRows(text);
  } else {
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    rows = rawRows.map(r => (r ?? []).map(c => String(c ?? '').trim()));
  }

  // 2. 데이터 시작 행 검출 (셀 중 하나라도 ref 패턴인 첫 행)
  let dataStart = -1;
  for (let r = 0; r < rows.length; r++) {
    if (!rows[r]) continue;
    if (rows[r].some(cell => isRefPattern(cell))) {
      dataStart = r;
      break;
    }
  }
  if (dataStart < 0) {
    throw new CoordParseError(
      '좌표 파일에서 데이터 영역을 찾지 못했습니다. (Reference 패턴 셀이 없음)',
      { fileName: file.name, headerRow: -1, reason: 'no_data_region', sampleRows: rows.slice(0, 10) },
    );
  }

  // 3. 각 컬럼을 데이터로 점수화
  const dataRows = rows.slice(dataStart, Math.min(dataStart + 50, rows.length));
  const numCols = Math.max(0, ...dataRows.map(r => r?.length ?? 0));

  type ColScore = { ref: number; coord: number; rotation: number; layer: number };
  const colScores: ColScore[] = [];
  for (let c = 0; c < numCols; c++) {
    colScores.push({
      ref: columnMatchRate(dataRows, c, isRefPattern).rate,
      coord: columnMatchRate(dataRows, c, isCoordValue).rate,
      rotation: columnMatchRate(dataRows, c, isRotationValue).rate,
      layer: columnMatchRate(dataRows, c, isLayerValue).rate,
    });
  }

  // 4. 역할 그리디 배정
  const assigned = new Set<number>();

  // ref: 가장 높은 refScore (필수, ≥0.6)
  let refCol = -1;
  let bestRefScore = 0;
  for (let c = 0; c < numCols; c++) {
    if (colScores[c].ref > bestRefScore) {
      bestRefScore = colScores[c].ref;
      refCol = c;
    }
  }
  if (refCol < 0 || bestRefScore < 0.6) {
    throw new CoordParseError(
      `좌표 파일의 REF 컬럼이 식별되지 않았습니다 (최고 매칭률 ${(bestRefScore * 100).toFixed(0)}%).`,
      { fileName: file.name, headerRow: dataStart - 1, reason: 'ref_validation_failed', sampleRows: rows.slice(0, 10) },
    );
  }
  assigned.add(refCol);

  // x, y: 좌표 패턴 매칭률 ≥0.7인 컬럼 중 인덱스 순서로 (EDA 툴 관행: x 먼저)
  const numericCols: number[] = [];
  for (let c = 0; c < numCols; c++) {
    if (assigned.has(c)) continue;
    if (colScores[c].coord >= 0.7) numericCols.push(c);
  }
  const xCol = numericCols[0] ?? -1;
  const yCol = numericCols[1] ?? -1;
  if (xCol >= 0) assigned.add(xCol);
  if (yCol >= 0) assigned.add(yCol);

  // rotation: 회전각 매칭률이 가장 높은 잔여 숫자 컬럼
  let rotCol = -1;
  let bestRot = 0;
  for (let c = 0; c < numCols; c++) {
    if (assigned.has(c)) continue;
    if (colScores[c].coord >= 0.7 && colScores[c].rotation > bestRot) {
      bestRot = colScores[c].rotation;
      rotCol = c;
    }
  }
  if (rotCol >= 0 && bestRot >= 0.5) {
    assigned.add(rotCol);
  } else {
    rotCol = -1;
  }

  // layer: TOP/BOTTOM 멤버십 매칭률이 가장 높은 잔여 텍스트 컬럼
  let layerCol = -1;
  let bestLayer = 0;
  for (let c = 0; c < numCols; c++) {
    if (assigned.has(c)) continue;
    if (colScores[c].layer > bestLayer) {
      bestLayer = colScores[c].layer;
      layerCol = c;
    }
  }
  if (bestLayer < 0.5) layerCol = -1;

  logger.debug('📍 좌표 컬럼 매핑 (데이터 기반):', {
    refCol, xCol, yCol, rotCol, layerCol, dataStart,
    refScore: bestRefScore, rotScore: bestRot, layerScore: bestLayer,
  });

  // 5. 데이터 행 파싱
  const items: ParsedCoordItem[] = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const ref = (row[refCol] || '').toUpperCase();
    if (!ref || Utils.isTP(ref) || /^\d+$/.test(ref)) continue;
    if (!isRefPattern(ref)) continue;

    const x = xCol >= 0 ? parseFloat(row[xCol] || '0') || 0 : 0;
    const y = yCol >= 0 ? parseFloat(row[yCol] || '0') || 0 : 0;
    const rotation = rotCol >= 0 ? parseFloat(row[rotCol] || '0') || 0 : 0;
    const layerStr = layerCol >= 0 ? (row[layerCol] || '').toUpperCase() : 'TOP';
    const layer = layerStr.includes('BOT') ? 'BOTTOM' : 'TOP';

    items.push({ ref, x, y, rotation, layer });
  }

  logger.debug(`📍 파싱된 좌표: ${items.length}개`);
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
// Grouped-Designator BOM 정규화 (Comment/Designator 형식 지원)
// ============================================================

function normalizeGroupedBomToken(token: string): string {
  return (token || '').trim();
}

function detectOpenFromTokens(partRaw: string, footprintRaw: string): boolean {
  const p = (partRaw || '').toUpperCase();
  const f = (footprintRaw || '').toUpperCase();
  // NC는 OPEN/미삽으로 취급 (기존 misapKeywords에도 포함)
  return p.includes('/NC') || p.endsWith('NC') || f.includes('/NC') || f.endsWith('NC');
}

function extractMetricSize(partRaw: string, footprintRaw: string): string {
  const candidates = `${footprintRaw || ''} ${partRaw || ''}`.toUpperCase();
  const m = candidates.match(/(0603|1005|1608|2012|3216|3225)/);
  return m?.[1] || '';
}

function extractVoltageToken(partRaw: string): string {
  const parts = (partRaw || '').split('/').map(p => p.trim()).filter(Boolean);
  const v = parts.find(p => /\d+\s*(V|KV)$/i.test(p));
  return v ? v.toUpperCase().replace(/\s+/g, '') : '';
}

function normalizeCapValueForFootprintKey(valueRaw: string): { displayValue: string; keyValue: string } | null {
  const v = normalizeGroupedBomToken(valueRaw);
  if (!v) return null;
  // value token 예: 0.1uF, 10pf, 1nF, 47u, 8pF
  const m = v.match(/^([0-9]*\.?[0-9]+)\s*([uUnNpP])\s*([fF])?$/);
  if (!m) return null;
  const num = m[1];
  const unitLetter = m[2].toLowerCase(); // u/n/p
  const displayUnit = `${unitLetter}F`; // uF/nF/pF
  const displayValue = `${num}${displayUnit}`;
  const keyValue = `${num}${unitLetter.toUpperCase()}F`; // UF/NF/PF
  return { displayValue, keyValue };
}

function normalizeResValueForFootprintKey(valueRaw: string): { displayValue: string; keyValue: string } | null {
  const v = normalizeGroupedBomToken(valueRaw);
  if (!v) return null;
  // 예: 1k, 4.7k, 1M, 0, 0.007
  const m = v.match(/^([0-9]*\.?[0-9]+)\s*([kKmMrR])?$/);
  if (!m) return null;
  const num = m[1];
  const suffix = (m[2] || '').toUpperCase(); // K/M/R/'' (R은 일부 파일에서 ohm 표시로 쓰는 경우)
  const displayValue = `${num}${suffix}`;
  const keyValue = `${num}${suffix}`;
  return { displayValue, keyValue };
}

function buildGroupedBomNormalization(
  partRaw: string,
  footprintRaw: string,
  refs: string[]
): {
  partCandidates: string[];
  footprintCandidates: string[];
  fallbackStandardizedName: string;
} {
  const raw = normalizeGroupedBomToken(partRaw);
  const fpRaw = normalizeGroupedBomToken(footprintRaw);
  const firstRef = (refs?.[0] || '').toUpperCase();
  const refPrefix = firstRef.replace(/\d+/g, '');

  const isOpen = detectOpenFromTokens(raw, fpRaw);
  const size = extractMetricSize(raw, fpRaw);
  const voltage = extractVoltageToken(raw);

  const segments = raw.split('/').map(s => s.trim()).filter(Boolean);
  const valueSeg = segments[0] || raw;

  const partCandidates: string[] = [];
  const footprintCandidates: string[] = [];
  let fallbackStandardizedName = raw || fpRaw || '';

  // 기본 후보: raw 그대로도 항상 시도
  if (raw) partCandidates.push(raw);
  if (fpRaw) footprintCandidates.push(fpRaw);

  if (refPrefix === 'C') {
    const cap = normalizeCapValueForFootprintKey(valueSeg);
    if (cap && size) {
      const key = voltage
        ? `C${cap.keyValue}_${voltage}_${size}`
        : `C${cap.keyValue}_${size}`;
      footprintCandidates.unshift(isOpen ? `${key}_OPEN` : key);
      // mapping key는 partRaw(예: 0.1uF/16V/1005)로 쓰이는 케이스가 많아,
      // u/n/p 단위를 uF/nF/pF로 통일한 variant도 같이 시도
      const normalizedPart = (() => {
        if (segments.length >= 3) {
          const vSeg = segments.find(s => /\d+\s*(V|KV)$/i.test(s)) || '';
          const sizeSeg = segments.find(s => /(0603|1005|1608|2012|3216|3225|1206)/i.test(s)) || '';
          const part = `${cap.displayValue}${vSeg ? `/${vSeg.replace(/\s+/g, '')}` : ''}${sizeSeg ? `/${sizeSeg}` : ''}`;
          return part;
        }
        return cap.displayValue;
      })();
      if (normalizedPart && normalizedPart !== raw) partCandidates.unshift(normalizedPart);
      fallbackStandardizedName = `C${cap.displayValue}${voltage ? `/${voltage}` : ''}_${size}${isOpen ? '_OPEN' : ''}`;
    }
  } else if (refPrefix === 'R') {
    const res = normalizeResValueForFootprintKey(valueSeg);
    if (res && size) {
      const key = `R${res.keyValue}_${size}${isOpen ? '_OPEN' : ''}`;
      footprintCandidates.unshift(key);
      const normalizedPart = (() => {
        // partRaw가 "1k/1005" 같은 형태면 그대로 두되, K/M 대문자 통일 버전만 추가
        if (segments.length >= 2) {
          const sizeSeg = segments.find(s => /(0603|1005|1608|2012|3216|3225|1206)/i.test(s)) || '';
          const tail = sizeSeg ? `/${sizeSeg}` : '';
          const nc = isOpen ? '/NC' : '';
          return `${res.displayValue}${tail}${nc}`;
        }
        return res.displayValue;
      })();
      if (normalizedPart && normalizedPart !== raw) partCandidates.unshift(normalizedPart);
      fallbackStandardizedName = `R${res.displayValue}_${size}${isOpen ? '_OPEN' : ''}`;
    }
  }

  // 후보 중복 제거 (순서 유지)
  const uniq = (arr: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of arr) {
      const key = (v || '').trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };

  return {
    partCandidates: uniq(partCandidates),
    footprintCandidates: uniq(footprintCandidates),
    fallbackStandardizedName,
  };
}

// ============================================================
// 메인 처리 함수
// ============================================================

export async function processBOMAndCoordinates(
  bomFile: File,
  coordFile: File | null,
  productionQuantity: number,
  aiColMap?: AiColumnMap
): Promise<ProcessedResult> {
  logger.debug('🚀 BOM/좌표 처리 시작...');

  // 1. 학습 데이터 로드
  const learningData = await loadLearningData();

  // 2. 파일 파싱
  const parsedBOM = await parseBOMFile(bomFile, aiColMap);
  const parsedCoord = coordFile ? await parseCoordinateFile(coordFile) : [];

  // Ref를 대문자로 정규화해 매핑 실패 방지
  parsedBOM.forEach(item => {
    item.refs = item.refs.map(ref => ref.toUpperCase());
  });
  const normalizedCoord = parsedCoord.map(coord => ({
    ...coord,
    ref: coord.ref.toUpperCase(),
  }));
  
  logger.debug(`📄 BOM 항목: ${parsedBOM.length}개`);
  logger.debug(`📍 좌표 항목: ${normalizedCoord.length}개`);
  
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
    // 포맷별(part/footprint) 정규화 (특히 grouped_designator BOM은 raw footprint가 C1005/R1005 등이라 매핑 실패가 잦음)
    const norm =
      item.format === 'grouped_designator'
        ? buildGroupedBomNormalization(item.part, item.footprint, item.refs)
        : null;

    // 매핑/수동확인 판단에 사용할 part/footprint (후보 탐색으로 결정)
    let partForMatch = item.part;
    let footprintForMatch = item.footprint;

    if (norm) {
      // part/footprint 후보 조합 중 학습데이터에 존재하는 매핑을 우선 선택
      let matched = false;
      for (const fp of norm.footprintCandidates) {
        for (const p of norm.partCandidates) {
          if (learningData.partNameMapping[`${p}|${fp}`] || learningData.partNameMapping[fp.toUpperCase()] || learningData.partNameMapping[fp]) {
            partForMatch = p;
            footprintForMatch = fp;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      // 매핑이 없어도 footprint는 정규화 후보가 있으면 그걸 우선 사용(표준화 fallback용)
      if (!matched && norm.footprintCandidates.length > 0) {
        footprintForMatch = norm.footprintCandidates[0];
        partForMatch = norm.partCandidates[0] || item.part;
      }
    }

    // 수동 확인 필요 여부
    const isManualRequired = Utils.isManualInputRequired(partForMatch, footprintForMatch, learningData);
    
    // 품명 매핑
    let mappedPartName: string;
    let isNewPart = false;
    
    if (isManualRequired) {
      mappedPartName = '데이터 없음 (수동 확인 필요)';
      manualRequiredCount++;
    } else {
      // grouped_designator 포맷은 후보 조합을 순차 시도해 매핑 적중률을 극대화
      if (norm) {
        let found: { partName: string; isNew: boolean } | null = null;
        for (const fp of norm.footprintCandidates) {
          for (const p of norm.partCandidates) {
            const m = mapPartName(p, fp, learningData);
            if (!m.isNew) {
              found = m;
              partForMatch = p;
              footprintForMatch = fp;
              break;
            }
          }
          if (found) break;
        }
        if (found) {
          mappedPartName = found.partName;
          isNewPart = found.isNew;
        } else {
          // 매핑 실패 시에도 표준화된 형태로 출력 (정답지처럼 일관된 형식 유지)
          mappedPartName = norm.fallbackStandardizedName || (footprintForMatch || partForMatch);
          isNewPart = true;
        }
      } else {
        const mapping = mapPartName(partForMatch, footprintForMatch, learningData);
        mappedPartName = mapping.partName;
        isNewPart = mapping.isNew;
      }
      if (isNewPart) {
        newPartCount++;
      }
    }
    
    // 종류 매핑
    const itemType = mapType(mappedPartName, learningData);
    if (!itemType && !isManualRequired && !isNewPart) {
      // 종류도 못 찾으면 새 부품으로 처리
      isNewPart = true;
      newPartCount++;
    }
    
    // 미삽 여부 (footprint와 part 모두 체크)
    const isMisap = Utils.isMisap(footprintForMatch, partForMatch, learningData);
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
      const aMisap = checkIsMisap(a.partName ?? '', a.remark ?? '');
      const bMisap = checkIsMisap(b.partName ?? '', b.remark ?? '');
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
  logger.debug('🔴 미삽 항목들:', { misapItems: misapItems.map(item => `${item.itemType} - ${item.itemName}`) });

  logger.debug('✅ BOM/좌표 처리 완료', {
    totalItems: bomItems.length,
    manualRequiredCount,
    newPartCount,
    misapCount,
  });
  
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
    logger.debug(`✅ 새 부품 저장: ${footprint} → ${partName} (${itemType})`);
    
    // 캐시 무효화
    learningDataCache = null;
  } catch (error) {
    logger.error('새 부품 저장 실패:', error);
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

