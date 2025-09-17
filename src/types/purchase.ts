export interface VendorContact {
  id: number
  vendor_id: number
  contact_name: string
  contact_email: string
  contact_phone: string
  position: string
  created_at: string
  updated_at: string
}

export interface Vendor {
  id: number
  vendor_name: string
  vendor_phone?: string
  vendor_fax?: string
  vendor_payment_schedule?: string
  business_number?: string
  representative?: string
  contact_phone?: string
  address?: string
  email?: string
  is_active: boolean
  created_at: string
  updated_at: string
  vendor_contacts?: VendorContact[]
}

export interface VendorFilters {
  search?: string
  is_active?: boolean | string
  business_number?: string
}

export interface VendorFormData {
  vendor_name: string
  vendor_phone?: string
  vendor_fax?: string
  vendor_payment_schedule?: string
  business_number?: string
  representative?: string
  contact_phone?: string
  address?: string
  email?: string
}

export interface EmployeeFilters {
  search?: string
  is_active?: boolean
  department?: string
  position?: string
  purchase_role?: string
}

export interface EmployeeFormData {
  name: string
  email: string
  department?: string
  position?: string
  phone?: string
  slack_id?: string
  purchase_role?: string[]
}

export type PurchaseRole = 'app_admin' | 'ceo' | 'middle_manager' | 'final_approver' | 'raw_material_manager' | 'consumable_manager' | 'purchase_manager' | 'requester' | 'lead_buyer' | 'buyer'  // hanslwebapp과 동일

export interface Employee {
  id: string
  employeeID?: string  // 사번 - hanslwebapp과 동일한 필드명
  employee_number?: string  // 사번 (employeeID와 동일, 하위호환용)
  name: string
  email: string
  department?: string
  position?: string
  phone?: string
  slack_id?: string
  purchase_role?: string  // 발주 관련 권한 (app_admin, ceo, middle_manager 등)
  role?: string  // 직원 관리 권한 (hr, admin)
  is_active: boolean
  created_at: string
  updated_at: string
  // 민감한 정보 (hr, admin만 볼 수 있음)
  bank?: string
  bank_account?: string
  adress?: string
  join_date?: string
  birthday?: string
  annual_leave_granted_current_year?: number
  used_annual_leave?: number
  remaining_annual_leave?: number
}

export interface PurchaseRequestItem {
  id: string
  purchase_request_id: string
  line_number?: number
  item_name: string
  specification?: string
  quantity: number
  unit: string
  unit_price: number
  unit_price_value?: number
  unit_price_currency?: string
  amount: number
  amount_value?: number
  amount_currency?: string
  remark?: string
  link?: string
  vendor_name?: string
  is_received: boolean
  received_quantity?: number
  received_date?: string
  received_by?: string
  delivery_status?: 'pending' | 'partial' | 'received'
  created_at: string
  updated_at: string
}

export interface PurchaseRequest {
  id: string
  purchase_order_number?: string
  requester_email?: string
  requester_name: string
  requester_id?: string
  requester_phone?: string
  requester_address?: string
  vendor_id?: number
  contact_id?: number
  sales_order_number?: string
  project_vendor?: string
  project_item?: string
  project_name?: string
  request_date: string
  desired_delivery_date?: string
  delivery_request_date?: string
  payment_category?: string
  request_type?: string
  progress_type?: string
  is_payment_completed?: boolean
  currency: 'KRW' | 'USD'
  total_amount: number
  unit_price_currency?: string
  po_template_type?: string
  shipping_address?: string
  middle_manager_status: 'pending' | 'approved' | 'rejected'
  final_manager_status: 'pending' | 'approved' | 'rejected'
  purchase_status?: 'pending' | 'in_progress' | 'completed'
  purchase_completed_at?: string
  delivery_status?: 'pending' | 'partial' | 'completed'
  delivery_completed_at?: string
  is_po_generated: boolean
  po_generated_at?: string
  is_received?: boolean
  received_at?: string
  created_at: string
  updated_at: string
}

export interface PurchaseRequestWithDetails extends PurchaseRequest {
  vendor?: Vendor
  vendor_name?: string
  vendor_contacts?: VendorContact[]
  purchase_request_items?: PurchaseRequestItem[]
  items?: PurchaseRequestItem[]  // alias for purchase_request_items
  delivery_request_date?: string  // alias for desired_delivery_date
  desired_delivery_date?: string  // actual DB column
  progress_type?: string
  project_vendor?: string  // alias for project_name
  project_item?: string
  sales_order_number?: string
  is_payment_completed?: boolean
  payment_completed_at?: string
  middle_manager_comment?: string
  final_manager_comment?: string
  purchase_comment?: string
  purpose?: string
  order_number?: string
  link?: string
}

export type PurchaseStatus = 'pending' | 'inProgress' | 'received' | 'rejected'

export interface PurchaseFilters {
  tab: 'pending' | 'inProgress' | 'received' | 'total'
  search: string
  dateFrom: string
  dateTo: string
  vendorId?: number
  requestType: string
  paymentCategory: string
}

export interface PurchaseListTabCounts {
  pending: number
  inProgress: number
  received: number
  total: number
}

// New purchase form types
export interface FormItem {
  line_number: number
  item_name: string
  specification: string
  quantity: number
  unit_price_value: number
  unit_price_currency: string
  amount_value: number
  amount_currency: string
  remark: string
  link?: string
}

export interface FormValues {
  vendor_id: number
  contact_id?: number
  contacts: string[]
  sales_order_number: string
  project_vendor: string
  project_item: string
  delivery_request_date: string
  progress_type: string
  payment_category: string
  currency: string
  po_template_type: string
  request_type: string
  request_date: string
  requester_name: string
  items: FormItem[]
}

// Dashboard specific types
export interface DashboardStats {
  total: number
  myRequests: number
  pending: number
  completed: number
  urgent: number
  todayActions: number
}

export interface UrgentRequest extends PurchaseRequest {
  priority: 'high' | 'medium' | 'low'
  daysOverdue: number
  vendor_name?: string
  total_items: number
  urgentReason: 'overdue_approval' | 'delivery_delay' | 'payment_pending'
}

export interface MyRequestStatus extends PurchaseRequest {
  progress_percentage: number
  current_step: 'approval' | 'purchase' | 'delivery' | 'payment' | 'completed'
  next_action: string
  vendor_name?: string
  total_items: number
  estimated_completion: string
}

export interface QuickAction {
  id: string
  type: 'approve' | 'reject' | 'purchase' | 'receive'
  label: string
  description: string
  count: number
  color: 'red' | 'yellow' | 'green' | 'blue'
}

// Purchase interface for list views (simplified version)
export interface Purchase {
  id: number;
  purchase_order_number?: string;
  request_date: string;
  delivery_request_date?: string;
  progress_type?: string;
  is_payment_completed?: boolean;
  payment_category?: string;
  currency: string;
  request_type?: string;
  vendor_name?: string;
  vendor_id?: number;
  contact_id?: number;
  contact_name?: string;
  requester_name: string;
  project_vendor?: string;
  sales_order_number?: string;
  project_item?: string;
  middle_manager_status?: string;
  final_manager_status?: string;
  total_amount: number;
  is_received: boolean;
  is_po_download?: boolean;
  items?: PurchaseRequestItem[];
  // Item level fields (for single item purchases)
  item_name?: string;
  specification?: string;
  quantity?: number;
  unit_price_value?: number;
  amount_value?: number;
  remark?: string;
  vendor_payment_schedule?: string;
  link?: string;
}

export interface DashboardData {
  employee: Employee | null
  stats: DashboardStats
  urgentRequests: UrgentRequest[]
  myRecentRequests: MyRequestStatus[]
  pendingApprovals: PurchaseRequestWithDetails[]
  quickActions: QuickAction[]
  todaySummary: {
    approved: number
    requested: number
    received: number
  }
  myPurchaseStatus: {
    waitingPurchase: PurchaseRequestWithDetails[]  // 구매 대기중
    waitingDelivery: PurchaseRequestWithDetails[]  // 입고 대기중
    recentCompleted: PurchaseRequestWithDetails[]  // 최근 완료
  }
}