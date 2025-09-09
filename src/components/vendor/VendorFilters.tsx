
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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">업체 관리</h2>
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
            업체 등록
          </Button>
        </div>
      </div>

      {/* 필터 섹션 */}
      <div className="bg-white p-4 rounded-lg border space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex gap-4 items-end">
          {/* 검색 */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              검색
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="업체명, 사업자번호, 대표자, 연락처, 이메일로 검색"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* 상태 필터 */}
          <div className="sm:min-w-[120px]">
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