import { createClient } from "@/lib/supabase/client";
import { Employee, EmployeeFilters, EmployeeUpsertData, PurchaseRole } from "@/types/purchase";
import { logger } from "@/lib/logger";
import { parseRoles } from '@/utils/roleHelper';

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
        const s = filters.search
        query = query.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,position.ilike.%${s}%,department.ilike.%${s}%,employeeID.ilike.%${s}%,employee_number.ilike.%${s}%,personal_email.ilike.%${s}%,bank_account.ilike.%${s}%,adress.ilike.%${s}%`);
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
      if (filters?.roles === 'none') {
        query = query.is('roles', null);
      } else if (filters?.roles) {
        query = query.contains('roles', [filters.roles]);
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
          roles: employeeData.roles && employeeData.roles.length > 0 ? employeeData.roles : null,
          is_active: isActive,
          terminated_at: isActive ? null : new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      logger.error('직원 생성 실패', error);
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in (error as Record<string, unknown>)
            ? String((error as Record<string, unknown>).message)
            : '알 수 없는 오류가 발생했습니다.'
      return {
        success: false,
        error: msg
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

      const updateData: Record<string, string | string[] | boolean | number | null | undefined> = {
        ...employeeData
      };

      if (employeeData.roles === undefined) {
        delete updateData.roles;
      } else {
        updateData.roles = employeeData.roles && employeeData.roles.length > 0 ? employeeData.roles : null;
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
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in (error as Record<string, unknown>)
            ? String((error as Record<string, unknown>).message)
            : '알 수 없는 오류가 발생했습니다.'
      return {
        success: false,
        error: msg
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

  // 직원 퇴사/복직 처리
  async toggleEmployeeStatus(id: string, terminatedAt?: string): Promise<{ success: boolean; data?: Employee; error?: string }> {
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
          terminated_at: nextIsActive ? null : (terminatedAt || new Date().toISOString())
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
        .update({ roles: role ? [role] : null })
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
        .map((emp: { department: string | null }) => emp.department)
        .filter((dept: string | null): dept is string => dept != null && dept !== '')
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
        .map((emp: { position: string | null }) => emp.position)
        .filter((pos: string | null): pos is string => pos != null && pos !== '')
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
      const exportData = (data || []).map((employee: { name: string; email?: string; phone?: string; adress?: string; department?: string; position?: string; roles?: string | string[] | null; is_active: boolean; created_at?: string }) => ({
        '이름': employee.name,
        '이메일': employee.email || '',
        '전화번호': employee.phone || '',
        '주소': employee.adress || '',
        '부서': employee.department || '',
        '직급': employee.position || '',
        '권한': this.getRoleDisplayName(employee.roles),
        '재직상태': employee.is_active ? '재직' : '퇴사',
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
      'superadmin': '앱 관리자',
      'hr': 'HR',
      'ceo': 'CEO',
      'final_approver': '최종 승인자',
      'middle_manager': '중간 관리자',
      'lead buyer': '수석 구매자',
    };

    const roles = parseRoles(role)
    if (roles.length === 0) {
      return '권한 없음'
    }

    return roles.map((value) => roleNames[value] || value).join(', ')
  }

  // 출퇴근 기록 조회
  async getAttendanceRecords(startDate: string, endDate: string): Promise<{ success: boolean; data?: Array<{
    id: number
    employee_id: string
    employee_name: string | null
    date: string
    clock_in: string | null
    clock_out: string | null
    status: string | null
    remarks: string | null
    note: string | null
    user_email: string | null
    created_at: string | null
    updated_at: string | null
    department: string | null
    position: string | null
  }>; error?: string }> {
    try {
      // 출퇴근 기록, 직원 정보, 승인된 연차/출장을 병렬 조회
      const [attendanceResult, employeesResult, leaveResult, tripResult] = await Promise.all([
        this.supabase
          .from('attendance_records')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false })
          .order('employee_name', { ascending: true }),
        this.supabase
          .from('employees')
          .select('id, department, is_active, email, position'),
        // 승인된 연차/반차/공가 조회 (해당 날짜 범위에 걸치는 것)
        this.supabase
          .from('leave')
          .select('user_email, type, start_date, end_date, status')
          .eq('status', 'approved')
          .lte('start_date', endDate)
          .gte('end_date', startDate),
        // 승인된 출장 조회 (해당 날짜 범위에 걸치는 것)
        this.supabase
          .from('business_trips')
          .select('requester_id, trip_start_date, trip_end_date, approval_status')
          .eq('approval_status', 'approved')
          .lte('trip_start_date', endDate)
          .gte('trip_end_date', startDate),
      ])

      if (attendanceResult.error) throw attendanceResult.error;

      // employee_id → { department, is_active, email, position } 매핑
      const empMap = new Map<string, { department: string | null; is_active: boolean; email: string | null; position: string | null }>()
      if (employeesResult.data) {
        for (const emp of employeesResult.data) {
          empMap.set(emp.id, { department: emp.department, is_active: emp.is_active, email: emp.email, position: emp.position })
        }
      }

      // 연차/반차/공가: user_email → 해당 날짜의 leave type 매핑
      const leaveTypeMap = new Map<string, string>() // key: "email|date" → leave type
      if (leaveResult.data) {
        for (const leave of leaveResult.data) {
          // 날짜 범위 내 각 날짜에 대해 매핑
          const start = new Date(leave.start_date + 'T00:00:00')
          const end = new Date(leave.end_date + 'T00:00:00')
          const queryStart = new Date(startDate + 'T00:00:00')
          const queryEnd = new Date(endDate + 'T00:00:00')
          const from = start > queryStart ? start : queryStart
          const to = end < queryEnd ? end : queryEnd
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0]
            const key = `${leave.user_email}|${dateStr}`
            // leave type → 근태 상태 변환
            const statusMap: Record<string, string> = {
              'annual': '연차',
              'half_am': '오전반차',
              'half_pm': '오후반차',
              'official': '공가',
            }
            leaveTypeMap.set(key, statusMap[leave.type] || leave.type)
          }
        }
      }

      // 출장: requester_id → 해당 날짜 매핑
      const tripSet = new Set<string>() // key: "employee_id|date"
      if (tripResult.data) {
        for (const trip of tripResult.data) {
          if (!trip.requester_id) continue
          const start = new Date(trip.trip_start_date + 'T00:00:00')
          const end = new Date(trip.trip_end_date + 'T00:00:00')
          const queryStart = new Date(startDate + 'T00:00:00')
          const queryEnd = new Date(endDate + 'T00:00:00')
          const from = start > queryStart ? start : queryStart
          const to = end < queryEnd ? end : queryEnd
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0]
            tripSet.add(`${trip.requester_id}|${dateStr}`)
          }
        }
      }

      // 퇴사자(is_active=false) 제외 + 연차/출장 상태 반영
      const attendanceData = attendanceResult.data || []
      const dataWithDept = attendanceData
        .filter((record: { employee_id: string }) => {
          const emp = empMap.get(record.employee_id)
          return !emp || emp.is_active
        })
        .map((record: { employee_id: string; date: string; status: string | null; clock_in: string | null; clock_out: string | null; [key: string]: unknown }) => {
          const emp = empMap.get(record.employee_id)
          let status = record.status
          const position = emp?.position || null

          // 출근 기록이 있는데 상태가 '출근 전'이면 시간 기반 자동 계산
          if (record.clock_in && (!status || status === '출근 전')) {
            const inTime = (record.clock_in as string).slice(0, 5)
            const lateThreshold = position === '아르바이트' ? '09:00' : '08:30'
            if (record.clock_out) {
              status = '퇴근'
            } else {
              status = inTime <= lateThreshold ? '정상 출근' : '지각'
            }
          }

          // 출근 기록 없고 상태 미입력/출근 전인 경우 연차/출장 확인
          if (!record.clock_in && (!status || status === '출근 전')) {
            // 출장 확인 (employee_id 기준)
            if (tripSet.has(`${record.employee_id}|${record.date}`)) {
              status = '출장'
            }
            // 연차/반차/공가 확인 (email 기준)
            if (emp?.email) {
              const leaveStatus = leaveTypeMap.get(`${emp.email}|${record.date}`)
              if (leaveStatus) {
                status = leaveStatus
              }
            }
          }

          return {
            ...record,
            status,
            department: emp?.department || null,
            position,
          }
        })

      return { success: true, data: dataWithDept };
    } catch (error) {
      logger.error('출퇴근 기록 조회 실패', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      };
    }
  }

  // 출퇴근 기록 수정 (시간/상태/비고)
  async updateAttendanceRecord(
    id: number,
    updates: { clock_in?: string | null; clock_out?: string | null; status?: string | null; remarks?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('attendance_records')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error;

      return { success: true };
    } catch (error) {
      logger.error('출퇴근 기록 수정 실패', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      };
    }
  }

  // 권한 체크 함수
  async checkPermission(userId: string, requiredRoles: string[]): Promise<{ success: boolean; hasPermission?: boolean; error?: string }> {
    try {
      const { data: employee } = await this.supabase
        .from('employees')
        .select('roles, is_active')
        .eq('id', userId)
        .single();

      if (!employee || !employee.is_active) {
        return { success: true, hasPermission: false };
      }

      const roles = parseRoles(employee.roles)
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