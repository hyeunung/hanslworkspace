/**
 * End-to-end 통합 테스트: 실제 Supabase Edge Function (bom-column-classifier) 호출 +
 * parseBOMFile 파이프라인 전체 검증.
 *
 * - 네트워크 의존 — 단위 테스트와 분리
 * - 환경변수 SUPABASE_ANON_KEY 없으면 자동 skip
 *
 * 실행: SUPABASE_ANON_KEY=... npm run test bom-ai-integration
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { parseBOMFile, type AiColumnMap } from '../v7-generator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const SUPABASE_URL = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

function loadFixture(name: string): File {
  const buffer = readFileSync(join(FIXTURES_DIR, name));
  const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return new File([u8], name);
}

async function extractTopRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  return rows.slice(0, 30);
}

async function callClassifier(file: File): Promise<AiColumnMap> {
  const rows = await extractTopRows(file);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bom-column-classifier`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rows, fileName: file.name }),
  });
  if (!res.ok) throw new Error(`Classifier HTTP ${res.status}: ${await res.text()}`);
  const result = await res.json();
  if (!result || result.error) throw new Error(`Classifier error: ${JSON.stringify(result?.error)}`);
  return result as AiColumnMap;
}

const skipIfNoKey = ANON_KEY ? describe : describe.skip;

skipIfNoKey('통합: AI 분류기 + parseBOMFile (3개 실패 사고 파일)', () => {
  it('B260526_001: AI 분류 → 32개 항목 추출', async () => {
    const file = loadFixture('B260526_001.xlsx');
    const aiColMap = await callClassifier(file);
    expect(aiColMap.colMap.ref).toBe(2);
    expect(aiColMap.colMap.qty).toBe(1);
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(32);
  }, 60000);

  it('B260527_001 (MIPI): AI 분류 → 22개 항목 추출', async () => {
    const file = loadFixture('B260527_001_MIPI.xlsx');
    const aiColMap = await callClassifier(file);
    expect(aiColMap.colMap.ref).toBe(2);
    expect(aiColMap.colMap.qty).toBe(1);
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(22);
  }, 60000);

  it('B260527_002 (MOMA_B2): AI 분류 → 34개 항목 추출', async () => {
    const file = loadFixture('B260527_002_MOMA_B2.xlsx');
    const aiColMap = await callClassifier(file);
    expect(aiColMap.colMap.ref).toBe(2);
    expect(aiColMap.colMap.qty).toBe(1);
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(34);
  }, 60000);

  it('B260526_002 (Altium 6-col, 기존 정상): AI 분류 → 80개 항목 추출', async () => {
    const file = loadFixture('B260526_002_APD.xlsx');
    const aiColMap = await callClassifier(file);
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(80);
  }, 60000);

  it('B260203_001 (5-col ModeA + 메타 11행, 기존 정상): AI 분류 → 73개 항목 추출', async () => {
    const file = loadFixture('B260203_001_KLEG.xls');
    const aiColMap = await callClassifier(file);
    expect(aiColMap.headerRow).toBeGreaterThanOrEqual(10);
    const items = await parseBOMFile(file, aiColMap);
    expect(items.length).toBe(73);
  }, 60000);
});
