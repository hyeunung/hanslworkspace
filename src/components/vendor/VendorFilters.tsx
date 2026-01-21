
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
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 className="page-title">업체 관리</h2>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Vendors Management</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onExport}
            className="flex items-center gap-1 sm:gap-2 button-base business-radius-button border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline badge-text">Excel 내보내기</span>
            <span className="sm:hidden badge-text">Excel</span>
          </Button>
          <Button 
            onClick={onCreateNew}
            className="flex items-center gap-1 sm:gap-2 button-base business-radius-button bg-blue-500 text-white hover:bg-blue-600"
          >
            <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="badge-text">업체 등록</span>
          </Button>
        </div>
      </div>
    </div>
  )
}