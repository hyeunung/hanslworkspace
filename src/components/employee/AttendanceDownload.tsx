import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Combobox, ComboboxOption } from '@/components/ui/combobox'
import { Download, Calendar, User, X } from 'lucide-react'
import { Employee } from '@/types/purchase'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { generateAttendanceExcel, formatDateWithDay } from '@/utils/exceljs/generateAttendanceExcel'

interface AttendanceDownloadProps {
  employees: Employee[]
  isOpen: boolean
  onClose: () => void
}

export default function AttendanceDownload({ employees, isOpen, onClose }: AttendanceDownloadProps) {
  const [selectedEmployee, setSelectedEmployee] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isDownloading, setIsDownloading] = useState(false)
  
  const supabase = createClient()

  // 기본 날짜 설정 (이번 달)
  const setCurrentMonth = () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    
    setStartDate(start.toISOString().split('T')[0])
    setEndDate(end.toISOString().split('T')[0])
  }

  // 지난 달 설정
  const setLastMonth = () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    
    setStartDate(start.toISOString().split('T')[0])
    setEndDate(end.toISOString().split('T')[0])
  }

  const handleDownload = async () => {
    if (!selectedEmployee) {
      toast.error('직원을 선택해주세요.')
      return
    }
    
    if (!startDate || !endDate) {
      toast.error('조회 기간을 설정해주세요.')
      return
    }
    
    if (new Date(startDate) > new Date(endDate)) {
      toast.error('시작일이 종료일보다 늦을 수 없습니다.')
      return
    }

    setIsDownloading(true)
    
    try {
      // 선택된 직원 정보 가져오기
      const selectedEmp = employees.find(emp => emp.id === selectedEmployee)
      if (!selectedEmp) {
        throw new Error('선택된 직원 정보를 찾을 수 없습니다.')
      }

      // 출근 기록 조회
      const { data: attendanceRecords, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('employee_id', selectedEmployee)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })

      if (error) {
        throw new Error('출근 기록을 조회하는데 실패했습니다.')
      }

      // 날짜 범위 내의 모든 날짜 생성 (출근 기록이 없는 날도 포함)
      const allDates: string[] = []
      const start = new Date(startDate)
      const end = new Date(endDate)
      
      for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        allDates.push(date.toISOString().split('T')[0])
      }

      // 출근 기록을 날짜별로 매핑
      const recordMap = new Map()
      attendanceRecords?.forEach(record => {
        recordMap.set(record.date, record)
      })

      // 엑셀 데이터 구성
      const excelRecords = allDates.map(date => {
        const record = recordMap.get(date)
        const dateWithDay = formatDateWithDay(date)
        const dayOfWeek = dateWithDay.split('(')[1]?.split(')')[0] || ''
        
        // 주말인지 확인 (토요일: 6, 일요일: 0)
        const dateObj = new Date(date)
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6
        
        return {
          date: dateWithDay,
          dayOfWeek,
          employeeName: selectedEmp.name || '',
          employeeId: selectedEmp.employeeID || selectedEmp.employee_number || '',
          department: selectedEmp.department || '',
          position: selectedEmp.position || '',
          workType: '사원', // 기본값, 필요시 데이터베이스에서 가져올 수 있음
          clockIn: record?.clock_in || (isWeekend ? '-' : ''),
          clockOut: record?.clock_out || (isWeekend ? '-' : ''),
          status: record?.status === '정상 출근' ? '정상 출근' : (record?.status || (isWeekend ? '' : '')),
          remarks: record?.remarks || ''
        }
      })

      // 엑셀 파일 생성
      const excelData = {
        employeeName: selectedEmp.name || '',
        employeeId: selectedEmp.employeeID || '',
        department: selectedEmp.department || '',
        startDate,
        endDate,
        records: excelRecords
      }

      const blob = await generateAttendanceExcel(excelData)
      
      // 파일 다운로드
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `출근현황표_${selectedEmp.name}_${startDate}_${endDate}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      
      toast.success('출근현황표가 다운로드되었습니다.')
      
      // 다운로드 성공 후 모달 닫기
      onClose()
      
    } catch (error) {
      console.error('출근현황표 다운로드 오류:', error)
      toast.error(error instanceof Error ? error.message : '다운로드 중 오류가 발생했습니다.')
    } finally {
      setIsDownloading(false)
    }
  }

  // 모달이 닫힐 때 상태 초기화
  const handleClose = () => {
    setSelectedEmployee('')
    setStartDate('')
    setEndDate('')
    setIsDownloading(false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        {/* 헤더 */}
        <DialogHeader className="pb-6 space-y-3">
          <DialogTitle className="flex items-center text-2xl font-bold text-gray-900">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-hansl-400 to-hansl-600 flex items-center justify-center mr-4 shadow-sm">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            출근현황표 다운로드
          </DialogTitle>
          <p className="text-gray-600 leading-relaxed pl-16">
            직원과 조회 기간을 선택하여 출근현황을<br />
            엑셀 파일로 간편하게 다운로드하세요
          </p>
        </DialogHeader>
        
        {/* 콘텐츠 */}
        <div className="space-y-8 py-2">
          {/* 직원 선택 섹션 */}
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">직원 선택</h3>
            </div>
            <div className="pl-11">
              <Combobox
                value={selectedEmployee}
                onValueChange={setSelectedEmployee}
                options={employees
                  .filter(emp => emp.name && emp.name.trim() !== '')
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map((employee): ComboboxOption => ({
                    value: employee.id,
                    label: `${employee.name} (${employee.department || '부서없음'})`
                  }))}
                placeholder="직원명 검색..."
                searchPlaceholder="직원 이름 검색..."
                emptyText="검색 결과가 없습니다"
                className="h-10 text-sm border-gray-200 focus:border-hansl-400 focus:ring-1 focus:ring-hansl-100"
              />
            </div>
          </div>

          {/* 기간 선택 섹션 */}
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">조회 기간</h3>
            </div>
            <div className="pl-11 space-y-4">
              {/* 날짜 입력 */}
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
              
              {/* 빠른 선택 */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">빠른 선택</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={setCurrentMonth}
                    className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                  >
                    이번 달
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={setLastMonth}
                    className="h-8 px-4 text-sm border-gray-200 hover:bg-hansl-50 hover:border-hansl-300 hover:text-hansl-700 transition-colors"
                  >
                    지난 달
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 액션 버튼 */}
        <div className="flex gap-3 pt-6 mt-2 border-t border-gray-100">
          <Button
            variant="outline"
            onClick={handleClose}
            className="flex-1 h-10 text-sm font-medium border-gray-200 hover:bg-gray-50 transition-colors"
            disabled={isDownloading}
          >
            취소
          </Button>
          <Button
            onClick={handleDownload}
            disabled={isDownloading || !selectedEmployee || !startDate || !endDate}
            className="flex-1 h-10 text-sm bg-gradient-to-r from-hansl-500 to-hansl-600 hover:from-hansl-600 hover:to-hansl-700 text-white font-medium shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4 mr-2" />
            {isDownloading ? '다운로드 중...' : '엑셀 다운로드'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}