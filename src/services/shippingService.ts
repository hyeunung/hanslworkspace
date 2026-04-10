import { createClient } from "@/lib/supabase/client"
import { ShippingAddress, ShippingAddressFormData, ShippingLabel, ShippingLabelFormData } from "@/types/shipping"
import { logger } from "@/lib/logger"

class ShippingService {
  private supabase

  constructor() {
    this.supabase = createClient()
  }

  // ===== 주소록 =====

  async getAddresses(): Promise<{ success: boolean; data?: ShippingAddress[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('shipping_addresses')
        .select('*')
        .order('company_name')

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      logger.error('주소록 조회 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  async createAddress(formData: ShippingAddressFormData, createdBy?: string): Promise<{ success: boolean; data?: ShippingAddress; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('shipping_addresses')
        .insert({
          company_name: formData.company_name,
          contact_name: formData.contact_name,
          phone: formData.phone,
          address: formData.address,
          created_by: createdBy || null,
        })
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      logger.error('주소록 등록 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  // ===== 발송 기록 =====

  async getLabels(): Promise<{ success: boolean; data?: ShippingLabel[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('shipping_labels')
        .select(`
          *,
          sender_employee:employees!shipping_labels_sender_employee_id_fkey(id, name, phone),
          receiver_address:shipping_addresses!shipping_labels_receiver_address_id_fkey(*)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      logger.error('발송 기록 조회 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  async createLabel(formData: ShippingLabelFormData, createdBy?: string): Promise<{ success: boolean; data?: ShippingLabel; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('shipping_labels')
        .insert({
          sender_employee_id: formData.sender_employee_id,
          receiver_address_id: formData.receiver_address_id,
          delivery_type: formData.delivery_type,
          product_name: formData.product_name || null,
          item_value: formData.item_value,
          delivery_point: formData.delivery_point || null,
          notes: formData.notes || null,
          print_count: formData.print_count,
          created_by: createdBy || null,
        })
        .select(`
          *,
          sender_employee:employees!shipping_labels_sender_employee_id_fkey(id, name, phone),
          receiver_address:shipping_addresses!shipping_labels_receiver_address_id_fkey(*)
        `)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      logger.error('발송 기록 생성 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  async deleteLabel(id: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('shipping_labels')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    } catch (error) {
      logger.error('발송 기록 삭제 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  // ===== 직원 목록 (보내는 사람 선택용) =====

  async getEmployees(): Promise<{ success: boolean; data?: { id: string; name: string | null; phone: string | null }[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, name, phone')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      logger.error('직원 목록 조회 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }
}

export const shippingService = new ShippingService()
