import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

// 🚀 무거운 PurchaseDetailModal을 지연 로딩으로 최적화
const PurchaseDetailModal = lazy(() => import('@/components/purchase/PurchaseDetailModal'))

interface LazyPurchaseDetailModalProps {
  purchaseId: number | null
  isOpen: boolean
  onClose: () => void
  currentUserRoles: string[]
  onRefresh: () => void
}

export default function LazyPurchaseDetailModal(props: LazyPurchaseDetailModalProps) {
  // 모달이 열리지 않은 상태에서는 컴포넌트 로드하지 않음
  if (!props.isOpen) {
    return null
  }

  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </div>
      </div>
    }>
      <PurchaseDetailModal {...props} />
    </Suspense>
  )
}