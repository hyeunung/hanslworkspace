
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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onFiltersChange({
      ...filters,
      search: localSearch.trim() || undefined
    })
  }

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
      purchase_role: value === 'all' ? undefined : value === 'none' ? '' : value
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onAnnualLeaveUsageDownload}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">연차사용현황</span>
            <span className="sm:hidden">연차</span>
          </Button>
          <Button
            variant="outline"
            onClick={onAttendanceDownload}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">출근현황표</span>
            <span className="sm:hidden">출근</span>
          </Button>
          <Button
            variant="outline"
            onClick={onExport}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Excel 내보내기</span>
            <span className="sm:hidden">Excel</span>
          </Button>
          <Button 
            onClick={onCreateNew}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
            직원 등록
          </Button>
        </div>
        )}
      </div>

      {/* 필터 섹션 */}
      <div className="bg-white p-3 sm:p-4 rounded-lg border space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end sm:flex-wrap">
          {/* 검색 */}
          <div className="flex-1 sm:min-w-[250px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              검색
            </label>
            <div className="relative">
              <Search className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3 sm:w-4 sm:h-4" />
              <Input
                type="text"
                placeholder="이름, 이메일, 전화번호로 검색"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="pl-8 sm:pl-10 text-sm h-9"
              />
            </div>
          </div>

          {/* 부서 필터 */}
          <div className="w-full sm:w-auto sm:min-w-[120px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              부서
            </label>
            <Select
              value={filters.department || 'all'}
              onValueChange={handleDepartmentChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
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
          <div className="w-full sm:w-auto sm:min-w-[120px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              직급
            </label>
            <Select
              value={filters.position || 'all'}
              onValueChange={handlePositionChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
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
          <div className="w-full sm:w-auto sm:min-w-[140px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              권한
            </label>
            <Select
              value={filters.purchase_role || 'all'}
              onValueChange={handleRoleChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
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
          <div className="w-full sm:w-auto sm:min-w-[100px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              상태
            </label>
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
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="inactive">비활성</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 검색 및 초기화 버튼 */}
          <div className="flex gap-2 w-full sm:w-auto">
            <Button type="submit" className="flex-1 sm:flex-none h-9 text-sm">
              검색
            </Button>
            {hasFilters && (
              <Button 
                type="button" 
                variant="outline" 
                onClick={clearFilters}
                className="flex items-center gap-1 h-9 text-sm"
              >
                <X className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">초기화</span>
                <span className="sm:hidden">초기</span>
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}