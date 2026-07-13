/**
 * 이관된 bom_items.ref_list 의 범위 표기("U1~U4")를 개별 REF 로 전개하는 일회성 보정 스크립트.
 * 사용: node scripts/fix-migrated-ref-ranges.cjs
 */
const fs = require('fs');
const path = require('path');

function expandToken(tok) {
  const m = tok.match(/^([A-Za-z]+)(\d+)\s*~\s*([A-Za-z]*)(\d+)$/);
  if (!m) return [tok];
  const [, prefix, s0, prefix2, e0] = m;
  if (prefix2 && prefix2.toUpperCase() !== prefix.toUpperCase()) return [tok];
  const start = parseInt(s0, 10), end = parseInt(e0, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 500) return [tok];
  return Array.from({ length: end - start + 1 }, (_, i) => `${prefix}${start + i}`);
}

async function main() {
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 이관 보드의 bom_items 중 '~' 포함 ref_list 페이지 단위 조회
  const { data: boards, error: bErr } = await supabase
    .from('cad_drawings').select('id').eq('is_migration_unconfirmed', true);
  if (bErr) throw bErr;
  // 확인 완료된 이관 보드도 포함해야 하므로 bom_raw_files.uploaded_by 기준으로도 수집
  const { data: rawBoards, error: rErr } = await supabase
    .from('bom_raw_files').select('cad_drawing_id').eq('uploaded_by', '이관(migration)');
  if (rErr) throw rErr;
  const boardIds = [...new Set([...(boards || []).map(b => b.id), ...(rawBoards || []).map(b => b.cad_drawing_id)])];
  console.log(`대상 보드 ${boardIds.length}개`);

  let updated = 0;
  for (let i = 0; i < boardIds.length; i += 50) {
    const chunk = boardIds.slice(i, i + 50);
    const { data: items, error } = await supabase
      .from('bom_items')
      .select('id, ref_list')
      .in('cad_drawing_id', chunk);
    if (error) throw error;
    for (const item of items || []) {
      const refs = item.ref_list || [];
      if (!refs.some(r => r.includes('~'))) continue;
      const expanded = refs.flatMap(expandToken);
      const { error: uErr } = await supabase.from('bom_items').update({ ref_list: expanded }).eq('id', item.id);
      if (uErr) throw uErr;
      updated += 1;
    }
    process.stdout.write(`\r보드 ${Math.min(i + 50, boardIds.length)}/${boardIds.length}, 행 업데이트 ${updated}`);
  }
  console.log(`\n완료: ${updated}행 전개`);
}

main().catch(e => { console.error(e); process.exit(1); });
