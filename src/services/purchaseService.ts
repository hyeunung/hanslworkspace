import { createClient } from "@/lib/supabase/client";
import { 
  PurchaseRequest, 
  PurchaseRequestItem, 
  PurchaseRequestWithDetails, 
  Vendor, 
  VendorContact,
  Employee,
  FormValues,
  PurchaseFilters 
} from "@/types/purchase";

class PurchaseService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  // 발주요청서 생성
  async createPurchaseRequest(data: FormValues): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // 발주 번호 생성
      const purchaseOrderNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      // 총 금액 계산
      const totalAmount = data.items.reduce((sum, item) => sum + item.amount_value, 0);

      const purchaseRequest: Omit<PurchaseRequest, 'id' | 'created_at' | 'updated_at'> = {
        purchase_order_number: purchaseOrderNumber,
        requester_name: data.requester_name,
        vendor_id: data.vendor_id,
        contact_id: data.contact_id,
        sales_order_number: data.sales_order_number,
        project_vendor: data.project_vendor,
        project_item: data.project_item,
        request_date: data.request_date,
        delivery_request_date: data.delivery_request_date,
        request_type: data.request_type,
        progress_type: data.progress_type,
        is_payment_completed: false,
        payment_category: data.payment_category,
        currency: data.currency as 'KRW' | 'USD',
        total_amount: totalAmount,
        unit_price_currency: data.currency as 'KRW' | 'USD',
        po_template_type: data.po_template_type,
        middle_manager_status: 'pending',
        final_manager_status: 'pending',
        is_po_generated: false,
        is_received: false
      };

      // 발주요청서 저장
      const { data: createdRequest, error: requestError } = await this.supabase
        .from('purchase_requests')
        .insert(purchaseRequest)
        .select()
        .single();

      if (requestError) throw requestError;

      // 품목들 저장
      const items: Omit<PurchaseRequestItem, 'id' | 'created_at' | 'updated_at'>[] = data.items.map((item) => ({
        purchase_request_id: createdRequest.id,
        line_number: item.line_number,
        item_name: item.item_name,
        specification: item.specification,
        quantity: item.quantity,
        unit: 'EA',
        unit_price: item.unit_price_value,
        unit_price_value: item.unit_price_value,
        unit_price_currency: item.unit_price_currency,
        amount: item.amount_value,
        amount_value: item.amount_value,
        amount_currency: item.amount_currency,
        remark: item.remark,
        link: item.link || undefined,
        is_received: false
      }));

      const { error: itemsError } = await this.supabase
        .from('purchase_request_items')
        .insert(items);

      if (itemsError) throw itemsError;

      return { success: true, data: createdRequest };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 발주 목록 조회
  async getPurchaseRequests(filters?: PurchaseFilters): Promise<{ success: boolean; data?: PurchaseRequestWithDetails[]; error?: string }> {
    try {
      let query = this.supabase
        .from('purchase_requests')
        .select('*,vendor:vendors(id,vendor_name),vendor_contacts:vendor_contacts(*),items:purchase_request_items(*).order(line_number)')
        .order('created_at', { ascending: false });

      // 필터 적용
      if (filters?.search) {
        query = query.or(`
          purchase_order_number.ilike.%${filters.search}%,
          requester_name.ilike.%${filters.search}%,
          project_vendor.ilike.%${filters.search}%,
          project_item.ilike.%${filters.search}%
        `);
      }

      if (filters?.dateFrom) {
        query = query.gte('request_date', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('request_date', filters.dateTo);
      }

      if (filters?.vendorId) {
        query = query.eq('vendor_id', filters.vendorId);
      }

      if (filters?.requestType) {
        query = query.eq('request_type', filters.requestType);
      }

      if (filters?.paymentCategory) {
        query = query.eq('payment_category', filters.paymentCategory);
      }

      const { data, error } = await query;

      if (error) throw error;

      const purchasesWithDetails = (Array.isArray(data) ? data : []).map(purchase => ({
        ...purchase,
        items: purchase.purchase_request_items || [],
        vendor: purchase.vendor || { id: 0, vendor_name: '알 수 없음' },
        vendor_contacts: purchase.vendor_contacts || []
      })) as PurchaseRequestWithDetails[];

      return { success: true, data: purchasesWithDetails };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 특정 발주 조회
  async getPurchaseRequest(id: number): Promise<{ success: boolean; data?: PurchaseRequestWithDetails; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_requests')
        .select('*,vendor:vendors(id,vendor_name),vendor_contacts:vendor_contacts(*),items:purchase_request_items(*).order(line_number)')
        .eq('id', id)
        .single();

      if (error) throw error;

      const purchaseWithDetails = {
        ...(data || {}),
        items: (data && 'items' in data) ? data.items || [] : [],
        vendor: (data && 'vendor' in data) ? data.vendor || { id: 0, vendor_name: '알 수 없음' } : { id: 0, vendor_name: '알 수 없음' },
        vendor_contacts: (data && 'vendor_contacts' in data) ? data.vendor_contacts || [] : []
      } as PurchaseRequestWithDetails;

      return { success: true, data: purchaseWithDetails };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 발주요청서 수정
  async updatePurchaseRequest(id: number, data: Partial<PurchaseRequest>): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('purchase_requests')
        .update(data)
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 발주요청서 삭제
  async deletePurchaseRequest(id: number): Promise<{ success: boolean; error?: string }> {
    try {
      // 품목들 먼저 삭제
      const { error: itemsError } = await this.supabase
        .from('purchase_request_items')
        .delete()
        .eq('purchase_request_id', id);

      if (itemsError) throw itemsError;

      // 발주요청서 삭제
      const { error: requestError } = await this.supabase
        .from('purchase_requests')
        .delete()
        .eq('id', id);

      if (requestError) throw requestError;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 목록 조회
  async getVendors(): Promise<{ success: boolean; data?: Vendor[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('vendors')
        .select('*')
        .order('vendor_name');

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 연락처 조회
  async getVendorContacts(vendorId: number): Promise<{ success: boolean; data?: VendorContact[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('vendor_contacts')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('contact_name');

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 목록 조회
  async getEmployees(): Promise<{ success: boolean; data?: Employee[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .order('name');

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 승인 상태 업데이트
  async updateApprovalStatus(
    id: number, 
    level: 'middle' | 'final', 
    status: 'approved' | 'rejected'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData = level === 'middle' 
        ? { middle_manager_status: status }
        : { final_manager_status: status };

      const { error } = await this.supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 입고 처리
  async markAsReceived(id: number): Promise<{ success: boolean; error?: string }> {
    try {
      const currentTime = new Date().toISOString();
      
      // 🔧 헤더와 품목 모두 업데이트 (동기화 보장)
      const [headerResult, itemsResult] = await Promise.all([
        this.supabase
          .from('purchase_requests')
          .update({ 
            is_received: true,
            received_at: currentTime
          })
          .eq('id', id),
        this.supabase
          .from('purchase_request_items')
          .update({ 
            is_received: true,
            received_at: currentTime,
            delivery_status: 'received'
          })
          .eq('purchase_request_id', id)
      ]);

      if (headerResult.error) throw headerResult.error;
      if (itemsResult.error) throw itemsResult.error;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }
}

export const purchaseService = new PurchaseService();