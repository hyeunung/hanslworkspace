import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import {
  Database,
  Search,
  Filter,
  Calendar,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Clock,
  Terminal,
  Activity,
  User,
  Info,
  AlertTriangle
} from 'lucide-react'

interface LogEntry {
  id: number
  created_at: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: 'frontend' | 'backend' | 'database'
  category: string
  action: string
  actor_id: string | null
  actor_email: string | null
  actor_name: string | null
  target_table: string | null
  target_id: string | null
  message: string
  details: any
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

// 화면/기능(모듈) 필터 — 내부 category(=대부분 테이블명) 값을 사용자 친화적 화면 이름으로 묶는다.
const MODULE_OPTIONS: { key: string; label: string; categories: string[] }[] = [
  { key: 'production', label: '제작현황', categories: ['production_pcbs', 'production_cables', 'production'] },
  { key: 'purchase', label: '발주', categories: ['purchase_requests', 'purchase_request_items', 'purchase_receipts', 'purchase'] },
  { key: 'transaction', label: '거래명세서', categories: ['transaction_statements', 'transaction_statement_items'] },
  { key: 'bom', label: 'BOM/도면', categories: ['bom_items', 'cad_drawings', 'part_placements', 'bom'] },
  { key: 'employees', label: '직원관리', categories: ['employees'] },
  { key: 'vendors', label: '업체관리', categories: ['vendors', 'vendor_contacts'] },
  { key: 'attendance', label: '근태·연차', categories: ['attendance_records', 'leave', 'holidays'] },
  { key: 'trip', label: '출장', categories: ['business_trips', 'business_trip_expenses', 'business_trip_expense_receipts', 'business_trip_allowances', 'business_trip_mileages', 'business_trip_tasks', 'trip_expense_places'] },
  { key: 'card', label: '카드사용', categories: ['card_usages', 'card_usage_receipts'] },
  { key: 'shipping', label: '배송·택배', categories: ['shipping_companies', 'shipping_company_addresses', 'shipping_contacts', 'shipping_labels'] },
  { key: 'vehicle', label: '차량신청', categories: ['vehicle_requests'] },
  { key: 'ai', label: 'AI서비스', categories: ['ai_service_applications'] },
  { key: 'official', label: '공문', categories: ['official_documents'] },
  { key: 'support', label: '문의', categories: ['support_inquires', 'support_inquiry_messages'] },
  { key: 'delivery', label: '납품', categories: ['delivery_orders', 'delivery_order_items'] },
  { key: 'system', label: '시스템/기타', categories: ['system', 'global_error'] },
]

export default function SystemActivityLogsPage() {
  const { currentUserRoles } = useAuth()
  const navigate = useNavigate()

  // 권한 체크
  const isAuthorized = currentUserRoles.includes('superadmin') || currentUserRoles.includes('hr')

  useEffect(() => {
    if (!isAuthorized) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthorized, navigate])

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 필터 상태
  const [moduleFilter, setModuleFilter] = useState<string>('all') // 화면/기능
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('30days') // 기본 30일
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  // 페이징
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 선택된 로그 상세 보기
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)

  // 직원 이메일 → 이름 매핑 (로그의 actor_name이 비어 있어도 이메일로 이름을 복원/검색하기 위함)
  const [employees, setEmployees] = useState<{ email: string; name: string }[]>([])
  const [empMap, setEmpMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.from('employees').select('email, name')
        const list = (data || []).filter((e: any) => e.email) as { email: string; name: string }[]
        setEmployees(list)
        const m: Record<string, string> = {}
        for (const e of list) m[e.email.toLowerCase()] = e.name || ''
        setEmpMap(m)
      } catch {
        // 직원 목록 로드 실패 시에도 로그 화면은 정상 동작(이름 복원만 생략)
      }
    })()
  }, [isAuthorized])

  // 로그 작성자 표시 이름: actor_name이 비면 이메일로 직원 이름을 복원, 시스템 트리거는 '시스템'
  const resolveActorName = (log: Pick<LogEntry, 'actor_email' | 'actor_name'>) => {
    if (log.actor_email === 'system_db_trigger') return '시스템'
    const byEmail = log.actor_email ? empMap[log.actor_email.toLowerCase()] : ''
    return byEmail || log.actor_name || (log.actor_email ? log.actor_email.split('@')[0] : 'System')
  }

  // 데이터 로드 함수
  const loadLogs = useCallback(async () => {
    if (!isAuthorized) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      
      let query = supabase
        .from('system_activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      // 필터 적용
      if (levelFilter !== 'all') {
        query = query.eq('level', levelFilter)
      }
      if (sourceFilter !== 'all') {
        query = query.eq('source', sourceFilter)
      }
      if (actionFilter !== 'all') {
        query = query.eq('action', actionFilter)
      }

      // 화면/기능(모듈) 필터 → 해당 category 목록으로 조회
      if (moduleFilter !== 'all') {
        const mod = MODULE_OPTIONS.find((m) => m.key === moduleFilter)
        if (mod) {
          query = query.in('category', mod.categories)
        }
      }

      // 날짜 필터
      if (dateFilter !== 'all') {
        const now = new Date()
        const startDate = new Date()
        if (dateFilter === 'today') {
          startDate.setHours(0, 0, 0, 0)
        } else if (dateFilter === '7days') {
          startDate.setDate(now.getDate() - 7)
        } else if (dateFilter === '30days') {
          startDate.setDate(now.getDate() - 30)
        }
        query = query.gte('created_at', startDate.toISOString())
      }

      // 텍스트 검색 (이메일/이름/메시지 + 직원 이름 → 이메일 해석)
      if (searchQuery.trim()) {
        const q = searchQuery.trim()
        const orParts = [
          `actor_email.ilike.%${q}%`,
          `actor_name.ilike.%${q}%`,
          `message.ilike.%${q}%`,
        ]
        // 이름으로 검색 시: 로그 actor_name이 비어 있으므로 employees에서 이름이 일치하는 이메일을 찾아 함께 조회
        const matchedEmails = employees
          .filter((e) => e.name && e.name.toLowerCase().includes(q.toLowerCase()))
          .map((e) => e.email)
          .filter(Boolean)
        if (matchedEmails.length > 0) {
          orParts.push(`actor_email.in.(${matchedEmails.join(',')})`)
        }
        query = query.or(orParts.join(','))
      }

      // 페이징 계산
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, count, error: queryError } = await query
      if (queryError) throw queryError

      setLogs((data as LogEntry[]) || [])
      setTotalCount(count || 0)
    } catch (err: any) {
      console.error('Error fetching logs:', err)
      setError(err.message || '로그 데이터를 불러오는 도중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [isAuthorized, moduleFilter, levelFilter, sourceFilter, actionFilter, dateFilter, searchQuery, page, pageSize, employees])

  useEffect(() => {
    setPage(1) // 필터가 바뀌면 첫 페이지로 초기화
  }, [moduleFilter, levelFilter, sourceFilter, actionFilter, dateFilter, searchQuery, pageSize])

  useEffect(() => {
    loadLogs()
  }, [loadLogs, page])

  const totalPages = Math.ceil(totalCount / pageSize)

  // 날짜 포맷 함수
  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  // 배지 스타일 매핑 함수들
  const getLevelBadgeStyle = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-red-50 text-red-700 border-red-100'
      case 'warn':
        return 'bg-amber-50 text-amber-700 border-amber-100'
      case 'info':
        return 'bg-blue-50 text-blue-700 border-blue-100'
      default:
        return 'bg-gray-50 text-gray-700 border-gray-100'
    }
  }

  const getSourceBadgeStyle = (source: string) => {
    switch (source) {
      case 'database':
        return 'bg-indigo-50 text-indigo-700 border-indigo-100'
      case 'backend':
        return 'bg-purple-50 text-purple-700 border-purple-100'
      case 'frontend':
        return 'bg-teal-50 text-teal-700 border-teal-100'
      default:
        return 'bg-gray-50 text-gray-700 border-gray-100'
    }
  }

  const getActionBadgeStyle = (action: string) => {
    switch (action) {
      case 'insert':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100'
      case 'update':
        return 'bg-amber-50 text-amber-700 border-amber-100'
      case 'delete':
        return 'bg-rose-50 text-rose-700 border-rose-100'
      case 'login':
        return 'bg-sky-50 text-sky-700 border-sky-100'
      case 'export_excel':
        return 'bg-cyan-50 text-cyan-700 border-cyan-100'
      default:
        return 'bg-gray-50 text-gray-600 border-gray-150'
    }
  }

  if (!isAuthorized) {
    return null
  }

  return (
    <div className="max-w-[1600px] mx-auto p-4 sm:p-6 space-y-6">
      {/* 헤더 섹션 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2.5">
            <Database className="w-6 h-6 text-hansl-600" />
            시스템 통합 감사 로그
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            프론트엔드, 백엔드 및 DB 핵심 테이블의 실시간 변경 사항을 영구적으로 모니터링합니다.
          </p>
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg shadow-sm text-sm font-medium text-gray-700 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      {/* 필터링 및 검색 카드 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {/* 화면/기능 (모듈) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" />
              화면/기능
            </label>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm focus:border-hansl-500 focus:outline-none"
            >
              <option value="all">전체 화면</option>
              {MODULE_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* 로그 레벨 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              로그 레벨
            </label>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm focus:border-hansl-500 focus:outline-none"
            >
              <option value="all">전체 레벨</option>
              <option value="info">INFO</option>
              <option value="warn">WARN (경고)</option>
              <option value="error">ERROR (오류)</option>
            </select>
          </div>

          {/* 로그 발생처 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Terminal className="w-3.5 h-3.5" />
              기록 출처
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm focus:border-hansl-500 focus:outline-none"
            >
              <option value="all">전체 출처</option>
              <option value="database">Database (트리거)</option>
              <option value="backend">Backend (엣지함수)</option>
              <option value="frontend">Frontend (브라우저)</option>
            </select>
          </div>

          {/* 액션 종류 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" />
              액션
            </label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm focus:border-hansl-500 focus:outline-none"
            >
              <option value="all">전체 액션</option>
              <option value="insert">등록 (insert)</option>
              <option value="update">수정 (update)</option>
              <option value="delete">삭제 (delete)</option>
              <option value="login">로그인</option>
              <option value="export_excel">엑셀 내보내기</option>
            </select>
          </div>

          {/* 기간 필터 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              기간 선택
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm focus:border-hansl-500 focus:outline-none"
            >
              <option value="all">전체 기간</option>
              <option value="today">오늘 하루</option>
              <option value="7days">최근 7일</option>
              <option value="30days">최근 30일</option>
            </select>
          </div>

          {/* 검색창 */}
          <div className="space-y-1.5 sm:col-span-2 md:col-span-4 lg:col-span-1">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Search className="w-3.5 h-3.5" />
              작업자 / 내용 검색
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="이름, 이메일, 요약 메시지..."
                className="w-full h-10 border border-gray-300 rounded-lg pl-9 pr-8 text-sm focus:border-hansl-500 focus:outline-none"
              />
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-3 hover:text-gray-600"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 메인 테이블 및 에러 핸들링 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* 로그 테이블 리스트 */}
        <div className="w-full lg:flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  <th className="py-3.5 px-4 w-[160px]">발생 시간</th>
                  <th className="py-3.5 px-3 w-[80px] text-center">레벨</th>
                  <th className="py-3.5 px-3 w-[90px] text-center">출처</th>
                  <th className="py-3.5 px-3 w-[100px] text-center">액션</th>
                  <th className="py-3.5 px-4 w-[150px]">작업자 (Who)</th>
                  <th className="py-3.5 px-4">요약 메시지 (What)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <div className="inline-block w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
                      <span className="block mt-2 text-sm text-gray-500">로그를 가져오는 중...</span>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-20 text-center text-gray-500">
                      조건에 일치하는 감사 로그가 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                        selectedLog?.id === log.id ? 'bg-hansl-50/40 font-medium' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 text-xs font-mono text-gray-500">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-bold uppercase rounded-md border ${getLevelBadgeStyle(
                            log.level
                          )}`}
                        >
                          {log.level}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-md border ${getSourceBadgeStyle(
                            log.source
                          )}`}
                        >
                          {log.source}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-md border ${getActionBadgeStyle(
                            log.action
                          )}`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="max-w-[150px] truncate">
                          <span className="font-semibold text-gray-900 block truncate">
                            {resolveActorName(log)}
                          </span>
                          <span className="text-xs text-gray-400 block truncate">
                            {log.actor_email || '-'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-gray-800 line-clamp-1 break-all" title={log.message}>
                          {log.message}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 페이징 네비게이션 */}
          <div className="bg-gray-50 border-t border-gray-200 py-3.5 px-4 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-4">
              <span>
                총 <strong className="text-gray-800 font-semibold">{totalCount}</strong>건의 로그
              </span>
              <div className="flex items-center gap-1.5">
                <span>페이지 표시 개수:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-hansl-500"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}개씩
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1 || loading}
                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-medium">
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page === totalPages || totalPages === 0 || loading}
                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 상세 내역 패널 (Sidebar) */}
        {selectedLog && (
          <div className="w-full lg:w-[480px] bg-white border border-gray-200 rounded-xl shadow-md p-5 space-y-5 flex-shrink-0 animate-fade-in">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-hansl-500" />
                상세 변경 내역
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 작업 정보 */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400 font-medium">로그 ID</span>
                <span className="font-mono text-gray-700">{selectedLog.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 font-medium">발생 시간</span>
                <span className="text-gray-700">{formatDateTime(selectedLog.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 font-medium">작업자</span>
                <span className="font-semibold text-gray-900">
                  {resolveActorName(selectedLog)} ({selectedLog.actor_email || '-'})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 font-medium">작업 범주 (Category)</span>
                <span className="font-mono text-gray-700 bg-gray-200/60 px-1.5 py-0.5 rounded text-xs">
                  {selectedLog.category}
                </span>
              </div>
              {selectedLog.target_table && (
                <div className="flex justify-between">
                  <span className="text-gray-400 font-medium">대상 테이블 / ID</span>
                  <span className="text-gray-700 font-mono text-xs truncate max-w-[250px]">
                    {selectedLog.target_table} / {selectedLog.target_id}
                  </span>
                </div>
              )}
            </div>

            {/* 메시지 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                요약 메시지
              </label>
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-sm font-medium text-gray-800 break-all leading-relaxed">
                {selectedLog.message}
              </div>
            </div>

            {/* 세부 데이터 변화 (JSON Diff/Details) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block">
                상세 변경 데이터 (JSON Payload)
              </label>

              {/* DB UPDATE의 경우 변경 전후 대조표 표시 */}
              {selectedLog.action === 'update' && selectedLog.details?.changes ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-gray-600 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="p-2 w-[120px]">필드명</th>
                        <th className="p-2 bg-red-50/50 text-red-800">수정 전 (Old)</th>
                        <th className="p-2 bg-green-50/50 text-green-800">수정 후 (New)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150 text-gray-700">
                      {Object.entries(selectedLog.details.changes).map(([field, values]: [string, any]) => (
                        <tr key={field} className="hover:bg-gray-50/50">
                          <td className="p-2 font-mono font-semibold text-gray-600 truncate max-w-[120px]" title={field}>
                            {field}
                          </td>
                          <td className="p-2 bg-red-50/20 text-red-700 font-mono break-all leading-normal">
                            {values.old === null ? <span className="text-gray-300">null</span> : String(values.old)}
                          </td>
                          <td className="p-2 bg-green-50/20 text-green-700 font-semibold font-mono break-all leading-normal">
                            {values.new === null ? <span className="text-gray-300">null</span> : String(values.new)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : selectedLog.details ? (
                /* 단순 JSON 뷰어 */
                <pre className="p-3.5 bg-gray-900 text-green-400 font-mono text-xs rounded-lg overflow-auto max-h-[300px] border border-gray-800 shadow-inner scrollbar-thin">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              ) : (
                <div className="text-center py-6 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                  상세 변경 데이터가 기록되지 않았습니다.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
