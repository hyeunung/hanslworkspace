import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar, Download } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { employeeService } from '@/services/employeeService'
import { calcAnnualLeaveUsageByWorkdays, type LeaveRow } from '@/utils/leave/calcAnnualLeaveWorkdays'
import { generateAnnualLeaveUsageExcel } from '@/utils/exceljs/generateAnnualLeaveUsageExcel'

interface AnnualLeaveUsageDownloadProps {
  isOpen: boolean
  onClose: () => void
}

export default function AnnualLeaveUsageDownload({ isOpen, onClose }: AnnualLeaveUsageDownloadProps) {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()))
  const [isDownloading, setIsDownloading] = useState(false)

  const supabase = createClient()

  const setThisYear = () => setYear(String(new Date().getFullYear()))
  const setLastYear = () => setYear(String(new Date().getFullYear() - 1))

  const handleDownload = async () => {
    const yearNum = Number(year)
    if (!year || Number.isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      toast.error('연도를 올바르게 입력해주세요. (예: 2025)')
      return
    }
    const startDate = `${yearNum}-01-01`
    const endDate = `${yearNum}-12-31`

    setIsDownloading(true)
    try {
      // 1) 기간 overlap 되는 leave 조회 (필터는 클라이언트에서 엄격 적용)
      const { data: leaveRows, error: leaveError } = await supabase
        .from('leave')
        .select('id,user_email,start_date,end_date,type,status,reason')
        .lte('start_date', endDate)
        .gte('end_date', startDate)
        .order('start_date', { ascending: true })

      if (leaveError) throw leaveError

      const leaves = (leaveRows || []) as LeaveRow[]
      if (leaves.length === 0) {
        toast.error('선택한 기간에 연차(승인) 기록이 없습니다.')
        return
      }

      // 2) 공휴일 조회
      const { data: holidayRows, error: holidayError } = await supabase
        .from('holidays')
        .select('date')
        .gte('date', startDate)
        .lte('date', endDate)

      if (holidayError) throw holidayError
      const holidayDates = (holidayRows || []).map((r: any) => r.date).filter(Boolean)

      // 3) 근무일 기준으로 일자 상세 + 직원별 합계 계산
      const { summaries, details } = calcAnnualLeaveUsageByWorkdays({
        leaves,
        startDate,
        endDate,
        holidayDates
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

      // 4-0) 지급연차(선택 연도) 계산: monthly_attendance(year)의 earned_leave_days 합계
      const targetEmails = new Set(summaries.map((s) => s.user_email))
      const targetEmployeeIds: string[] = []
      const employeeIdByEmail = new Map<string, string>()
      employees.forEach((e) => {
        if (!e.email || !targetEmails.has(e.email)) return
        if (!e.id) return
        employeeIdByEmail.set(e.email, e.id)
        targetEmployeeIds.push(e.id)
      })

      const grantedByEmployeeId = new Map<string, number>()
      if (targetEmployeeIds.length > 0) {
        const { data: monthlyRows, error: monthlyError } = await supabase
          .from('monthly_attendance')
          .select('employee_id, earned_leave_days')
          .eq('year', yearNum)
          .in('employee_id', targetEmployeeIds)

        if (monthlyError) throw monthlyError

        ;(monthlyRows || []).forEach((r: any) => {
          const empId = r.employee_id
          const val = Number(r.earned_leave_days ?? 0)
          grantedByEmployeeId.set(empId, (grantedByEmployeeId.get(empId) ?? 0) + (Number.isNaN(val) ? 0 : val))
        })
      }

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
        const empId = employeeIdByEmail.get(s.user_email)
        const grantedDaysFromMonthly = empId ? (grantedByEmployeeId.get(empId) ?? undefined) : undefined
        return {
          employeeId: emp?.employeeID || emp?.employee_number || '',
          name: emp?.name || '',
          // 선택 연도의 지급연차(=earned_leave_days 합계)가 있으면 그 값을 우선 사용, 없으면 직원 테이블 값을 fallback
          grantedDays: grantedDaysFromMonthly ?? (emp?.annual_leave_granted_current_year ?? 0),
          usedDays: s.used_days,
          months
        }
      })

      // 5) 엑셀 생성 + 다운로드
      const blob = await generateAnnualLeaveUsageExcel({
        summaries: summaryRows
      })

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `연차_사용현황_${yearNum}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('연차사용현황 엑셀이 다운로드되었습니다.')
      onClose()
    } catch (err: any) {
      toast.error(err?.message || '다운로드 중 오류가 발생했습니다.')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleClose = () => {
    setYear(String(new Date().getFullYear()))
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
          {/* 연도 선택 */}
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


