import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar, Download } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { employeeService } from '@/services/employeeService'
import { calcAnnualLeaveUsageByWorkdays, classifyLeaveForAnnualUsage, type LeaveRow } from '@/utils/leave/calcAnnualLeaveWorkdays'
import { generateAnnualLeaveUsageExcel } from '@/utils/exceljs/generateAnnualLeaveUsageExcel'

interface AnnualLeaveUsageDownloadProps {
  isOpen: boolean
  onClose: () => void
}

export default function AnnualLeaveUsageDownload({ isOpen, onClose }: AnnualLeaveUsageDownloadProps) {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()))
  const [mode, setMode] = useState<'year' | 'range'>('year')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isDownloading, setIsDownloading] = useState(false)

  const supabase = createClient()

  const setThisYear = () => setYear(String(new Date().getFullYear()))
  const setLastYear = () => setYear(String(new Date().getFullYear() - 1))

  const setRangeThisYear = () => {
    const now = new Date()
    const y = now.getFullYear()
    setStartDate(`${y}-01-01`)
    setEndDate(`${y}-12-31`)
  }

  const setRangeLastYear = () => {
    const now = new Date()
    const y = now.getFullYear() - 1
    setStartDate(`${y}-01-01`)
    setEndDate(`${y}-12-31`)
  }

  const setRangeThisMonth = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const start = new Date(y, m, 1)
    const end = new Date(y, m + 1, 0)
    setStartDate(start.toISOString().slice(0, 10))
    setEndDate(end.toISOString().slice(0, 10))
  }

  const setRangeLastMonth = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() - 1
    const start = new Date(y, m, 1)
    const end = new Date(y, m + 1, 0)
    setStartDate(start.toISOString().slice(0, 10))
    setEndDate(end.toISOString().slice(0, 10))
  }

  // hansl 백엔드(연차 트리거/년도업데이트)와 동일한 법정연차 산식
  const calcGrantedAnnualLeaveForYear = (joinDateStr: string | undefined, targetYear: number): number => {
    if (!joinDateStr) return 0
    const joinDate = new Date(joinDateStr)
    if (Number.isNaN(joinDate.getTime())) return 0

    const joinYear = joinDate.getFullYear()
    const joinMonth = joinDate.getMonth() + 1 // 1~12
    const serviceYears = targetYear - joinYear

    if (serviceYears === 0) {
      const remainingMonths = 13 - joinMonth
      return Math.floor((15 * remainingMonths) / 12)
    }
    if (serviceYears === 1 || serviceYears === 2) return 15
    if (serviceYears >= 3) return Math.min(25, 15 + Math.floor((serviceYears - 1) / 2))
    return 0
  }

  const handleDownload = async () => {
    let yearNum: number
    let effectiveStart: string
    let effectiveEnd: string

    if (mode === 'year') {
      yearNum = Number(year)
      if (!year || Number.isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        toast.error('연도를 올바르게 입력해주세요. (예: 2025)')
        return
      }
      effectiveStart = `${yearNum}-01-01`
      effectiveEnd = `${yearNum}-12-31`
    } else {
      if (!startDate || !endDate) {
        toast.error('조회 기간을 설정해주세요.')
        return
      }
      if (new Date(startDate) > new Date(endDate)) {
        toast.error('시작일이 종료일보다 늦을 수 없습니다.')
        return
      }
      const y1 = new Date(startDate).getFullYear()
      const y2 = new Date(endDate).getFullYear()
      if (y1 !== y2) {
        toast.error('기간 선택은 같은 연도 안에서만 가능합니다.')
        return
      }
      yearNum = y1
      effectiveStart = startDate
      effectiveEnd = endDate
    }

    setIsDownloading(true)
    try {
      // 1) 기간 overlap 되는 leave 조회 (필터는 클라이언트에서 엄격 적용)
      const { data: leaveRows, error: leaveError } = await supabase
        .from('leave')
        // 스키마 차이(컬럼 유무)로 다운로드가 실패하지 않도록 전체 컬럼 조회
        .select('*')
        .lte('start_date', effectiveEnd)
        .gte('end_date', effectiveStart)
        .order('start_date', { ascending: true })

      if (leaveError) throw leaveError

      const leaves = (leaveRows || []) as LeaveRow[]
      if (leaves.length === 0) {
        toast.error('선택한 기간에 연차(승인) 기록이 없습니다.')
        return
      }

      // 1-1) 검증용: 포함/제외 leave 목록 구성(누락 확인)
      const includedLeaves = leaves
        .map((l) => {
          const cls = classifyLeaveForAnnualUsage(l)
          if (!cls.ok) return null
          return {
            id: l.id,
            user_email: l.user_email,
            start_date: l.start_date,
            end_date: l.end_date,
            unit: cls.unit,
            type: l.type ?? null,
            status: l.status ?? null,
            reason: l.reason ?? null
          }
        })
        .filter(Boolean) as any[]

      const excludedLeaves = leaves
        .map((l) => {
          const cls = classifyLeaveForAnnualUsage(l)
          if (cls.ok) return null
          return {
            id: l.id,
            user_email: l.user_email,
            start_date: l.start_date,
            end_date: l.end_date,
            excludeReason: cls.reason,
            type: l.type ?? null,
            status: l.status ?? null,
            reason: l.reason ?? null
          }
        })
        .filter(Boolean) as any[]

      // 3) 백엔드 leave(days/period) 기반으로 일자 상세 + 직원별 합계 계산
      const { summaries, details } = calcAnnualLeaveUsageByWorkdays({
        leaves,
        startDate: effectiveStart,
        endDate: effectiveEnd
      })

      if (summaries.length === 0 || details.length === 0) {
        toast.error('선택한 연도에 승인된 연차/반차(근무일 기준) 기록이 없습니다.')
        return
      }

      // 4) 직원 정보 매핑 (기간 내 기록이 있는 직원만: summaries 기반)
      const employeesResult = await employeeService.getEmployees({ is_active: undefined })
      if (!employeesResult.success || !employeesResult.data) {
        throw new Error(employeesResult.error || '직원 목록을 불러오지 못했습니다.')
      }
      const employees = employeesResult.data
      const empByEmail = new Map<string, any>()
      employees.forEach((e) => {
        if (e.email) empByEmail.set(e.email, e)
      })

      const targetEmails = new Set(summaries.map((s) => s.user_email))
      const targetEmployeeIds: string[] = []
      const employeeIdByEmail = new Map<string, string>()
      employees.forEach((e) => {
        if (!e.email || !targetEmails.has(e.email)) return
        if (!e.id) return
        employeeIdByEmail.set(e.email, e.id)
        targetEmployeeIds.push(e.id)
      })

      // 4-1) 월별 셀 문자열 생성: "3(1),19(0.5)" 형태
      const monthlyMap = new Map<string, Map<number, { day: number; unit: 1 | 0.5 }[]>>()
      details.forEach((d) => {
        const [y, m, dayStr] = d.date.split('-')
        if (!y || !m || !dayStr) return
        const month = Number(m)
        const day = Number(dayStr)
        if (Number.isNaN(month) || Number.isNaN(day)) return

        if (!monthlyMap.has(d.user_email)) monthlyMap.set(d.user_email, new Map())
        const byMonth = monthlyMap.get(d.user_email)!
        if (!byMonth.has(month)) byMonth.set(month, [])
        byMonth.get(month)!.push({ day, unit: d.unit })
      })

      const formatMonthCell = (email: string, month: number): string => {
        const byMonth = monthlyMap.get(email)
        const items = byMonth?.get(month) || []
        items.sort((a, b) => a.day - b.day)
        return items
          .map((it) => `${it.day}(${it.unit === 1 ? '1' : '0.5'})`)
          .join(',')
      }

      const summaryRows = summaries.map((s) => {
        const emp = empByEmail.get(s.user_email)
        const months: Record<number, string> = {} as any
        for (let m = 1; m <= 12; m++) {
          months[m] = formatMonthCell(s.user_email, m)
        }
        const grantedDays = calcGrantedAnnualLeaveForYear(emp?.join_date, yearNum)
        return {
          employeeId: emp?.employeeID || emp?.employee_number || '',
          name: emp?.name || '',
          // 2025년 지급연차는 “해당 연도 기준 법정연차 산식”으로 산출(백엔드 트리거/년도업데이트와 동일)
          grantedDays,
          usedDays: s.used_days,
          months
        }
      })

      // 5) 엑셀 생성 + 다운로드
      const blob = await generateAnnualLeaveUsageExcel({
        summaries: summaryRows,
        debug: {
          year: yearNum,
          includedLeaves,
          excludedLeaves
        }
      })

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = mode === 'year'
        ? `연차_사용현황_${yearNum}.xlsx`
        : `연차_사용현황_${effectiveStart}_${effectiveEnd}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('연차사용현황 엑셀이 다운로드되었습니다.')
      onClose()
    } catch (err: any) {
      const msg =
        err?.message ||
        (typeof err === 'string' ? err : '') ||
        '다운로드 중 오류가 발생했습니다.'
      toast.error(msg)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleClose = () => {
    setYear(String(new Date().getFullYear()))
    setMode('year')
    setStartDate('')
    setEndDate('')
    setIsDownloading(false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="pb-6 space-y-3">
          <DialogTitle className="flex items-center text-2xl font-bold text-gray-900">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-hansl-400 to-hansl-600 flex items-center justify-center mr-4 shadow-sm">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            연차사용현황 다운로드
          </DialogTitle>
          <p className="text-gray-600 leading-relaxed pl-16">
            연도를 선택하면 직원별 사용일수와 월별 상세(일자/단위)를<br />
            엑셀로 다운로드합니다
          </p>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* 모드 선택 */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'year' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('year')}
              className="h-8 px-4 text-sm"
            >
              연도 선택
            </Button>
            <Button
              type="button"
              variant={mode === 'range' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('range')}
              className="h-8 px-4 text-sm"
            >
              기간 선택
            </Button>
          </div>

          {mode === 'year' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">연도</label>
                <Input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  min={2000}
                  max={2100}
                  placeholder="예: 2025"
                  className="h-9 text-sm border-gray-200 focus:border-hansl-400 focus:ring-1 focus:ring-hansl-100"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setThisYear}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  올해
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setLastYear}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  작년
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">시작일</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 text-sm border-gray-200 focus:border-hansl-400 focus:ring-1 focus:ring-hansl-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">종료일</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9 text-sm border-gray-200 focus:border-hansl-400 focus:ring-1 focus:ring-hansl-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setRangeThisYear}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  올해
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setRangeLastYear}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  작년
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setRangeThisMonth}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  이번 달
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setRangeLastMonth}
                  className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                >
                  지난 달
                </Button>
              </div>

              <p className="text-xs text-gray-500">
                기간 선택은 엑셀 포맷(1~12월) 때문에 같은 연도 안에서만 가능합니다.
              </p>
            </div>
          )}

          <div className="pt-2">
            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full h-11 bg-hansl-600 hover:bg-hansl-700 text-white font-semibold shadow-sm"
            >
              {isDownloading ? (
                '다운로드 중...'
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  엑셀 다운로드
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


