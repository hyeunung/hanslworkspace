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
        .select(`
          *,
          vendor_contacts (*)
        `)
        .order('vendor_name');

      // 검색 필터 적용
      if (filters?.search) {
        query = query.or(`
          vendor_name.ilike.%${filters.search}%,
          business_number.ilike.%${filters.search}%,
          representative.ilike.%${filters.search}%,
          contact_phone.ilike.%${filters.search}%,
          email.ilike.%${filters.search}%
        `);
      }

      // 활성 상태 필터 적용
      if (filters?.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active);
      }

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
      // 사업자번호 중복 체크
      if (vendorData.business_number) {
        const { data: existingVendor } = await this.supabase
          .from('vendors')
          .select('id')
          .eq('business_number', vendorData.business_number)
          .single();

        if (existingVendor) {
          return { success: false, error: '이미 등록된 사업자번호입니다.' };
        }
      }

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
        .insert({
          ...vendorData,
          is_active: true
        })
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
      // 사업자번호 중복 체크 (자신 제외)
      if (vendorData.business_number) {
        const { data: existingVendor } = await this.supabase
          .from('vendors')
          .select('id')
          .eq('business_number', vendorData.business_number)
          .neq('id', id)
          .single();

        if (existingVendor) {
          return { success: false, error: '이미 등록된 사업자번호입니다.' };
        }
      }

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

  // 업체 삭제 (소프트 삭제)
  async deleteVendor(id: number): Promise<{ success: boolean; error?: string }> {
    try {
      // 발주 요청과 연결된 업체인지 확인
      const { data: purchaseRequests } = await this.supabase
        .from('purchase_requests')
        .select('id')
        .eq('vendor_id', id)
        .limit(1);

      if (purchaseRequests && purchaseRequests.length > 0) {
        // 발주 요청과 연결된 업체는 비활성화만 가능
        const { error } = await this.supabase
          .from('vendors')
          .update({ is_active: false })
          .eq('id', id);

        if (error) throw error;

        return { success: true };
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

  // 업체 활성화/비활성화 토글
  async toggleVendorStatus(id: number): Promise<{ success: boolean; data?: Vendor; error?: string }> {
    try {
      // 현재 상태 조회
      const { data: currentVendor, error: selectError } = await this.supabase
        .from('vendors')
        .select('is_active')
        .eq('id', id)
        .single();

      if (selectError) throw selectError;

      // 상태 토글
      const { data, error } = await this.supabase
        .from('vendors')
        .update({ is_active: !currentVendor.is_active })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('업체 상태 변경 실패', error);
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
      const exportData = (data || []).map(vendor => ({
        '업체명': vendor.vendor_name,
        '사업자번호': vendor.business_number || '',
        '대표자': vendor.representative || '',
        '연락처': vendor.contact_phone || '',
        '주소': vendor.address || '',
        '이메일': vendor.email || '',
        '상태': vendor.is_active ? '활성' : '비활성',
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