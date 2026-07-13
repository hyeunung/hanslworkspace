import { ReactNode } from 'react'
import { Purchase, PurchaseRequestItem } from '@/types/purchase'
import { DoneTabColumnId } from '@/types/columnSettings'
import { formatDateShort } from '@/utils/helpers'
import {
  ApprovalStatusBadge, PaymentProgressBar, ReceiptProgressBar, StatementProgressBar,
  OrderNumberCell, PaymentCategoryBadge, ProgressTypeBadge, QuantityCell, UnitPriceCell, AmountCell,
  UtkCell, LinkCell, TextCell, ItemQuantityCell, ItemLinkCell,
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

// 인풋 모드에서 인라인 편집을 허용하는 품목 필드
export type PurchaseItemEditField =
  | 'item_name' | 'specification' | 'quantity' | 'unit_price_value' | 'amount_value' | 'remark'

export interface PurchaseColumnDef {
  id: string
  visibilityKey?: DoneTabColumnId
  label: string
  width: number             // px — 기본/폴백 폭 (fitText 없는 칼럼은 이 값 고정, 있으면 빈 표일 때 바닥값)
  align?: 'left' | 'right'  // 기본 center (production-compact-table 표준)
  render: (p: Purchase, ctx: PurchaseCellCtx) => ReactNode
  // 칼럼폭 실측 핏(제작현황 지침): 표시 텍스트를 반환하면 테이블이 canvas 실측으로 폭을 잡는다.
  // 배지/진행바처럼 텍스트가 아닌 칼럼은 생략(고정 폭 유지).
  fitText?: (p: Purchase) => string
  fitExtra?: (p: Purchase) => number // 텍스트 외 부가 요소 폭 보정(아이콘/배지 등, px)
  fitMax?: number // 실측 폭 상한 — 극단적으로 긴 값(비고·규격 등)이 칼럼을 폭주시키지 않게, 넘치면 말줄임
  // ── 인풋 모드(품목 전개) 전용 ──────────────────────────────────────────
  // itemRender가 있으면 품목 단위 칼럼: 품목 1개당 1셀로 풀린다.
  // 없으면 발주 공통 칼럼: 그룹 전체를 rowspan으로 세로 병합해 한 번만 표시.
  itemRender?: (item: PurchaseRequestItem, p: Purchase, ctx: PurchaseCellCtx) => ReactNode
  itemFitText?: (item: PurchaseRequestItem, p: Purchase) => string
  editField?: PurchaseItemEditField  // 지정 시 인풋 모드에서 해당 품목 필드 인라인 편집 허용
  editType?: 'text' | 'number'
}

// 셀 표시 문자열 (실측용) — 렌더 로직과 동일한 규칙
const currencyText = (amount: number, currency?: string) => {
  const sym = !currency || ['KRW', '원', '₩'].includes(currency) ? '₩'
    : ['USD', '$', '달러'].includes(currency) ? '$'
    : ['EUR', '€'].includes(currency) ? '€'
    : ['JPY', '엔', '¥', 'CNY', '위안', '元'].includes(currency) ? '¥'
    : currency
  return `${amount.toLocaleString()} ${sym}`
}
const unitPriceText = (p: Purchase) => {
  const items = p.purchase_request_items || []
  if (items.length > 1) return '-'
  return currencyText(items[0]?.unit_price_value || 0, items[0]?.unit_price_currency || 'KRW')
}
const amountText = (p: Purchase) => {
  const items = p.purchase_request_items || []
  const total = items.reduce((sum, item) => {
    const tax = (p.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0
    return sum + (item.amount_value || 0) + tax
  }, 0)
  return currencyText(total, items[0]?.amount_currency || p.currency || 'KRW')
}
const quantitySumText = (p: Purchase) => {
  const q = (p.purchase_request_items || []).reduce((sum, item) => sum + (item.quantity || 0), 0)
  return String(q || 0)
}
const quantityPairText = (p: Purchase) => {
  const items = p.purchase_request_items || []
  const q = items.reduce((sum, item) => sum + (item.quantity || 0), 0)
  const r = items.reduce((sum, item) => sum + (item.received_quantity || 0), 0)
  return q === r && r > 0 ? String(r) : `${q}/${r}`
}

// 배지/진행바 칼럼의 fitExtra 상수 — 실제 렌더 마크업의 자체 여백/요소 폭 (PurchaseTableCells.tsx 기준)
const BADGE_PADDING = 12       // .badge-stats → px-1.5(6px)×2
const UTK_BADGE_PADDING = 14   // badge-utk-* → badge-stats(12) + border 1px×2
const PROGRESS_BAR_WIDTH = 36  // ProgressBar: 바 w-8(32px) + gap-1(4px)

const paymentCategoryText = (p: Purchase): string => {
  const c = p.payment_category
  return c === '발주' ? '발주요청' : c === '구매 요청' ? '구매요청' : c === '현장 결제' ? '현장결제' : c || '-'
}
const approvalStatusText = (p: Purchase): string => {
  const middleApproved = p.middle_manager_status === 'approved'
  const middleRejected = p.middle_manager_status === 'rejected'
  const finalApproved = p.final_manager_status === 'approved'
  const finalRejected = p.final_manager_status === 'rejected'
  if (middleRejected || finalRejected) return '반려'
  if (middleApproved && finalApproved) return '승인완료'
  if (middleApproved) return '1차 승인'
  return '승인대기'
}
const utkStatusText = (p: Purchase): string => (p.is_utk_checked ? '완료' : '대기')

// 구매완료 진행률 % 텍스트 (PaymentProgressBar와 동일 계산, activeTab='done'의 '-' 분기는 별도 처리)
const paymentProgressPercent = (p: Purchase): number => {
  if (p.is_payment_completed) return 100
  const items = p.purchase_request_items || []
  if (items.length === 0) return 0
  const completed = items.filter(item => item.is_payment_completed === true).length
  return Math.round((completed / items.length) * 100)
}
const receiptProgressPercent = (p: Purchase): number => {
  const items = p.purchase_request_items || []
  if (items.length === 0) return 0
  const received = items.filter(item => item.is_received === true).length
  return Math.round((received / items.length) * 100)
}
const statementProgressPercent = (p: Purchase): number => {
  const items = p.purchase_request_items || p.items || []
  if (items.length === 0) return 0
  const completed = items.filter(item => item.is_statement_received === true).length
  return Math.round((completed / items.length) * 100)
}

// 공통 칼럼 (탭별 배열에서 조합)
const orderNumber: PurchaseColumnDef = {
  id: 'purchase_order_number', visibilityKey: 'purchase_order_number', label: '발주번호', width: 155, align: 'left',
  render: (p, ctx) => <OrderNumberCell purchase={p} onExcelDownload={ctx.onExcelDownload} />,
  fitText: (p) => {
    const n = p.purchase_request_items?.length || 0
    return `${p.purchase_order_number || '-'}${n > 1 ? `(${n})` : ''}`
  },
  // 엑셀 아이콘(14px+간격) + 무상샘플 배지 보정
  fitExtra: (p) => 20 + (p.is_free_sample ? 32 : 0),
}
const progressTypeText = (p: Purchase): string =>
  (p.progress_type === '선진행' || p.progress_type?.includes('선진행')) ? '선진행' : '일반'
const progressType: PurchaseColumnDef = {
  id: 'progress_type', visibilityKey: 'progress_type', label: '진행종류', width: 68,
  render: (p) => <ProgressTypeBadge purchase={p} />,
  fitText: progressTypeText,
  fitExtra: () => UTK_BADGE_PADDING,
}
const paymentCategory: PurchaseColumnDef = {
  id: 'payment_category', visibilityKey: 'payment_category', label: '결제종류', width: 85,
  render: (p) => <PaymentCategoryBadge purchase={p} />,
  fitText: paymentCategoryText,
  fitExtra: () => BADGE_PADDING,
}
const requesterName: PurchaseColumnDef = {
  id: 'requester_name', visibilityKey: 'requester_name', label: '요청자', width: 52,
  render: (p) => <TextCell value={p.requester_name} />,
  fitText: (p) => p.requester_name || '-',
}
const requestDate: PurchaseColumnDef = {
  id: 'request_date', visibilityKey: 'request_date', label: '청구일', width: 68,
  render: (p) => <>{formatDateShort(p.request_date)}</>,
  fitText: (p) => formatDateShort(p.request_date) || '-',
}
const vendorName: PurchaseColumnDef = {
  id: 'vendor_name', visibilityKey: 'vendor_name', label: '업체', width: 128, align: 'left',
  render: (p) => <TextCell value={p.vendor_name} />,
  fitText: (p) => p.vendor_name || '-',
  fitMax: 200,
}
const contactName: PurchaseColumnDef = {
  id: 'contact_name', visibilityKey: 'contact_name', label: '담당자', width: 68,
  render: (p) => <TextCell value={p.contact_name} />,
  fitText: (p) => p.contact_name || '-',
}
const deliveryRequestDate: PurchaseColumnDef = {
  id: 'delivery_request_date', visibilityKey: 'delivery_request_date', label: '입고요청일', width: 85,
  render: (p) => (
    <span className={p.revised_delivery_request_date ? 'text-gray-400' : ''}>
      {formatDateShort(p.delivery_request_date)}
    </span>
  ),
  fitText: (p) => formatDateShort(p.delivery_request_date) || '-',
}
const revisedDeliveryDate: PurchaseColumnDef = {
  id: 'revised_delivery_date', visibilityKey: 'revised_delivery_date', label: '변경입고일', width: 85,
  render: (p) => <>{formatDateShort(p.revised_delivery_request_date)}</>,
  fitText: (p) => formatDateShort(p.revised_delivery_request_date) || '-',
}
// 인풋 모드 품목 단위 표시 텍스트 — 수량은 탭에 따라 요청/입고 병기
const itemQuantityText = (item: PurchaseRequestItem, pair: boolean): string => {
  const q = item.quantity || 0
  if (!pair) return String(q)
  const r = item.received_quantity || 0
  return q === r && r > 0 ? String(r) : `${q}/${r}`
}

const itemName: PurchaseColumnDef = {
  id: 'item_name', visibilityKey: 'item_name', label: '품명', width: 176, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.item_name} />,
  fitText: (p) => p.purchase_request_items?.[0]?.item_name || '-',
  fitMax: 250,
  itemRender: (item) => <TextCell value={item.item_name} />,
  itemFitText: (item) => item.item_name || '-',
  editField: 'item_name', editType: 'text',
}
const specification: PurchaseColumnDef = {
  id: 'specification', visibilityKey: 'specification', label: '규격', width: 260, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.specification} />,
  fitText: (p) => p.purchase_request_items?.[0]?.specification || '-',
  fitMax: 360,
  itemRender: (item) => <TextCell value={item.specification} />,
  itemFitText: (item) => item.specification || '-',
  editField: 'specification', editType: 'text',
}
const quantityCol = (label: string, pair: boolean): PurchaseColumnDef => ({
  id: 'quantity', visibilityKey: 'quantity', label, width: 70,
  render: (p, ctx) => <QuantityCell purchase={p} activeTab={ctx.activeTab} />,
  fitText: pair ? quantityPairText : quantitySumText,
  itemRender: (item) => <ItemQuantityCell item={item} pair={pair} />,
  itemFitText: (item) => itemQuantityText(item, pair),
  editField: 'quantity', editType: 'number',
})
const unitPrice: PurchaseColumnDef = {
  id: 'unit_price', visibilityKey: 'unit_price', label: '단가', width: 100, align: 'right',
  render: (p) => <UnitPriceCell purchase={p} />,
  fitText: unitPriceText,
  itemRender: (item) => <>{currencyText(item.unit_price_value || 0, item.unit_price_currency || 'KRW')}</>,
  itemFitText: (item) => currencyText(item.unit_price_value || 0, item.unit_price_currency || 'KRW'),
  editField: 'unit_price_value', editType: 'number',
}
const amountCol = (label: string): PurchaseColumnDef => ({
  id: 'amount', visibilityKey: 'amount', label, width: 100, align: 'right',
  render: (p) => <AmountCell purchase={p} />,
  fitText: amountText,
  itemRender: (item, p) => <>{currencyText(item.amount_value || 0, item.amount_currency || p.currency || 'KRW')}</>,
  itemFitText: (item, p) => currencyText(item.amount_value || 0, item.amount_currency || p.currency || 'KRW'),
  editField: 'amount_value', editType: 'number',
})
const remark: PurchaseColumnDef = {
  id: 'remark', visibilityKey: 'remark', label: '비고', width: 165, align: 'left',
  render: (p) => <TextCell value={p.purchase_request_items?.[0]?.remark} />,
  fitText: (p) => p.purchase_request_items?.[0]?.remark || '-',
  fitMax: 240,
  itemRender: (item) => <TextCell value={item.remark} />,
  itemFitText: (item) => item.remark || '-',
  editField: 'remark', editType: 'text',
}
// 링크는 클릭=열기 동작과 충돌하므로 인풋 모드에서도 편집 대상에서 제외 (표시만 품목 단위)
const linkCol: PurchaseColumnDef = {
  id: 'link', visibilityKey: 'link', label: '링크', width: 85, align: 'left',
  render: (p) => <LinkCell purchase={p} />,
  fitText: (p) => (p.purchase_request_items?.[0]?.link ? '링크 보기' : '-'),
  itemRender: (item) => <ItemLinkCell item={item} />,
  itemFitText: (item) => (item.link ? '링크 보기' : '-'),
}
const projectVendor: PurchaseColumnDef = {
  id: 'project_vendor', visibilityKey: 'project_vendor', label: 'PJ업체', width: 105, align: 'left',
  render: (p) => <TextCell value={p.project_vendor} />,
  fitText: (p) => p.project_vendor || '-',
  fitMax: 170,
}
const projectItem: PurchaseColumnDef = {
  id: 'project_item', visibilityKey: 'project_item', label: 'PJ ITEM', width: 180, align: 'left',
  render: (p) => <TextCell value={p.project_item} />,
  fitText: (p) => p.project_item || '-',
  fitMax: 240,
}
const salesOrderNumber: PurchaseColumnDef = {
  id: 'sales_order_number', visibilityKey: 'sales_order_number', label: '수주번호', width: 115, align: 'left',
  render: (p) => <TextCell value={p.sales_order_number} />,
  fitText: (p) => p.sales_order_number || '-',
}
const paymentSchedule: PurchaseColumnDef = {
  id: 'payment_schedule', visibilityKey: 'payment_schedule', label: '지출예정일', width: 100, align: 'left',
  render: (p) => <TextCell value={p.vendor_payment_schedule} />,
  fitText: (p) => p.vendor_payment_schedule || '-',
}

// 탭별 선두/전용 칼럼
const approvalStatus: PurchaseColumnDef = {
  id: 'approval_status', label: '승인상태', width: 85,
  render: (p) => <ApprovalStatusBadge purchase={p} />,
  fitText: approvalStatusText,
  fitExtra: () => BADGE_PADDING,
}
// 'purchase' 탭 전용 — activeTab이 항상 'purchase'라 PaymentProgressBar의 '-'(activeTab==='done') 분기는 타지 않는다
const paymentProgressLead: PurchaseColumnDef = {
  id: 'payment_progress_lead', label: '구매진행', width: 85,
  render: (p, ctx) => <PaymentProgressBar purchase={p} activeTab={ctx.activeTab} />,
  fitText: (p) => `${paymentProgressPercent(p)}%`,
  fitExtra: () => PROGRESS_BAR_WIDTH,
}
// 'receipt' 탭 전용 — ReceiptProgressBar는 activeTab 분기가 없어 항상 진행바를 그린다
const receiptProgressLead: PurchaseColumnDef = {
  id: 'receipt_progress_lead', visibilityKey: 'receipt_progress', label: '입고진행', width: 85,
  render: (p) => <ReceiptProgressBar purchase={p} />,
  fitText: (p) => `${receiptProgressPercent(p)}%`,
  fitExtra: () => PROGRESS_BAR_WIDTH,
}
// 'done' 탭 전용 — StatementProgressBar도 분기 없이 항상 진행바
const statementProgressLead: PurchaseColumnDef = {
  id: 'statement_progress', visibilityKey: 'statement_progress', label: '거래명세서', width: 85,
  render: (p) => <StatementProgressBar purchase={p} />,
  fitText: (p) => `${statementProgressPercent(p)}%`,
  fitExtra: () => PROGRESS_BAR_WIDTH,
}
const utkStatus: PurchaseColumnDef = {
  id: 'utk_status', visibilityKey: 'utk_status', label: 'UTK', width: 56,
  render: (p, ctx) => <UtkCell purchase={p} canUtkCheck={ctx.canUtkCheck} onToggleUtkCheck={ctx.onToggleUtkCheck} />,
  fitText: utkStatusText,
  fitExtra: () => UTK_BADGE_PADDING,
}
// 'done' 탭 전용 — PaymentProgressBar가 activeTab==='done'일 때 구매요청 외 카테고리는 '-'만 표시(바 없음)
const purchaseProgress: PurchaseColumnDef = {
  id: 'purchase_progress', visibilityKey: 'purchase_progress', label: '구매진행', width: 100,
  render: (p, ctx) => <PaymentProgressBar purchase={p} activeTab={ctx.activeTab} />,
  fitText: (p) => (p.payment_category !== '구매 요청' ? '-' : `${paymentProgressPercent(p)}%`),
  fitExtra: (p) => (p.payment_category !== '구매 요청' ? 0 : PROGRESS_BAR_WIDTH),
}
const receiptProgress: PurchaseColumnDef = {
  id: 'receipt_progress', visibilityKey: 'receipt_progress', label: '입고진행', width: 100,
  render: (p) => <ReceiptProgressBar purchase={p} />,
  fitText: (p) => `${receiptProgressPercent(p)}%`,
  fitExtra: () => PROGRESS_BAR_WIDTH,
}

// 탭별 칼럼 구성 — 기존 FastPurchaseTable의 탭별 순서와 동일
export const purchaseColumnsForTab = (tab: string): PurchaseColumnDef[] => {
  switch (tab) {
    case 'pending':
      return [
        approvalStatus, orderNumber, progressType, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, itemName, specification,
        quantityCol('요청수량', false), unitPrice, amountCol('합계'),
        remark, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'purchase':
      return [
        paymentProgressLead, orderNumber, progressType, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, itemName, specification,
        quantityCol('요청수량', false), unitPrice, amountCol('합계'),
        remark, linkCol, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'receipt':
      return [
        receiptProgressLead, orderNumber, progressType, paymentCategory, requesterName, requestDate,
        vendorName, contactName, deliveryRequestDate, revisedDeliveryDate, itemName, specification,
        quantityCol('수량', true), unitPrice, amountCol('합계'),
        remark, projectVendor, projectItem, salesOrderNumber,
      ]
    case 'done':
    default:
      return [
        statementProgressLead, orderNumber, progressType, paymentCategory, requesterName, requestDate, utkStatus,
        vendorName, contactName, deliveryRequestDate, revisedDeliveryDate, itemName, specification,
        quantityCol('수량', true), unitPrice, amountCol('(총 품목)합계'),
        remark, linkCol, projectVendor, projectItem, salesOrderNumber,
        paymentSchedule, purchaseProgress, receiptProgress,
      ]
  }
}
