/**
 * 이관 보드 created_at 백필 — 정리본 파일명에서 원본 작성 날짜를 추출해 반영.
 *
 * 목적: 이관 보드 832개가 전부 이관 실행일(created_at=now)로 찍혀 목록 상단을 점유하는 문제.
 * 정리본 원본 날짜로 백필하면 생성일 내림차순 정렬만으로 기존 보드 아래 + 연도 순서(H번호 순과 동일)가 된다.
 *
 * 날짜 추출 (bom_raw_files.bom_file_name 기준):
 *  - 구형식 `..._YYMMDD.xlsx`        → 20YY-MM-DD
 *  - 신형식 `...(YYMM).xlsx`         → 20YY-MM-15 (일자 미상 → 월 중간값)
 *  - 날짜 없음(`..._확인완료.xlsx` 등) → 보드명 HYY- 접두사에서 20YY-06-30, 그것도 없으면 미변경
 *
 * 사용: node scripts/backfill-migrated-created-at.cjs
 */
const fs = require('fs');
const path = require('path');

// 유효한 날짜만 인정 (연 2015~2026, 월 01~12, 일 01~31) — 날짜가 아닌 6자리 숫자 오인 방지
const valid = (yy, mm, dd) => {
  const y = 2000 + Number(yy);
  return y >= 2015 && y <= 2026 && Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31;
};

function dateFromFileName(fileName, boardName) {
  let m = fileName.match(/_(\d{2})(\d{2})(\d{2})(?:-검사중)?\.(xlsx|xls)$/i);
  if (m && valid(m[1], m[2], m[3])) return `20${m[1]}-${m[2]}-${m[3]}`;
  m = fileName.match(/\((\d{2})(\d{2})\)\.(xlsx|xls)$/i);
  if (m && valid(m[1], m[2], 15)) return `20${m[1]}-${m[2]}-15`;
  m = (boardName || '').match(/^H(\d{2})-/);
  if (m && valid(m[1], 6, 30)) return `20${m[1]}-06-30`;
  return null;
}

async function main() {
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 이관 보드 = bom_raw_files.uploaded_by 마커 기준 (확인 완료된 보드도 포함)
  const { data: rawRows, error } = await supabase
    .from('bom_raw_files')
    .select('cad_drawing_id, bom_file_name')
    .eq('uploaded_by', '이관(migration)');
  if (error) throw error;

  const ids = rawRows.map(r => r.cad_drawing_id);
  const nameById = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: boards, error: bErr } = await supabase
      .from('cad_drawings').select('id, board_name').in('id', ids.slice(i, i + 200));
    if (bErr) throw bErr;
    for (const b of boards || []) nameById.set(b.id, b.board_name);
  }

  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const date = dateFromFileName(r.bom_file_name || '', nameById.get(r.cad_drawing_id) || '');
    if (!date) { skipped += 1; continue; }
    // 한국시간 기준 정오로 저장 (KST 변환 표시 시 날짜가 밀리지 않게)
    const { error: uErr } = await supabase
      .from('cad_drawings')
      .update({ created_at: `${date}T12:00:00+09:00` })
      .eq('id', r.cad_drawing_id);
    if (uErr) throw uErr;
    updated += 1;
    if (updated % 50 === 0) process.stdout.write(`\r업데이트 ${updated}/${rawRows.length}`);
  }
  console.log(`\n완료: ${updated}건 백필, 날짜 미상 ${skipped}건 미변경`);
}

main().catch(e => { console.error(e); process.exit(1); });
