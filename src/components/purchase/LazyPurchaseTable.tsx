import { memo, lazy, Suspense } from 'react';
import { Purchase } from '@/hooks/usePurchaseData';

// Lazy load the heavy table component
const FastPurchaseTable = lazy(() => import('./FastPurchaseTable'));

interface LazyPurchaseTableProps {
  purchases: Purchase[];
  activeTab: string;
  currentUserRoles: string[];
  onRefresh: (forceRefresh?: boolean, options?: { silent?: boolean }) => Promise<void> | void;
  onOptimisticUpdate: (purchaseId: number, updater: (prev: Purchase) => Purchase) => void;
  onPaymentComplete: (id: number) => Promise<void>;
  onReceiptComplete: (id: number) => Promise<void>;
}

// Memoized loading component
const TableSkeleton = memo(() => (
  <div className="p-4 space-y-4">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex space-x-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
      </div>
    ))}
  </div>
));
TableSkeleton.displayName = 'TableSkeleton';

// Main component with memoization
const LazyPurchaseTable = memo<LazyPurchaseTableProps>(({
  purchases,
  activeTab,
  currentUserRoles,
  onRefresh,
  onOptimisticUpdate,
  onPaymentComplete,
  onReceiptComplete
}) => (
  <Suspense fallback={<TableSkeleton />}>
    <FastPurchaseTable
      purchases={purchases}
      activeTab={activeTab}
      currentUserRoles={currentUserRoles}
      onRefresh={onRefresh}
      onOptimisticUpdate={onOptimisticUpdate}
      onPaymentComplete={onPaymentComplete}
      onReceiptComplete={onReceiptComplete}
    />
  </Suspense>
));

LazyPurchaseTable.displayName = 'LazyPurchaseTable';

export default LazyPurchaseTable;