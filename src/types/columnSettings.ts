/**
 * 칼럼 설정 관련 타입 정의
 * 전체항목 탭의 칼럼 숨기기/표시 기능을 위한 타입들
 */

// 전체항목 탭 칼럼 ID 타입
export type DoneTabColumnId = 
  | 'statement_progress'      // 거래명세서 (진행률)
  | 'purchase_order_number'   // 발주번호
  | 'payment_category'        // 결제종류
  | 'requester_name'          // 요청자
  | 'request_date'            // 청구일
  | 'utk_status'              // UTK
  | 'vendor_name'             // 업체
  | 'contact_name'            // 담당자
  | 'delivery_request_date'   // 입고요청일
  | 'revised_delivery_date'   // 변경입고일
  | 'item_name'               // 품명
  | 'specification'           // 규격
  | 'quantity'                // 수량
  | 'received_quantity'       // 실제입고수량
  | 'unit_price'              // 단가
  | 'amount'                  // 합계
  | 'remark'                  // 비고
  | 'link'                    // 링크
  | 'project_vendor'          // PJ업체
  | 'project_item'            // PJ ITEM
  | 'sales_order_number'      // 수주번호
  | 'purchase_progress'       // 구매진행 (진행률)
  | 'receipt_progress';       // 입고진행 (진행률)

// 칼럼 설정 타입
export type ColumnVisibility = Record<DoneTabColumnId, boolean>;

// 개별 칼럼 정보
export interface ColumnInfo {
  id: DoneTabColumnId;
  label: string;
  description?: string;
  defaultVisible: boolean;
}

// 칼럼 설정 훅의 반환 타입
export interface UseColumnSettingsReturn {
  columnVisibility: ColumnVisibility;
  toggleColumn: (columnId: DoneTabColumnId) => void;
  applyColumnSettings: (newSettings: ColumnVisibility) => void;
  resetToDefault: () => void;
  isLoading: boolean;
  error: string | null;
}

// DB 저장용 설정 타입
export interface ColumnSettingsDbData {
  user_email: string;
  setting_type: 'column_visibility';
  setting_key: 'purchase_list_done';
  setting_value: ColumnVisibility;
}