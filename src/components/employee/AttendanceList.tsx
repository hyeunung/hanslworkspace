
import { useState, useEffect, useMemo } from 'react'
import { employeeService } from '@/services/employeeService'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableHeader } from '@/components/ui/sortable-header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, X, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface AttendanceListProps {
  canManageEmployees: boolean
}

interface AttendanceRecord {
  id: number
  employee_id: string
  employee_name: string | null
  date: string
  clock_in: string | null
  clock_out: string | null
  status: string | null
  remarks: string | null
  note: string | null
  user_email: string | null
  created_at: string | null
  updated_at: string | null
  department: string | null
}

const STATUS_OPTIONS = ['정상 출근', '지각', '퇴근', '오전반차']

// 상태별 배지 스타일 (Flutter 앱 AppColors 기준)
const BADGE_CLASS = "badge-stats text-white w-[52px] text-center justify-center"

function getStatusBadge(status: string | null) {
  // 정규화: 다양한 상태값 변형을 통일
  const normalized = (() => {
    if (!status) return null
    const s = status.trim()
    if (s === '정상 출근' || s === '정상출근' || s === '정상' || s === '출근' || s === 'present') return '정상 출근'
    if (s === '출근 전') return '출근 전'
    return s
  })()

  switch (normalized) {
    case '정상 출근':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#34C759' }}>정상 출근</span>
    case '출근 전':
      return <span className={`${BADGE_CLASS} bg-gray-300`}>출근 전</span>
    case '지각':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF3B30' }}><span className="w-full flex justify-between"><span>지</span><span>각</span></span></span>
    case '퇴근':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#6B7280' }}><span className="w-full flex justify-between"><span>퇴</span><span>근</span></span></span>
    case '오전반차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF9500' }}>오전 반차</span>
    case '오후반차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#FF9500' }}>오후 반차</span>
    case '출장':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#1976D2' }}><span className="w-full flex justify-between"><span>출</span><span>장</span></span></span>
    case '연차':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#34C759' }}><span className="w-full flex justify-between"><span>연</span><span>차</span></span></span>
    case '공가':
      return <span className={BADGE_CLASS} style={{ backgroundColor: '#8E8E93' }}><span className="w-full flex justify-between"><span>공</span><span>가</span></span></span>
    default:
      return <span className={`${BADGE_CLASS} bg-gray-300`}>{status || '-'}</span>
  }
}

// 출퇴근 시간 없이 배지로 표기할 상태들
const NO_CLOCK_STATUSES: Record<string, { label: string; color: string }> = {
  '출장': { label: '출장', color: '#1976D2' },
  '연차': { label: '연차', color: '#34C759' },
  '공가': { label: '공가', color: '#8E8E93' },
}

// 시간 포맷 (HH:MM:SS → HH:MM)
function formatTime(time: string | null) {
  if (!time) return '-'
  return time.slice(0, 5)
}

// 출퇴근 시간 셀 렌더링 (시간이 없고 특정 상태면 배지 표시)
function renderClockCell(time: string | null, status: string | null) {
  if (time) return formatTime(time)
  const badge = status ? NO_CLOCK_STATUSES[status] : null
  if (badge) {
    const chars = badge.label.split('')
    if (chars.length === 2) {
      return <span className={BADGE_CLASS} style={{ backgroundColor: badge.color }}><span className="w-full flex justify-between"><span>{chars[0]}</span><span>{chars[1]}</span></span></span>
    }
    return <span className={BADGE_CLASS} style={{ backgroundColor: badge.color }}>{badge.label}</span>
  }
  return '-'
}

export default function AttendanceList({ canManageEmployees }: AttendanceListProps) {
  // 기본 날짜: 오늘 (KST)
  const getToday = () => {
    const now = new Date()
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const yyyy = kstNow.getUTCFullYear()
    const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(kstNow.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const [selectedDate, setSelectedDate] = useState(getToday())
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  // 인라인 편집 상태
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 데이터 조회
  const loadRecords = async () => {
    if (!selectedDate) return

    setLoading(true)
    try {
      const result = await employeeService.getAttendanceRecords(selectedDate, selectedDate)
      if (result.success && result.data) {
        setRecords(result.data)
      } else {
        toast.error(result.error || '출퇴근 기록을 불러오는데 실패했습니다.')
      }
    } catch {
      toast.error('출퇴근 기록을 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
      setHasLoaded(true)
    }
  }

  // 최초 마운트 시 로드
  useEffect(() => {
    loadRecords()
  }, [])

  // 날짜 변경 시 재조회
  useEffect(() => {
    if (hasLoaded) {
      loadRecords()
    }
  }, [selectedDate])

  // 클라이언트 사이드 필터링
  const filteredRecords = useMemo(() => {
    let result = records

    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase()
      result = result.filter((r) =>
        (r.employee_name && r.employee_name.toLowerCase().includes(keyword)) ||
        (r.user_email && r.user_email.toLowerCase().includes(keyword))
      )
    }

    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter)
    }

    return result
  }, [records, searchKeyword, statusFilter])

  // 정렬
  const { sortedData, sortConfig, handleSort } = useTableSort<AttendanceRecord>(
    filteredRecords,
    'employee_name',
    'asc'
  )

  // 빠른 날짜 이동
  const moveDate = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number)
    const date = new Date(y, m - 1, d + days)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    setSelectedDate(`${yyyy}-${mm}-${dd}`)
  }

  const goToToday = () => {
    setSelectedDate(getToday())
  }

  // 날짜 포맷 (요일 표시)
  const getDateLabel = () => {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    const date = new Date(selectedDate + 'T00:00:00')
    return `${selectedDate.replace(/-/g, '.')} (${days[date.getDay()]})`
  }

  // 인라인 편집 시작
  const startEdit = (record: AttendanceRecord) => {
    setEditingId(record.id)
    setEditClockIn(record.clock_in ? record.clock_in.slice(0, 5) : '')
    setEditClockOut(record.clock_out ? record.clock_out.slice(0, 5) : '')
    setEditStatus(record.status || '')
    setEditRemarks(record.remarks || '')
  }

  // 인라인 편집 취소
  const cancelEdit = () => {
    setEditingId(null)
  }

  // 인라인 편집 저장
  const saveEdit = async (record: AttendanceRecord) => {
    setIsSaving(true)
    try {
      const updates: { clock_in?: string | null; clock_out?: string | null; status?: string | null; remarks?: string | null } = {}

      if (editClockIn !== (record.clock_in?.slice(0, 5) || '')) {
        updates.clock_in = editClockIn ? `${editClockIn}:00` : null
      }
      if (editClockOut !== (record.clock_out?.slice(0, 5) || '')) {
        updates.clock_out = editClockOut ? `${editClockOut}:00` : null
      }
      if (editStatus !== (record.status || '')) {
        updates.status = editStatus || null
      }
      if (editRemarks !== (record.remarks || '')) {
        updates.remarks = editRemarks || null
      }

      if (Object.keys(updates).length === 0) {
        toast.info('변경된 내용이 없습니다.')
        setEditingId(null)
        return
      }

      const result = await employeeService.updateAttendanceRecord(record.id, updates)
      if (result.success) {
        toast.success(`${record.employee_name || ''} 출퇴근 기록이 수정되었습니다.`)
        setEditingId(null)
        loadRecords()
      } else {
        toast.error(result.error || '수정에 실패했습니다.')
      }
    } catch {
      toast.error('수정 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 필터 영역 */}
      <div className="bg-white business-radius-card border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* 상태 필터 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[100px] !h-7 !py-1 !px-2.5 !text-[11px] business-radius-button">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="정상 출근">정상 출근</SelectItem>
              <SelectItem value="지각">지각</SelectItem>
              <SelectItem value="퇴근">퇴근</SelectItem>
              <SelectItem value="오전반차">오전반차</SelectItem>
            </SelectContent>
          </Select>

          {/* 날짜 선택 */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => moveDate(-1)} className="text-gray-400 hover:text-gray-700 transition-colors p-1">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-[160px] business-radius-button"
            />
            <button type="button" onClick={() => moveDate(1)} className="text-gray-400 hover:text-gray-700 transition-colors p-1">
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button variant="outline" size="sm" onClick={goToToday} className="!h-7 !py-0 !text-[11px] business-radius-button">
              오늘
            </Button>
          </div>

          {/* 직원 검색 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="직원명"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="pl-8 w-[100px] business-radius-button"
            />
          </div>

          {(searchKeyword || statusFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearchKeyword(''); setStatusFilter('all') }}
              className="button-text"
            >
              <X className="h-4 w-4 mr-1" />
              초기화
            </Button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white business-radius-card border border-gray-200 w-fit">
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="button-text font-semibold text-gray-900">{getDateLabel()} 출퇴근 기록</h3>
            <span className="badge-stats bg-gray-100 text-gray-600">
              {loading ? '로딩 중...' : `${filteredRecords.length}명`}
            </span>
          </div>
        </div>

        {loading && !hasLoaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 card-subtitle">출퇴근 기록을 불러오는 중...</p>
            </div>
          </div>
        ) : sortedData.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="card-subtitle">해당 날짜에 출퇴근 기록이 없습니다.</p>
          </div>
        ) : (
          <Table className="w-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">
                  <SortableHeader
                    sortKey="employee_name"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                  >
                    직원명
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-[80px]">
                  <SortableHeader
                    sortKey="department"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                  >
                    부서
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-[70px]">
                  <SortableHeader
                    sortKey="clock_in"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                  >
                    출근시간
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-[70px]">
                  <SortableHeader
                    sortKey="clock_out"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                  >
                    퇴근시간
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-[65px]">
                  <SortableHeader
                    sortKey="status"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                  >
                    상태
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-[120px]">비고</TableHead>
                {canManageEmployees && <TableHead className="w-[50px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((record) => {
                const isEditing = editingId === record.id

                if (isEditing && canManageEmployees) {
                  return (
                    <TableRow key={record.id} className="bg-hansl-50/30">
                      <TableCell className="text-[11px] px-2 py-1.5 font-medium">{record.employee_name || '-'}</TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5 text-gray-500">{record.department || '-'}</TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <Input
                          type="time"
                          value={editClockIn}
                          onChange={(e) => setEditClockIn(e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] w-[100px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <Input
                          type="time"
                          value={editClockOut}
                          onChange={(e) => setEditClockOut(e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] w-[100px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <Select value={editStatus} onValueChange={setEditStatus}>
                          <SelectTrigger className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] w-[90px] business-radius-input border border-gray-300 bg-white text-gray-700">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <Input
                          value={editRemarks}
                          onChange={(e) => setEditRemarks(e.target.value)}
                          placeholder="비고"
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => saveEdit(record)}
                            disabled={isSaving}
                            className="h-5 w-5 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                }

                return (
                  <TableRow
                    key={record.id}
                    className={canManageEmployees ? 'cursor-pointer' : ''}
                    onClick={() => canManageEmployees && startEdit(record)}
                  >
                    <TableCell className="text-[11px] px-2 py-1.5 font-medium">{record.employee_name || '-'}</TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5 text-gray-500">{record.department || '-'}</TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5">{renderClockCell(record.clock_in, record.status)}</TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5">{renderClockCell(record.clock_out, record.status)}</TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5">{getStatusBadge(record.status)}</TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5 max-w-[200px] truncate text-gray-500">
                      {record.remarks || record.note || '-'}
                    </TableCell>
                    {canManageEmployees && (
                      <TableCell className="text-[11px] px-2 py-1.5 text-gray-400">수정</TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
