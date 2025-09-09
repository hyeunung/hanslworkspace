import { useState, useMemo, useEffect } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Purchase } from './usePurchaseData';
import { createClient } from '@/lib/supabase/client';

// 상수 정의
const HIDDEN_EMPLOYEES = ['정현웅', '정희웅'];

export interface PurchaseFilters {
  tab: string;
  searchTerm: string;
  vendorFilter: string;
  dateFromFilter: string;
  dateToFilter: string;
}

export const usePurchaseFilters = (purchases: Purchase[], currentUserRoles: string[]) => {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  
  // 기간 필터 초기값 설정 (올해 1월 1일 ~ 오늘)
  const thisYear = new Date().getFullYear();
  const defaultStart = new Date(thisYear, 0, 1).toISOString().split('T')[0];
  const defaultEnd = new Date().toISOString().split('T')[0];
  const [dateFromFilter, setDateFromFilter] = useState(defaultStart);
  const [dateToFilter, setDateToFilter] = useState(defaultEnd);
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // 사용자별 저장된 기간 불러오기
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('user_preferences')
        .select('period_start, period_end')
        .eq('user_id', user.id)
        .single();
        
      if (data) {
        const ps = data.period_start ? new Date(data.period_start).toISOString().split('T')[0] : defaultStart;
        const pe = data.period_end ? new Date(data.period_end).toISOString().split('T')[0] : defaultEnd;
        setDateFromFilter(ps);
        setDateToFilter(pe);
      }
    })();
  }, []);
  
  // 기간 변경 시 즉시 저장 (사용자별)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (!dateFromFilter || !dateToFilter) return;
      
      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        period_start: dateFromFilter,
        period_end: dateToFilter,
        updated_at: new Date().toISOString()
      });
    })();
  }, [dateFromFilter, dateToFilter]);

  // 필터링된 발주요청 목록 (성능 최적화)
  const filteredPurchases = useMemo(() => {
    // 특정 직원 발주요청 숨김 처리
    let visiblePurchases = purchases;
    if (!currentUserRoles.includes('purchase_manager') && 
        !currentUserRoles.includes('app_admin')) {
      visiblePurchases = purchases.filter(p => 
        !HIDDEN_EMPLOYEES.includes(p.requester_name)
      );
    }
    
    return visiblePurchases.filter((purchase) => {
      // 직원 필터링
      if (selectedEmployee && selectedEmployee !== 'all' && purchase.requester_name !== selectedEmployee) {
        return false;
      }
      
      // 탭별 필터링 (hanslwebapp과 동일)
      let matchesTab = true;
      switch (activeTab) {
        case 'pending':
          // pending, 대기, 빈값, null 모두 승인대기로 처리
          matchesTab = ['pending', '대기', '', null].includes(purchase.final_manager_status as any);
          break;
        case 'purchase': {
          // 조건: (1) 선진행 & 구매요청 & 결제 미완료  OR  (2) 일반 & 구매요청 & 결제 미완료 & 최종승인
          const isRequest = purchase.payment_category === '구매요청';
          const notPaid = !purchase.is_payment_completed;
          if (!isRequest || !notPaid) {
            matchesTab = false;
          } else {
            const isSeonJin = (purchase.progress_type || '').includes('선진행');
            const isIlban = (purchase.progress_type || '').includes('일반');
            const finalApproved = purchase.final_manager_status === 'approved';
            matchesTab = (isSeonJin) || (isIlban && finalApproved);
          }
          break;
        }
        case 'receipt': {
          // 입고대기: 미입고 & (선진행 OR 최종승인)
          const notReceived = !purchase.is_received;
          const cond = (purchase.progress_type || '').includes('선진행') || purchase.final_manager_status === 'approved';
          matchesTab = notReceived && cond;
          break;
        }
        case 'done':
          matchesTab = true;
          break;
      }

      // 검색어 필터링 (최적화됨)
      const matchesSearch = !debouncedSearchTerm || (() => {
        const term = debouncedSearchTerm.trim().toLowerCase();
        if (!term) return true;
        
        // 기본 필드 우선 검색 (빠른 종료)
        const basicFields = [
          purchase.purchase_order_number,
          purchase.vendor_name,
          purchase.requester_name,
          purchase.project_vendor
        ];
        
        // 기본 필드에서 먼저 찾기
        for (const field of basicFields) {
          if (field && field.toLowerCase().includes(term)) {
            return true;
          }
        }
        
        // 추가 필드 검색
        const additionalFields = [
          purchase.sales_order_number,
          purchase.project_item,
          purchase.remark,
          purchase.unit_price_value?.toString(),
          purchase.amount_value?.toString(),
        ];
        
        for (const field of additionalFields) {
          if (field && field.toLowerCase().includes(term)) {
            return true;
          }
        }
        
        // 품목 검색 (마지막에)
        if (purchase.items && purchase.items.length > 0) {
          return purchase.items.some(item => 
            (item.item_name && item.item_name.toLowerCase().includes(term)) ||
            (item.specification && item.specification.toLowerCase().includes(term))
          );
        }
        
        return false;
      })();

      // 업체 필터링
      const matchesVendor = !vendorFilter || purchase.vendor_name === vendorFilter;

      // 날짜 필터링 (청구일 기준)
      const requestDate = purchase.request_date ? purchase.request_date.split('T')[0] : '';
      const matchesDateFrom = !dateFromFilter || requestDate >= dateFromFilter;
      const matchesDateTo = !dateToFilter || requestDate <= dateToFilter;

      return matchesTab && matchesSearch && matchesVendor && matchesDateFrom && matchesDateTo;
    });
  }, [
    purchases,
    activeTab,
    debouncedSearchTerm,
    vendorFilter,
    dateFromFilter,
    dateToFilter,
    currentUserRoles,
    selectedEmployee
  ]);

  // 탭별 카운트 (hanslwebapp과 동일한 조건 - 기간 필터 적용)
  const tabCounts = useMemo(() => {
    // 특정 직원 발주요청 숨김 처리
    let countPurchases = purchases;
    if (!currentUserRoles.includes('purchase_manager') && 
        !currentUserRoles.includes('app_admin')) {
      countPurchases = purchases.filter(p => 
        !HIDDEN_EMPLOYEES.includes(p.requester_name)
      );
    }
    
    // 기간 필터 적용
    const dateFilteredPurchases = countPurchases.filter((purchase) => {
      const requestDate = purchase.request_date ? purchase.request_date.split('T')[0] : '';
      const matchesDateFrom = !dateFromFilter || requestDate >= dateFromFilter;
      const matchesDateTo = !dateToFilter || requestDate <= dateToFilter;
      return matchesDateFrom && matchesDateTo;
    });
    
    // 각 탭의 고유 발주요청번호 카운트 (중복 제거)
    const getUniqueOrderCount = (filtered: Purchase[]) => {
      return new Set(filtered.map(p => p.purchase_order_number)).size;
    };
    
    // 입고대기 상태 체크는 이미 아래에서 수행하므로 제거
    
    return {
      pending: getUniqueOrderCount(dateFilteredPurchases.filter(p => 
        ['pending', '대기', '', null].includes(p.final_manager_status as any)
      )),
      purchase: getUniqueOrderCount(dateFilteredPurchases.filter(p => {
        const isRequest = p.payment_category === '구매요청';
        const notPaid = !p.is_payment_completed;
        if (!isRequest || !notPaid) return false;
        const isSeonJin = (p.progress_type || '').includes('선진행');
        const isIlban = (p.progress_type || '').includes('일반');
        const finalApproved = p.final_manager_status === 'approved';
        return (isSeonJin) || (isIlban && finalApproved);
      })),
      receipt: getUniqueOrderCount(dateFilteredPurchases.filter(p => {
        const notReceived = !p.is_received;
        const cond = (p.progress_type || '').includes('선진행') || p.final_manager_status === 'approved';
        return notReceived && cond;
      })),
      done: getUniqueOrderCount(dateFilteredPurchases)
    };
  }, [
    purchases,
    currentUserRoles,
    dateFromFilter,
    dateToFilter
  ]);

  return {
    // States
    activeTab,
    searchTerm,
    vendorFilter,
    dateFromFilter,
    dateToFilter,
    selectedEmployee,
    
    // Setters
    setActiveTab,
    setSearchTerm,
    setVendorFilter,
    setDateFromFilter,
    setDateToFilter,
    setSelectedEmployee,
    
    // Computed values
    filteredPurchases,
    tabCounts
  };
};