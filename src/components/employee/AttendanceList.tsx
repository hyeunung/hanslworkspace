
import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { employeeService } from '@/services/employeeService'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableHeader } from '@/components/ui/sortable-header'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, X, Check, ChevronLeft, ChevronRight, CalendarDays, RotateCcw } from 'lucide-react'
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
  position: string | null
}

const STATUS_OPTIONS = ['정상 출근', '지각', '퇴근', '오전반차']

// 상태 필터 드롭다운 기본 정렬 순서 (데이터에 있는 나머지 상태는 뒤에 붙음)
const STATUS_FILTER_ORDER = ['정상 출근', '지각', '퇴근', '오전반차', '오후반차', '출장', '연차', '공가', '출근 전']

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

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// KST 기준 오늘 (YYYY-MM-DD)
function getToday() {
  const now = new Date()
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kstNow.getUTCFullYear()
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kstNow.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// YYYY-MM-DD에 일수 더하기
function addDays(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// 날짜 라벨 (2026.09.01 (화))
function formatDateLabel(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return `${dateStr.replace(/-/g, '.')} (${DAY_LABELS[date.getDay()]})`
}

// 짧은 날짜 라벨 (09.01 (화)) — 표 날짜 칼럼용
function formatDateShort(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return `${dateStr.slice(5).replace(/-/g, '.')} (${DAY_LABELS[date.getDay()]})`
}

// 기간 프리셋
type PeriodPreset = 'today' | 'week' | 'month'

function presetRange(preset: PeriodPreset): { start: string; end: string } {
  const today = getToday()
  if (preset === 'today') return { start: today, end: today }
  if (preset === 'week') return { start: addDays(today, -6), end: today }
  return { start: `${today.slice(0, 7)}-01`, end: today }
}

// 필터 pill 내부 date input 인라인 스타일 (ReceiptFilterToolbar와 동일 규격)
const pillInputStyle: CSSProperties = {
  border: 'none', borderBottom: '1px solid #d1d5db', boxShadow: 'none', background: 'none', outline: 'none', width: '92px',
}

export default function AttendanceList({ canManageEmployees }: AttendanceListProps) {
  const [startDate, setStartDate] = useState(getToday())
  const [endDate, setEndDate] = useState(getToday())
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  // 여러 날 조회 여부 (날짜 칼럼 표시)
  const isRange = startDate !== endDate

  // 인라인 편집 상태
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 데이터 조회
  const loadRecords = useCallback(async () => {
    if (!startDate || !endDate) return

    setLoading(true)
    try {
      const result = await employeeService.getAttendanceRecords(startDate, endDate)
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
  }, [startDate, endDate])

  // 최초 마운트 + 기간 변경 시 로드
  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  // 실시간 구독: attendance_records 변경 시 자동 갱신
  useEffect(() => {
    const channel = supabase
      .channel('attendance-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, () => {
        void loadRecords()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, loadRecords])

  // 시작/종료가 뒤집히지 않게 보정하며 변경
  const changeStartDate = (value: string) => {
    if (!value) return
    setStartDate(value)
    if (value > endDate) setEndDate(value)
  }
  const changeEndDate = (value: string) => {
    if (!value) return
    setEndDate(value)
    if (value < startDate) setStartDate(value)
  }

  // 기간 길이(일수)만큼 앞뒤로 이동 (하루 조회면 하루씩)
  const rangeDays = useMemo(() => {
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T00:00:00')
    return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  }, [startDate, endDate])

  const moveRange = (direction: 1 | -1) => {
    setStartDate(addDays(startDate, direction * rangeDays))
    setEndDate(addDays(endDate, direction * rangeDays))
  }

  const activePreset = useMemo((): PeriodPreset | null => {
    for (const p of ['today', 'week', 'month'] as PeriodPreset[]) {
      const r = presetRange(p)
      if (r.start === startDate && r.end === endDate) return p
    }
    return null
  }, [startDate, endDate])

  const applyPreset = (preset: PeriodPreset) => {
    const r = presetRange(preset)
    setStartDate(r.start)
    setEndDate(r.end)
  }

  // 상태 필터 옵션: 기본 순서 + 데이터에 실제 존재하는 상태
  const statusOptions = useMemo(() => {
    const present = new Set(records.map((r) => r.status).filter(Boolean) as string[])
    const ordered = STATUS_FILTER_ORDER.filter((s) => present.has(s))
    const extras = Array.from(present).filter((s) => !STATUS_FILTER_ORDER.includes(s)).sort()
    return [...ordered, ...extras]
  }, [records])

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

  // 정렬 — 기본은 서비스 정렬(날짜 내림차순 → 직원명 오름차순), 헤더 클릭 시 해당 칼럼 정렬
  const { sortedData, sortConfig, handleSort } = useTableSort<AttendanceRecord>(filteredRecords)

  const hasActiveFilter = searchKeyword !== '' || statusFilter !== 'all'

  const resetFilters = () => {
    setSearchKeyword('')
    setStatusFilter('all')
  }

  // 표 제목 기간 라벨
  const rangeLabel = isRange
    ? `${formatDateLabel(startDate)} ~ ${formatDateLabel(endDate)}`
    : formatDateLabel(startDate)

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

  // 출근 시간 기반 상태 자동 계산 (정규직 08:30, 아르바이트 09:00)
  const calcStatus = (clockIn: string | null, clockOut: string | null, position: string | null): string => {
    if (!clockIn) return '출근 전'
    const inTime = clockIn.slice(0, 5)
    const lateThreshold = position === '아르바이트' ? '09:00' : '08:30'
    if (clockOut) return '퇴근'
    return inTime <= lateThreshold ? '정상 출근' : '지각'
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
      if (editRemarks !== (record.remarks || '')) {
        updates.remarks = editRemarks || null
      }

      // 시간이 변경되면 상태 자동 계산 (수동 상태 선택보다 시간 기반 자동 계산 우선)
      if ('clock_in' in updates || 'clock_out' in updates) {
        const finalClockIn = 'clock_in' in updates ? updates.clock_in : record.clock_in
        const finalClockOut = 'clock_out' in updates ? updates.clock_out : record.clock_out
        updates.status = calcStatus(finalClockIn ?? null, finalClockOut ?? null, record.position)
      } else if (editStatus !== (record.status || '')) {
        updates.status = editStatus || null
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
      {/* 필터 영역 (제작현황 표준): 검색란 + 기간 pill/프리셋 칩 + 상태 pill */}
      <Card className="border border-gray-200">
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* 직원 검색 */}
            <div className="relative w-[160px] flex-shrink-0 h-5 flex items-center">
              <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="직원명, 이메일 검색"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                style={{ paddingLeft: '26px', height: '20px' }}
                className="hansl-search-input"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  title="검색어 지우기"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 기간 선택 */}
            <span className="hansl-filter-row-label ml-2">
              <CalendarDays className="w-3.5 h-3.5" /> 기간:
            </span>
            <button
              type="button"
              onClick={() => moveRange(-1)}
              title={`이전 ${rangeDays === 1 ? '날' : `${rangeDays}일`}`}
              className="text-gray-400 hover:text-gray-700 transition-colors p-0.5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="hansl-filter-pill">
              <input
                type="date"
                value={startDate}
                onChange={(e) => changeStartDate(e.target.value)}
                className="hansl-pill-input"
                style={pillInputStyle}
              />
              <span className="text-gray-400">~</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => changeEndDate(e.target.value)}
                className="hansl-pill-input"
                style={pillInputStyle}
              />
            </div>
            <button
              type="button"
              onClick={() => moveRange(1)}
              title={`다음 ${rangeDays === 1 ? '날' : `${rangeDays}일`}`}
              className="text-gray-400 hover:text-gray-700 transition-colors p-0.5"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            {/* 기간 프리셋 칩 */}
            {([['today', '오늘'], ['week', '최근 7일'], ['month', '이번 달']] as [PeriodPreset, string][]).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`hansl-chip ${activePreset === preset ? 'hansl-chip-on' : 'hansl-chip-off'}`}
              >
                {label}
              </button>
            ))}

            {/* 상태 필터 */}
            <div className="hansl-filter-pill ml-2">
              <span className="hansl-pill-select font-semibold pointer-events-none">상태</span>
              <span className="text-gray-300">·</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={`hansl-pill-select ${statusFilter !== 'all' ? 'text-hansl-500 font-bold' : ''}`}
              >
                <option value="all">전체</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* 초기화 */}
            {hasActiveFilter && (
              <button type="button" onClick={resetFilters} className="hansl-ctl-chip-reset" title="검색·상태 필터 초기화">
                <RotateCcw className="w-3 h-3" /> 초기화
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 표 카드 — 제목행(기간·건수) + 테이블 */}
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm w-fit max-w-full">
        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 bg-gray-50/50">
          <span className="modal-section-title">{rangeLabel} 출퇴근 기록</span>
          <span className="badge-stats bg-gray-100 text-gray-600">
            {loading ? '로딩 중...' : isRange ? `${filteredRecords.length}건` : `${filteredRecords.length}명`}
          </span>
        </div>

        {loading && !hasLoaded ? (
          <div className="flex items-center justify-center py-20 px-32">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 card-subtitle">출퇴근 기록을 불러오는 중...</p>
            </div>
          </div>
        ) : sortedData.length === 0 ? (
          <div className="flex items-center justify-center py-20 px-32">
            <p className="card-subtitle whitespace-nowrap">해당 기간에 출퇴근 기록이 없습니다.</p>
          </div>
        ) : (
          <Table className="w-auto">
            <TableHeader>
              <TableRow>
                {isRange && (
                  <TableHead className="w-[85px]">
                    <SortableHeader
                      sortKey="date"
                      currentSortKey={sortConfig.key as string | null}
                      sortDirection={sortConfig.direction}
                      onSort={(key) => handleSort(key as keyof AttendanceRecord)}
                    >
                      날짜
                    </SortableHeader>
                  </TableHead>
                )}
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
                      {isRange && <TableCell className="text-[11px] px-2 py-1.5 text-gray-500 whitespace-nowrap">{formatDateShort(record.date)}</TableCell>}
                      <TableCell className="text-[11px] px-2 py-1.5 font-medium">{record.employee_name || '-'}</TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5 text-gray-500">{record.department || '-'}</TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <input
                          type="time"
                          value={editClockIn}
                          onChange={(e) => setEditClockIn(e.target.value)}
                          className="hansl-cell-input w-[100px]"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <input
                          type="time"
                          value={editClockOut}
                          onChange={(e) => setEditClockOut(e.target.value)}
                          className="hansl-cell-input w-[100px]"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="hansl-cell-input w-[90px]"
                        >
                          {!STATUS_OPTIONS.includes(editStatus) && <option value={editStatus}>{editStatus || '-'}</option>}
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <input
                          value={editRemarks}
                          onChange={(e) => setEditRemarks(e.target.value)}
                          placeholder="비고"
                          className="hansl-cell-input"
                        />
                      </TableCell>
                      <TableCell className="text-[11px] px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => saveEdit(record)}
                            disabled={isSaving}
                            title="저장"
                            className="hansl-icon-btn !p-0.5 text-green-600 hover:text-green-700 hover:bg-green-50 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            title="취소"
                            className="hansl-icon-btn !p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
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
                    {isRange && <TableCell className="text-[11px] px-2 py-1.5 text-gray-500 whitespace-nowrap">{formatDateShort(record.date)}</TableCell>}
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
