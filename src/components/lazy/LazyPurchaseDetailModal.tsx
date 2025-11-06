import { lazy, Suspense } from 'react'

const PurchaseDetailModal = lazy(() => import('../purchase/PurchaseDetailModal'))

interface LazyPurchaseDetailModalProps {
  [key: string]: any
}

export default function LazyPurchaseDetailModal(props: LazyPurchaseDetailModalProps) {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-hansl-600"></div>
            <span className="text-gray-600">모달 로딩 중...</span>
          </div>
        </div>
      </div>
    }>
      <PurchaseDetailModal {...props} />
    </Suspense>
  )
}