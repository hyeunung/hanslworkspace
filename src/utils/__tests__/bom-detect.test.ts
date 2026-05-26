import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBOMFile,
  BomParseError,
  isRefPattern,
  isQtyValue,
  isFootprintValue,
  isCoordValue,
  isLayerValue,
  type AiColumnMap,
} from '../v7-generator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

function loadFixture(name: string): File {
  const buffer = readFileSync(join(FIXTURES_DIR, name));
  const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return new File([u8], name);
}

// ============================================================
// 데이터 패턴 검증 함수 단위 테스트
// ============================================================

describe('isRefPattern', () => {
  it('단일 ref 매칭', () => {
    expect(isRefPattern('R23')).toBe(true);
    expect(isRefPattern('C17')).toBe(true);
    expect(isRefPattern('U2')).toBe(true);
    expect(isRefPattern('TP1')).toBe(true);
    expect(isRefPattern('FL2')).toBe(true);
  });

  it('다중 ref (콤마/공백 구분) 매칭', () => {
    expect(isRefPattern('R1,R2,R3')).toBe(true);
    expect(isRefPattern('C17, C18, C19')).toBe(true);
    expect(isRefPattern('J9 J11 J20')).toBe(true);
    expect(isRefPattern('C17, C18, C19, C20, C21, C23')).toBe(true);
  });

  it('범위 ref 매칭', () => {
    expect(isRefPattern('R1-R10')).toBe(true);
    expect(isRefPattern('C1~C5')).toBe(true);
  });

  it('ref가 아닌 값은 거부', () => {
    expect(isRefPattern('10uF')).toBe(false);
    expect(isRefPattern('1K/5W')).toBe(false);
    expect(isRefPattern('SOIC8')).toBe(false);
    expect(isRefPattern('')).toBe(false);
    expect(isRefPattern('   ')).toBe(false);
  });
});

describe('isQtyValue', () => {
  it('정수 매칭', () => {
    expect(isQtyValue('1')).toBe(true);
    expect(isQtyValue('18')).toBe(true);
    expect(isQtyValue('999')).toBe(true);
  });

  it('.0 접미사 매칭 (.xls 부동소수점)', () => {
    expect(isQtyValue('1.0')).toBe(true);
    expect(isQtyValue('2.00')).toBe(true);
  });

  it('범위 밖 / 비정수 거부', () => {
    expect(isQtyValue('0')).toBe(false);
    expect(isQtyValue('10000')).toBe(false);
    expect(isQtyValue('1.5')).toBe(false);
    expect(isQtyValue('abc')).toBe(false);
    expect(isQtyValue('')).toBe(false);
  });
});

describe('isFootprintValue', () => {
  it('일반 footprint 패턴 매칭', () => {
    expect(isFootprintValue('R1608')).toBe(true);
    expect(isFootprintValue('C3225')).toBe(true);
    expect(isFootprintValue('SOIC8')).toBe(true);
    expect(isFootprintValue('1005')).toBe(true);
    expect(isFootprintValue('TQFP100')).toBe(true);
    expect(isFootprintValue('0603')).toBe(true);
  });

  it('비-footprint 값 거부', () => {
    expect(isFootprintValue('R23')).toBe(false); // ref이지 footprint 아님 (R\d{4}는 4자리 필요)
    expect(isFootprintValue('10uF/100V')).toBe(false);
    expect(isFootprintValue('1K/5W')).toBe(false);
  });
});

describe('isCoordValue / isLayerValue', () => {
  it('isCoordValue: 부호있는 부동소수점 매칭', () => {
    expect(isCoordValue('100.0')).toBe(true);
    expect(isCoordValue('-50.25')).toBe(true);
    expect(isCoordValue('0')).toBe(true);
    expect(isCoordValue('abc')).toBe(false);
  });

  it('isLayerValue: TOP/BOTTOM 멤버십', () => {
    expect(isLayerValue('TOP')).toBe(true);
    expect(isLayerValue('top')).toBe(true);
    expect(isLayerValue('BOTTOM')).toBe(true);
    expect(isLayerValue('BOT')).toBe(true);
    expect(isLayerValue('OTHER')).toBe(false);
  });
});

// ============================================================
// parseBOMFile 회귀 테스트 (실제 fixture 파일)
// ============================================================

describe('parseBOMFile: B260526_001 (4-col grouped, no Comment/Description)', () => {
  // 원래 사고 케이스. 헤더: Name | Quantity | Designator | Footprint
  const aiColMap: AiColumnMap = {
    headerRow: 0,
    colMap: {
      item: -1,        // Item# 컬럼 없음
      ref: 2,          // Designator
      qty: 1,          // Quantity
      part: 0,         // Name
      comment: -1,
      description: -1,
      footprint: 3,    // Footprint
    },
    confidence: 0.95,
  };

  it('AI 매핑이 올바르면 32개 항목 추출 (ModeB)', async () => {
    const file = loadFixture('B260526_001.xlsx');
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(32);
    expect(items[0].format).toBe('grouped_designator');
    // 부품명이 Name 컬럼에서 와야 함 (1K/5W, 10K, 10uF 등)
    expect(items[0].part).toMatch(/[A-Za-z0-9]/);
  });

  it('ref 패턴이 큰 행 (콤마 다중) 정상 파싱', async () => {
    const file = loadFixture('B260526_001.xlsx');
    const items = await parseBOMFile(file, aiColMap);
    // C17, C18, ..., C37 — 18개 refs를 가진 행이 있어야 함
    const multiRefItem = items.find((it) => it.refs.length >= 15);
    expect(multiRefItem).toBeDefined();
    expect(multiRefItem!.refs.length).toBe(18);
  });
});

describe('parseBOMFile: B260526_002 (6-col Altium grouped)', () => {
  // 헤더: Comment | Description | Designator | Footprint | LibRef | Quantity
  const aiColMap: AiColumnMap = {
    headerRow: 0,
    colMap: {
      item: -1,
      ref: 2,          // Designator
      qty: 5,          // Quantity
      part: -1,
      comment: 0,      // Comment = 실제 부품값
      description: 1,
      footprint: 3,
    },
    confidence: 0.95,
  };

  it('80개 항목 추출 (ModeB)', async () => {
    const file = loadFixture('B260526_002_APD.xlsx');
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(80);
    expect(items[0].format).toBe('grouped_designator');
    // Comment가 부품명으로 사용되어야 함 (4.7uF/16V/1608 등)
    expect(items[0].part).toContain('uF');
  });
});

describe('parseBOMFile: B260203_001 (5-col ModeA, leading metadata)', () => {
  // 헤더: Item | Reference | Quantity | Part | PCB Footprint (실제 헤더는 row 12 = idx 11)
  const aiColMap: AiColumnMap = {
    headerRow: 11,
    colMap: {
      item: 0,         // Item (단조 증가 아니지만 모두 정수)
      ref: 1,          // Reference
      qty: 2,          // Quantity
      part: 3,         // Part
      comment: -1,
      description: -1,
      footprint: 4,    // PCB Footprint
    },
    confidence: 0.95,
  };

  it('73개 항목 추출 (ModeA item_no)', async () => {
    const file = loadFixture('B260203_001_KLEG.xls');
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(73);
    expect(items[0].format).toBe('item_no');
  });
});

// ============================================================
// 에러 케이스 — BomParseError 던지는지 검증
// ============================================================

describe('parseBOMFile: AI 매핑 없으면 throw', () => {
  it('aiColMap 미전달 시 BomParseError', async () => {
    const file = loadFixture('B260526_001.xlsx');
    await expect(parseBOMFile(file)).rejects.toThrowError(BomParseError);
    await expect(parseBOMFile(file)).rejects.toMatchObject({
      diagnostics: { reason: 'no_ai_classification' },
    });
  });
});

describe('parseBOMFile: AI가 잘못된 매핑 주면 데이터로 잡아냄', () => {
  it('ref 컬럼을 Name 컬럼(0)으로 잘못 매핑 → 데이터 검증 실패', async () => {
    const file = loadFixture('B260526_001.xlsx');
    const wrongAiColMap: AiColumnMap = {
      headerRow: 0,
      colMap: {
        item: -1,
        ref: 0,          // ❌ 잘못! Name 컬럼 ("1K/5W" 등)이 들어있음
        qty: 1,
        part: 2,
        comment: -1,
        description: -1,
        footprint: 3,
      },
      confidence: 0.95,
    };
    await expect(parseBOMFile(file, wrongAiColMap)).rejects.toThrowError(BomParseError);
    await expect(parseBOMFile(file, wrongAiColMap)).rejects.toMatchObject({
      diagnostics: { reason: 'ref_validation_failed' },
    });
  });

  it('ref 컬럼 없음 (-1) → 즉시 에러', async () => {
    const file = loadFixture('B260526_001.xlsx');
    const noRefMap: AiColumnMap = {
      headerRow: 0,
      colMap: { item: -1, ref: -1, qty: 1, part: 0, comment: -1, description: -1, footprint: 3 },
      confidence: 0.5,
    };
    await expect(parseBOMFile(file, noRefMap)).rejects.toThrowError(BomParseError);
    await expect(parseBOMFile(file, noRefMap)).rejects.toMatchObject({
      diagnostics: { reason: 'no_ref_column' },
    });
  });
});
