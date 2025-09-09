
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
import { Search, X, Download, Plus } from 'lucide-react'
import { employeeService } from '@/services/employeeService'

interface EmployeeFiltersProps {
  filters: EmployeeFiltersType
  onFiltersChange: (filters: EmployeeFiltersType) => void
  onExport: () => void
  onCreateNew: () => void
}

const PURCHASE_ROLES: { value: PurchaseRole; label: string }[] = [
  { value: 'app_admin', label: '앱 관리자' },
  { value: 'ceo', label: 'CEO' },
  { value: 'final_approver', label: '최종 승인자' },
  { value: 'middle_manager', label: '중간 관리자' },
  { value: 'lead_buyer', label: '수석 구매자' },
  { value: 'buyer', label: '구매자' },
]

export default function EmployeeFilters({ 
  filters, 
  onFiltersChange, 
  onExport,
  onCreateNew 
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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">직원 관리</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onExport}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Excel 내보내기
          </Button>
          <Button 
            onClick={onCreateNew}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            직원 등록
          </Button>
        </div>
      </div>

      {/* 필터 섹션 */}
      <div className="bg-white p-4 rounded-lg border space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex gap-4 items-end flex-wrap">
          {/* 검색 */}
          <div className="flex-1 sm:min-w-[300px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              검색
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="이름, 이메일, 전화번호, 직급, 부서, Slack ID로 검색"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* 부서 필터 */}
          <div className="sm:min-w-[120px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              부서
            </label>
            <Select
              value={filters.department || 'all'}
              onValueChange={handleDepartmentChange}
            >
              <SelectTrigger>
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
          <div className="sm:min-w-[120px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              직급
            </label>
            <Select
              value={filters.position || 'all'}
              onValueChange={handlePositionChange}
            >
              <SelectTrigger>
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
          <div className="sm:min-w-[140px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              권한
            </label>
            <Select
              value={filters.purchase_role || 'all'}
              onValueChange={handleRoleChange}
            >
              <SelectTrigger>
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
          <div className="sm:min-w-[100px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <SelectTrigger>
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
          <div className="flex gap-2">
            <Button type="submit">
              검색
            </Button>
            {hasFilters && (
              <Button 
                type="button" 
                variant="outline" 
                onClick={clearFilters}
                className="flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                초기화
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}