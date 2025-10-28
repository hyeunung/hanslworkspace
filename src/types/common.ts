/**
 * Common utility types used across the application
 */

// 기본 타임스탬프 필드
export interface TimestampFields {
  created_at: string;
  updated_at: string;
}

// 기본 엔티티 (ID + 타임스탬프)
export interface BaseEntity extends TimestampFields {
  id: number;
}

// 문자열 기반 기본 엔티티
export interface BaseStringEntity extends TimestampFields {
  id: string;
}

// 활성화 상태 필드
export interface ActiveStatusField {
  is_active: boolean;
}

// 페이지네이션 관련 타입
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// 정렬 관련 타입
export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

// 필터링 관련 타입
export interface FilterConfig {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'notin';
  value: any;
}

// 검색 관련 타입
export interface SearchParams {
  search?: string;
  searchFields?: string[];
}

// 사용자 역할 관련 타입
export type UserRole = 'app_admin' | 'ceo' | 'final_approver' | 'middle_manager' | 'lead_buyer' | 'buyer' | 'requester' | 'hr';

export interface UserPermissions {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canManage: boolean;
}

// 상태 관련 타입
export type Status = 'active' | 'inactive' | 'pending' | 'approved' | 'rejected' | 'cancelled';

// 파일 관련 타입
export interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
}

// 주소 관련 타입
export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

// 연락처 정보 타입
export interface ContactInfo {
  name: string;
  email?: string;
  phone?: string;
  position?: string;
}

// 금액 관련 타입
export interface MoneyAmount {
  amount: number;
  currency: string;
}

// 선택 옵션 타입
export interface SelectOption<T = string> {
  label: string;
  value: T;
  disabled?: boolean;
}

// 폼 필드 상태 타입
export interface FieldState {
  value: any;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

// 폼 상태 타입
export interface FormState<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  dirty: boolean;
  submitting: boolean;
  submitted: boolean;
}

// API 응답 상태 타입
export type ApiStatus = 'idle' | 'loading' | 'success' | 'error';

// 모달 상태 타입
export interface ModalState {
  isOpen: boolean;
  data?: any;
}

// 테이블 상태 타입
export interface TableState<T> {
  data: T[];
  loading: boolean;
  error?: string;
  pagination: PaginationResult<T>;
  sorting: SortConfig[];
  filters: FilterConfig[];
  selection: Set<string | number>;
}

// 날짜 범위 타입
export interface DateRange {
  startDate?: string;
  endDate?: string;
}

// 통계 데이터 타입
export interface StatItem {
  label: string;
  value: number | string;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
}

// 알림 타입
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
  type?: 'primary' | 'secondary';
}

// 테마 관련 타입
export type Theme = 'light' | 'dark' | 'system';

// 언어 관련 타입
export type Language = 'ko' | 'en';

// 환경 관련 타입
export type Environment = 'development' | 'staging' | 'production';

// 유틸리티 타입들
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Omit 확장 (여러 키 제외)
export type OmitMultiple<T, K extends keyof T> = Omit<T, K>;

// Pick 확장 (여러 키 선택)
export type PickMultiple<T, K extends keyof T> = Pick<T, K>;

// 깊은 부분 타입
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// 읽기 전용 깊은 타입
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// 키-값 쌍 타입
export type KeyValuePair<K extends string | number | symbol, V> = {
  [key in K]: V;
};

// 함수 타입들
export type AsyncFunction<T = any, R = any> = (...args: T[]) => Promise<R>;
export type EventHandler<T = any> = (event: T) => void;
export type ErrorHandler = (error: Error) => void;

// 컴포넌트 Props 유틸리티 타입
export type ComponentProps<T> = T extends React.ComponentType<infer P> ? P : never;

// React Node 확장
export type ReactNodeExtended = React.ReactNode | (() => React.ReactNode);

// 조건부 타입들
export type NonNullable<T> = T extends null | undefined ? never : T;
export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;