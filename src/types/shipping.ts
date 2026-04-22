// 택배 주소록
export interface ShippingAddress {
  id: string
  company_name: string
  contact_name: string
  contact_name_only: string | null
  contact_title: string | null
  contact_memo: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  address: string
  is_favorite: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface ShippingAddressFormData {
  company_name: string
  contact_name_only: string
  contact_title?: string
  contact_memo?: string
  phone: string
  mobile?: string
  email?: string
  address?: string
}

// 직함 표기용 헬퍼: "박민호 선임님" 또는 "박민호님" (직함이 없어도 '님' 부여)
export function formatContactDisplay(addr: Pick<ShippingAddress, 'contact_name' | 'contact_name_only' | 'contact_title' | 'contact_memo'>): string {
  const name = addr.contact_name_only || addr.contact_name || ''
  if (!name) return ''
  const titleWithNim = addr.contact_title ? ` ${addr.contact_title}님` : '님'
  const memo = addr.contact_memo ? ` (${addr.contact_memo})` : ''
  return `${name}${titleWithNim}${memo}`.trim()
}

/** 직함 칸에 '님'이 들어갔는지 검사 (UI에서 자동으로 '님'을 붙여주므로 중복 방지용) */
export function hasHonorificSuffix(title: string | null | undefined): boolean {
  if (!title) return false
  return /님/.test(title)
}

// 택배 발송 기록
export interface ShippingLabel {
  id: string
  label_code: string | null
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
