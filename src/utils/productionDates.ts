// ─────────────────────────────────────────────────────────────
// 제작현황 날짜/메모 입력·표시 포맷 유틸
// ProductionListMain.tsx에서 분리한 순수 함수 모음 — 동작 동일
// ─────────────────────────────────────────────────────────────

// Date utilities for formatting text inputs (e.g. 7/6 -> 07월 06일)
export const formatDbDateToDisplay = (dbDate: string | null | undefined): string => {
  if (!dbDate || dbDate.trim() === '' || dbDate === '-') return '-월 -일';
  const match = dbDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}월 ${match[3]}일`;
  }
  return dbDate;
};

export const formatDisplayDateToDb = (displayDate: string | null | undefined): string | null => {
  if (!displayDate || displayDate.trim() === '' || displayDate === '-') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
    return displayDate;
  }
  const match = displayDate.match(/(\d+)월\s*(\d+)일/);
  if (match) {
    const year = new Date().getFullYear();
    const mm = match[1].padStart(2, '0');
    const dd = match[2].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  const numbers = displayDate.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    const year = new Date().getFullYear();
    const mm = numbers[0].padStart(2, '0');
    const dd = numbers[1].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  return null;
};

export const parseAndFormatInputDate = (val: string, defaultMonth?: number | null): string => {
  if (!val) return '';
  const clean = val.trim();
  if (!clean) return '';
  if (clean.includes('월') && clean.includes('일')) {
    // 'YYYY년 MM월 DD일'처럼 연도가 있으면 연도를 보존하여 ISO로 승격
    const ky = clean.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (ky) return `${ky[1]}-${ky[2].padStart(2, '0')}-${ky[3].padStart(2, '0')}`;
    return clean;
  }
  const numbers = clean.match(/\d+/g);
  if (!numbers || numbers.length === 0) return val;

  // 입력에 4자리 연도가 있으면 그 연도를 보존하여 ISO(YYYY-MM-DD)로 반환.
  // (formatDisplayDateToDb가 ISO 형식은 그대로 통과시키므로 연도가 유지된다)
  if (numbers.length >= 3 && numbers[0].length === 4) {
    const yStr = numbers[0];
    const mm = String(Math.min(12, Math.max(1, parseInt(numbers[1], 10)))).padStart(2, '0');
    const dd = String(Math.min(31, Math.max(1, parseInt(numbers[2], 10)))).padStart(2, '0');
    return `${yStr}-${mm}-${dd}`;
  }

  let month = defaultMonth || (new Date().getMonth() + 1);
  let day = 1;

  if (numbers.length >= 2) {
    month = parseInt(numbers[0], 10);
    day = parseInt(numbers[1], 10);
  } else if (numbers.length === 1) {
    day = parseInt(numbers[0], 10);
  }

  const mStr = String(Math.min(12, Math.max(1, month))).padStart(2, '0');
  const dStr = String(Math.min(31, Math.max(1, day))).padStart(2, '0');
  return `${mStr}월 ${dStr}일`;
};

// ASS'Y(환화/에버텍)처럼 '날짜 또는 메모' 하이브리드 칼럼용 유틸.
// 입력 '전체'가 날짜 토큰일 때만 날짜로 인식하고, 그 외(숫자가 섞인 메모 포함)는 메모 원문으로 취급한다.
export const isDateLikeInput = (raw: string | null | undefined): boolean => {
  const s = (raw || '').trim();
  if (!s) return false;
  // 2026-07-06 / 2026.7.6 / 2026/07/06
  if (/^\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}$/.test(s)) return true;
  // 7/6 / 12-26 / 7.6
  if (/^\d{1,2}\s*[.\-/]\s*\d{1,2}$/.test(s)) return true;
  // 7월 6일 / 2026년 7월 6일 / 7월6일
  if (/^(\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일$/.test(s)) return true;
  return false;
};

// 하이브리드 칼럼 저장값 계산: 날짜 토큰이면 YYYY-MM-DD, 아니면 메모 원문, 빈값이면 null
export const toDateOrMemo = (val: string, defaultMonth?: number | null): string | null => {
  if (!val || val.trim() === '') return null;
  if (isDateLikeInput(val)) {
    const db = formatDisplayDateToDb(parseAndFormatInputDate(val, defaultMonth));
    if (db) return db;
  }
  return val;
};

// 하이브리드 칼럼 표시값: YYYY-MM-DD -> 'MM월 DD일', 그 외는 메모 원문, 빈값은 '-'
export const formatDateOrMemo = (value: string | null | undefined): string => {
  if (!value || value.trim() === '' || value === '-') return '-';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[2]}월 ${m[3]}일`;
  return value;
};

// 완제품 입고 표시 정규화: 경로별로 섞인 값을 'MM월 DD일'로 통일해 보여준다.
// - ISO(YYYY-MM-DD) → 'MM월 DD일' (엑셀 임포트분)
// - 'MM월 DD일 입고' → 'MM월 DD일' (버튼 스탬프 구형: '입고' 제거)
// - 그 외(완료/납품/분할입고 메모 등)는 의미가 있어 원문 유지
export const formatStockInDisplay = (value: string | null | undefined): string => {
  if (!value) return '-';
  const s = String(value).trim();
  if (!s || s === '-') return '-';
  // ISO(YYYY-MM-DD) → MM월 DD일 (엑셀 임포트분)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}월 ${iso[3]}일`;
  // 'MM월 DD일' + 선택적 상태어(입고/완료/납품) → MM월 DD일
  const md = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(?:입고|완료|납품))?$/);
  if (md) return `${md[1].padStart(2, '0')}월 ${md[2].padStart(2, '0')}일`;
  // 'M/D' 또는 'M/D 입고' → MM월 DD일
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\s*입고)?$/);
  if (slash) return `${slash[1].padStart(2, '0')}월 ${slash[2].padStart(2, '0')}일`;
  // 그 외(분할입고 수량/재고/회수 메모, 오타 등)는 의미가 있어 원문 유지
  return s;
};

// 입고완료(PCB 제작) / 배송완료(납품) 표시 정규화: 완제품입고와 달리 'M/D 완료' 형식(0채움 없음)으로 통일
// - ISO(YYYY-MM-DD) → 'M/D 완료'
// - 'MM월 DD일'/'M/D' + 선택적 상태어 → 'M/D 완료'
// - 그 외 메모 원문은 의미가 있어 유지
export const formatCompletedDisplay = (value: string | null | undefined): string => {
  if (!value) return '-';
  const s = String(value).trim();
  if (!s || s === '-') return '-';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])} 완료`;
  const md = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(?:입고|완료|납품|배송))?$/);
  if (md) return `${Number(md[1])}/${Number(md[2])} 완료`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\s*(?:입고|완료|배송))?$/);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])} 완료`;
  return s;
};

// 입고/배송 대기 버튼 문구·팝오버 라벨: 완제품입고류는 '입고', 배송완료는 '배송'으로 구분
export const STOCK_WAITING_LABEL: Record<string, string> = {
  final_product_stock: '입고대기',
  cable_actual_date: '입고대기',
  pcb_stock_completed: '입고대기',
  delivery_completed: '배송대기',
}
export const stockPickerLabel = (field: string): string => field === 'delivery_completed' ? '배송일' : '입고일'
