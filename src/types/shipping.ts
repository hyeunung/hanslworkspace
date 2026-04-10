// 택배 주소록
export interface ShippingAddress {
  id: string
  company_name: string
  contact_name: string
  phone: string | null
  address: string
  is_favorite: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface ShippingAddressFormData {
  company_name: string
  contact_name: string
  phone: string
  address: string
}

// 택배 발송 기록
export interface ShippingLabel {
  id: string
  sender_employee_id: string
  receiver_address_id: string
  delivery_type: '택배' | '퀵'
  product_name: string | null
  item_value: number | null
  delivery_point: string | null
  notes: string | null
  print_count: number
  created_at: string
  created_by: string | null
  // joined
  sender_employee?: {
    id: string
    name: string | null
    phone: string | null
  }
  receiver_address?: ShippingAddress
}

export interface ShippingLabelFormData {
  sender_employee_id: string
  receiver_address_id: string
  delivery_type: '택배' | '퀵'
  product_name: string
  item_value: number | null
  delivery_point: string
  notes: string
  print_count: number
}

// 보내는 사람 고정 정보
export const SENDER_COMPANY = '(주)한슬'
export const SENDER_ADDRESS = '대구광역시 달서구 성서공단북로305'
