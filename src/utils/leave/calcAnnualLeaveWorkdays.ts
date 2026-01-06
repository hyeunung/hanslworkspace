export interface LeaveRow {
  id?: number | string
  user_email: string
  start_date: string
  end_date: string
  type?: string | null
  status?: string | null
  reason?: string | null
}

export interface AnnualLeaveUsageDetailRow {
  user_email: string
  date: string // YYYY-MM-DD
  dayOfWeek: string // '일'...'토'
  unit: 1 | 0.5
  leave_id?: number | string
  leave_start_date: string
  leave_end_date: string
  reason?: string | null
}

export interface AnnualLeaveUsageSummary {
  user_email: string
  used_days: number
}

const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

function toDateOnly(dateStr: string): Date {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isApprovedAnnualLeave(leave: LeaveRow): boolean {
  const typeRaw = (leave.type ?? '').toString()
  const reasonRaw = (leave.reason ?? '').toString()
  const statusRaw = (leave.status ?? '').toString()

  const type = typeRaw.toLowerCase()
  const reason = reasonRaw.toLowerCase()
  const status = statusRaw.toLowerCase()

  const isApproved =
    status === 'approved' ||
    status.includes('approved') ||
    status.includes('승인')

  // 연차/반차 모두 포함 (단위는 별도 계산)
  const isAnnualOrHalf =
    type.includes('annual') ||
    type.includes('연차') ||
    type.includes('half') ||
    type.includes('반차') ||
    reason.includes('half') ||
    reason.includes('반차') ||
    reason.includes('0.5')

  return isApproved && isAnnualOrHalf
}

export function getLeaveUnit(leave: LeaveRow): 1 | 0.5 {
  const typeRaw = (leave.type ?? '').toString()
  const reasonRaw = (leave.reason ?? '').toString()
  const type = typeRaw.toLowerCase()
  const reason = reasonRaw.toLowerCase()

  const isHalfKeyword =
    type.includes('half') ||
    type.includes('반차') ||
    reason.includes('half') ||
    reason.includes('반차') ||
    reason.includes('0.5')

  // 반차는 보통 단일 날짜여서, start=end인 경우만 0.5로 처리 (범위 반차는 안전하게 1로 처리)
  if (isHalfKeyword && leave.start_date === leave.end_date) return 0.5
  return 1
}

export function calcAnnualLeaveUsageByWorkdays(params: {
  leaves: LeaveRow[]
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  holidayDates: string[] // YYYY-MM-DD
}): { summaries: AnnualLeaveUsageSummary[]; details: AnnualLeaveUsageDetailRow[] } {
  const { leaves, startDate, endDate, holidayDates } = params

  const rangeStart = toDateOnly(startDate)
  const rangeEnd = toDateOnly(endDate)
  const holidaysSet = new Set(holidayDates)

  const details: AnnualLeaveUsageDetailRow[] = []
  const usedByEmail = new Map<string, number>()

  leaves.forEach((leave) => {
    if (!isApprovedAnnualLeave(leave)) return
    const unit = getLeaveUnit(leave)

    const leaveStart = toDateOnly(leave.start_date)
    const leaveEnd = toDateOnly(leave.end_date)

    const effectiveStart = leaveStart > rangeStart ? leaveStart : rangeStart
    const effectiveEnd = leaveEnd < rangeEnd ? leaveEnd : rangeEnd

    if (effectiveStart > effectiveEnd) return

    const cursor = new Date(effectiveStart)
    for (; cursor <= effectiveEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dow = cursor.getDay()
      // 주말 제외 (0:일, 6:토)
      if (dow === 0 || dow === 6) continue

      const ymd = formatYmd(cursor)
      // 공휴일 제외
      if (holidaysSet.has(ymd)) continue

      details.push({
        user_email: leave.user_email,
        date: ymd,
        dayOfWeek: KOREAN_DAYS[dow],
        unit,
        leave_id: leave.id,
        leave_start_date: leave.start_date,
        leave_end_date: leave.end_date,
        reason: leave.reason ?? null
      })

      usedByEmail.set(leave.user_email, (usedByEmail.get(leave.user_email) ?? 0) + unit)
    }
  })

  const summaries: AnnualLeaveUsageSummary[] = Array.from(usedByEmail.entries())
    .map(([user_email, used_days]) => ({ user_email, used_days }))
    .sort((a, b) => b.used_days - a.used_days)

  // 상세는 이메일/날짜 기준 정렬
  details.sort((a, b) => {
    if (a.user_email !== b.user_email) return a.user_email.localeCompare(b.user_email)
    return a.date.localeCompare(b.date)
  })

  return { summaries, details }
}


