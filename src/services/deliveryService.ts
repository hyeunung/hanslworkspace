import { createClient } from "@/lib/supabase/client";
import { PurchaseRequestItem } from "@/types/purchase";

export interface DeliveryUpdateData {
  receivedQuantity: number;
  deliveryNotes?: string;
  receivedBy: string;
  receivedByName: string;
}

export interface DeliveryBatchUpdateData {
  itemId: number;
  receivedQuantity: number;
  deliveryNotes?: string;
}

class DeliveryService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  // 단일 품목 입고 처리
  async updateItemDeliveryStatus(
    itemId: number, 
    data: DeliveryUpdateData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData = {
        received_quantity: data.receivedQuantity,
        delivery_notes: data.deliveryNotes,
        received_by: data.receivedBy,
        received_by_name: data.receivedByName,
        received_date: new Date().toISOString()
      };

      const { error } = await this.supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', itemId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 배치 입고 처리 (여러 품목 동시 처리)
  async batchUpdateItemsDeliveryStatus(
    items: DeliveryBatchUpdateData[],
    receivedBy: string,
    receivedByName: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updates = items.map(item => ({
        id: item.itemId,
        received_quantity: item.receivedQuantity,
        delivery_notes: item.deliveryNotes,
        received_by: receivedBy,
        received_by_name: receivedByName,
        received_date: new Date().toISOString()
      }));

      // 트랜잭션으로 처리
      const { error } = await this.supabase
        .from('purchase_request_items')
        .upsert(updates);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 발주의 모든 품목 완전 입고 처리
  async markAllItemsAsReceived(
    purchaseRequestId: number,
    receivedBy: string,
    receivedByName: string,
    deliveryNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 해당 발주의 모든 품목을 조회
      const { data: items, error: fetchError } = await this.supabase
        .from('purchase_request_items')
        .select('id, quantity')
        .eq('purchase_request_id', purchaseRequestId)
        .eq('delivery_status', 'pending');

      if (fetchError) throw fetchError;
      if (!items || items.length === 0) {
        return { success: true }; // 처리할 품목이 없음
      }

      // 모든 품목을 완전 입고로 업데이트
      const updates = items.map(item => ({
        id: item.id,
        received_quantity: item.quantity, // 주문 수량과 동일하게 설정
        delivery_notes: deliveryNotes,
        received_by: receivedBy,
        received_by_name: receivedByName,
        received_date: new Date().toISOString(),
        delivery_status: 'received',
        is_received: true
      }));

      const { error: updateError } = await this.supabase
        .from('purchase_request_items')
        .upsert(updates);

      if (updateError) throw updateError;

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 발주별 입고 현황 조회
  async getDeliveryStatusByPurchaseRequest(
    purchaseRequestId: number
  ): Promise<{ success: boolean; data?: PurchaseRequestItem[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_request_id', purchaseRequestId)
        .order('line_number');

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 입고 대기 품목 조회
  async getPendingDeliveryItems(): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_request_items')
        .select('*,purchase_request:purchase_requests(id,purchase_order_number,requester_name,vendor:vendors(vendor_name),final_manager_status)')
        .in('delivery_status', ['pending', 'partial'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 입고 처리 내역 조회 (최근 처리된 품목들)
  async getRecentDeliveryHistory(limit: number = 50): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('purchase_request_items')
        .select('*,purchase_request:purchase_requests(id,purchase_order_number,requester_name,vendor:vendors(vendor_name))')
        .not('received_date', 'is', null)
        .order('received_date', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 입고 통계 조회
  async getDeliveryStatistics(): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { data, error } = await this.supabase.rpc('get_delivery_statistics');

      if (error) throw error;

      return { success: true, data: data };
    } catch (error) {
      // RPC 함수가 없는 경우 기본 쿼리로 대체
      try {
        const [totalResult, pendingResult, partialResult, completedResult] = await Promise.all([
          this.supabase.from('purchase_request_items').select('id', { count: 'exact' }),
          this.supabase.from('purchase_request_items').select('id', { count: 'exact' }).eq('delivery_status', 'pending'),
          this.supabase.from('purchase_request_items').select('id', { count: 'exact' }).eq('delivery_status', 'partial'),
          this.supabase.from('purchase_request_items').select('id', { count: 'exact' }).eq('delivery_status', 'received')
        ]);

        const statistics = {
          total: totalResult.count || 0,
          pending: pendingResult.count || 0,
          partial: partialResult.count || 0,
          completed: completedResult.count || 0
        };

        return { success: true, data: statistics };
      } catch (fallbackError) {
        return { 
          success: false, 
          error: fallbackError instanceof Error ? fallbackError.message : '알 수 없는 오류가 발생했습니다.' 
        };
      }
    }
  }
}

export const deliveryService = new DeliveryService();