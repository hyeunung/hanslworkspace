import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export interface Purchase {
  id: number;
  purchase_order_number?: string;
  request_date: string;
  delivery_request_date?: string;
  progress_type: string;
  is_payment_completed: boolean;
  payment_category: string;
  payment_completed_at?: string;
  currency: string;
  request_type: string;
  vendor?: {
    vendor_name: string;
    vendor_payment_schedule?: string;
  };
  vendor_name: string;
  vendor_payment_schedule?: string;
  vendor_id?: number;
  contact_id?: number;
  vendor_contacts?: {
    contact_name: string;
  } | Array<{
    contact_name: string;
  }>;
  contact_name?: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  requester_full_name: string;
  project_vendor: string;
  sales_order_number: string;
  project_item: string;
  middle_manager_status?: string;
  final_manager_status?: string;
  total_amount: number;
  is_received: boolean;
  received_at?: string;

  is_po_download?: boolean;
  items?: any[];
  purchase_request_items?: any[];
  item_name?: string;
  specification?: string;
  quantity?: number;
  unit_price_value?: number;
  amount_value?: number;
  remark?: string;
  line_number?: number;
  link?: string;
  purchase_status?: string;
}

export interface Vendor {
  id: number;
  vendor_name: string;
  vendor_contacts?: any[];
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  full_name?: string;
}

export const usePurchaseData = () => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([]);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  const supabase = createClient();

  // 초기 데이터 로드 (업체 목록, 사용자 권한)
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // 업체 목록, 직원 목록, 사용자 정보를 병렬로 로드
        const [vendorResult, employeeResult, userResult] = await Promise.all([
          supabase.from('vendors').select('*'),
          supabase.from('employees').select('*'),
          supabase.auth.getUser()
        ]);

        if (vendorResult.error) {
          // Vendor fetch error - will throw
          throw vendorResult.error;
        }
        setVendors(vendorResult.data || []);
        
        if (employeeResult.error) {
          // Employee fetch error - will throw
          throw employeeResult.error;
        }
        setEmployees(employeeResult.data || []);

        // 사용자 권한 및 이름 로드
        if (userResult.data.user && !userResult.error) {
          // email로 직원 정보 찾기 (올바른 방법)
          let employeeData = null;
          if (userResult.data.user.email) {
            const emailResult = await supabase
              .from('employees')
              .select('*')
              .eq('email', userResult.data.user.email)
              .maybeSingle();
            
            employeeData = emailResult.data;
          }
          
          if (employeeData) {
            // purchase_role을 쉼표로 분할하고 각 role의 공백을 제거
            let roles: string[] = [];
            
            // purchase_role이 배열인지 문자열인지 확인
            if (employeeData.purchase_role) {
              if (Array.isArray(employeeData.purchase_role)) {
                // 배열인 경우
                roles = employeeData.purchase_role.map((r: any) => String(r).trim());
              } else {
                // 문자열인 경우 (일반적)
                const roleString = String(employeeData.purchase_role);
                // 쉼표로 분할하고 공백 제거
                roles = roleString
                  .split(',')
                  .map((r: string) => r.trim())
                  .filter((r: string) => r.length > 0);
              }
            }
            
            setCurrentUserRoles(roles);
            // name을 우선 사용 (필터링과 일치시키기 위해)
            setCurrentUserName(employeeData.name || employeeData.full_name || '');
            setCurrentUserEmail(employeeData.email || '');
            setCurrentUserId(employeeData.id || '');
          }
        }
      } catch (error) {
        logger.error('초기 데이터 로드 실패', error);
      }
    };

    loadInitialData();
  }, []);

  // 발주 목록 로드
  const loadPurchases = useCallback(async () => {
    setLoading(true);
    
    try {
      // employees 데이터가 없으면 먼저 로드
      let employeeList = employees;
      if (employeeList.length === 0) {
        const { data: empData } = await supabase
          .from('employees')
          .select('*');
        employeeList = empData || [];
      }
      
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        logger.error('사용자 인증 실패', authError);
        toast.error('로그인이 필요합니다.');
        setLoading(false);
        return;
      }

      // 발주 데이터 조회 (hanslwebapp과 완전히 동일) - 전체 데이터 로드
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*,vendors(vendor_name,vendor_payment_schedule),vendor_contacts(contact_name),purchase_request_items(item_name,specification,quantity,unit_price_value,amount_value,remark,line_number,link)')
        .order('request_date', { ascending: false })
        .limit(2000); // 충분한 수의 데이터 로드

      if (error) {
        // Purchase data fetch error - will throw
        throw error;
      }

      // 데이터 변환 (hanslwebapp과 동일)
      const processedData = (data || []).map((request: any) => {
        // 첫 번째 품목 정보 (기존 방식과 호환성 유지)
        const firstItem = request.purchase_request_items?.[0] || {};
        
        // requester_id로 employee 찾기
        const requesterEmployee = employeeList.find(emp => emp.id === request.requester_id);
        
        return {
          id: Number(request.id),
          purchase_order_number: request.purchase_order_number as string,
          request_date: request.request_date as string,
          delivery_request_date: request.delivery_request_date as string,
          progress_type: request.progress_type as string,
          payment_completed_at: request.payment_completed_at as string,
          payment_category: request.payment_category as string,
          currency: request.currency as string,
          request_type: request.request_type as string,
          vendor: request.vendors || null,
          vendor_name: request.vendors?.vendor_name || '',
          vendor_payment_schedule: request.vendors?.vendor_payment_schedule || '',
          vendor_contacts: request.vendor_contacts || [],
          requester_id: request.requester_id as string,
          requester_name: request.requester_name as string,
          requester_email: requesterEmployee?.email || '',
          requester_full_name: requesterEmployee?.full_name || requesterEmployee?.name || request.requester_name || '',
          item_name: firstItem.item_name as string || '',
          specification: firstItem.specification as string || '',
          quantity: Number(firstItem.quantity) || 0,
          unit_price_value: Number(firstItem.unit_price_value) || 0,
          amount_value: Number(firstItem.amount_value) || 0,
          remark: firstItem.remark as string || '',
          project_vendor: request.project_vendor as string,
          sales_order_number: request.sales_order_number as string,
          project_item: request.project_item as string,
          line_number: Number(firstItem.line_number) || 1,
          contact_name: request.vendor_contacts?.contact_name || '',
          middle_manager_status: request.middle_manager_status as string,
          final_manager_status: request.final_manager_status as string,
          is_received: !!request.is_received,
          received_at: request.received_at as string,
          is_payment_completed: !!request.is_payment_completed,
          is_po_download: !!request.is_po_download,
          link: firstItem.link as string | undefined,
          // 전체 품목 리스트 추가 (hanslwebapp과 동일하게 items로 통일)
          items: request.purchase_request_items || [],
          // 총 금액 계산
          total_amount: request.purchase_request_items?.reduce((sum: number, item: any) => 
            sum + (Number(item.amount_value) || 0), 0) || 0,
          purchase_status: request.purchase_status || 'pending'
        };
      });

      // 데이터 로드 완료
      setPurchases(processedData);
    } catch (error) {
      logger.error('발주 목록 로드 실패', error);
      toast.error('발주 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [employees]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  return {
    purchases,
    vendors,
    employees,
    loading,
    currentUserRoles,
    currentUserName,
    currentUserEmail,
    currentUserId,
    refreshPurchases: loadPurchases
  };
};