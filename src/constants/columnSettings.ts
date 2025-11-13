import { ColumnInfo, DoneTabColumnId, ColumnVisibility } from '@/types/columnSettings';

/**
 * 전체항목 탭 칼럼 설정 상수
 * 22개 칼럼의 기본 설정 및 메타데이터
 */

// 전체항목 탭 칼럼 정보 (표시 순서대로)
export const DONE_TAB_COLUMNS: ColumnInfo[] = [
  {
    id: 'statement_progress',
    label: '거래명세서',
    description: '거래명세서 수령 진행률',
    defaultVisible: true,
  },
  {
    id: 'purchase_order_number',
    label: '발주번호',
    description: '발주요청 번호',
    defaultVisible: true,
  },
  {
    id: 'payment_category',
    label: '결제종류',
    description: '결제 방식 (구매요청, 발주, 현장결제 등)',
    defaultVisible: true,
  },
  {
    id: 'requester_name',
    label: '요청자',
    description: '발주를 요청한 사용자',
    defaultVisible: true,
  },
  {
    id: 'request_date',
    label: '청구일',
    description: '발주 요청 날짜',
    defaultVisible: true,
  },
  {
    id: 'utk_status',
    label: 'UTK',
    description: 'UTK 확인 상태',
    defaultVisible: true,
  },
  {
    id: 'vendor_name',
    label: '업체',
    description: '공급업체명',
    defaultVisible: true,
  },
  {
    id: 'contact_name',
    label: '담당자',
    description: '업체 담당자명',
    defaultVisible: true,
  },
  {
    id: 'delivery_request_date',
    label: '입고요청일',
    description: '입고 요청 날짜',
    defaultVisible: true,
  },
  {
    id: 'revised_delivery_date',
    label: '변경입고일',
    description: '수정된 입고 날짜',
    defaultVisible: true,
  },
  {
    id: 'item_name',
    label: '품명',
    description: '구매 품목명',
    defaultVisible: true,
  },
  {
    id: 'specification',
    label: '규격',
    description: '품목 규격 정보',
    defaultVisible: true,
  },
  {
    id: 'quantity',
    label: '수량',
    description: '구매 수량',
    defaultVisible: true,
  },
  {
    id: 'unit_price',
    label: '단가',
    description: '품목 단가',
    defaultVisible: true,
  },
  {
    id: 'amount',
    label: '합계',
    description: '총 금액',
    defaultVisible: true,
  },
  {
    id: 'remark',
    label: '비고',
    description: '추가 메모 사항',
    defaultVisible: true,
  },
  {
    id: 'link',
    label: '링크',
    description: '관련 링크',
    defaultVisible: true,
  },
  {
    id: 'project_vendor',
    label: 'PJ업체',
    description: '프로젝트 업체',
    defaultVisible: true,
  },
  {
    id: 'project_item',
    label: 'PJ ITEM',
    description: '프로젝트 아이템',
    defaultVisible: true,
  },
  {
    id: 'sales_order_number',
    label: '수주번호',
    description: '수주 번호',
    defaultVisible: true,
  },
  {
    id: 'purchase_progress',
    label: '구매진행',
    description: '구매 진행률',
    defaultVisible: true,
  },
  {
    id: 'receipt_progress',
    label: '입고진행',
    description: '입고 진행률',
    defaultVisible: true,
  },
];

// 기본 칼럼 가시성 설정 (모든 칼럼 표시)
export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = DONE_TAB_COLUMNS.reduce(
  (acc, column) => {
    acc[column.id] = column.defaultVisible;
    return acc;
  },
  {} as ColumnVisibility
);

// 칼럼 ID별 빠른 조회를 위한 맵
export const COLUMN_INFO_MAP: Record<DoneTabColumnId, ColumnInfo> = DONE_TAB_COLUMNS.reduce(
  (acc, column) => {
    acc[column.id] = column;
    return acc;
  },
  {} as Record<DoneTabColumnId, ColumnInfo>
);

// 필수 칼럼 (숨길 수 없는 칼럼)
export const REQUIRED_COLUMNS: DoneTabColumnId[] = [
  'purchase_order_number',
  'vendor_name',
  'item_name',
  'specification',
];

// 칼럼 그룹 (설정 UI에서 그룹핑용)
export const COLUMN_GROUPS = [
  {
    title: '기본 정보',
    columns: [
      'statement_progress',
      'purchase_order_number',
      'payment_category',
      'requester_name',
      'request_date',
      'utk_status',
    ] as DoneTabColumnId[],
  },
  {
    title: '업체 정보',
    columns: [
      'vendor_name',
      'contact_name',
      'delivery_request_date',
      'revised_delivery_date',
    ] as DoneTabColumnId[],
  },
  {
    title: '품목 정보',
    columns: [
      'item_name',
      'specification',
      'quantity',
      'unit_price',
      'amount',
      'remark',
      'link',
    ] as DoneTabColumnId[],
  },
  {
    title: '프로젝트 정보',
    columns: [
      'project_vendor',
      'project_item',
      'sales_order_number',
    ] as DoneTabColumnId[],
  },
  {
    title: '진행 상태',
    columns: [
      'purchase_progress',
      'receipt_progress',
    ] as DoneTabColumnId[],
  },
] as const;