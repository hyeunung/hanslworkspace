// ─── 제작현황 셀/행 색상·스타일 상태 유틸 ─────────────────────────────
// 색상/스타일 문자열 파싱 (예: 'yellow::strike::bold::redtext' -> { color, strike, bold, redText })
// 각 토큰은 '::'로 구분되며 배경색 / 취소선 / 볼드 / 빨간글자를 중복 지정할 수 있음 (하위호환 유지)
// ProductionListMain.tsx에서 분리한 순수 함수 — 동작 동일
export const COLOR_NAMES = ['yellow', 'blue', 'red', 'green'];

export type ColorState = { color: string | null, strike: 'strike' | 'nostrike' | null, bold: boolean, redText: boolean }

export const parseColorState = (value: string | null | undefined): ColorState => {
  const empty = { color: null as string | null, strike: null as 'strike' | 'nostrike' | null, bold: false, redText: false };
  if (!value) return empty;
  const result = { ...empty };
  for (const token of value.split('::')) {
    if (!token) continue;
    if (COLOR_NAMES.includes(token)) result.color = token;
    else if (token === 'strike' || token === 'nostrike') result.strike = token;
    else if (token === 'bold') result.bold = true;
    else if (token === 'redtext') result.redText = true;
  }
  return result;
};

// 색상/스타일 상태 직렬화 (지정된 항목만 '::'로 이어붙임)
export const serializeColorState = (color: string | null, strike: 'strike' | 'nostrike' | null, bold = false, redText = false) => {
  const parts: string[] = [];
  if (color) parts.push(color);
  if (strike) parts.push(strike);
  if (bold) parts.push('bold');
  if (redText) parts.push('redtext');
  return parts.length ? parts.join('::') : null;
};
