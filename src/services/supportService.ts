import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export interface SupportInquiry {
  id?: number
  created_at?: string
  updated_at?: string
  user_id?: string
  user_email?: string
  user_name?: string
  inquiry_type: 'bug' | 'modify' | 'delete' | 'other' | 'annual_leave' | 'attendance'
  subject: string
  message: string
  status?: 'open' | 'in_progress' | 'resolved' | 'closed'
  handled_by?: string
  resolution_note?: string
  purchase_request_id?: number | null
  purchase_info?: string
  purchase_order_number?: string
  processed_at?: string
  requester_id?: string
  purchase_requests?: any
}

export interface CreateSupportInquiryPayload {
  inquiry_type: 'bug' | 'modify' | 'delete' | 'other' | 'annual_leave' | 'attendance'
  subject: string
  message: string
  purchase_request_id?: number
  purchase_info?: string
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
          purchase_request_id: payload.purchase_request_id ?? null,
          purchase_info: payload.purchase_info,
          purchase_order_number: payload.purchase_order_number,
          status: 'open'
        })

      if (error) {
        logger.error('문의 등록 에러', error, {
          code: error.code,
          details: error.details,
          hint: error.hint
        })
        return { success: false, error: error.message }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '문의 접수 실패' }
    }
  }

  // 내 문의 목록 조회
  async getMyInquiries(): Promise<{ success: boolean; data: SupportInquiry[]; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) {
        return { success: false, data: [], error: '로그인이 필요합니다.' }
      }


      const { data, error } = await this.supabase
        .from('support_inquires')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })


      if (error) {
        throw error
      }

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
        .select('*')
        .order('created_at', { ascending: false })


      if (error) {
        throw error
      }

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
        .select('id,purchase_order_number,vendor_name,request_date,created_at,requester_name,middle_manager_status,final_manager_status,purchase_request_items(item_name,specification,quantity)')
        .eq('requester_name', employee.name)
        // 승인대기 항목은 request_date가 비어있는 경우가 있어 created_at 기준으로 정렬/필터링
        .order('created_at', { ascending: false })

      // 날짜 필터 적용
      if (startDate) {
        query = query.gte('created_at', `${startDate}T00:00:00`)
      }
      if (endDate) {
        query = query.lte('created_at', `${endDate}T23:59:59.999`)
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
      const { data: deletedItems, error: itemsError } = await this.supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', requestId)
        .select()

      if (itemsError) {
        console.error('[deletePurchaseRequest] 품목 삭제 실패', {
          requestId,
          error: itemsError
        })
        throw itemsError
      }

      console.log('[deletePurchaseRequest] 품목 삭제 성공', {
        requestId,
        deletedItemsCount: deletedItems?.length || 0
      })

      // 발주요청 삭제
      const { data: deletedRequest, error: requestError } = await this.supabase
        .from('purchase_requests')
        .delete()
        .eq('id', requestId)
        .select()

      if (requestError) {
        console.error('[deletePurchaseRequest] 발주요청 삭제 실패', {
          requestId,
          error: requestError,
          note: '품목은 이미 삭제되었지만 발주요청은 삭제되지 않았습니다.'
        })
        throw requestError
      }

      console.log('[deletePurchaseRequest] 발주요청 삭제 성공', {
        requestId,
        deletedRequest: deletedRequest?.[0]
      })

      return { success: true }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : '발주요청 삭제 실패'
      console.error('[deletePurchaseRequest] 전체 삭제 실패', {
        requestId,
        error: errorMessage
      })
      return { success: false, error: errorMessage }
    }
  }

  // 발주요청 상세 조회
  async getPurchaseRequestDetail(requestId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_requests')
        .select('*,purchase_request_items(id,line_number,item_name,specification,quantity,unit_price_value,amount_value,remark,link)')
        .eq('id', requestId)
        .single()

      if (error) throw error

      return { success: true, data }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '발주요청 조회 실패' }
    }
  }

  // 문의 삭제
  async deleteInquiry(inquiryId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser()
      if (authError || !user) return { success: false, error: '로그인이 필요합니다.' }

      // 관리자 권한 확인
      const { data: employee } = await this.supabase
        .from('employees')
        .select('purchase_role')
        .eq('email', user.email)
        .single()

      const isAdmin = employee?.purchase_role?.includes('app_admin')

      // 관리자가 아닌 경우에만 본인 문의 확인
      if (!isAdmin) {
        // 문의 정보 확인 (본인 것인지)
        const { data: inquiry, error: fetchError } = await this.supabase
          .from('support_inquires')
          .select('user_id, status, resolution_note')
          .eq('id', inquiryId)
          .single()

        if (fetchError || !inquiry) {
          return { success: false, error: '문의를 찾을 수 없습니다.' }
        }

        // 본인 문의가 아니면 삭제 불가
        if (inquiry.user_id !== user.id) {
          return { success: false, error: '본인의 문의만 삭제할 수 있습니다.' }
        }

        // 일반 사용자는 답변이 있거나 처리중인 문의는 삭제 불가
        if (inquiry.resolution_note) {
          return { success: false, error: '답변이 완료된 문의는 삭제할 수 없습니다.' }
        }

        if (inquiry.status !== 'open') {
          return { success: false, error: '처리가 진행된 문의는 삭제할 수 없습니다.' }
        }
      }
      // 관리자는 모든 문의 삭제 가능 (제한 없음)

      // 삭제 실행
      const { error } = await this.supabase
        .from('support_inquires')
        .delete()
        .eq('id', inquiryId)

      if (error) throw error
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '문의 삭제 실패' }
    }
  }
}

export const supportService = new SupportService()