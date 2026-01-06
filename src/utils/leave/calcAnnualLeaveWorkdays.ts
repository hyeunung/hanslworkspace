export interface LeaveRow {
  id?: number | string
  user_email: string
  start_date: string
  end_date: string
  days?: number | string | null
  start_period?: string | null
  end_period?: string | null
  type?: string | null
  status?: string | null
  reason?: string | null
}

export type LeaveMatchReason =
  | 'included'
  | 'not_approved'
  | 'not_annual_or_half'

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

export function classifyLeaveForAnnualUsage(leave: LeaveRow): {
  ok: boolean
  reason: LeaveMatchReason
  unit: 1 | 0.5
} {
  const statusRaw = (leave.status ?? '').toString()
  const status = statusRaw.toLowerCase()
  const isApproved =
    status === 'approved' ||
    status.includes('approved') ||
    status.includes('승인')

  if (!isApproved) {
    return { ok: false, reason: 'not_approved', unit: 1 }
  }

  const typeRaw = (leave.type ?? '').toString()
  const reasonRaw = (leave.reason ?? '').toString()
  const type = typeRaw.toLowerCase()
  const reason = reasonRaw.toLowerCase()

  const isAnnualOrHalf =
    type.includes('annual') ||
    type.includes('연차') ||
    type.includes('half') ||
    type.includes('반차') ||
    reason.includes('half') ||
    reason.includes('반차') ||
    reason.includes('0.5')

  if (!isAnnualOrHalf) {
    return { ok: false, reason: 'not_annual_or_half', unit: 1 }
  }

  return { ok: true, reason: 'included', unit: getLeaveUnit(leave) }
}

export function getLeaveUnit(leave: LeaveRow): 1 | 0.5 {
  // 1) 백엔드 스키마에 days(DECIMAL(3,1))가 있으면 그걸 우선 사용
  const daysNum = Number(leave.days ?? NaN)
  if (!Number.isNaN(daysNum)) {
    if (daysNum === 0.5) return 0.5
    return 1
  }

  // 2) start_period/end_period 기반(half-day) 처리
  const sp = (leave.start_period ?? '').toString().toLowerCase()
  const ep = (leave.end_period ?? '').toString().toLowerCase()
  const hasHalfPeriod = (sp && sp !== 'full') || (ep && ep !== 'full')
  if (hasHalfPeriod && leave.start_date === leave.end_date) return 0.5

  // 3) fallback: type/reason 키워드
  const type = (leave.type ?? '').toString().toLowerCase()
  const reason = (leave.reason ?? '').toString().toLowerCase()
  const isHalfKeyword =
    type.includes('half') ||
    type.includes('반차') ||
    reason.includes('half') ||
    reason.includes('반차') ||
    reason.includes('0.5')
  if (isHalfKeyword && leave.start_date === leave.end_date) return 0.5
  return 1
}

export function calcAnnualLeaveUsageByWorkdays(params: {
  leaves: LeaveRow[]
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}): { summaries: AnnualLeaveUsageSummary[]; details: AnnualLeaveUsageDetailRow[] } {
  const { leaves, startDate, endDate } = params

  const rangeStart = toDateOnly(startDate)
  const rangeEnd = toDateOnly(endDate)

  const details: AnnualLeaveUsageDetailRow[] = []
  const usedByEmail = new Map<string, number>()

  leaves.forEach((leave) => {
    const cls = classifyLeaveForAnnualUsage(leave)
    if (!cls.ok) return
    // leave가 단일 날짜면 unit(0.5/1)을 쓰고, 여러 날짜면 날짜별로 분해(기본 1, 필요 시 period로 0.5)

    const leaveStart = toDateOnly(leave.start_date)
    const leaveEnd = toDateOnly(leave.end_date)

    const effectiveStart = leaveStart > rangeStart ? leaveStart : rangeStart
    const effectiveEnd = leaveEnd < rangeEnd ? leaveEnd : rangeEnd

    if (effectiveStart > effectiveEnd) return

    const cursor = new Date(effectiveStart)
    for (; cursor <= effectiveEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dow = cursor.getDay()
      const ymd = formatYmd(cursor)

      let dayUnit: 1 | 0.5 = 1
      // 단일 날짜면 백엔드 days/period 기반 unit을 사용
      if (leave.start_date === leave.end_date) {
        dayUnit = cls.unit
      } else {
        // 여러 날짜인데 period가 half면 첫날/마지막날에 반영
        const sp = (leave.start_period ?? '').toString().toLowerCase()
        const ep = (leave.end_period ?? '').toString().toLowerCase()
        const isFirst = ymd === leave.start_date
        const isLast = ymd === leave.end_date
        if (isFirst && sp && sp !== 'full') dayUnit = 0.5
        if (isLast && ep && ep !== 'full') dayUnit = 0.5
      }

      details.push({
        user_email: leave.user_email,
        date: ymd,
        dayOfWeek: KOREAN_DAYS[dow],
        unit: dayUnit,
        leave_id: leave.id,
        leave_start_date: leave.start_date,
        leave_end_date: leave.end_date,
        reason: leave.reason ?? null
      })

      usedByEmail.set(leave.user_email, (usedByEmail.get(leave.user_email) ?? 0) + dayUnit)
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


