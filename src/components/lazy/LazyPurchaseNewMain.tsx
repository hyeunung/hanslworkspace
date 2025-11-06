import { lazy, Suspense } from 'react'

const PurchaseNewMain = lazy(() => import('../purchase/PurchaseNewMain'))

export default function LazyPurchaseNewMain() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-hansl-600"></div>
          <span className="text-gray-600">신규 발주 페이지 로딩 중...</span>
        </div>
      </div>
    }>
      <PurchaseNewMain />
    </Suspense>
  )
}