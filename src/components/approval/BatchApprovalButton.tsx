
import { CheckSquare, Square, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BatchApprovalButtonProps {
  selectedCount: number
  totalCount: number
  onBatchApproval: () => void
  onSelectAll: (checked: boolean) => void
  allSelected: boolean
}

export default function BatchApprovalButton({
  selectedCount,
  totalCount,
  onBatchApproval,
  onSelectAll,
  allSelected
}: BatchApprovalButtonProps) {
  if (totalCount === 0) return null

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 business-radius-card border">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectAll(!allSelected)}
          className="flex items-center gap-2"
        >
          {allSelected ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
          전체 선택
        </Button>
        
        <span className="text-sm text-gray-600">
          {selectedCount}개 선택됨 (총 {totalCount}개)
        </span>
      </div>
      
      {selectedCount > 0 && (
        <Button
          onClick={onBatchApproval}
          className="bg-green-600 hover:bg-green-700"
          size="sm"
        >
          <CheckCircle className="w-4 h-4 mr-1" />
          선택 항목 일괄 승인 ({selectedCount})
        </Button>
      )}
    </div>
  )
}