import { createClient } from "@/lib/supabase/client"
import { ShippingAddress, ShippingAddressFormData, ShippingLabel, ShippingLabelFormData } from "@/types/shipping"
import { logger } from "@/lib/logger"

/**
 * 택배 서비스 (3-테이블 구조: shipping_companies / shipping_company_addresses / shipping_contacts)
 *
 * UI 호환을 위해 기존 ShippingAddress shape({ company_name, contact_name, address, ... })
 * 을 유지한 채로 내부에서 3테이블 JOIN/분산 저장을 수행합니다.
 */
class ShippingService {
  private supabase

  constructor() {
    this.supabase = createClient()
  }

  /** shipping_contacts + companies + addresses 를 JOIN 해서 ShippingAddress shape 으로 반환 */
  private async fetchJoinedContacts(filter?: { id?: string; company_id?: string }): Promise<ShippingAddress[]> {
    let query = this.supabase
      .from('shipping_contacts')
      .select(`
        id, name, title, memo, phone, mobile, email, is_favorite,
        created_at, updated_at, created_by,
        company:shipping_companies!company_id(id, name),
        address:shipping_company_addresses!address_id(id, address)
      `)
      .order('created_at', { ascending: false })

    if (filter?.id) query = query.eq('id', filter.id)
    if (filter?.company_id) query = query.eq('company_id', filter.company_id)

    const { data, error } = await query
    if (error) throw error

    return (data ?? []).map((r: any) => {
      const legacy = [r.name, r.title].filter(Boolean).join(' ').trim()
      return {
        id: r.id,
        company_name: r.company?.name ?? '',
        contact_name: legacy || r.name,
        contact_name_only: r.name,
        contact_title: r.title,
        contact_memo: r.memo,
        phone: r.phone,
        mobile: r.mobile,
        email: r.email,
        address: r.address?.address ?? '',
        is_favorite: r.is_favorite,
        created_at: r.created_at,
        updated_at: r.updated_at,
        created_by: r.created_by,
      } as ShippingAddress
    })
  }

  // ===== 주소록 조회 =====

  async getAddresses(): Promise<{ success: boolean; data?: ShippingAddress[]; error?: string }> {
    try {
      const data = await this.fetchJoinedContacts()
      // 회사명 기준 정렬 (기존 동작 유지)
      data.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''))
      return { success: true, data }
    } catch (error) {
      logger.error('주소록 조회 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  // ===== 회사/주소 upsert 헬퍼 =====

  private async ensureCompany(name: string, memo?: string, createdBy?: string): Promise<string> {
    const { data: existing } = await this.supabase
      .from('shipping_companies')
      .select('id')
      .eq('name', name)
      .maybeSingle()
    if (existing?.id) return existing.id

    const { data, error } = await this.supabase
      .from('shipping_companies')
      .insert({ name, memo: memo || null, created_by: createdBy || null })
      .select('id')
      .single()
    if (error) throw error
    return data!.id
  }

  private async ensureCompanyAddress(companyId: string, address: string): Promise<string | null> {
    const addr = (address ?? '').trim()
    if (!addr) return null

    const { data: existing } = await this.supabase
      .from('shipping_company_addresses')
      .select('id')
      .eq('company_id', companyId)
      .eq('address', addr)
      .maybeSingle()
    if (existing?.id) return existing.id

    const { data, error } = await this.supabase
      .from('shipping_company_addresses')
      .insert({ company_id: companyId, address: addr })
      .select('id')
      .single()
    if (error) throw error
    return data!.id
  }

  // ===== 주소록 등록/수정 =====

  async createAddress(formData: ShippingAddressFormData, createdBy?: string): Promise<{ success: boolean; data?: ShippingAddress; error?: string }> {
    try {
      const companyName = (formData.company_name ?? '').trim()
      const contactName = (formData.contact_name_only ?? '').trim()
      if (!companyName || !contactName) {
        return { success: false, error: '상호와 담당자 이름은 필수입니다' }
      }

      const companyId = await this.ensureCompany(companyName, undefined, createdBy)
      const addressId = await this.ensureCompanyAddress(companyId, formData.address ?? '')

      const { data, error } = await this.supabase
        .from('shipping_contacts')
        .insert({
          company_id: companyId,
          address_id: addressId,
          name: contactName,
          title: formData.contact_title || null,
          memo: formData.contact_memo || null,
          phone: formData.phone || null,
          mobile: formData.mobile || null,
          email: formData.email || null,
          created_by: createdBy || null,
        })
        .select('id')
        .single()
      if (error) throw error

      const [row] = await this.fetchJoinedContacts({ id: data!.id })
      return { success: true, data: row }
    } catch (error) {
      logger.error('주소록 등록 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  async updateAddress(id: string, formData: ShippingAddressFormData): Promise<{ success: boolean; data?: ShippingAddress; error?: string }> {
    try {
      const companyName = (formData.company_name ?? '').trim()
      const contactName = (formData.contact_name_only ?? '').trim()
      if (!companyName || !contactName) {
        return { success: false, error: '상호와 담당자 이름은 필수입니다' }
      }

      const companyId = await this.ensureCompany(companyName)
      const addressId = formData.address !== undefined
        ? await this.ensureCompanyAddress(companyId, formData.address)
        : undefined

      const patch: Record<string, unknown> = {
        company_id: companyId,
        name: contactName,
        title: formData.contact_title || null,
        memo: formData.contact_memo || null,
        phone: formData.phone || null,
        mobile: formData.mobile || null,
        email: formData.email || null,
        updated_at: new Date().toISOString(),
      }
      if (addressId !== undefined) patch.address_id = addressId

      const { error } = await this.supabase
        .from('shipping_contacts')
        .update(patch)
        .eq('id', id)
      if (error) throw error

      const [row] = await this.fetchJoinedContacts({ id })
      return { success: true, data: row }
    } catch (error) {
      logger.error('주소록 수정 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  /**
   * 스마트 upsert (발행+인쇄 시 사용)
   *
   * 매칭 키: (회사명 + 담당자이름 + 주소)
   * - 완전 일치 contact 있음 → 직함/전화/메일/비고만 UPDATE
   * - (회사+담당자) 같은데 주소 다름 → 신규 contact INSERT (새 address 포함)
   * - 담당자 같은데 회사 다름 → 신규 contact INSERT (다른 회사)
   */
  async upsertAddressByCompanyAndContact(
    formData: ShippingAddressFormData,
    createdBy?: string
  ): Promise<{ success: boolean; data?: ShippingAddress; mode: 'created' | 'updated'; error?: string }> {
    try {
      const companyName = (formData.company_name ?? '').trim()
      const contactName = (formData.contact_name_only ?? '').trim()
      const address = (formData.address ?? '').trim()
      if (!companyName || !contactName) {
        return { success: false, mode: 'created', error: '상호와 담당자는 필수입니다' }
      }

      const companyId = await this.ensureCompany(companyName, undefined, createdBy)
      const addressId = await this.ensureCompanyAddress(companyId, address)

      // (company + contact name + address) 완전 일치 contact 검색
      let existingQuery = this.supabase
        .from('shipping_contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('name', contactName)
      if (addressId) existingQuery = existingQuery.eq('address_id', addressId)
      else existingQuery = existingQuery.is('address_id', null)

      const { data: existing } = await existingQuery.maybeSingle()

      if (existing?.id) {
        const { error } = await this.supabase
          .from('shipping_contacts')
          .update({
            title: formData.contact_title || null,
            memo: formData.contact_memo || null,
            phone: formData.phone || null,
            mobile: formData.mobile || null,
            email: formData.email || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        if (error) throw error
        const [row] = await this.fetchJoinedContacts({ id: existing.id })
        return { success: true, data: row, mode: 'updated' }
      }

      // 신규 INSERT
      const { data, error } = await this.supabase
        .from('shipping_contacts')
        .insert({
          company_id: companyId,
          address_id: addressId,
          name: contactName,
          title: formData.contact_title || null,
          memo: formData.contact_memo || null,
          phone: formData.phone || null,
          mobile: formData.mobile || null,
          email: formData.email || null,
          created_by: createdBy || null,
        })
        .select('id')
        .single()
      if (error) throw error
      const [row] = await this.fetchJoinedContacts({ id: data!.id })
      return { success: true, data: row, mode: 'created' }
    } catch (error) {
      logger.error('주소록 upsert 실패', error)
      return {
        success: false,
        mode: 'created',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      }
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
          receiver_contact:shipping_contacts!shipping_labels_receiver_contact_id_fkey(
            id, name, title, memo, phone, mobile, email, is_favorite, created_at, updated_at, created_by,
            company:shipping_companies!company_id(id, name),
            address:shipping_company_addresses!address_id(id, address)
          ),
          receiver_address:shipping_company_addresses!receiver_address_id(id, address)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      // UI 호환을 위해 receiver_address 를 ShippingAddress shape 으로 변환
      const labels: ShippingLabel[] = (data ?? []).map((l: any) => {
        const c = l.receiver_contact
        const overrideAddr = l.receiver_address?.address
        const contactAddr = c?.address?.address
        const legacy = c ? [c.name, c.title].filter(Boolean).join(' ').trim() : ''
        return {
          ...l,
          receiver_address: c
            ? {
                id: c.id,
                company_name: c.company?.name ?? '',
                contact_name: legacy || c.name,
                contact_name_only: c.name,
                contact_title: c.title,
                contact_memo: c.memo,
                phone: c.phone,
                mobile: c.mobile,
                email: c.email,
                address: overrideAddr ?? contactAddr ?? '',
                is_favorite: c.is_favorite,
                created_at: c.created_at,
                updated_at: c.updated_at,
                created_by: c.created_by,
              }
            : undefined,
        }
      })

      return { success: true, data: labels }
    } catch (error) {
      logger.error('발송 기록 조회 실패', error)
      return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' }
    }
  }

  async createLabel(formData: ShippingLabelFormData, createdBy?: string): Promise<{ success: boolean; data?: ShippingLabel; error?: string }> {
    try {
      // 담당자의 기본 주소를 발송 주소로 기본 지정
      const { data: contact } = await this.supabase
        .from('shipping_contacts')
        .select('address_id')
        .eq('id', formData.receiver_address_id)
        .maybeSingle()

      const { data, error } = await this.supabase
        .from('shipping_labels')
        .insert({
          sender_employee_id: formData.sender_employee_id,
          receiver_contact_id: formData.receiver_address_id, // UI에서는 여전히 contact id를 보냄
          receiver_address_id: contact?.address_id ?? null,
          delivery_type: formData.delivery_type,
          product_name: formData.product_name || null,
          item_value: formData.item_value,
          delivery_point: formData.delivery_point || null,
          notes: formData.notes || null,
          print_count: formData.print_count,
          created_by: createdBy || null,
        })
        .select('id')
        .single()
      if (error) throw error

      // 조회는 getLabels의 포맷을 재사용
      const all = await this.getLabels()
      const created = all.data?.find((l: any) => l.id === data!.id)
      return { success: true, data: created }
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

  async getEmployees(): Promise<{ success: boolean; data?: { id: string; name: string | null; phone: string | null; email: string | null }[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, name, phone, email')
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
