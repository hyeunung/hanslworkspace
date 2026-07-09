// ─── 엑셀식 복사/붙여넣기 TSV 유틸 ─────────────────────────────────
// 엑셀이 클립보드에 쓰는 형식과 동일: 셀은 탭, 행은 줄바꿈으로 구분.
// 탭/줄바꿈/따옴표가 든 값은 "..."로 감싼다 (엑셀 규칙 그대로).
// ProductionListMain.tsx에서 분리한 순수 함수 — 동작 동일
export const toTsvCell = (v: any): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// 엑셀 호환 TSV 파서: "..." 안의 줄바꿈/탭은 셀 내용으로 취급
export const parseTsvGrid = (text: string): string[][] => {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === '\t') {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  row.push(cell); rows.push(row)
  // 엑셀 복사분은 끝에 개행이 붙어 빈 행이 생기므로 제거
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop()
  return rows
}
