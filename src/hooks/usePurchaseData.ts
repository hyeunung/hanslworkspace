import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export interface Purchase {
  id: number;
  purchase_order_number?: string;
  request_date: string;
  delivery_request_date?: string | null;
  revised_delivery_request_date?: string | null;
  progress_type: string;
  is_payment_completed: boolean;
  payment_category: string;
  payment_completed_at?: string;
  payment_completed_by_name?: string;
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
  is_utk_checked?: boolean;
  is_statement_received?: boolean;
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
}


// 향상된 캐시 관리
const globalCache = {
  purchases: null as Purchase[] | null,
  lastFetch: 0,
  userInfo: null as any,
  CACHE_DURATION: 5 * 60 * 1000, // 5분 캐싱으로 연장
  // 탭별 필터링 결과 캐시
  filteredData: new Map<string, { data: Purchase[]; timestamp: number }>(),
  FILTER_CACHE_DURATION: 30 * 1000 // 30초 필터 캐시
};

// 향상된 캐시 관리 함수들
export const clearPurchaseCache = () => {
  globalCache.purchases = null;
  globalCache.userInfo = null;
  globalCache.lastFetch = 0;
  globalCache.filteredData.clear();
};

// 부분 캐시 무효화 (탭별)
export const invalidateFilterCache = (tabKey?: string) => {
  if (tabKey) {
    for (const [key] of globalCache.filteredData.entries()) {
      if (key.includes(tabKey)) {
        globalCache.filteredData.delete(key);
      }
    }
  } else {
    globalCache.filteredData.clear();
  }
};

export const usePurchaseData = () => {
  // 초기 상태에서 캐시 확인하여 즉시 표시
  const now = Date.now();
  const cacheValid = globalCache.lastFetch && (now - globalCache.lastFetch) < globalCache.CACHE_DURATION;
  const hasCache = cacheValid && globalCache.purchases && globalCache.purchases.length > 0;
  
  const [purchases, setPurchases] = useState<Purchase[]>(hasCache ? globalCache.purchases : []);
  const [loading, setLoading] = useState(!hasCache);
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([]);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  const supabase = createClient();
  const initializationRef = useRef(false);
  const hasLoadedCacheRef = useRef(hasCache);

  // 초기 데이터 로드 (업체 목록, 사용자 권한) - 캐싱 적용
  useEffect(() => {
    const loadInitialData = async () => {
      if (initializationRef.current) return;
      initializationRef.current = true;
      
      const now = Date.now();
      const cacheValid = globalCache.lastFetch && (now - globalCache.lastFetch) < globalCache.CACHE_DURATION;
      
      try {
        // 캐시된 데이터가 유효한 경우 사용
        if (cacheValid && globalCache.userInfo) {
          try {
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
            // 캐시 초기화
            globalCache.purchases = null;
            globalCache.userInfo = null;
            globalCache.lastFetch = 0;
          }
        }
        
        // 캐시가 없거나 만료된 경우 새로 로드
        const userResult = await supabase.auth.getUser();

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
            
            setCurrentUserRoles(roles);
            setCurrentUserName(employeeData.name || employeeData.full_name || '');
            setCurrentUserEmail(employeeData.email || '');
            setCurrentUserId(employeeData.id || '');
          }
          
          globalCache.lastFetch = now;
        }
      } catch (error) {
        logger.error('초기 데이터 로드 실패', error);
      }
    };

    loadInitialData();
  }, []);

  // 발주 목록 로드 - 향상된 캐싱 및 최적화
  const loadPurchases = useCallback(async (forceRefresh?: boolean, options?: { silent?: boolean }) => {
    const showSpinner = !options?.silent && !hasLoadedCacheRef.current;
    
    try {
      // 캐시 확인
      const now = Date.now();
      const cacheValid = globalCache.lastFetch && (now - globalCache.lastFetch) < globalCache.CACHE_DURATION;
      
      // 강제 새로고침 시 필터 캐시도 무효화
      if (forceRefresh) {
        invalidateFilterCache();
        globalCache.purchases = null;
        globalCache.lastFetch = 0;
        hasLoadedCacheRef.current = false;
        // silent 모드가 아니고 캐시가 없었던 경우에만 로딩 표시
        if (showSpinner) {
          setLoading(true);
        }
      } else if (cacheValid && globalCache.purchases) {
        // 캐시가 있으면 즉시 표시
        setPurchases(globalCache.purchases);
        setLoading(false);
        hasLoadedCacheRef.current = true;
        
        // silent 모드가 아니면 백그라운드에서 업데이트
        if (!options?.silent) {
          setTimeout(async () => {
            try {
              // 캐시를 무시하고 최신 데이터 가져오기 (silent 모드)
              await loadPurchases(true, { silent: true });
            } catch (error) {
              // 백그라운드 업데이트 실패는 무시 (캐시된 데이터 사용 중)
              logger.debug('백그라운드 데이터 업데이트 실패 (무시됨)', error);
            }
          }, 100);
        }
        
        return;
      } else {
        // 캐시가 없으면 로딩 표시 (이미 캐시가 로드되지 않은 경우에만)
        if (showSpinner && !hasLoadedCacheRef.current) {
          setLoading(true);
        }
      }
      
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        logger.error('사용자 인증 실패', authError);
        toast.error('로그인이 필요합니다.');
        if (showSpinner) {
          setLoading(false);
        }
        return;
      }

      // 승인대기 항목을 놓치지 않기 위해 시간 제한 제거
      
      // 먼저 purchase_requests만 가져오기 (vendors JOIN 제거)
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          *,
          purchase_request_items(*)
        `)
        .order('request_date', { ascending: false })
        .limit(1000); // 성능 최적화: 최대 1000건

      if (error) {
        throw error;
      }

      // 필요시에만 employees와 vendors, vendor_contacts 데이터 조회 (캐시된 데이터 우선 사용)
      let employeeList: any[] = [];
      let vendorList: any[] = [];
      let contactList: any[] = [];
      
      // 데이터 변환에서 필요한 경우에만 조회
      if (data && data.length > 0) {
        // 병렬로 조회하여 성능 개선 (쿼리 필드명 수정)
        const [employeesResult, vendorsResult, contactsResult] = await Promise.all([
          supabase.from('employees').select('id, name, email'),
          supabase.from('vendors').select('id, vendor_name, vendor_payment_schedule'),
          supabase.from('vendor_contacts').select('id, contact_name')
        ]);
        
        employeeList = employeesResult.data || [];
        vendorList = vendorsResult.data || [];
        contactList = contactsResult.data || [];
      }

      
      // 오늘 발주 항목 확인
      const today = new Date().toISOString().split('T')[0];
      const todayItems = (data || []).filter((d: any) => d.request_date?.startsWith(today));

      // 데이터 변환 (hanslwebapp과 동일)
      const processedData = (data || []).map((request: any) => {
        // 첫 번째 품목 정보 (기존 방식과 호환성 유지)
        const firstItem = request.purchase_request_items?.[0] || {};
        
        // requester_id로 employee 찾기
        const requesterEmployee = employeeList.find(emp => emp.id === request.requester_id);
        
        // vendor_id로 vendor 찾기
        const vendorInfo = vendorList.find(vendor => vendor.id === request.vendor_id);
        
        // contact_id로 담당자 찾기
        const contactInfo = contactList.find(contact => contact.id === request.contact_id);
        
        return {
          id: Number(request.id),
          purchase_order_number: request.purchase_order_number as string,
          request_date: request.request_date as string,
          delivery_request_date: request.delivery_request_date ?? null,
          revised_delivery_request_date: request.revised_delivery_request_date ?? null,
          progress_type: request.progress_type as string,
          payment_completed_at: request.payment_completed_at as string,
          payment_completed_by_name: request.payment_completed_by_name as string,
          payment_category: request.payment_category as string,
          currency: request.currency as string,
          request_type: request.request_type as string,
          vendor: undefined, // vendors JOIN 제거됨
          vendor_name: request.vendor_name || '', // purchase_requests 테이블의 vendor_name 사용
          vendor_payment_schedule: vendorInfo?.vendor_payment_schedule || '', // vendors 테이블에서 조회
          vendor_contacts: [], // vendors JOIN 없으므로 빈배열
          requester_id: request.requester_id as string,
          requester_name: request.requester_name as string,
          requester_full_name: requesterEmployee?.name || request.requester_name || '',
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
          contact_name: contactInfo?.contact_name || '', // contact_id로 담당자 정보 조회
          middle_manager_status: request.middle_manager_status,
          final_manager_status: request.final_manager_status,
          is_received: !!request.is_received,
          received_at: request.received_at as string,
          is_payment_completed: !!request.is_payment_completed,
          is_utk_checked: !!request.is_utk_checked,
          is_statement_received: !!request.is_statement_received,
          is_po_download: !!request.is_po_download,
          link: firstItem.link as string | undefined,
          // 전체 품목 리스트 추가 (hanslwebapp과 동일하게 items로 통일) - line_number로 정렬
          items: (request.purchase_request_items || []).sort((a: any, b: any) => 
            (a.line_number || 0) - (b.line_number || 0)),
          // 총 금액 계산
          total_amount: request.purchase_request_items?.reduce((sum: number, item: any) => 
            sum + (Number(item.amount_value) || 0), 0) || 0
        };
      });


      // 데이터 로드 완료 및 캐싱
      setPurchases(processedData);
      globalCache.purchases = processedData;
      globalCache.lastFetch = now;
      hasLoadedCacheRef.current = true;
    } catch (error) {
      logger.error('발주 목록 로드 실패', error);
      toast.error('발주 목록을 불러올 수 없습니다.');
    } finally {
      if (showSpinner) {
        setLoading(false);
      } else {
        // silent 모드여도 로딩 상태는 false로 설정 (이미 표시된 경우)
        setLoading(false);
      }
    }
  }, [supabase]);

  const updatePurchaseOptimistic = useCallback((purchaseId: number, updater: (prev: Purchase) => Purchase) => {
    setPurchases(prev => {
      const next = prev.map(purchase => (purchase.id === purchaseId ? updater(purchase) : purchase));
      globalCache.purchases = next;
      return next;
    });
  }, []);

  // 초기 마운트 시 데이터 로드
  useEffect(() => {
    if (hasLoadedCacheRef.current) {
      // 캐시가 이미 로드되었으면 백그라운드에서만 업데이트
      setTimeout(() => {
        loadPurchases(true, { silent: true }).catch(() => {
          // 백그라운드 업데이트 실패는 무시
        });
      }, 100);
      return;
    }
    
    // 캐시가 없으면 정상적으로 로드
    loadPurchases();
  }, [loadPurchases]);

  return {
    purchases,
    loading,
    currentUserRoles,
    currentUserName,
    currentUserEmail,
    currentUserId,
    refreshPurchases: loadPurchases,
    updatePurchaseOptimistic
  };
};
