import { useState, useMemo, useEffect } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Purchase } from './usePurchaseData';
import { createClient } from '@/lib/supabase/client';

// 상수 정의
const HIDDEN_EMPLOYEES = ['정현웅', '정희웅'];

export const useFastPurchaseFilters = (purchases: Purchase[], currentUserRoles: string[], currentUserName: string) => {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [purchaseNumberFilter, setPurchaseNumberFilter] = useState('');
  const [itemNameFilter, setItemNameFilter] = useState('');
  const [specificationFilter, setSpecificationFilter] = useState('');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState('');
  const [remarkFilter, setRemarkFilter] = useState('');
  
  // 기간 필터 초기값 설정 (올해 1월 1일 ~ 오늘)
  const thisYear = new Date().getFullYear();
  const defaultStart = new Date(thisYear, 0, 1).toISOString().split('T')[0];
  const defaultEnd = new Date().toISOString().split('T')[0];
  const [dateFromFilter, setDateFromFilter] = useState(defaultStart);
  const [dateToFilter, setDateToFilter] = useState(defaultEnd);
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // 권한별 로직 계산
  const isAdmin = currentUserRoles?.includes('app_admin') || currentUserRoles?.includes('final_approver');
  
  // 탭별 기본 직원 필터 계산
  const computeDefaultEmployee = (tabKey: string): string => {
    if (!currentUserName) return currentUserName || '';
    
    // 기본값은 항상 로그인한 사용자 본인
    return currentUserName;
  };
  
  // 탭 변경 시 직원 필터 기본값 설정
  useEffect(() => {
    if (!currentUserName) return;
    const defaultEmployee = computeDefaultEmployee(activeTab);
    setSelectedEmployee(defaultEmployee);
  }, [activeTab, currentUserName, isAdmin]);
  
  // 1단계: 권한별 필터링 (한번만 실행)
  const visiblePurchases = useMemo(() => {
    if (currentUserRoles.includes('purchase_manager') || currentUserRoles.includes('app_admin')) {
      return purchases;
    }
    return purchases.filter(p => !HIDDEN_EMPLOYEES.includes(p.requester_name));
  }, [purchases, currentUserRoles]);

  // 2단계: 날짜 필터링 (날짜 변경시만 실행)
  const dateFilteredPurchases = useMemo(() => {
    return visiblePurchases.filter((purchase) => {
      const requestDate = purchase.request_date ? purchase.request_date.split('T')[0] : '';
      const matchesDateFrom = !dateFromFilter || requestDate >= dateFromFilter;
      const matchesDateTo = !dateToFilter || requestDate <= dateToFilter;
      return matchesDateFrom && matchesDateTo;
    });
  }, [visiblePurchases, dateFromFilter, dateToFilter]);

  // 3단계: 탭별 필터링 (탭 변경시만 실행)
  const tabFilteredPurchases = useMemo(() => {
    return dateFilteredPurchases.filter((purchase) => {
      switch (activeTab) {
        case 'pending':
          return ['pending', '대기', '', null].includes(purchase.final_manager_status as any);
        case 'purchase': {
          // 구매요청 건이면서, 구매완료 전인 항목
          const isRequest = purchase.payment_category === '구매요청';
          const notPaid = !purchase.is_payment_completed;
          if (!isRequest || !notPaid) return false;
          
          // 선진행은 승인 없이도 표시, 일반은 최종승인 완료된 것만 표시
          const isSeonJin = (purchase.progress_type || '').includes('선진행');
          const finalApproved = purchase.final_manager_status === 'approved';
          
          return isSeonJin || finalApproved;
        }
        case 'receipt': {
          const notReceived = !purchase.is_received;
          const cond = (purchase.progress_type || '').includes('선진행') || purchase.final_manager_status === 'approved';
          return notReceived && cond;
        }
        case 'done':
          return true;
        default:
          return true;
      }
    });
  }, [dateFilteredPurchases, activeTab]);

  // 4단계: 직원 필터링 (직원 선택시만 실행)
  const employeeFilteredPurchases = useMemo(() => {
    // 전체 직원 선택 시
    if (!selectedEmployee || selectedEmployee === 'all' || selectedEmployee === '전체') {
      return tabFilteredPurchases;
    }
    // 특정 직원 선택 시
    return tabFilteredPurchases.filter(purchase => purchase.requester_name === selectedEmployee);
  }, [tabFilteredPurchases, selectedEmployee]);

  // 5단계: 업체 필터링 (업체 선택시만 실행)
  const vendorFilteredPurchases = useMemo(() => {
    if (!vendorFilter) {
      return employeeFilteredPurchases;
    }
    return employeeFilteredPurchases.filter(purchase => purchase.vendor_name === vendorFilter);
  }, [employeeFilteredPurchases, vendorFilter]);

  // 6단계: 추가 필터 적용
  const additionalFilteredPurchases = useMemo(() => {
    let filtered = vendorFilteredPurchases;
    
    // 발주요청번호 필터
    if (purchaseNumberFilter) {
      const term = purchaseNumberFilter.trim().toLowerCase();
      filtered = filtered.filter(p => p.purchase_order_number?.toLowerCase().includes(term));
    }
    
    // 품명 필터
    if (itemNameFilter) {
      const term = itemNameFilter.trim().toLowerCase();
      filtered = filtered.filter(p => {
        if (p.items && p.items.length > 0) {
          return p.items.some(item => item.item_name?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    // 규격 필터
    if (specificationFilter) {
      const term = specificationFilter.trim().toLowerCase();
      filtered = filtered.filter(p => {
        if (p.items && p.items.length > 0) {
          return p.items.some(item => item.specification?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    // 승인상태 필터
    if (approvalStatusFilter && approvalStatusFilter !== 'all') {
      filtered = filtered.filter(p => {
        switch (approvalStatusFilter) {
          case 'pending':
            return !p.final_manager_status || p.final_manager_status === 'pending' || p.final_manager_status === '대기';
          case 'approved':
            return p.final_manager_status === 'approved';
          case 'rejected':
            return p.final_manager_status === 'rejected' || p.middle_manager_status === 'rejected';
          default:
            return true;
        }
      });
    }
    
    // 비고 필터
    if (remarkFilter) {
      const term = remarkFilter.trim().toLowerCase();
      filtered = filtered.filter(p => {
        if (p.items && p.items.length > 0) {
          return p.items.some(item => item.remark?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    return filtered;
  }, [vendorFilteredPurchases, purchaseNumberFilter, itemNameFilter, specificationFilter, approvalStatusFilter, remarkFilter]);

  // 7단계: 검색 필터링 (검색어 변경시만 실행)
  const searchFilteredPurchases = useMemo(() => {
    if (!debouncedSearchTerm) {
      return additionalFilteredPurchases;
    }
    
    const term = debouncedSearchTerm.trim().toLowerCase();
    
    return additionalFilteredPurchases.filter(purchase => {
      // 빠른 검색 (기본 필드만)
      if (purchase.purchase_order_number?.toLowerCase().includes(term) ||
          purchase.vendor_name?.toLowerCase().includes(term) ||
          purchase.requester_name?.toLowerCase().includes(term) ||
          purchase.project_vendor?.toLowerCase().includes(term)) {
        return true;
      }
      
      // 품목 검색 (필요할 때만)
      if (purchase.items && purchase.items.length > 0) {
        return purchase.items.some(item => 
          (item.item_name && item.item_name.toLowerCase().includes(term)) ||
          (item.specification && item.specification.toLowerCase().includes(term))
        );
      }
      
      return false;
    });
  }, [additionalFilteredPurchases, debouncedSearchTerm]);

  // 8단계: 최종 정렬 - 최신순 (내림차순)
  const filteredPurchases = useMemo(() => {
    return [...searchFilteredPurchases].sort((a, b) => {
      // request_date를 기준으로 내림차순 정렬 (최신이 위로)
      const dateA = a.request_date ? new Date(a.request_date).getTime() : 0;
      const dateB = b.request_date ? new Date(b.request_date).getTime() : 0;
      return dateB - dateA;
    });
  }, [searchFilteredPurchases]);

  // 탭 카운트 (캐시됨, 날짜 필터 기준)
  const tabCounts = useMemo(() => {
    const getUniqueOrderCount = (filtered: Purchase[]) => {
      return new Set(filtered.map(p => p.purchase_order_number)).size;
    };
    
    return {
      pending: getUniqueOrderCount(dateFilteredPurchases.filter(p => 
        ['pending', '대기', '', null].includes(p.final_manager_status as any)
      )),
      purchase: getUniqueOrderCount(dateFilteredPurchases.filter(p => {
        // 구매요청 건이면서, 구매완료 전인 항목
        const isRequest = p.payment_category === '구매요청';
        const notPaid = !p.is_payment_completed;
        if (!isRequest || !notPaid) return false;
        
        // 선진행은 승인 없이도 표시, 일반은 최종승인 완료된 것만 표시
        const isSeonJin = (p.progress_type || '').includes('선진행');
        const finalApproved = p.final_manager_status === 'approved';
        
        return isSeonJin || finalApproved;
      })),
      receipt: getUniqueOrderCount(dateFilteredPurchases.filter(p => {
        const notReceived = !p.is_received;
        const cond = (p.progress_type || '').includes('선진행') || p.final_manager_status === 'approved';
        return notReceived && cond;
      })),
      done: getUniqueOrderCount(dateFilteredPurchases)
    };
  }, [dateFilteredPurchases]);

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

  return {
    // States
    activeTab,
    searchTerm,
    vendorFilter,
    dateFromFilter,
    dateToFilter,
    selectedEmployee,
    purchaseNumberFilter,
    itemNameFilter,
    specificationFilter,
    approvalStatusFilter,
    remarkFilter,
    
    // Setters
    setActiveTab,
    setSearchTerm,
    setVendorFilter,
    setDateFromFilter,
    setDateToFilter,
    setSelectedEmployee,
    setPurchaseNumberFilter,
    setItemNameFilter,
    setSpecificationFilter,
    setApprovalStatusFilter,
    setRemarkFilter,
    
    // Computed values
    filteredPurchases,
    tabCounts
  };
};