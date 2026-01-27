
import { useState, useEffect } from 'react'
import { EmployeeFilters as EmployeeFiltersType, PurchaseRole } from '@/types/purchase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, X, Download, Plus, Calendar } from 'lucide-react'
import { employeeService } from '@/services/employeeService'

interface EmployeeFiltersProps {
  filters: EmployeeFiltersType
  onFiltersChange: (filters: EmployeeFiltersType) => void
  onExport: () => void
  onCreateNew: () => void
  onAttendanceDownload: () => void
  onAnnualLeaveUsageDownload: () => void
  canManageEmployees?: boolean
}

const PURCHASE_ROLES: { value: PurchaseRole; label: string }[] = [
  { value: 'app_admin', label: '앱 관리자' },
  { value: 'ceo', label: 'CEO' },
  { value: 'final_approver', label: '최종 승인자' },
  { value: 'middle_manager', label: '중간 관리자' },
  { value: 'lead buyer', label: '수석 구매자' },
  { value: 'buyer', label: '구매자' },
]

export default function EmployeeFilters({ 
  filters, 
  onFiltersChange, 
  onExport,
  onCreateNew,
  onAttendanceDownload,
  onAnnualLeaveUsageDownload
  ,
  canManageEmployees = false
}: EmployeeFiltersProps) {
  const [localSearch, setLocalSearch] = useState(filters.search || '')
  const [departments, setDepartments] = useState<string[]>([])
  const [positions, setPositions] = useState<string[]>([])

  useEffect(() => {
    // 부서와 직급 목록 로드
    const loadOptions = async () => {
      const [deptResult, posResult] = await Promise.all([
        employeeService.getDepartments(),
        employeeService.getPositions()
      ])
      
      if (deptResult.success) {
        setDepartments(deptResult.data || [])
      }
      
      if (posResult.success) {
        setPositions(posResult.data || [])
      }
    }
    
    loadOptions()
  }, [])

  useEffect(() => {
    setLocalSearch(filters.search || '')
  }, [filters.search])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const nextSearch = localSearch.trim()
      if (nextSearch === (filters.search || '')) {
        return
      }
      onFiltersChange({
        ...filters,
        search: nextSearch || undefined
      })
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [localSearch, filters, onFiltersChange])

  const handleDepartmentChange = (value: string) => {
    onFiltersChange({
      ...filters,
      department: value === 'all' ? undefined : value
    })
  }

  const handlePositionChange = (value: string) => {
    onFiltersChange({
      ...filters,
      position: value === 'all' ? undefined : value
    })
  }

  const handleRoleChange = (value: string) => {
    onFiltersChange({
      ...filters,
      purchase_role: value === 'all' ? undefined : value
    })
  }

  const handleStatusChange = (value: string) => {
    onFiltersChange({
      ...filters,
      is_active: value === 'all' ? undefined : value === 'active'
    })
  }

  const clearFilters = () => {
    setLocalSearch('')
    onFiltersChange({})
  }

  const hasFilters = filters.search || 
                     filters.department || 
                     filters.position || 
                     filters.purchase_role || 
                     filters.is_active !== undefined

  return (
    <div className="space-y-4">
      {/* 상단 액션 버튼 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="page-title">직원 관리</h2>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Employee Management</p>
        </div>
        {canManageEmployees && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onAnnualLeaveUsageDownload}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
          >
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">연차사용현황</span>
            <span className="sm:hidden">연차</span>
          </Button>
          <Button
            onClick={onAttendanceDownload}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
          >
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">출근현황표</span>
            <span className="sm:hidden">출근</span>
          </Button>
          <Button
            onClick={onExport}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Excel 내보내기</span>
            <span className="sm:hidden">Excel</span>
          </Button>
          <Button 
            onClick={onCreateNew}
            className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            직원 등록
          </Button>
        </div>
        )}
      </div>

      {/* 필터 섹션 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 검색 */}
        <div className="relative min-w-[180px] flex-1 max-w-[260px]">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-gray-400" />
          <Input
            type="text"
            placeholder="이름, 이메일, 전화번호 검색"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="!h-auto !py-px !pr-1.5 !pl-5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
          />
        </div>

        {/* 부서 필터 */}
        <div className="min-w-[120px]">
          <Select
            value={filters.department || 'all'}
            onValueChange={handleDepartmentChange}
          >
            <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
              <SelectValue placeholder="부서" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 부서</SelectItem>
              {departments.map((dept) => (
                <SelectItem key={dept} value={dept}>
                  {dept}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 직급 필터 */}
        <div className="min-w-[120px]">
          <Select
            value={filters.position || 'all'}
            onValueChange={handlePositionChange}
          >
            <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
              <SelectValue placeholder="직급" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 직급</SelectItem>
              {positions.map((pos) => (
                <SelectItem key={pos} value={pos}>
                  {pos}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 권한 필터 */}
        <div className="min-w-[140px]">
          <Select
            value={filters.purchase_role || 'all'}
            onValueChange={handleRoleChange}
          >
            <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
              <SelectValue placeholder="권한" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 권한</SelectItem>
              <SelectItem value="none">권한 없음</SelectItem>
              {PURCHASE_ROLES.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 상태 필터 */}
        <div className="min-w-[100px]">
          <Select
            value={
              filters.is_active === undefined 
                ? 'all' 
                : filters.is_active 
                  ? 'active' 
                  : 'inactive'
            }
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="active">활성</SelectItem>
              <SelectItem value="inactive">비활성</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 초기화 버튼 */}
        {hasFilters && (
          <Button 
            type="button" 
            onClick={clearFilters}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">초기화</span>
            <span className="sm:hidden">초기</span>
          </Button>
        )}
      </div>
    </div>
  )
}