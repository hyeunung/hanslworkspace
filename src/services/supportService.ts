import { createClient } from '@/lib/supabase/client'

export interface SupportInquiry {
  id?: number
  created_at?: string
  updated_at?: string
  user_id?: string
  user_email?: string
  user_name?: string
  inquiry_type: 'bug' | 'modify' | 'delete' | 'other'
  subject: string
  message: string
  status?: 'open' | 'in_progress' | 'resolved' | 'closed'
  handled_by?: string
  resolution_note?: string
  purchase_request_id?: number  // bigint는 number로 처리
  purchase_order_number?: string
  processed_at?: string
  requester_id?: string
  purchase_requests?: any
}

export interface CreateSupportInquiryPayload {
  inquiry_type: 'bug' | 'modify' | 'delete' | 'other'
  subject: string
  message: string
  purchase_request_id?: string
  purchase_order_number?: string
}

class SupportService {
  private supabase = createClient()

  // 문의 생성
  async createInquiry(payload: CreateSupportInquiryPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) return { success: false, error: '로그인이 필요합니다.' }

      const { data: employee } = await this.supabase
        .from('employees')
        .select('id, name, email')
        .eq('email', user.email)
        .maybeSingle()

      const { error } = await this.supabase
        .from('support_inquires')
        .insert({
          user_id: user.id,
          user_email: employee?.email || user.email,
          user_name: employee?.name || '',
          requester_id: employee?.id,
          inquiry_type: payload.inquiry_type,
          subject: payload.subject,
          message: payload.message,
          purchase_request_id: payload.purchase_request_id,
          purchase_order_number: payload.purchase_order_number,
          status: 'open'
        })

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '문의 접수 실패' }
    }
  }

  // 내 문의 목록 조회
  async getMyInquiries(): Promise<{ success: boolean; data: SupportInquiry[]; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) return { success: false, data: [], error: '로그인이 필요합니다.' }

      const { data, error } = await this.supabase
        .from('support_inquires')
        .select(`
          *,
          purchase_requests (
            purchase_order_number,
            vendor_name,
            requester_name
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (e) {
      return { success: false, data: [], error: e instanceof Error ? e.message : '문의 조회 실패' }
    }
  }

  // 모든 문의 목록 조회 (관리자용)
  async getAllInquiries(): Promise<{ success: boolean; data: SupportInquiry[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('support_inquires')
        .select(`
          *,
          purchase_requests (
            purchase_order_number,
            vendor_name,
            requester_name,
            purchase_request_items (
              item_name,
              specification,
              quantity
            )
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (e) {
      return { success: false, data: [], error: e instanceof Error ? e.message : '문의 조회 실패' }
    }
  }

  // 문의 상태 업데이트 (관리자용)
  async updateInquiryStatus(
    inquiryId: number, 
    status: 'open' | 'in_progress' | 'resolved' | 'closed',
    resolution_note?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) return { success: false, error: '로그인이 필요합니다.' }

      const { data: employee } = await this.supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single()

      const updateData: any = {
        status,
        handled_by: employee?.name || user.email,
        updated_at: new Date().toISOString()
      }

      // resolved나 closed 상태로 변경 시 처리 시간 기록
      if (status === 'resolved' || status === 'closed') {
        updateData.processed_at = new Date().toISOString()
      }

      // resolution_note가 있으면 추가
      if (resolution_note) {
        updateData.resolution_note = resolution_note
      }

      const { error } = await this.supabase
        .from('support_inquires')
        .update(updateData)
        .eq('id', inquiryId)

      if (error) throw error

      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '상태 업데이트 실패' }
    }
  }

  // 내가 요청한 발주 목록 조회 (수정/삭제 요청용)
  async getMyPurchaseRequests(startDate?: string, endDate?: string) {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) return { success: false, data: [], error: '로그인이 필요합니다.' }

      const { data: employee } = await this.supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single()

      if (!employee) {
        return { success: false, data: [], error: '사용자 정보를 찾을 수 없습니다.' }
      }

      let query = this.supabase
        .from('purchase_requests')
        .select(`
          id,
          purchase_order_number,
          vendor_name,
          request_date,
          requester_name,
          purchase_request_items (
            item_name,
            specification,
            quantity
          )
        `)
        .eq('requester_name', employee.name)
        .order('request_date', { ascending: false })

      // 날짜 필터 적용
      if (startDate) {
        query = query.gte('request_date', startDate)
      }
      if (endDate) {
        query = query.lte('request_date', endDate)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (e) {
      return { success: false, data: [], error: e instanceof Error ? e.message : '발주요청 조회 실패' }
    }
  }

  // 실시간 구독 설정
  subscribeToInquiries(callback: (payload: any) => void) {
    return this.supabase
      .channel('support_inquires_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_inquires'
        },
        callback
      )
      .subscribe()
  }

  // 발주요청 품목 수정
  async updatePurchaseRequestItem(
    itemId: string,
    updates: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData: any = {}
      
      if (updates.item_name !== undefined) updateData.item_name = updates.item_name
      if (updates.specification !== undefined) updateData.specification = updates.specification
      if (updates.quantity !== undefined) updateData.quantity = updates.quantity
      if (updates.remark !== undefined) updateData.remark = updates.remark
      if (updates.unit_price_value !== undefined) {
        updateData.unit_price_value = updates.unit_price_value
        updateData.unit_price_currency = 'KRW'
      }
      if (updates.amount_value !== undefined) {
        updateData.amount_value = updates.amount_value
        updateData.amount_currency = 'KRW'
      }
      
      const { error } = await this.supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', itemId)

      if (error) throw error
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '품목 수정 실패' }
    }
  }

  // 발주요청 품목 삭제
  async deletePurchaseRequestItem(itemId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('purchase_request_items')
        .delete()
        .eq('id', itemId)

      if (error) throw error
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '품목 삭제 실패' }
    }
  }

  // 발주요청 전체 삭제
  async deletePurchaseRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 먼저 관련 품목들 삭제
      const { error: itemsError } = await this.supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', requestId)

      if (itemsError) throw itemsError

      // 발주요청 삭제
      const { error } = await this.supabase
        .from('purchase_requests')
        .delete()
        .eq('id', requestId)

      if (error) throw error
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '발주요청 삭제 실패' }
    }
  }

  // 발주요청 상세 조회
  async getPurchaseRequestDetail(requestId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_requests')
        .select(`
          *,
          purchase_request_items (
            id,
            line_number,
            item_name,
            specification,
            quantity,
            unit_price_value,
            amount_value,
            remark,
            link
          )
        `)
        .eq('id', requestId)
        .single()

      if (error) throw error

      return { success: true, data }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '발주요청 조회 실패' }
    }
  }
}

export const supportService = new SupportService()