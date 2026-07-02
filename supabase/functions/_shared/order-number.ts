// PO/SO 번호 파싱·정규화 공통 모듈
// 거래명세서 파싱 edge function 들이 공통으로 사용한다.

export type OrderType = 'PO' | 'SO'

export interface ParsedOrderNumber {
  base: string
  lineNumber: number | null
  type: OrderType
}

/**
 * 발주/수주번호를 base + lineNumber 로 분해한다.
 *
 * 지원 포맷:
 *   F20260121_001-07  → base=F20260121_001, lineNumber=7  (PO + 라인)
 *   F20260121_001     → base=F20260121_001, lineNumber=null (PO)
 *   HS260109-03-01    → base=HS260109-03,   lineNumber=1  (SO + 라인)
 *   HS260109-03       → base=HS260109-03,   lineNumber=null (SO)
 */
function normalizePoDatePart(rawDate: string): string {
  if (rawDate.length === 6) {
    return '20' + rawDate
  }
  if (rawDate.length === 7) {
    return '20' + rawDate.slice(1)
  }
  return rawDate
}

export function parseOrderNumberWithLine(input: string | null | undefined): ParsedOrderNumber | null {
  if (!input) return null
  const normalized = input.toUpperCase().replace(/\s+/g, '')

  const poWithLine = normalized.match(/^(F\d{6,8})[_-](\d{1,3})[-_](\d{1,3})$/)
  if (poWithLine) {
    const datePart = normalizePoDatePart(poWithLine[1].slice(1))
    return {
      base: `F${datePart}_${poWithLine[2].padStart(3, '0')}`,
      lineNumber: parseInt(poWithLine[3], 10),
      type: 'PO',
    }
  }

  const poOnly = normalized.match(/^(F\d{6,8})[_-](\d{1,3})$/)
  if (poOnly) {
    const datePart = normalizePoDatePart(poOnly[1].slice(1))
    return {
      base: `F${datePart}_${poOnly[2].padStart(3, '0')}`,
      lineNumber: null,
      type: 'PO',
    }
  }

  const soWithLine = normalized.match(/^(HS\d{6})[-_](\d{1,2})[-_](\d{1,3})$/)
  if (soWithLine) {
    return {
      base: `${soWithLine[1]}-${soWithLine[2].padStart(2, '0')}`,
      lineNumber: parseInt(soWithLine[3], 10),
      type: 'SO',
    }
  }

  const soOnly = normalized.match(/^(HS\d{6})[-_](\d{1,2})$/)
  if (soOnly) {
    return {
      base: `${soOnly[1]}-${soOnly[2].padStart(2, '0')}`,
      lineNumber: null,
      type: 'SO',
    }
  }

  return null
}

export function normalizeOrderNumber(input: string | null | undefined): string {
  return parseOrderNumberWithLine(input)?.base || ''
}

/**
 * 임의의 텍스트에서 PO/SO 번호 토큰을 찾아 정규화된 base 형태로 반환.
 * 셀 본문/비고 칼럼에서 발주번호 추출 시 사용.
 */
export function extractOrderNumber(text: string | null | undefined): string | null {
  if (!text) return null
  const normalized = text.toUpperCase().replace(/\s+/g, '')

  const exactPo = normalized.match(/F\d{6,8}[_-]\d{1,3}/g)
  if (exactPo?.length) return normalizeOrderNumber(exactPo[0])

  const exactSo = normalized.match(/HS\d{6}[-_]\d{1,2}/g)
  if (exactSo?.length) return normalizeOrderNumber(exactSo[0])

  return null
}
