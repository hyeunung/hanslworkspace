
import { Button } from '@/components/ui/button'
import { Download, Plus } from 'lucide-react'

interface VendorFiltersProps {
  onExport: () => void
  onCreateNew: () => void
}

export default function VendorFilters({
  onExport,
  onCreateNew
}: VendorFiltersProps) {
  return (
    <div className="space-y-4">
      {/* 상단 액션 버튼 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="page-title">업체 관리</h2>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Vendors Management</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onExport}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline text-[12px]">Excel 내보내기</span>
            <span className="sm:hidden text-[12px]">Excel</span>
          </Button>
          <Button
            onClick={onCreateNew}
            className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            <span className="text-[12px]">업체 등록</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
