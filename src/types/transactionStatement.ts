/**
 * 거래명세서 확인 시스템 타입 정의
 */

// 거래명세서 상태
export type TransactionStatementStatus = 
  | 'pending'     // 업로드됨, 처리 대기
  | 'processing'  // OCR 처리 중
  | 'extracted'   // 추출 완료, 확인 대기
  | 'confirmed'   // 확정됨
  | 'rejected';   // 거부됨

// 매칭 신뢰도
export type MatchConfidence = 'low' | 'med' | 'high';

// 매칭 방법
export type MatchMethod = 'po_number' | 'item_similarity' | 'manual';

// 거래명세서 테이블 타입
export interface TransactionStatement {
  id: string;
  image_url: string;
  file_name?: string;
  uploaded_at: string;
  uploaded_by?: string;
  uploaded_by_name?: string;
  status: TransactionStatementStatus;
  confirmed_at?: string;
  confirmed_by?: string;
  confirmed_by_name?: string;
  statement_date?: string;
  vendor_name?: string;
  total_amount?: number;
  tax_amount?: number;
  grand_total?: number;
  extracted_data?: ExtractedData;
  extraction_error?: string;
  created_at: string;
  updated_at: string;
}

// 거래명세서 품목 타입
export interface TransactionStatementItem {
  id: string;
  statement_id: string;
  line_number?: number;
  extracted_item_name?: string;
  extracted_specification?: string;
  extracted_quantity?: number;
  extracted_unit_price?: number;
  extracted_amount?: number;
  extracted_tax_amount?: number;
  extracted_po_number?: string;
  extracted_remark?: string;
  
  // 매칭 정보
  matched_purchase_id?: number;
  matched_item_id?: number;
  match_confidence?: MatchConfidence;
  match_method?: MatchMethod;
  
  // 추가 공정
  is_additional_item: boolean;
  parent_item_id?: string;
  
  // 확정 정보
  is_confirmed: boolean;
  confirmed_unit_price?: number;
  confirmed_amount?: number;
  confirmed_quantity?: number;
  
  created_at: string;
  updated_at: string;
}

// OCR 교정 데이터 타입
export interface OCRCorrection {
  id: string;
  statement_id?: string;
  statement_item_id?: string;
  original_text: string;
  corrected_text: string;
  field_type: OCRFieldType;
  corrected_by?: string;
  corrected_by_name?: string;
  created_at: string;
}

export type OCRFieldType = 
  | 'po_number' 
  | 'item_name' 
  | 'quantity' 
  | 'unit_price' 
  | 'amount' 
  | 'date' 
  | 'vendor_name' 
  | 'remark';

// OCR/LLM 추출 결과 타입
export interface ExtractedItem {
  line_number: number;
  item_name: string;
  specification?: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_amount?: number;
  po_number?: string;
  remark?: string;
  confidence: MatchConfidence;
}

export interface ExtractedData {
  statement_date?: string;
  vendor_name?: string;
  total_amount?: number;
  tax_amount?: number;
  grand_total?: number;
  items: ExtractedItem[];
  raw_vision_text?: string;
}

// 발주 매칭 후보 타입
export interface MatchCandidate {
  purchase_id: number;
  purchase_order_number: string;
  sales_order_number?: string;
  item_id: number;
  item_name: string;
  specification?: string;
  quantity: number;
  unit_price?: number;
  vendor_name?: string;
  score: number; // 매칭 점수 (0-100)
  match_reasons: string[]; // 매칭 이유
}

// 거래명세서 상세 (품목 포함)
export interface TransactionStatementWithItems extends TransactionStatement {
  items: TransactionStatementItemWithMatch[];
}

// 품목 + 매칭 후보
export interface TransactionStatementItemWithMatch extends TransactionStatementItem {
  match_candidates?: MatchCandidate[];
  matched_purchase?: {
    id: number;
    purchase_order_number: string;
    sales_order_number?: string;
    vendor_name?: string;
  };
  matched_item?: {
    id: number;
    item_name: string;
    specification?: string;
    quantity: number;
    unit_price_value?: number;
  };
}

// 업로드 요청 타입
export interface UploadStatementRequest {
  file: File;
}

// 업로드 응답 타입
export interface UploadStatementResponse {
  statementId: string;
  imageUrl: string;
}

// OCR 추출 요청 타입
export interface ExtractStatementRequest {
  statementId: string;
  imageUrl: string;
}

// 확정 요청 타입
export interface ConfirmStatementRequest {
  statementId: string;
  items: ConfirmItemRequest[];
}

export interface ConfirmItemRequest {
  itemId: string;
  matched_purchase_id?: number;
  matched_item_id?: number;
  confirmed_quantity?: number;
  confirmed_unit_price?: number;
  confirmed_amount?: number;
  is_additional_item?: boolean;
  parent_item_id?: string;
}

// 교정 저장 요청 타입
export interface SaveCorrectionRequest {
  statement_id?: string;
  statement_item_id?: string;
  original_text: string;
  corrected_text: string;
  field_type: OCRFieldType;
}

// 발주번호/수주번호 패턴
// 발주번호: F + YYYYMMDD + _ + 3자리 숫자 (예: F20251008_001, F20251008_002)
export const PO_NUMBER_PATTERN = /^F\d{8}_\d{3}$/;
// 수주번호: HS + YYYYMMDD + - + 2자리 숫자 (예: HS20251201-01, HS20251201-11)
export const SO_NUMBER_PATTERN = /^HS\d{8}-\d{2}$/;

// OCR에서 읽은 번호를 시스템 형식으로 정규화
export function normalizeOrderNumber(input: string): string {
  if (!input) return input;
  
  let normalized = input.toUpperCase().replace(/\s+/g, '');
  
  // 발주번호 정규화: F20251008_1 또는 F20251008_01 → F20251008_001
  const poMatch = normalized.match(/^(F\d{8})_(\d{1,3})$/);
  if (poMatch) {
    const [, prefix, num] = poMatch;
    return `${prefix}_${num.padStart(3, '0')}`;
  }
  
  // 수주번호 정규화: HS20251201-1 → HS20251201-01
  const soMatch = normalized.match(/^(HS\d{8})-(\d{1,2})$/);
  if (soMatch) {
    const [, prefix, num] = soMatch;
    return `${prefix}-${num.padStart(2, '0')}`;
  }
  
  return normalized;
}

// 패턴 검증 함수
export function isValidPoNumber(value: string): boolean {
  return PO_NUMBER_PATTERN.test(value.toUpperCase());
}

export function isValidSoNumber(value: string): boolean {
  return SO_NUMBER_PATTERN.test(value.toUpperCase());
}

export function isValidOrderNumber(value: string): boolean {
  return isValidPoNumber(value) || isValidSoNumber(value);
}

// 번호에서 날짜 추출
export function extractDateFromOrderNumber(orderNumber: string): string | null {
  const match = orderNumber.match(/\d{8}/);
  if (!match) return null;
  
  const dateStr = match[0];
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  
  return `${year}-${month}-${day}`;
}

