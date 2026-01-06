import ExcelJS from 'exceljs'

export interface AnnualLeaveUsageSummaryExcelRow {
  employeeId?: string
  name?: string
  grantedDays?: number
  usedDays: number
  months: Record<number, string> // 1~12
}

export async function generateAnnualLeaveUsageExcel(params: {
  summaries: AnnualLeaveUsageSummaryExcelRow[]
}): Promise<Blob> {
  const { summaries } = params

  const workbook = new ExcelJS.Workbook()

  // 요약 시트
  const wsSummary = workbook.addWorksheet('연차사용현황')
  wsSummary.columns = [
    { header: '사번', key: 'employeeId', width: 14 },
    { header: '이름', key: 'name', width: 12 },
    { header: '지급연차', key: 'grantedDays', width: 10 },
    { header: '사용일수', key: 'usedDays', width: 10 },
    { header: '1월', key: 'm1', width: 22 },
    { header: '2월', key: 'm2', width: 22 },
    { header: '3월', key: 'm3', width: 22 },
    { header: '4월', key: 'm4', width: 22 },
    { header: '5월', key: 'm5', width: 22 },
    { header: '6월', key: 'm6', width: 22 },
    { header: '7월', key: 'm7', width: 22 },
    { header: '8월', key: 'm8', width: 22 },
    { header: '9월', key: 'm9', width: 22 },
    { header: '10월', key: 'm10', width: 24 },
    { header: '11월', key: 'm11', width: 24 },
    { header: '12월', key: 'm12', width: 24 }
  ]

  wsSummary.getRow(1).font = { name: '맑은 고딕', bold: true }
  wsSummary.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }

  // 이름 오름차순 정렬(동률이면 사번)
  const sorted = [...summaries].sort((a, b) => {
    const nameA = (a.name ?? '').toString()
    const nameB = (b.name ?? '').toString()
    const cmp = nameA.localeCompare(nameB)
    if (cmp !== 0) return cmp
    return (a.employeeId ?? '').toString().localeCompare((b.employeeId ?? '').toString())
  })

  sorted.forEach((row) => {
    wsSummary.addRow({
      employeeId: row.employeeId ?? '',
      name: row.name ?? '',
      grantedDays: row.grantedDays ?? '',
      usedDays: row.usedDays,
      m1: row.months[1] ?? '',
      m2: row.months[2] ?? '',
      m3: row.months[3] ?? '',
      m4: row.months[4] ?? '',
      m5: row.months[5] ?? '',
      m6: row.months[6] ?? '',
      m7: row.months[7] ?? '',
      m8: row.months[8] ?? '',
      m9: row.months[9] ?? '',
      m10: row.months[10] ?? '',
      m11: row.months[11] ?? '',
      m12: row.months[12] ?? ''
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}


