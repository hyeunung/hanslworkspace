import { ReactNode } from 'react'
import { Purchase } from '@/types/purchase'
import { DoneTabColumnId } from '@/types/columnSettings'
import { formatDateShort } from '@/utils/helpers'
import {
  ApprovalStatusBadge, PaymentProgressBar, ReceiptProgressBar, StatementProgressBar,
  OrderNumberCell, PaymentCategoryBadge, QuantityCell, UnitPriceCell, AmountCell,
  UtkCell, LinkCell, TextCell,
} from '@/components/purchase/PurchaseTableCells'

// ─── 발주/구매 컴팩트 테이블 칼럼 정의 (주입식) ───────────────────────────
// 표는 1개(제네릭 PurchaseCompactTable)이고 탭별 칼럼 구성만 이 정의로 갈아끼운다.
// 기존 FastPurchaseTable의 탭별 4벌 JSX를 칼럼 정의 배열로 대체 — 순서/표시조건 동일.
// visibilityKey가 있는 칼럼만 칼럼 표시 설정(useColumnSettings)의 영향을 받는다.

export interface PurchaseCellCtx {
  activeTab: string
  canUtkCheck: boolean
  onExcelDownload: (p: Purchase) => Promise<void> | void
  onToggleUtkCheck: (p: Purchase) => Promise<void> | void
}

export interface PurchaseColumnDef {
  id: string
  visibilityKey?: DoneTabColumnId
  label: string
  width: number             // px — 기존 실데이터 분석 기반 고정 폭 유지
  align?: 'left' | 'right'  // 기본 center (production-compact-table 표준)
  render: (p: Purchase, ctx: PurchaseCellCtx) => ReactNode
}

// 공통 칼럼 (탭별 배열에서 조합)
const orderNumber: PurchaseColumnDef = {
  id: 'purchase_order_number', visibilityKey: 'purchase_order_number', label: '발주번호', width: 155, align: 'left',
  render: (p, ctx) => <OrderNumberCell purchase={p} onExcelDownload={ctx.onExcelDownload} />,
}
const paymentCategory: PurchaseColumnDef = {
  id: 'payment_category', visibilityKey: 'payment_category', label: '결제종류', width: 85,
  render: (p) => <PaymentCategoryBadge purchase={p} />,
}
const requesterName: PurchaseColumnDef = {
  id: 'requester_name', visibilityKey: 'requester_name', label: '요청자', width: 52,
  render: (p) => <TextCell value={p.requester_name} />,
}
const requestDate: PurchaseColumnDef = {
  id: 'request_date', visibilityKey: 'request_date', label: '청구일', width: 68,
  render: (p) => <>{formatDateShort(p.request_date)}</>,
}
const vendorName: PurchaseColumnDef = {
  id: 'vendor_name', visibilityKey: 'vendor_name', label: '업체', width: 128, align: 'left',
  render: (p) => <TextCell value={p.vendor_name} />,
}
const contactName: PurchaseColumnDef = {
  id: 'contact_name', visibilityKey: 'contact_name', label: '담당자', width: 68,
  render: (p) => <TextCell value={p.contact_name} />,
}
const deliveryRequestDate: PurchaseColumnDef = {
  id: 'delivery_request_date', visibilityKey: 'delivery_request_date', label: '입고요청일', width: 85,
  render: (p) => (
    <span className={p.revised_delivery_request_date ? 'text-gray-400' : ''}>
      {formatDateShort(p.delivery_request_date)}
    </span>
  ),
}
const revisedDeliveryDate: PurchaseColumnDef = {
  id: 'revised_delivery_date', visibilityKey: 'revised_delivery_date', label: '변경입고일', width: 85,
  render: (p) => <>{formatDateShort(p.revised_delivery_request_date)}</>,
}
const itemName: PurchaseColumnDef = {
  id: 'item_name', visibilityKey: 'item_name', label: '품명', width: 176, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.item_name} />,
}
const specification: PurchaseColumnDef = {
  id: 'specification', visibilityKey: 'specification', label: '규격', width: 260, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.specification} />,
}
const quantityCol = (label: string): PurchaseColumnDef => ({
  id: 'quantity', visibilityKey: 'quantity', label, width: 70,
  render: (p, ctx) => <QuantityCell purchase={p} activeTab={ctx.activeTab} />,
})
const unitPrice: PurchaseColumnDef = {
  id: 'unit_price', visibilityKey: 'unit_price', label: '단가', width: 100, align: 'right',
  render: (p) => <UnitPriceCell purchase={p} />,
}
const amountCol = (label: string): PurchaseColumnDef => ({
  id: 'amount', visibilityKey: 'amount', label, width: 100, align: 'right',
  render: (p) => <AmountCell purchase={p} />,
})
const remark: PurchaseColumnDef = {
  id: 'remark', visibilityKey: 'remark', label: '비고', width: 165, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.remark} />,
}
const linkCol: PurchaseColumnDef = {
  id: 'link', visibilityKey: 'link', label: '링크', width: 85, align: 'left',
  render: (p) => <LinkCell purchase={p} />,
}
const projectVendor: PurchaseColumnDef = {
  id: 'project_vendor', visibilityKey: 'project_vendor', label: 'PJ업체', width: 105, align: 'left',
  render: (p) => <TextCell value={p.project_vendor} />,
}
const projectItem: PurchaseColumnDef = {
  id: 'project_item', visibilityKey: 'project_item', label: 'PJ ITEM', width: 180, align: 'left',
  render: (p) => <TextCell value={p.project_item} />,
}
const salesOrderNumber: PurchaseColumnDef = {
  id: 'sales_order_number', visibilityKey: 'sales_order_number', label: '수주번호', width: 115, align: 'left',
  render: (p) => <TextCell value={p.sales_order_number} />,
}
const paymentSchedule: PurchaseColumnDef = {
  id: 'payment_schedule', visibilityKey: 'payment_schedule', label: '지출예정일', width: 100, align: 'left',
  render: (p) => <TextCell value={p.vendor_payment_schedule} />,
}

// 탭별 선두/전용 칼럼
const approvalStatus: PurchaseColumnDef = {
  id: 'approval_status', label: '승인상태', width: 85,
  render: (p) => <ApprovalStatusBadge purchase={p} />,
}
const paymentProgressLead: PurchaseColumnDef = {
  id: 'payment_progress_lead', label: '구매진행', width: 85,
  render: (p, ctx) => <PaymentProgressBar purchase={p} activeTab={ctx.activeTab} />,
}
const receiptProgressLead: PurchaseColumnDef = {
  id: 'receipt_progress_lead', visibilityKey: 'receipt_progress', label: '입고진행', width: 85,
  render: (p) => <ReceiptProgressBar purchase={p} />,
}
const statementProgressLead: PurchaseColumnDef = {
  id: 'statement_progress', visibilityKey: 'statement_progress', label: '거래명세서', width: 85,
  render: (p) => <StatementProgressBar purchase={p} />,
}
const utkStatus: PurchaseColumnDef = {
  id: 'utk_status', visibilityKey: 'utk_status', label: 'UTK', width: 56,
  render: (p, ctx) => <UtkCell purchase={p} canUtkCheck={ctx.canUtkCheck} onToggleUtkCheck={ctx.onToggleUtkCheck} />,
}
const purchaseProgress: PurchaseColumnDef = {
  id: 'purchase_progress', visibilityKey: 'purchase_progress', label: '구매진행', width: 100,
  render: (p, ctx) => <PaymentProgressBar purchase={p} activeTab={ctx.activeTab} />,
}
const receiptProgress: PurchaseColumnDef = {
  id: 'receipt_progress', visibilityKey: 'receipt_progress', label: '입고진행', width: 100,
  render: (p) => <ReceiptProgressBar purchase={p} />,
}

// 탭별 칼럼 구성 — 기존 FastPurchaseTable의 탭별 순서와 동일
export const purchaseColumnsForTab = (tab: string): PurchaseColumnDef[] => {
  switch (tab) {
    case 'pending':
      return [
        approvalStatus, orderNumber, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, itemName, specification,
        quantityCol('요청수량'), unitPrice, amountCol('합계'),
        remark, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'purchase':
      return [
        paymentProgressLead, orderNumber, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, itemName, specification,
        quantityCol('요청수량'), unitPrice, amountCol('합계'),
        remark, linkCol, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'receipt':
      return [
        receiptProgressLead, orderNumber, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, revisedDeliveryDate, itemName, specification,
        quantityCol('수량'), unitPrice, amountCol('합계'),
        remark, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'done':
    default:
      return [
        statementProgressLead, orderNumber, paymentCategory, requesterName, requestDate, utkStatus,
        vendorName, contactName, deliveryRequestDate, revisedDeliveryDate, itemName, specification,
        quantityCol('수량'), unitPrice, amountCol('(총 품목)합계'),
        remark, linkCol, projectVendor, projectItem, salesOrderNumber,
        paymentSchedule, purchaseProgress, receiptProgress,
      ]
  }
}
