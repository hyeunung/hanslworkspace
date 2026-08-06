// 거래명세서 날짜 추출/검증 공용 모듈.
//
// 배경(TS-20260806-0002 사고): 행 전체를 문자열로 이어붙인 뒤 느슨한 정규식으로
// 날짜를 찾는 방식은 서로 다른 셀의 숫자가 결합해 가짜 날짜를 만든다.
// (엑셀 날짜 시리얼 "46205" + 금액 "400000" → "6205-40-01" → date 칼럼 update 전체 실패)
//
// 원칙:
// 1. 날짜는 셀 단위로만 해석한다 — 행을 이어붙인 텍스트에 날짜 정규식을 돌리지 않는다.
// 2. 텍스트에서 연-월만 뽑을 때는 '월' 마커가 반드시 있어야 한다.
// 3. 어떤 경로로 얻은 값이든 DB에 쓰기 전 sanitizeStatementDate를 통과해야 한다.
//    (검증 실패 → null: 날짜 하나 때문에 추출 전체가 실패하는 일이 없도록)

const MIN_YEAR = 2000
const MAX_YEAR = 2099

// 위 연도 범위에 대응하는 엑셀 날짜 시리얼(1900 date system, epoch 1899-12-30)
const MIN_EXCEL_SERIAL = 36526  // 2000-01-01
const MAX_EXCEL_SERIAL = 73050  // 2099-12-31

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isValidStatementDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  return true
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * DB 쓰기 직전 최종 게이트. 유효한 YYYY-MM-DD만 통과시키고 그 외에는 null.
 * transaction_statements.statement_date 에 값을 쓰는 모든 곳은 반드시 이 함수를 거친다.
 */
export function sanitizeStatementDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, y, m, d] = match
  if (!isValidStatementDateParts(Number(y), Number(m), Number(d))) return null
  return text
}

/** 엑셀 날짜 시리얼(1900 date system) → YYYY-MM-DD. 통상 범위 밖 숫자는 날짜로 보지 않는다. */
export function excelSerialToISODate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const whole = Math.floor(serial)
  if (whole < MIN_EXCEL_SERIAL || whole > MAX_EXCEL_SERIAL) return null
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + whole * 86400000)
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/**
 * 텍스트(셀 하나 또는 파일명 등 사람이 쓴 문자열)에서 날짜 추출.
 * - 완전한 날짜: 2026년 7월 2일 / 2026.07.02 / 2026-7-2 / 2026/07/02
 * - 연-월: 2026년 7월 / 2026.07월 / 2026-07월 — '월' 마커 필수, 일자는 01로 보정
 * - 구분자로 공백만 있는 숫자 나열("46205 400000")은 날짜로 인정하지 않는다.
 */
export function extractStatementDateFromText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null

  const fullDate = text.match(/(\d{4})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?/)
  if (fullDate) {
    const year = Number(fullDate[1])
    const month = Number(fullDate[2])
    const day = Number(fullDate[3])
    if (isValidStatementDateParts(year, month, day)) {
      return formatDate(year, month, day)
    }
  }

  const yearMonth = text.match(/(\d{4})\s*(?:년|[.\-/])?\s*(\d{1,2})\s*월/)
  if (yearMonth) {
    const year = Number(yearMonth[1])
    const month = Number(yearMonth[2])
    if (isValidStatementDateParts(year, month, 1)) {
      return formatDate(year, month, 1)
    }
  }

  return null
}

/**
 * 엑셀 셀 값 하나에서 날짜 추출. (Date 인스턴스 / 날짜 시리얼 숫자 / 텍스트)
 * 행을 이어붙인 문자열이 아니라 반드시 개별 셀 값을 넘길 것.
 *
 * allowSerial: 순수 숫자를 엑셀 날짜 시리얼로 해석할지 여부. 날짜 시리얼 범위(36526~73050)는
 * 금액(예: 45,000원)과 겹치므로, 헤더가 '일자'류로 확인된 칼럼의 셀에만 true를 줄 것.
 */
export function extractStatementDateFromCell(cell: unknown, allowSerial = false): string | null {
  if (cell === null || cell === undefined || cell === '') return null

  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const candidate = formatDate(cell.getFullYear(), cell.getMonth() + 1, cell.getDate())
    return sanitizeStatementDate(candidate)
  }

  if (typeof cell === 'number') {
    return allowSerial ? excelSerialToISODate(cell) : null
  }

  const text = String(cell).trim()
  if (!text) return null

  // "46205" 처럼 문자열로 들어온 날짜 시리얼
  if (/^\d{5}$/.test(text)) {
    return allowSerial ? excelSerialToISODate(Number(text)) : null
  }

  return extractStatementDateFromText(text)
}
