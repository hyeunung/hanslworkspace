import { createClient } from '@/lib/supabase/client'
import type {
  DeliveryOrder,
  DeliveryOrderFormData,
} from '@/types/deliveryOrder'
import { logger } from '@/lib/logger'

/**
 * 제품 인수증 (Delivery Order) 서비스
 * - DB 스키마: delivery_orders + delivery_order_items + delivery_order_code_counters
 * - 문서번호 규칙: DO + KST YYYYMMDD + _ + 3자리 순번
 */
class DeliveryOrderService {
  private supabase

  constructor() {
    this.supabase = createClient()
  }

  /** KST 기준 오늘 날짜 YYYY-MM-DD */
  private kstToday(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
    const m = parts.find((p) => p.type === 'month')?.value ?? '01'
    const d = parts.find((p) => p.type === 'day')?.value ?? '01'
    return `${y}-${m}-${d}`
  }

  /** 당일 다음 순번 발급 (원자적) */
  async nextSequence(issuedDate: string): Promise<number> {
    const { data, error } = await this.supabase.rpc(
      'next_delivery_order_sequence',
      { p_issued_date: issuedDate }
    )
    if (error) throw error
    return data as number
  }

  /** 문서번호 포맷: DO{YYYYMMDD}_{3자리} */
  private formatDocNumber(issuedDate: string, sequence: number): string {
    const compact = issuedDate.replace(/-/g, '')
    return `DO${compact}_${String(sequence).padStart(3, '0')}`
  }

  // ===== 목록 =====

  /** shipping_contacts id 목록을 ShippingAddress shape으로 hydrate */
  private async hydrateContacts(ids: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>()
    if (ids.length === 0) return map
    const { data } = await this.supabase
      .from('shipping_contacts')
      .select(`
        id, name, title, memo, phone, mobile, email, is_favorite,
        created_at, updated_at, created_by,
        company:shipping_companies!company_id(id, name),
        address:shipping_company_addresses!address_id(id, address)
      `)
      .in('id', ids)
    ;(data ?? []).forEach((c: any) => {
      const legacy = [c.name, c.title].filter(Boolean).join(' ').trim()
      map.set(c.id, {
        id: c.id,
        company_name: c.company?.name ?? '',
        contact_name: legacy || c.name,
        contact_name_only: c.name,
        contact_title: c.title,
        contact_memo: c.memo,
        phone: c.phone,
        mobile: c.mobile,
        email: c.email,
        address: c.address?.address ?? '',
        is_favorite: c.is_favorite,
        created_at: c.created_at,
        updated_at: c.updated_at,
        created_by: c.created_by,
      })
    })
    return map
  }

  async list(): Promise<{ success: boolean; data?: DeliveryOrder[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('delivery_orders')
        .select(
          `*,
          supplier_employee:employees!delivery_orders_supplier_employee_id_fkey(id, name, phone, email),
          items:delivery_order_items(*)`
        )
        .order('created_at', { ascending: false })

      if (error) throw error

      // supplier + recipients는 shipping_contacts에서 수동 hydrate
      const rows = (data ?? []) as DeliveryOrder[]
      const allIds = Array.from(new Set([
        ...rows.flatMap((r) => r.recipient_address_ids ?? []),
        ...rows.map((r) => r.supplier_address_id).filter(Boolean) as string[],
      ]))
      const map = await this.hydrateContacts(allIds)

      rows.forEach((r) => {
        r.supplier_address = r.supplier_address_id ? map.get(r.supplier_address_id) ?? null : null
        r.recipients = (r.recipient_address_ids ?? [])
          .map((id) => map.get(id))
          .filter(Boolean) as any
      })

      // items 정렬
      rows.forEach((r) => {
        if (Array.isArray(r.items)) {
          r.items.sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
        }
      })

      return { success: true, data: rows }
    } catch (error) {
      logger.error('인수증 목록 조회 실패', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      }
    }
  }

  // ===== 단건 조회 =====

  async get(id: string): Promise<{ success: boolean; data?: DeliveryOrder; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('delivery_orders')
        .select(
          `*,
          supplier_employee:employees!delivery_orders_supplier_employee_id_fkey(id, name, phone, email),
          items:delivery_order_items(*)`
        )
        .eq('id', id)
        .single()

      if (error) throw error

      const row = data as DeliveryOrder
      const ids = Array.from(new Set([
        ...(row.recipient_address_ids ?? []),
        ...(row.supplier_address_id ? [row.supplier_address_id] : []),
      ]))
      const map = await this.hydrateContacts(ids)
      row.supplier_address = row.supplier_address_id ? map.get(row.supplier_address_id) ?? null : null
      row.recipients = (row.recipient_address_ids ?? [])
        .map((rid) => map.get(rid))
        .filter(Boolean) as any
      if (Array.isArray(row.items)) {
        row.items.sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
      }
      return { success: true, data: row }
    } catch (error) {
      logger.error('인수증 조회 실패', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      }
    }
  }

  // ===== 생성 =====

  async create(
    formData: DeliveryOrderFormData,
    createdBy?: string
  ): Promise<{ success: boolean; data?: DeliveryOrder; error?: string }> {
    try {
      const issuedDate = this.kstToday()
      const seq = await this.nextSequence(issuedDate)
      const documentNumber = this.formatDocNumber(issuedDate, seq)

      const totalSupply = formData.items.reduce(
        (s, it) => s + (Number(it.supply_amount) || 0),
        0
      )
      const totalTax = formData.items.reduce(
        (s, it) => s + (Number(it.tax_amount) || 0),
        0
      )
      const totalAmount = totalSupply + totalTax

      const { data: order, error } = await this.supabase
        .from('delivery_orders')
        .insert({
          document_number: documentNumber,
          issued_date: issuedDate,
          sequence: seq,
          supplier_employee_id: formData.supplier_employee_id ?? null,
          supplier_address_id: formData.supplier_address_id ?? null,
          recipient_address_ids: formData.recipient_address_ids,
          shipping_date: formData.shipping_date || null,
          receiving_date: formData.receiving_date || null,
          receiver_name: formData.receiver_name || null,
          note: formData.note || null,
          total_supply_amount: totalSupply,
          total_tax_amount: totalTax,
          total_amount: totalAmount,
          created_by: createdBy || null,
        })
        .select()
        .single()

      if (error) throw error

      if (formData.items.length > 0) {
        const rows = formData.items.map((it, idx) => ({
          delivery_order_id: order.id,
          line_number: it.line_number ?? idx + 1,
          item_name: it.item_name,
          specification: it.specification ?? null,
          quantity: it.quantity ?? null,
          unit: it.unit ?? null,
          unit_price: it.unit_price ?? null,
          supply_amount: Number(it.supply_amount) || 0,
          tax_amount: Number(it.tax_amount) || 0,
          remark: it.remark ?? null,
        }))
        const { error: itemErr } = await this.supabase
          .from('delivery_order_items')
          .insert(rows)
        if (itemErr) throw itemErr
      }

      return this.get(order.id)
    } catch (error) {
      logger.error('인수증 생성 실패', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      }
    }
  }

  // ===== 삭제 =====

  async remove(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('delivery_orders')
        .delete()
        .eq('id', id)
      if (error) throw error
      return { success: true }
    } catch (error) {
      logger.error('인수증 삭제 실패', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      }
    }
  }
}

export const deliveryOrderService = new DeliveryOrderService()
