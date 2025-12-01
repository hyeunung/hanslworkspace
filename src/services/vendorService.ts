import { createClient } from "@/lib/supabase/client";
import { Vendor, VendorFormData, VendorFilters, VendorContact } from "@/types/purchase";
import { logger } from "@/lib/logger";

class VendorService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  // 업체 목록 조회
  async getVendors(filters?: VendorFilters): Promise<{ success: boolean; data?: Vendor[]; error?: string }> {
    try {
      let query = this.supabase
        .from('vendors')
        .select('*,vendor_contacts(*)')
        .order('vendor_name');

      // 검색 필터 적용
      if (filters?.search) {
        query = query.or(`
          vendor_name.ilike.%${filters.search}%,
          vendor_phone.ilike.%${filters.search}%,
          vendor_fax.ilike.%${filters.search}%,
          vendor_address.ilike.%${filters.search}%
        `);
      }

      // 활성 상태 필터는 제거 (DB에 is_active 컄럼 없음)

      const { data, error } = await query;

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      logger.error('업체 목록 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 상세 조회
  async getVendor(id: number): Promise<{ success: boolean; data?: Vendor; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('vendors')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('업체 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 생성
  async createVendor(vendorData: VendorFormData): Promise<{ success: boolean; data?: Vendor; error?: string }> {
    try {
      // 사업자번호 중복 체크 제거 (DB에 해당 컄럼 없음)

      // 업체명 중복 체크
      const { data: existingVendorByName } = await this.supabase
        .from('vendors')
        .select('id')
        .eq('vendor_name', vendorData.vendor_name)
        .single();

      if (existingVendorByName) {
        return { success: false, error: '이미 등록된 업체명입니다.' };
      }

      const { data, error } = await this.supabase
        .from('vendors')
        .insert(vendorData)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('업체 생성 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 수정
  async updateVendor(id: number, vendorData: Partial<VendorFormData>): Promise<{ success: boolean; data?: Vendor; error?: string }> {
    try {
      // 사업자번호 중복 체크 제거 (DB에 해당 컄럼 없음)

      // 업체명 중복 체크 (자신 제외)
      if (vendorData.vendor_name) {
        const { data: existingVendorByName } = await this.supabase
          .from('vendors')
          .select('id')
          .eq('vendor_name', vendorData.vendor_name)
          .neq('id', id)
          .single();

        if (existingVendorByName) {
          return { success: false, error: '이미 등록된 업체명입니다.' };
        }
      }

      const { data, error } = await this.supabase
        .from('vendors')
        .update(vendorData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('업체 수정 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 삭제
  async deleteVendor(id: number): Promise<{ success: boolean; error?: string }> {
    try {
      // 발주 요청과 연결된 업체인지 확인
      const { data: purchaseRequests } = await this.supabase
        .from('purchase_requests')
        .select('id')
        .eq('vendor_id', id)
        .limit(1);

      if (purchaseRequests && purchaseRequests.length > 0) {
        // 발주 요청과 연결된 업체는 삭제 불가
        return { 
          success: false, 
          error: '발주 요청과 연결된 업체는 삭제할 수 없습니다.' 
        };
      } else {
        // 연결된 데이터가 없으면 완전 삭제
        const { error } = await this.supabase
          .from('vendors')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return { success: true };
      }
    } catch (error) {
      logger.error('업체 삭제 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 업체 활성화/비활성화 토글 - is_active 컄럼이 없어서 제거
  // 필요 시 나중에 DB에 is_active 컄럼 추가 필요

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
      logger.error('업체 연락처 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // Excel 내보내기용 데이터 준비
  async getVendorsForExport(): Promise<{ success: boolean; data?: Array<Record<string, string>>; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('vendors')
        .select('*')
        .order('vendor_name');

      if (error) throw error;

      // Excel 형식에 맞게 데이터 변환
      const exportData = (data || []).map((vendor: any) => ({
        '업체명': vendor.vendor_name,
        '전화번호': vendor.vendor_phone || '',
        '팩스번호': vendor.vendor_fax || '',
        '결제조건': vendor.vendor_payment_schedule || '',
        '주소': vendor.vendor_address || '',
        '비고': vendor.note || '',
        '등록일': vendor.created_at ? new Date(vendor.created_at).toLocaleDateString('ko-KR') : ''
      }));

      return { success: true, data: exportData };
    } catch (error) {
      logger.error('업체 Excel 내보내기 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }
}

export const vendorService = new VendorService();