function parseOrderNumberWithLineNew(input: string | null | undefined) {
  if (!input) return null
  const normalized = input.toUpperCase().replace(/\s+/g, '')

  const poWithLine = normalized.match(/^(F\d{8})[_-](\d{1,3})[-_](\d{1,3})(?:[-_]\d+|\(\d+\))?$/)
  if (poWithLine) {
    return {
      base: `${poWithLine[1]}_${poWithLine[2].padStart(3, '0')}`,
      lineNumber: parseInt(poWithLine[3], 10),
      type: 'PO',
    }
  }

  const poOnly = normalized.match(/^(F\d{8})[_-](\d{1,3})$/)
  if (poOnly) {
    return {
      base: `${poOnly[1]}_${poOnly[2].padStart(3, '0')}`,
      lineNumber: null,
      type: 'PO',
    }
  }

  const soWithLine = normalized.match(/^(HS\d{6})[-_](\d{1,2})[-_](\d{1,3})(?:[-_]\d+|\(\d+\))?$/)
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

const testCases = [
  "F20260422_007-22(2)",
  "F20260422_007-22-2",
  "F20260422_007-22_2",
  "F20260422_007-22",
  "F20260422_007",
  "HS260109-03-01",
  "HS260109-03-01(2)",
  "HS260109-03-01-2"
];

testCases.forEach(tc => {
  console.log(`${tc} =>`, parseOrderNumberWithLineNew(tc));
});
