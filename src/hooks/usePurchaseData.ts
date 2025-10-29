import { useState, useEffect, useCallback, useRef } from 'react';
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

// 캐시 관리
const globalCache = {
  purchases: null as Purchase[] | null,
  vendors: null as Vendor[] | null,
  employees: null as Employee[] | null,
  lastFetch: 0,
  userInfo: null as any,
  CACHE_DURATION: 2 * 60 * 1000 // 2분 캐싱으로 성능 향상
};

// 캐시 강제 초기화 함수 (디버깅용)
export const clearPurchaseCache = () => {
  console.log('🔄 캐시 강제 초기화');
  globalCache.purchases = null;
  globalCache.vendors = null;
  globalCache.employees = null;
  globalCache.userInfo = null;
  globalCache.lastFetch = 0;
};

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
  const initializationRef = useRef(false);

  // 초기 데이터 로드 (업체 목록, 사용자 권한) - 캐싱 적용
  useEffect(() => {
    const loadInitialData = async () => {
      if (initializationRef.current) return;
      initializationRef.current = true;
      
      console.log('🚀 [DEBUG] loadInitialData 시작');
      const now = Date.now();
      const cacheValid = globalCache.lastFetch && (now - globalCache.lastFetch) < globalCache.CACHE_DURATION;
      console.log('📊 [DEBUG] 캐시 상태:', {
        cacheValid,
        lastFetch: globalCache.lastFetch,
        timeSinceLastFetch: now - globalCache.lastFetch,
        cacheHasData: !!(globalCache.vendors && globalCache.employees && globalCache.userInfo)
      });
      
      try {
        // 캐시된 데이터가 유효한 경우 사용
        if (cacheValid && globalCache.vendors && globalCache.employees && globalCache.userInfo) {
          try {
            console.log('✅ [DEBUG] 캐시 데이터 사용');
            setVendors(globalCache.vendors);
            setEmployees(globalCache.employees);
            
            const employeeData = globalCache.userInfo;
            if (employeeData) {
              let roles: string[] = [];
              if (employeeData.purchase_role) {
                if (Array.isArray(employeeData.purchase_role)) {
                  roles = employeeData.purchase_role.map((r: any) => String(r).trim());
                } else {
                  const roleString = String(employeeData.purchase_role);
                  roles = roleString
                    .split(',')
                    .map((r: string) => r.trim())
                    .filter((r: string) => r.length > 0);
                }
              }
              
              setCurrentUserRoles(roles);
              setCurrentUserName(employeeData.name || employeeData.full_name || '');
              setCurrentUserEmail(employeeData.email || '');
              setCurrentUserId(employeeData.id || '');
            }
            return;
          } catch (error) {
            logger.error('캐시 데이터 사용 중 오류', error);
            console.error('❌ [DEBUG] 캐시 오류:', error);
            // 캐시 초기화
            globalCache.purchases = null;
            globalCache.vendors = null;
            globalCache.employees = null;
            globalCache.userInfo = null;
            globalCache.lastFetch = 0;
          }
        }
        
        // 캐시가 없거나 만료된 경우 새로 로드
        console.log('🔄 [DEBUG] 데이터 새로 로드');
        const [vendorResult, employeeResult, userResult] = await Promise.all([
          supabase.from('vendors').select('*'),
          supabase.from('employees').select('*'),
          supabase.auth.getUser()
        ]);

        if (vendorResult.error) {
          console.error('❌ [DEBUG] 업체 로드 실패:', vendorResult.error);
          throw vendorResult.error;
        }
        const vendorData = vendorResult.data || [];
        setVendors(vendorData);
        globalCache.vendors = vendorData;
        console.log('✅ [DEBUG] 업체 로드 완료:', vendorData.length, '개');
        
        if (employeeResult.error) {
          console.error('❌ [DEBUG] 직원 로드 실패:', employeeResult.error);
          throw employeeResult.error;
        }
        const employeeData = employeeResult.data || [];
        setEmployees(employeeData);
        globalCache.employees = employeeData;
        console.log('✅ [DEBUG] 직원 로드 완료:', employeeData.length, '개');

        // 사용자 권한 및 이름 로드
        if (userResult.data.user && !userResult.error) {
          console.log('👤 [DEBUG] 사용자 정보:', userResult.data.user.email);
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
            globalCache.userInfo = employeeData;
            
            let roles: string[] = [];
            if (employeeData.purchase_role) {
              if (Array.isArray(employeeData.purchase_role)) {
                roles = employeeData.purchase_role.map((r: any) => String(r).trim());
              } else {
                const roleString = String(employeeData.purchase_role);
                roles = roleString
                  .split(',')
                  .map((r: string) => r.trim())
                  .filter((r: string) => r.length > 0);
              }
            }
            
            console.log('👤 [DEBUG] 사용자 권한:', {
              name: employeeData.name,
              email: employeeData.email,
              roles
            });
            
            setCurrentUserRoles(roles);
            setCurrentUserName(employeeData.name || employeeData.full_name || '');
            setCurrentUserEmail(employeeData.email || '');
            setCurrentUserId(employeeData.id || '');
          }
          
          globalCache.lastFetch = now;
        }
      } catch (error) {
        logger.error('초기 데이터 로드 실패', error);
        console.error('❌ [DEBUG] 초기 데이터 로드 실패:', error);
      }
    };

    loadInitialData();
  }, []);

  // 발주 목록 로드 - 캐싱 및 최적화 적용
  const loadPurchases = useCallback(async (forceRefresh?: boolean) => {
    console.log('🔄 [DEBUG] loadPurchases 시작 - forceRefresh:', forceRefresh);
    setLoading(true);
    
    try {
      // 캐시 확인
      const now = Date.now();
      const cacheValid = globalCache.lastFetch && (now - globalCache.lastFetch) < globalCache.CACHE_DURATION;
      
      console.log('📊 [DEBUG] 캐시 확인:', {
        forceRefresh,
        cacheValid,
        hasCachedData: !!globalCache.purchases,
        cacheAge: now - globalCache.lastFetch
      });
      
      if (!forceRefresh && cacheValid && globalCache.purchases) {
        try {
          console.log('✅ [DEBUG] 캐시된 발주 데이터 사용:', globalCache.purchases.length, '건');
          setPurchases(globalCache.purchases);
          setLoading(false);
          return;
        } catch (error) {
          logger.error('발주 데이터 캐시 사용 중 오류', error);
          console.error('❌ [DEBUG] 캐시 오류:', error);
          // 캐시 초기화
          globalCache.purchases = null;
          globalCache.lastFetch = 0;
        }
      }
      
      // employees 데이터 준비
      let employeeList = employees;
      if (employeeList.length === 0) {
        employeeList = globalCache.employees || [];
        if (employeeList.length === 0) {
          const { data: empData } = await supabase
            .from('employees')
            .select('*');
          employeeList = empData || [];
        }
      }
      
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        logger.error('사용자 인증 실패', authError);
        toast.error('로그인이 필요합니다.');
        setLoading(false);
        return;
      }

      // 최근 6개월 발주 데이터 조회 (성능 최적화)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      sixMonthsAgo.setHours(0, 0, 0, 0);
      
      console.log('📅 [DEBUG] 최근 6개월 데이터 조회:', {
        sixMonthsAgo: sixMonthsAgo.toISOString(),
        today: new Date().toISOString()
      });
      
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*,vendors(vendor_name,vendor_payment_schedule),vendor_contacts(contact_name),purchase_request_items(*).order(line_number)')
        .gte('request_date', sixMonthsAgo.toISOString())
        .order('request_date', { ascending: false })
        .limit(500); // 성능 최적화: 최대 500건

      if (error) {
        console.error('❌ [DEBUG] 발주 데이터 조회 실패:', error);
        throw error;
      }

      console.log('📊 [DEBUG] 발주 데이터 조회 결과:', {
        dataCount: data?.length || 0,
        firstFewIds: data?.slice(0, 5).map(d => ({
          id: d.id,
          po_number: d.purchase_order_number,
          date: d.request_date
        }))
      });

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

      console.log('✅ [DEBUG] 발주 데이터 처리 완료:', {
        processedCount: processedData.length,
        sampleData: processedData.slice(0, 3).map(p => ({
          id: p.id,
          po: p.purchase_order_number,
          requester: p.requester_name,
          date: p.request_date
        }))
      });

      // 데이터 로드 완료 및 캐싱
      setPurchases(processedData);
      globalCache.purchases = processedData;
      globalCache.lastFetch = now;
      console.log('✅ [DEBUG] 캐시 업데이트 완료');
    } catch (error) {
      logger.error('발주 목록 로드 실패', error);
      console.error('❌ [DEBUG] 발주 목록 로드 실패:', error);
      toast.error('발주 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [employees]);

  useEffect(() => {
    console.log('🚀 [DEBUG] usePurchaseData 첫 로드');
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
