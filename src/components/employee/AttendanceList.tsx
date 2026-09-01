
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { DateRange } from 'react-day-picker'
import { createClient } from '@/lib/supabase/client'
import { employeeService } from '@/services/employeeService'
import { useTableSort } from '@/hooks/useTableSort'
import { Card, CardContent } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ko } from 'date-fns/locale'
import AttendanceCompactTable, { type AttendanceRecord } from '@/components/employee/AttendanceCompactTable'
import { Search, X, RotateCcw, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'

interface AttendanceListProps {
  canManageEmployees: boolean
}

const STATUS_OPTIONS = ['정상 출근', '지각', '퇴근', '오전반차']

// 상태 필터 드롭다운 기본 정렬 순서 (데이터에 있는 나머지 상태는 뒤에 붙음)
const STATUS_FILTER_ORDER = ['정상 출근', '지각', '퇴근', '오전반차', '오후반차', '출장', '연차', '공가', '출근 전']

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

// 기간 프리셋
type PeriodPreset = 'today' | 'week' | 'month'

function presetRange(preset: PeriodPreset): { start: string; end: string } {
  const today = getToday()
  if (preset === 'today') return { start: today, end: today }
  if (preset === 'week') return { start: addDays(today, -6), end: today }
  return { start: `${today.slice(0, 7)}-01`, end: today }
}

// YYYY-MM-DD ↔ Date 변환 (로컬 기준)
function parseDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00')
}

function toDateStr(date: Date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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

  // 공용 달력(compact-calendar) 팝오버 연동 — 새요청 청구일/입고요청일과 동일 디자인.
  // 열 때마다 선택을 비워서(오늘은 표시만) 원하는 날짜부터 새로 지정하게 한다.
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined)
  // 텍스트 직접 입력 (숫자 입력 시 YYYY.MM.DD 자동 포맷)
  const [draftStartText, setDraftStartText] = useState('')
  const [draftEndText, setDraftEndText] = useState('')

  const openDatePopover = (open: boolean) => {
    if (open) {
      setDraftRange(undefined)
      setDraftStartText('')
      setDraftEndText('')
    }
    setDatePopoverOpen(open)
  }

  // 달력 클릭 → 드래프트만 갱신 (적용은 확인 버튼에서)
  const handleRangeChange = (range: DateRange | undefined) => {
    setDraftRange(range)
    if (range?.from) setDraftStartText(toDateStr(range.from).replace(/-/g, '.'))
    setDraftEndText(range?.to ? toDateStr(range.to).replace(/-/g, '.') : range?.from ? toDateStr(range.from).replace(/-/g, '.') : '')
  }

  // 숫자만 받아 YYYY.MM.DD로 자동 포맷
  const maskDateText = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 8)
    if (d.length <= 4) return d
    if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
  }

  // YYYY.MM.DD → YYYY-MM-DD (실존 날짜만)
  const parseMaskedDate = (text: string): string | null => {
    const m = text.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
    if (!m) return null
    const [, y, mo, da] = m
    const date = new Date(Number(y), Number(mo) - 1, Number(da))
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(da)) return null
    return `${y}-${mo}-${da}`
  }

  // 텍스트 입력 → 드래프트만 갱신 (적용은 확인 버튼에서)
  const handleStartTextChange = (raw: string) => {
    const masked = maskDateText(raw)
    setDraftStartText(masked)
    const parsed = parseMaskedDate(masked)
    if (!parsed) return
    const from = parseDate(parsed)
    setDraftRange((r) => ({ from, to: r?.to && toDateStr(r.to) >= parsed ? r.to : undefined }))
  }

  const handleEndTextChange = (raw: string) => {
    const masked = maskDateText(raw)
    setDraftEndText(masked)
    const parsed = parseMaskedDate(masked)
    if (!parsed) return
    const to = parseDate(parsed)
    setDraftRange((r) => ({ from: r?.from && toDateStr(r.from) <= parsed ? r.from : to, to }))
  }

  // 확인 → 드래프트 적용 후 닫기 (선택 안 했으면 기존 기간 유지)
  const confirmDateRange = () => {
    if (draftRange?.from) {
      const a = toDateStr(draftRange.from)
      const b = draftRange.to ? toDateStr(draftRange.to) : a
      setStartDate(a <= b ? a : b)
      setEndDate(a <= b ? b : a)
    }
    setDatePopoverOpen(false)
  }

  // 지우기 → 드래프트 초기화 (다시 선택)
  const clearDraftRange = () => {
    setDraftRange(undefined)
    setDraftStartText('')
    setDraftEndText('')
  }

  // 트리거 라벨 (새요청 표기: 26.09.01)
  const shortLabel = (dateStr: string) => dateStr.slice(2).replace(/-/g, '.')
  const rangeTriggerLabel = isRange
    ? `${shortLabel(startDate)} ~ ${shortLabel(endDate)}`
    : shortLabel(startDate)

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

            {/* 상태 필터 (프리셋 칩과 동일 규격) */}
            <div className="hansl-ctl-chip hansl-toggle-off ml-2">
              <span className="font-semibold">상태</span>
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

            {/* 기간 선택 — 새요청과 동일한 공용 달력(compact-calendar) 팝오버 */}
            <Popover open={datePopoverOpen} onOpenChange={openDatePopover}>
              <PopoverTrigger asChild>
                <button type="button" className="hansl-ctl-chip hansl-toggle-off ml-2">
                  <CalendarIcon className="w-3 h-3 text-gray-400" />
                  {rangeTriggerLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                <div className="bg-white business-radius-card p-3">
                  <div className="mb-2 px-1">
                    <div className="modal-label text-gray-600 text-center">날짜 선택 (1회: 당일, 2회: 기간)</div>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    <input
                      value={draftStartText}
                      onChange={(e) => handleStartTextChange(e.target.value)}
                      placeholder="시작일 입력"
                      className="hansl-pill-input !w-[76px] text-center"
                    />
                    <span className="text-gray-400 text-[11px]">~</span>
                    <input
                      value={draftEndText}
                      onChange={(e) => handleEndTextChange(e.target.value)}
                      placeholder="종료일 입력"
                      className="hansl-pill-input !w-[76px] text-center"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 text-center mb-2">(예: 20260804 → 2026.08.04)</div>
                  <Calendar
                    mode="range"
                    selected={draftRange}
                    onSelect={handleRangeChange}
                    locale={ko}
                    className="compact-calendar"
                    fromDate={new Date('2020-01-01')}
                    toDate={new Date('2035-12-31')}
                    defaultMonth={parseDate(startDate)}
                    formatters={{
                      formatCaption: (month) => `${month.getFullYear()}년 ${month.getMonth() + 1}월`,
                    }}
                    modifiers={{ today: new Date() }}
                    modifiersClassNames={{
                      today: 'bg-hansl-500 text-white font-semibold cursor-pointer hover:bg-hansl-600 rounded-md',
                    }}
                  />
                  <div className="border-t border-gray-100 mt-3 pt-2 flex items-center justify-end gap-1.5">
                    <button type="button" className="hansl-btn" onClick={clearDraftRange}>
                      지우기
                    </button>
                    <button
                      type="button"
                      className="button-base bg-hansl-500 hover:bg-hansl-600 text-white"
                      onClick={confirmDateRange}
                    >
                      확인
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

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
          <AttendanceCompactTable
            rows={sortedData}
            showDate={isRange}
            sortKey={sortConfig.key as string | null}
            sortDirection={sortConfig.direction}
            onSort={(key) => handleSort(key)}
            ctx={{
              canManage: canManageEmployees,
              editingId,
              isSaving,
              editClockIn,
              setEditClockIn,
              editClockOut,
              setEditClockOut,
              editStatus,
              setEditStatus,
              editRemarks,
              setEditRemarks,
              editStatusOptions: STATUS_OPTIONS,
              startEdit,
              saveEdit,
              cancelEdit,
            }}
          />
        )}
      </div>
    </div>
  )
}
