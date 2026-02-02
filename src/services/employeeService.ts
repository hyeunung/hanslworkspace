import { createClient } from "@/lib/supabase/client";
import { Employee, EmployeeFilters, EmployeeUpsertData, PurchaseRole } from "@/types/purchase";
import { logger } from "@/lib/logger";

class EmployeeService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  // 직원 목록 조회
  async getEmployees(filters?: EmployeeFilters): Promise<{ success: boolean; data?: Employee[]; error?: string }> {
    try {
      let query = this.supabase
        .from('employees')
        .select('*')
        .order('name');

      // 검색 필터 적용
      if (filters?.search) {
        query = query.or(`
          name.ilike.%${filters.search}%,
          email.ilike.%${filters.search}%,
          phone.ilike.%${filters.search}%,
          position.ilike.%${filters.search}%,
          department.ilike.%${filters.search}%
        `);
      }

      // 부서 필터 적용
      if (filters?.department) {
        query = query.eq('department', filters.department);
      }

      // 직급 필터 적용
      if (filters?.position) {
        query = query.eq('position', filters.position);
      }

      // 권한 필터 적용
      if (filters?.purchase_role === 'none') {
        query = query.is('purchase_role', null);
      } else if (filters?.purchase_role) {
        query = query.contains('purchase_role', [filters.purchase_role]);
      }

      // 활성 상태 필터 적용
      if (filters?.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { success: true, data: data || [] };
    } catch (error) {
      logger.error('직원 목록 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 상세 조회
  async getEmployee(id: string): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 생성
  async createEmployee(employeeData: EmployeeUpsertData): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      // 이메일 중복 체크
      const { data: existingEmployee } = await this.supabase
        .from('employees')
        .select('id')
        .eq('email', employeeData.email)
        .single();

      if (existingEmployee) {
        return { success: false, error: '이미 등록된 이메일입니다.' };
      }

      // ID 생성 (UUID 형태)
      const employeeId = crypto.randomUUID();
      const isActive = employeeData.is_active ?? true

      const { data, error } = await this.supabase
        .from('employees')
        .insert({
          id: employeeId,
          ...employeeData,
          purchase_role: employeeData.purchase_role && employeeData.purchase_role.length > 0 ? employeeData.purchase_role : null,
          is_active: isActive,
          terminated_at: isActive ? null : new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 생성 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 수정
  async updateEmployee(id: string, employeeData: Partial<EmployeeUpsertData>): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      // 이메일 중복 체크 (자신 제외)
      if (employeeData.email) {
        const { data: existingEmployee } = await this.supabase
          .from('employees')
          .select('id')
          .eq('email', employeeData.email)
          .neq('id', id)
          .single();

        if (existingEmployee) {
          return { success: false, error: '이미 등록된 이메일입니다.' };
        }
      }

      const updateData: Record<string, any> = {
        ...employeeData
      };

      if (employeeData.purchase_role === undefined) {
        delete updateData.purchase_role;
      } else {
        updateData.purchase_role = employeeData.purchase_role.length > 0 ? employeeData.purchase_role : null;
      }

      // is_active를 직접 업데이트하는 경우 terminated_at도 일관되게 처리
      if (employeeData.is_active !== undefined && employeeData.is_active !== null) {
        updateData.terminated_at = employeeData.is_active ? null : new Date().toISOString()
      }
      
      const { data, error } = await this.supabase
        .from('employees')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 수정 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 삭제 (소프트 삭제)
  async deleteEmployee(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 발주 요청과 연결된 직원인지 확인
      const { data: purchaseRequests } = await this.supabase
        .from('purchase_requests')
        .select('id')
        .eq('requester_id', id)
        .limit(1);

      if (purchaseRequests && purchaseRequests.length > 0) {
        // 발주 요청과 연결된 직원은 비활성화만 가능
        const { error } = await this.supabase
          .from('employees')
          .update({ 
            is_active: false,
            terminated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (error) throw error;

        return { success: true };
      } else {
        // 연결된 데이터가 없으면 완전 삭제
        const { error } = await this.supabase
          .from('employees')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return { success: true };
      }
    } catch (error) {
      logger.error('직원 삭제 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직원 활성화/비활성화 토글
  async toggleEmployeeStatus(id: string): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      // 현재 상태 조회
      const { data: currentEmployee, error: selectError } = await this.supabase
        .from('employees')
        .select('is_active')
        .eq('id', id)
        .single();

      if (selectError) throw selectError;

      // 상태 토글
      const nextIsActive = !currentEmployee.is_active
      const { data, error } = await this.supabase
        .from('employees')
        .update({ 
          is_active: nextIsActive,
          terminated_at: nextIsActive ? null : new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 상태 변경 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }



  // 권한 변경
  async updateEmployeeRole(id: string, role: PurchaseRole | null): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .update({ purchase_role: role ? [role] : null })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 권한 변경 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 부서 목록 조회
  async getDepartments(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('department');

      if (error) throw error;

      // 클라이언트 사이드에서 null과 빈 문자열 필터링 후 중복 제거하고 정렬
      const departments = [...new Set((data || [])
        .map((emp: any) => emp.department)
        .filter((dept: any) => dept != null && dept !== '')
      )].sort() as string[];

      return { success: true, data: departments };
    } catch (error) {
      logger.error('부서 목록 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 직급 목록 조회
  async getPositions(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('position');

      if (error) throw error;

      // 클라이언트 사이드에서 null과 빈 문자열 필터링 후 중복 제거하고 정렬
      const positions = [...new Set((data || [])
        .map((emp: any) => emp.position)
        .filter((pos: any) => pos != null && pos !== '')
      )].sort() as string[];

      return { success: true, data: positions };
    } catch (error) {
      logger.error('직급 목록 조회 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // Excel 내보내기용 데이터 준비
  async getEmployeesForExport(): Promise<{ success: boolean; data?: Array<Record<string, string>>; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .order('name');

      if (error) throw error;

      // Excel 형식에 맞게 데이터 변환
      const exportData = (data || []).map((employee: any) => ({
        '이름': employee.name,
        '이메일': employee.email || '',
        '전화번호': employee.phone || '',
        '주소': employee.adress || '',
        '부서': employee.department || '',
        '직급': employee.position || '',
        '권한': this.getRoleDisplayName(employee.purchase_role),
        '상태': employee.is_active ? '활성' : '비활성',
        '등록일': employee.created_at ? new Date(employee.created_at).toLocaleDateString('ko-KR') : ''
      }));

      return { success: true, data: exportData };
    } catch (error) {
      logger.error('직원 Excel 내보내기 실패', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }

  // 권한명 표시용 변환
  private getRoleDisplayName(role?: string | string[] | null): string {
    const roleNames: Record<string, string> = {
      'app_admin': '앱 관리자',
      'hr': 'HR',
      'accounting': '회계',
      'ceo': 'CEO',
      'final_approver': '최종 승인자',
      'middle_manager': '중간 관리자',
      'lead buyer': '수석 구매자',
      'buyer': '구매자'
    };
    
    const roles = this.normalizeRoles(role)
    if (roles.length === 0) {
      return '권한 없음'
    }

    return roles.map((value) => roleNames[value] || value).join(', ')
  }

  private normalizeRoles(role?: string | string[] | null): string[] {
    if (!role) return []

    if (Array.isArray(role)) {
      return role.filter((value) => value && value.trim())
    }

    if (typeof role === 'string') {
      return role.split(',').map((value) => value.trim()).filter(Boolean)
    }

    return []
  }

  // 권한 체크 함수
  async checkPermission(userId: string, requiredRoles: string[]): Promise<{ success: boolean; hasPermission?: boolean; error?: string }> {
    try {
      const { data: employee } = await this.supabase
        .from('employees')
        .select('purchase_role, is_active')
        .eq('id', userId)
        .single();

      if (!employee || !employee.is_active) {
        return { success: true, hasPermission: false };
      }

      const roles = this.normalizeRoles(employee.purchase_role)
      const hasPermission = roles.some((role) => requiredRoles.includes(role));
      return { success: true, hasPermission };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' 
      };
    }
  }
}

export const employeeService = new EmployeeService();