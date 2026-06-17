/**
 * 3개 실패 BOM 파일을 새 파서로 처리해서 결과를 JSON으로 출력.
 * 그 JSON을 받아서 SQL INSERT 생성 → Supabase에 직접 적용.
 *
 * 사용: SUPABASE_ANON_KEY=... npx tsx /tmp/reupload-bom.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  parseBOMFile,
  loadLearningData,
  sortBOMItems,
  type AiColumnMap,
  type BOMItem,
} from '/Users/scott/workspace/hanslworkspace/src/utils/v7-generator';

const FIXTURES = '/Users/scott/workspace/hanslworkspace/src/utils/__tests__/fixtures';
const PUBLIC_DATA = '/Users/scott/workspace/hanslworkspace/public/data';

// fetch() 패치 — public/data/*.json을 로컬에서 읽도록
const originalFetch = global.fetch;
global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.startsWith('/data/')) {
    const localPath = join(PUBLIC_DATA, url.slice('/data/'.length));
    const buffer = readFileSync(localPath, 'utf-8');
    return new Response(buffer, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};

const SUPABASE_URL = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY!;

async function classifyColumns(file: File): Promise<AiColumnMap> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const sample = rows.slice(0, 30);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bom-column-classifier`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rows: sample, fileName: file.name }),
  });
  if (!res.ok) throw new Error(`Classifier HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as AiColumnMap;
}

function loadFile(name: string): File {
  const buffer = readFileSync(join(FIXTURES, name));
  const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return new File([u8], name);
}

// 학습 데이터 + 단순 BOMItem 생성 (processBOMAndCoordinates 일부 발췌)
async function buildBOMItems(fixtureName: string, productionQty: number): Promise<BOMItem[]> {
  const file = loadFile(fixtureName);
  const aiColMap = await classifyColumns(file);
  const parsed = await parseBOMFile(file, aiColMap);

  const learning = await loadLearningData();

  // 간략 BOMItem 변환 — 종류/품명 매핑 적용
  const items: BOMItem[] = [];
  let lineNumber = 1;
  for (const p of parsed) {
    const refs = p.refs.map((r) => r.toUpperCase());
    const fpUpper = (p.footprint || '').toUpperCase();
    const partRaw = p.part;

    // 품명 매핑 (간략 — Footprint → 품명)
    let itemName = learning.partNameMapping[fpUpper] ||
                   learning.partNameMapping[p.footprint] ||
                   learning.partNameMapping[partRaw] ||
                   partRaw;

    // 종류 매핑 (품명 → 종류)
    let itemType = learning.typeMapping[itemName] || '';

    // 종류 fallback: footprint/part prefix
    if (!itemType) {
      const fp = fpUpper;
      if (/^C\d{3,}/.test(fp)) itemType = 'CAPACITOR(SMD)';
      else if (/^R\d{3,}/.test(fp)) itemType = 'RESISTOR(SMD)';
      else if (/^L\d{3,}/.test(fp)) itemType = 'INDUCTOR(SMD)';
      else if (fp.includes('SOIC') || fp.includes('QFP') || fp.includes('TQFP') || fp.includes('SOP')) itemType = 'IC(SMD)';
      else if (fp.startsWith('TP')) itemType = 'TEST POINT/SMD';
      else itemType = 'ETC';
    }

    // 미삽 확인
    const isMisap = learning.misapKeywords.some(
      (kw) => fpUpper.includes(kw) || (partRaw || '').toUpperCase().includes(kw),
    );

    items.push({
      lineNumber: lineNumber++,
      itemType,
      itemName,
      setCount: refs.length,
      totalQuantity: refs.length * productionQty,
      checkStatus: '',
      refList: refs.join(', '),
      remark: isMisap ? '미삽' : '',
      isManualRequired: false,
      isNewPart: !learning.partNameMapping[fpUpper] && !learning.partNameMapping[partRaw],
      originalPart: partRaw,
      originalFootprint: p.footprint,
    });
  }

  return sortBOMItems(items);
}

async function main() {
  const targets = [
    { fixture: 'B260526_001.xlsx',      bomFileName: 'MOMA_B1_POWER_V1P0_260522.BOM.xlsx',       boardBase: 'MOMA_B1_POWER_V1P0',      productionQty: 5 },
    { fixture: 'B260527_001_MIPI.xlsx', bomFileName: 'MIPI_ASIC_Socketboard_Gender_V1P0_260522.BOM.xlsx', boardBase: 'MIPI_ASIC_Socketboard_Gender_V1P0', productionQty: 5 },
    { fixture: 'B260527_002_MOMA_B2.xlsx', bomFileName: 'MOMA_B2_POWER_V1P0_260522.BOM.xlsx',    boardBase: 'MOMA_B2_POWER_V1P0',      productionQty: 5 },
  ];

  const output: { boardBase: string; bomFileName: string; productionQty: number; items: BOMItem[] }[] = [];

  for (const t of targets) {
    console.error(`\n=== Processing ${t.fixture} ===`);
    const items = await buildBOMItems(t.fixture, t.productionQty);
    console.error(`  Items: ${items.length}`);
    console.error(`  Sample: ${JSON.stringify(items[0])}`);
    output.push({ boardBase: t.boardBase, bomFileName: t.bomFileName, productionQty: t.productionQty, items });
  }

  writeFileSync('/tmp/reupload-output.json', JSON.stringify(output, null, 2));
  console.error(`\n✓ Wrote /tmp/reupload-output.json (${output.length} boards)`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
