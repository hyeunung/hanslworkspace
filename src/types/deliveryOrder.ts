/**
 * 제품 인수증 (Delivery Order) 타입
 */

import type { ShippingAddress } from '@/types/shipping'

export interface DeliveryOrderItem {
  id?: string
  delivery_order_id?: string
  line_number: number
  item_name: string
  specification?: string | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  supply_amount: number
  tax_amount: number
  remark?: string | null
  created_at?: string
}

export interface DeliveryOrder {
  id: string
  document_number: string
  issued_date: string                    // 'YYYY-MM-DD' (KST)
  sequence: number
  supplier_employee_id?: string | null   // 내부 인도자 (기본 로그인 사용자)
  supplier_address_id?: string | null    // 외부 인도자 override
  recipient_address_ids: string[]        // 인수자 shipping_addresses.id[]
  shipping_date?: string | null
  receiving_date?: string | null
  receiver_name?: string | null
  note?: string | null
  total_supply_amount: number
  total_tax_amount: number
  total_amount: number
  created_by?: string | null
  created_at: string
  updated_at: string

  // 조인 관계
  supplier_employee?: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
  } | null
  supplier_address?: ShippingAddress | null
  items?: DeliveryOrderItem[]
  recipients?: ShippingAddress[]
}

export interface DeliveryOrderFormData {
  supplier_employee_id?: string | null
  supplier_address_id?: string | null
  recipient_address_ids: string[]
  shipping_date?: string | null
  receiving_date?: string | null
  receiver_name?: string | null
  note?: string | null
  items: Omit<DeliveryOrderItem, 'id' | 'delivery_order_id' | 'created_at'>[]
}
