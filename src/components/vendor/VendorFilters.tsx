
import { useState } from 'react'
import { VendorFilters as VendorFiltersType } from '@/types/purchase'
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

interface VendorFiltersProps {
  filters: VendorFiltersType
  onFiltersChange: (filters: VendorFiltersType) => void
  onExport: () => void
  onCreateNew: () => void
}

export default function VendorFilters({ 
  filters, 
  onFiltersChange, 
  onExport,
  onCreateNew 
}: VendorFiltersProps) {
  const [localSearch, setLocalSearch] = useState(filters.search || '')

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onFiltersChange({
      ...filters,
      search: localSearch.trim() || undefined
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

  const hasFilters = filters.search || filters.is_active !== undefined

  return (
    <div className="space-y-4">
      {/* 상단 액션 버튼 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">업체 관리</h2>
        <div className="flex gap-2">
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
            업체 등록
          </Button>
        </div>
      </div>

      {/* 필터 섹션 */}
      <div className="bg-white p-3 sm:p-4 rounded-lg border space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
          {/* 검색 */}
          <div className="flex-1">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              검색
            </label>
            <div className="relative">
              <Search className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3 sm:w-4 sm:h-4" />
              <Input
                type="text"
                placeholder="업체명, 사업자번호, 연락처 검색"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="pl-8 sm:pl-10 text-sm h-9"
              />
            </div>
          </div>

          {/* 상태 필터 */}
          <div className="w-full sm:w-auto sm:min-w-[120px]">
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