import { PurchaseRequest, PurchaseStatus } from '@/types/purchase'

export function getPurchaseStatus(request: PurchaseRequest): PurchaseStatus {
  if (request.delivery_status === 'completed') {
    return 'received'
  }
  if (request.final_manager_status === 'rejected' || request.middle_manager_status === 'rejected') {
    return 'rejected'
  }
  if (request.is_payment_completed) {
    return 'inProgress'
  }
  return 'pending'
}

export function getStatusLabel(status: PurchaseStatus): string {
  const labels: Record<PurchaseStatus, string> = {
    pending: '승인 대기',
    inProgress: '구매 진행',
    received: '입고 완료',
    rejected: '반려'
  }
  return labels[status]
}

export function getStatusColorClass(status: PurchaseStatus): string {
  const colors: Record<PurchaseStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    inProgress: 'bg-hansl-100 text-hansl-800',
    received: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800'
  }
  return colors[status]
}

export function formatCurrency(amount: number, currency: 'KRW' | 'USD'): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW'
  }).format(amount)
}