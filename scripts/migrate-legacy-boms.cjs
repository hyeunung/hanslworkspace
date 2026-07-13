/**
 * 과거 SOCKET 보드 정리본 일괄 이관 스크립트
 *
 * sample-data/24년이전/{2019..2025}_SOCKET, sample-data/24_25_SOCKET/{2024,2025} 폴더를 스캔해
 * 정리본 엑셀(신형식 `보드명(YYMM).xlsx`, 구형식 `보드명_YYMMDD.xlsx`)을 파싱하고
 * cad_drawings / bom_items / part_placements / bom_raw_files 로 등록한다.
 * 정리본 원본 파일은 Storage(bom-files/raw/legacy/)에 업로드해 링크한다.
 *
 * 사용:
 *   node scripts/migrate-legacy-boms.js --dry-run   # 파싱/중복 리포트만 생성
 *   node scripts/migrate-legacy-boms.js --execute   # 실제 업로드+DB 삽입
 *
 * 환경: .env.local 의 SUPABASE_URL(NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY 사용
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'sample-data');
const REPORT_DIR = path.join(__dirname, 'v7_분석결과');

const SCAN_DIRS = [
  ...['2019', '2020', '2021', '2022', '2023', '2024', '2025'].map(y =>
    path.join(SAMPLE, '24년이전', `${y}_SOCKET`)
  ),
  path.join(SAMPLE, '24_25_SOCKET', '2024'),
  path.join(SAMPLE, '24_25_SOCKET', '2025'),
];

// 정리본이 아닌 파일들을 배제하는 키워드 (NFC 정규화 후 비교)
const EXCLUDE_KEYWORD = /견적|발주|part|ref\b|refbom|ref\.|pnp|\.bom|좌표|silk|회로도|검사중|재고현황|수량_|thumbs/i;

function nfc(s) {
  return (s || '').normalize('NFC');
}

// ---------- 파일 탐색 ----------

/** 정리본 후보 파일들을 우선순위 순으로 반환 (파싱 실패 시 다음 후보 시도) */
function findAnswerCandidates(folderPath) {
  let files;
  try {
    files = fs.readdirSync(folderPath, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name);
  } catch {
    return [];
  }
  const excel = files.filter(f => /\.(xlsx|xls)$/i.test(f) && !f.startsWith('~$') && !f.startsWith('.'));

  // 1순위: 신형식 보드명(YYMM).xlsx (최신 우선)
  const newFmt = excel.filter(f => /\(\d{4}\)\.xlsx?$/i.test(nfc(f))).sort().reverse();
  // 2순위: 구형식 보드명_YYMMDD.xlsx (견적/원본류 배제, 최신 우선)
  const oldFmt = excel.filter(f => {
    const n = nfc(f);
    return /_\d{6}\.xlsx?$/i.test(n) && !EXCLUDE_KEYWORD.test(n) && !/\(\d{4}\)\.xlsx?$/i.test(n);
  }).sort().reverse();

  // 3순위: 그 외 배제어 없는 엑셀 (예: `..._확인완료.xlsx`) — 파싱 검증으로 거른다
  const rest = excel.filter(f => {
    const n = nfc(f);
    return !newFmt.includes(f) && !oldFmt.includes(f) && !EXCLUDE_KEYWORD.test(n);
  }).sort().reverse();

  return [...newFmt, ...oldFmt, ...rest].map(f => path.join(folderPath, f));
}

function deriveBoardName(fileName) {
  let name = nfc(fileName).replace(/\.(xlsx|xls)$/i, '');
  name = name.replace(/\(\d{4}\)$/, '');       // (YYMM)
  name = name.replace(/_\d{6}(-검사중)?$/, ''); // _YYMMDD
  return name.trim();
}

function deriveFileDate(fileName) {
  const n = nfc(fileName);
  let m = n.match(/_(\d{6})(?:-검사중)?\.(xlsx|xls)$/i);
  if (m) return m[1];               // YYMMDD
  m = n.match(/\((\d{4})\)\.(xlsx|xls)$/i);
  if (m) return m[1] + '99';        // YYMM → 정렬용으로 월말 취급
  return '000000';
}

// ---------- 파싱 ----------

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function cellInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function cellNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 보드명 시트(부품리스트) 파싱 */
function parseBoardSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // 헤더 행 탐색: '품명' + ('SET' 또는 '수량') 포함
  let headerIdx = -1;
  let col = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] || [];
    const texts = r.map(c => cellStr(c));
    if (texts.some(t => t === '품명') && texts.some(t => /^SET$/i.test(t) || t === '수량')) {
      headerIdx = i;
      texts.forEach((t, idx) => {
        if (t === '번호') col.no = idx;
        else if (t === '종류') col.type = idx;
        else if (t === '품명') col.name = idx;
        else if (/^SET$/i.test(t)) col.set = idx;
        else if (t === '수량') col.qty = idx;
        else if (t === '재고') col.stock = idx;
        else if (/CHECK/i.test(t)) col.check = idx;
        else if (/^Ref$/i.test(t)) col.ref = idx;
        else if (/대체/.test(t)) col.alt = idx;
        else if (t === '비고') col.remark = idx;
      });
      break;
    }
  }
  if (headerIdx < 0 || col.name === undefined) {
    return { error: '부품리스트 헤더를 찾지 못함' };
  }

  const items = [];
  let productionQuantity = 0;
  let currentType = '';
  let line = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rawType = cellStr(col.type !== undefined ? r[col.type] : '');
    const name = cellStr(r[col.name]);

    // "** 보드명 **" 배너 행: 수량 칼럼 값 = 제작수량
    if (/\*\*/.test(rawType) || /\*\*/.test(name)) {
      const pq = cellInt(col.qty !== undefined ? r[col.qty] : null);
      if (pq && !productionQuantity) productionQuantity = pq;
      continue;
    }
    if (!name) continue;
    // 표 밖 메모 배제: 번호/SET/수량이 전부 비어있고 종류도 없는 행은 스킵
    const noVal = col.no !== undefined ? cellInt(r[col.no]) : null;
    const setVal = col.set !== undefined ? cellInt(r[col.set]) : null;
    const qtyVal = col.qty !== undefined ? cellInt(r[col.qty]) : null;
    if (noVal === null && setVal === null && qtyVal === null && !rawType) continue;

    if (rawType) currentType = rawType;
    line += 1;

    const stockRaw = col.stock !== undefined ? cellStr(r[col.stock]) : '';
    const stockNum = cellInt(stockRaw);
    let remark = col.remark !== undefined ? cellStr(r[col.remark]) : '';
    if (stockRaw && stockNum === null) {
      // '사급' 같은 텍스트 재고는 비고로 보존
      remark = remark ? `${remark} / 재고:${stockRaw}` : `재고:${stockRaw}`;
    }

    const refRaw = col.ref !== undefined ? cellStr(r[col.ref]) : '';
    // 범위 표기(U1~U4) 전개 — 좌표 REF 매칭을 위해
    const refList = refRaw
      ? refRaw.split(',').map(s => s.trim()).filter(Boolean).flatMap(tok => {
          const m = tok.match(/^([A-Za-z]+)(\d+)\s*~\s*([A-Za-z]*)(\d+)$/);
          if (!m) return [tok];
          const [, prefix, s0, prefix2, e0] = m;
          if (prefix2 && prefix2.toUpperCase() !== prefix.toUpperCase()) return [tok];
          const start = parseInt(s0, 10), end = parseInt(e0, 10);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 500) return [tok];
          return Array.from({ length: end - start + 1 }, (_, i) => `${prefix}${start + i}`);
        })
      : [];

    items.push({
      line_number: noVal ?? line,
      item_type: currentType,
      item_name: name,
      specification: '',
      set_count: setVal ?? 0,
      total_quantity: qtyVal,
      stock_quantity: stockNum ?? 0,
      check_status: col.check !== undefined ? cellStr(r[col.check]) : '',
      ref_list: refList,
      alternative_item: col.alt !== undefined ? cellStr(r[col.alt]) : '',
      remark,
    });
  }

  return { items, productionQuantity };
}

/** TOP/BOTTOM 좌표 시트 파싱 — 연식별 헤더 변형 지원
 * 신형식:  종류 | Type | RefDes | Layer | LocationX | LocationY | Rotation | 비고
 * 2020식: (없음) | PartNumber | RefDesignator | X | Y | Rot | Side
 * 기타:   PartType | RefDes | PartDecal | Pins | Layer | Orient. | X | Y
 */
function parseCoordSheet(ws, side) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let headerIdx = -1;
  let col = {};
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = rows[i] || [];
    const texts = r.map(c => cellStr(c));
    const refIdx = texts.findIndex(t => /^(refdes|refdesignator|ref des)/i.test(t));
    if (refIdx >= 0) {
      headerIdx = i;
      texts.forEach((t, idx) => {
        if (/^(refdes|refdesignator|ref des)/i.test(t)) col.ref = idx;
        else if (/^(type|partdecal|partnumber)$/i.test(t)) col.name = idx;
        else if (/^parttype$/i.test(t)) col.kind = idx;
        else if (/^(layer|side)$/i.test(t)) col.layer = idx;
        else if (/^(locationx|x)$/i.test(t)) col.x = idx;
        else if (/^(locationy|y)$/i.test(t)) col.y = idx;
        else if (/^(rotation|rot|orient\.?)$/i.test(t)) col.rot = idx;
      });
      // 종류 칼럼(헤더 없음)은 관례상 첫 칼럼 — 다른 매핑이 차지하지 않았을 때만
      if (col.kind === undefined && col.ref !== 0 && col.name !== 0 && col.x !== 0) col.kind = 0;
      break;
    }
  }
  if (headerIdx < 0 || col.ref === undefined || col.x === undefined || col.y === undefined) return [];

  const items = [];
  let currentKind = '';
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const ref = cellStr(r[col.ref]);
    if (!ref || /^\d+$/.test(ref)) continue; // RefDes가 숫자만이면 배제
    const x = cellNum(r[col.x]);
    const y = cellNum(r[col.y]);
    if (x === null || y === null) continue;
    if (col.kind !== undefined) {
      const kindRaw = cellStr(r[col.kind]);
      if (kindRaw) currentKind = kindRaw;
    }
    // 행에 Layer/Side 값이 있으면 그 값 우선, 없으면 시트명 기준
    let rowSide = side;
    if (col.layer !== undefined) {
      const lv = cellStr(r[col.layer]).toUpperCase();
      if (lv === 'TOP' || lv === 'BOTTOM') rowSide = lv;
    }
    items.push({
      ref,
      part_name: col.name !== undefined ? cellStr(r[col.name]) : '',
      part_type: currentKind,
      side: rowSide,
      x_coordinate: x,
      y_coordinate: y,
      angle: cellNum(col.rot !== undefined ? r[col.rot] : null),
    });
  }
  return items;
}

function parseAnswerFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetNames = wb.SheetNames;
  const topName = sheetNames.find(s => /^top$/i.test(s.trim()));
  const bottomName = sheetNames.find(s => /^bottom$/i.test(s.trim()));
  const boardSheetCandidates = sheetNames.filter(s => !/^(top|bottom)$/i.test(s.trim()));
  if (!boardSheetCandidates.length) return { error: '부품리스트 시트 없음' };

  // 부품리스트 헤더가 있는 시트를 찾을 때까지 순서대로 시도
  let board = null;
  for (const name of boardSheetCandidates) {
    const parsed = parseBoardSheet(wb.Sheets[name]);
    if (!parsed.error && parsed.items.length) { board = parsed; break; }
  }
  if (!board) return { error: '부품리스트 헤더를 찾지 못함' };

  const placements = [
    ...(topName ? parseCoordSheet(wb.Sheets[topName], 'TOP') : []),
    ...(bottomName ? parseCoordSheet(wb.Sheets[bottomName], 'BOTTOM') : []),
  ];

  return { items: board.items, placements, productionQuantity: board.productionQuantity };
}

// ---------- 스캔 + 중복 제거 ----------

function scanAndParseAll() {
  const boards = [];
  const noAnswer = [];
  const failed = [];

  // 폴더 목록 수집
  const folderList = [];
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const yearLabel = nfc(path.relative(SAMPLE, dir));
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) folderList.push({ yearLabel, folderPath: path.join(dir, d.name), folder: nfc(d.name) });
    }
  }

  for (let i = 0; i < folderList.length; i++) {
    const { yearLabel, folderPath, folder } = folderList[i];
    process.stdout.write(`\r   스캔/파싱: ${i + 1}/${folderList.length}`);
    const candidates = findAnswerCandidates(folderPath);
    if (!candidates.length) {
      noAnswer.push(`${yearLabel}/${folder}`);
      continue;
    }
    let ok = false;
    let lastError = '';
    for (const candidate of candidates) {
      try {
        const result = parseAnswerFile(candidate);
        if (result.error) { lastError = result.error; continue; }
        const fileName = nfc(path.basename(candidate));
        boards.push({
          year: yearLabel,
          folder,
          filePath: candidate,
          fileName,
          boardName: deriveBoardName(fileName),
          fileDate: deriveFileDate(fileName),
          ...result,
        });
        ok = true;
        break;
      } catch (e) {
        lastError = e.message;
      }
    }
    if (!ok) failed.push({ folder: `${yearLabel}/${folder}`, error: lastError });
  }
  console.log('');

  // 보드명(정규화) 기준 중복 제거 — 최신 파일 유지
  const byKey = new Map();
  const dups = [];
  for (const b of boards) {
    const key = b.boardName.toUpperCase().replace(/\s+/g, '');
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, b);
    } else {
      const keep = b.fileDate > prev.fileDate ? b : prev;
      const drop = keep === b ? prev : b;
      byKey.set(key, keep);
      dups.push({ kept: `${keep.year}/${keep.fileName}`, dropped: `${drop.year}/${drop.fileName}` });
    }
  }

  return { parsed: [...byKey.values()], dups, noAnswer, failed, totalFound: boards.length };
}

// ---------- 메인 ----------

async function main() {
  const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';
  console.log(`🚀 정리본 이관 (${mode})`);

  const { parsed, dups, noAnswer, failed, totalFound } = scanAndParseAll();
  console.log(`📂 정리본 파싱 ${totalFound}건 → 중복 제거 후 ${parsed.length}건 (중복 ${dups.length}, 정리본 없음 폴더 ${noAnswer.length}, 실패 ${failed.length})`);

  const summary = {
    mode,
    totalFound,
    parsedOk: parsed.length,
    parseFailed: failed.length,
    totalBomItems: parsed.reduce((s, p) => s + p.items.length, 0),
    totalPlacements: parsed.reduce((s, p) => s + p.placements.length, 0),
    boardsWithPlacements: parsed.filter(p => p.placements.length > 0).length,
    duplicatesDropped: dups.length,
    foldersWithoutAnswer: noAnswer.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, '이관_드라이런_리포트.json'),
    JSON.stringify({ summary, failed, dups, noAnswer, boards: parsed.map(p => ({
      year: p.year, boardName: p.boardName, file: p.fileName,
      items: p.items.length, placements: p.placements.length, productionQuantity: p.productionQuantity,
    })) }, null, 2)
  );
  console.log(`📄 리포트: scripts/v7_분석결과/이관_드라이런_리포트.json`);

  if (mode !== 'execute') return;

  // ---------- 실제 이관 ----------
  // .env.local 수동 파싱 (dotenv 미설치)
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const supabase = createClient(url, key);

  // 기존 보드명과 충돌 확인
  const { data: existingBoards, error: exErr } = await supabase
    .from('cad_drawings')
    .select('board_name');
  if (exErr) throw exErr;
  const existingSet = new Set(
    (existingBoards || []).map(r => nfc(r.board_name).toUpperCase().replace(/\s+/g, '').replace(/_\d{6}_정리본$/, '').replace(/_정리본$/, ''))
  );

  const skippedExisting = [];
  const inserted = [];
  const insertFailed = [];

  for (let i = 0; i < parsed.length; i++) {
    const b = parsed[i];
    const normName = b.boardName.toUpperCase().replace(/\s+/g, '');
    if (existingSet.has(normName)) {
      skippedExisting.push(b.boardName);
      continue;
    }
    process.stdout.write(`\r   이관: ${i + 1}/${parsed.length} (등록 ${inserted.length})`);

    try {
      // 1) Storage 업로드
      // Supabase Storage 키는 ASCII만 허용 — 한글 등은 _ 로 치환
      const storagePath = `raw/legacy/${Date.now()}_${i}_${b.fileName.replace(/[^A-Za-z0-9.\-()_]/g, '_').replace(/_+/g, '_')}`;
      const fileBuf = fs.readFileSync(b.filePath);
      const { error: upErr } = await supabase.storage.from('bom-files').upload(storagePath, fileBuf, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });
      if (upErr) throw new Error(`storage: ${upErr.message}`);
      const { data: urlData, error: urlErr } = await supabase.storage
        .from('bom-files')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      if (urlErr || !urlData?.signedUrl) throw new Error(`signedUrl: ${urlErr?.message}`);

      // 2) cad_drawings
      const { data: newBoard, error: bErr } = await supabase
        .from('cad_drawings')
        .insert({
          board_name: b.boardName,
          artwork_manager: null,
          production_manager: null,
          production_quantity: b.productionQuantity || 0,
          status: 'completed',
          sales_order_number: null,
          is_migration_unconfirmed: true,
        })
        .select('id')
        .single();
      if (bErr) throw new Error(`cad_drawings: ${bErr.message}`);
      const cadId = newBoard.id;

      // 3) bom_raw_files (정리본만, 좌표 슬롯 비움)
      const { error: rawErr } = await supabase.from('bom_raw_files').insert({
        cad_drawing_id: cadId,
        bom_file_url: urlData.signedUrl,
        coordinate_file_url: null,
        bom_file_name: b.fileName,
        coordinate_file_name: null,
        uploaded_by: '이관(migration)',
      });
      if (rawErr) throw new Error(`bom_raw_files: ${rawErr.message}`);

      // 4) bom_items (1000행 단위 분할)
      const itemRows = b.items.map(it => ({ ...it, cad_drawing_id: cadId }));
      for (let j = 0; j < itemRows.length; j += 500) {
        const { error: iErr } = await supabase.from('bom_items').insert(itemRows.slice(j, j + 500));
        if (iErr) throw new Error(`bom_items: ${iErr.message}`);
      }

      // 5) part_placements
      const plRows = b.placements.map(p => ({ ...p, cad_drawing_id: cadId }));
      for (let j = 0; j < plRows.length; j += 500) {
        const { error: pErr } = await supabase.from('part_placements').insert(plRows.slice(j, j + 500));
        if (pErr) throw new Error(`part_placements: ${pErr.message}`);
      }

      inserted.push({ boardName: b.boardName, cadId, items: b.items.length, placements: b.placements.length });
    } catch (e) {
      insertFailed.push({ boardName: b.boardName, error: e.message });
    }
  }
  console.log('');

  const execSummary = {
    inserted: inserted.length,
    skippedExisting: skippedExisting.length,
    insertFailed: insertFailed.length,
  };
  console.log(JSON.stringify(execSummary, null, 2));
  fs.writeFileSync(
    path.join(REPORT_DIR, '이관_실행_리포트.json'),
    JSON.stringify({ execSummary, inserted, skippedExisting, insertFailed }, null, 2)
  );
  console.log(`📄 리포트: scripts/v7_분석결과/이관_실행_리포트.json`);
}

main().catch(e => {
  console.error('\n❌ 실패:', e);
  process.exit(1);
});
