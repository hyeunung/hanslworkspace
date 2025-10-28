import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Purchase } from './usePurchaseData';
import { createClient } from '@/lib/supabase/client';

// 상수 정의 - 특정 직원의 발주요청 숨김 (본인이 아닌 경우에만)
const HIDDEN_EMPLOYEES = ['정희웅'];  // 정현웅 제거

// 메모이제이션 캐시
const filterCache = new Map();
const CACHE_SIZE_LIMIT = 100;

export const useFastPurchaseFilters = (purchases: Purchase[], currentUserRoles: string[], currentUserName: string, currentUserId?: string, currentUserEmail?: string) => {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  // 초기값 설정 - hanslwebapp과 동일하게 빈 문자열로 시작
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
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
  const isAdmin = currentUserRoles?.includes('app_admin');
  const isFinalApprover = currentUserRoles?.includes('final_approver');
  const isMiddleManager = currentUserRoles?.includes('middle_manager');
  const isPurchaseManager = currentUserRoles?.includes('purchase_manager');
  const hasApprovalRole = isAdmin || isFinalApprover || isMiddleManager;
  
  // lead buyer 권한 체크 추가
  const isLeadBuyer = currentUserRoles?.includes('raw_material_manager') || 
                      currentUserRoles?.includes('consumable_manager') || 
                      currentUserRoles?.includes('purchase_manager');

  // hanslwebapp과 동일한 로직 - roleCase 계산 (lead buyer 추가)
  const roleCase = useMemo(() => {
    if (!currentUserRoles || currentUserRoles.length === 0) return 1; // null
    if (isPurchaseManager) return 2; // purchase_manager
    if (currentUserRoles.some(r => ['middle_manager', 'final_approver', 'app_admin', 'ceo'].includes(r))) return 3;
    return 1;
  }, [currentUserRoles, isPurchaseManager]);
  
  // 탭별 기본 직원 필터 계산 (구매현황은 lead buyer와 app_admin만 전체 보기)
  const computeDefaultEmployee = useCallback(
    (tabKey: string): string => {
      if (!currentUserName) return 'all';
      
      // 구매현황 탭은 lead buyer와 app_admin만 전체 보기
      if (tabKey === 'purchase') {
        if (isLeadBuyer || isAdmin) {
          return 'all';
        }
        return currentUserName;
      }
      
      switch (roleCase) {
        case 1: // role null
          if (tabKey === 'done') return 'all';
          return currentUserName;
        case 2: // purchase_manager
          if (tabKey === 'done') return 'all';
          return currentUserName; // pending & receipt
        case 3: // 관리자 권한
          return 'all';
        default:
          return currentUserName;
      }
    },
    [currentUserName, roleCase, isLeadBuyer, isAdmin]
  );
  
  // 탭 변경 또는 사용자/역할 로딩 시 기본값 설정 (hanslwebapp과 동일)
  useEffect(() => {
    if (!currentUserName) return;
    const defaultEmployee = computeDefaultEmployee(activeTab);
    setSelectedEmployee(defaultEmployee);
  }, [activeTab, currentUserName, roleCase, computeDefaultEmployee]);
  
  // 1단계: 권한별 필터링 (캐싱 적용)
  const visiblePurchases = useMemo(() => {
    try {
      const cacheKey = `visible_${purchases.length}_${currentUserRoles.join(',')}`;
      if (filterCache.has(cacheKey)) {
        return filterCache.get(cacheKey);
      }
      
      let result;
      if (currentUserRoles.includes('purchase_manager') || currentUserRoles.includes('app_admin')) {
        result = purchases;
      } else {
        result = purchases.filter(p => !HIDDEN_EMPLOYEES.includes(p.requester_name));
      }
      
      // 캐시 크기 제한
      if (filterCache.size >= CACHE_SIZE_LIMIT) {
        const firstKey = filterCache.keys().next().value;
        filterCache.delete(firstKey);
      }
      filterCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('필터링 중 오류:', error);
      // 캐시 초기화 후 직접 계산
      filterCache.clear();
      if (currentUserRoles.includes('purchase_manager') || currentUserRoles.includes('app_admin')) {
        return purchases;
      } else {
        return purchases.filter(p => !HIDDEN_EMPLOYEES.includes(p.requester_name));
      }
    }
  }, [purchases, currentUserRoles]);

  // 2단계: 날짜 필터링 (캐싱 적용)
  const dateFilteredPurchases = useMemo(() => {
    const cacheKey = `date_${visiblePurchases.length}_${dateFromFilter}_${dateToFilter}`;
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    const result = visiblePurchases.filter((purchase) => {
      const requestDate = purchase.request_date ? purchase.request_date.split('T')[0] : '';
      const matchesDateFrom = !dateFromFilter || requestDate >= dateFromFilter;
      const matchesDateTo = !dateToFilter || requestDate <= dateToFilter;
      return matchesDateFrom && matchesDateTo;
    });
    
    if (filterCache.size >= CACHE_SIZE_LIMIT) {
      const firstKey = filterCache.keys().next().value;
      filterCache.delete(firstKey);
    }
    filterCache.set(cacheKey, result);
    return result;
  }, [visiblePurchases, dateFromFilter, dateToFilter]);

  // 3단계: 탭별 필터링 (최적화 적용)
  const tabFilteredPurchases = useMemo(() => {
    const cacheKey = `tab_${dateFilteredPurchases.length}_${activeTab}`;
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    const result = dateFilteredPurchases.filter((purchase) => {
      let matches = false;
      
      switch (activeTab) {
        case 'pending':
          // pending, 대기, 빈값, null 모두 승인대기로 처리
          matches = ['pending', '대기', '', null].includes(purchase.final_manager_status as any);
          return matches;
          
        case 'purchase': {
          // DB 확인 결과: '구매 요청' (띄어쓰기 있음) 또는 '발주'
          const isRequest = purchase.payment_category === '구매 요청';
          const notPaid = !purchase.is_payment_completed;
          const isSeonJin = (purchase.progress_type || '').includes('선진행');
          const isIlban = (purchase.progress_type || '').includes('일반');
          const finalApproved = purchase.final_manager_status === 'approved';
          
          if (!isRequest || !notPaid) {
            matches = false;
          } else {
            matches = (isSeonJin) || (isIlban && finalApproved);
          }
          
          return matches;
        }
        
        case 'receipt': {
          // 입고현황: 미입고 & (선진행 or 최종승인)
          const notReceived = !purchase.is_received;
          const isSeonJin = (purchase.progress_type || '').includes('선진행');
          const finalApproved = purchase.final_manager_status === 'approved';
          matches = notReceived && (isSeonJin || finalApproved);
          return matches;
        }
        
        case 'done':
          matches = true;
          return matches;
          
        default:
          return true;
      }
    });
    
    if (filterCache.size >= CACHE_SIZE_LIMIT) {
      const firstKey = filterCache.keys().next().value;
      filterCache.delete(firstKey);
    }
    filterCache.set(cacheKey, result);
    return result;
  }, [dateFilteredPurchases, activeTab]);

  // 4단계: 직원 필터링 (최적화 적용)
  const employeeFilteredPurchases = useMemo(() => {
    const cacheKey = `employee_${tabFilteredPurchases.length}_${selectedEmployee}`;
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    let result;
    if (selectedEmployee && selectedEmployee !== 'all' && selectedEmployee !== '전체') {
      result = tabFilteredPurchases.filter(purchase => purchase.requester_name === selectedEmployee);
    } else {
      result = tabFilteredPurchases;
    }
    
    if (filterCache.size >= CACHE_SIZE_LIMIT) {
      const firstKey = filterCache.keys().next().value;
      filterCache.delete(firstKey);
    }
    filterCache.set(cacheKey, result);
    return result;
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

  // 탭 카운트 (hanslwebapp과 동일한 조건)
  const tabCounts = useMemo(() => {
    // 특정 직원 발주요청 숨김 처리
    const countPurchases = visiblePurchases;
    
    // 기간 필터 적용
    const dateFilteredForCount = countPurchases.filter((purchase) => {
      const requestDate = purchase.request_date ? purchase.request_date.split('T')[0] : '';
      const matchesDateFrom = !dateFromFilter || requestDate >= dateFromFilter;
      const matchesDateTo = !dateToFilter || requestDate <= dateToFilter;
      return matchesDateFrom && matchesDateTo;
    });
    
    // 각 탭의 고유 발주요청번호 카운트 (중복 제거)
    const getUniqueOrderCount = (filtered: Purchase[]) => {
      return new Set(filtered.map(p => p.purchase_order_number)).size;
    };
    
    // 각 탭별로 기본 직원 필터 계산 (카운트용)
    const getFilteredDataForTab = (tabKey: string) => {
      // 구매현황 탭은 특별 처리
      if (tabKey === 'purchase') {
        if (isLeadBuyer || isAdmin) {
          return dateFilteredForCount;
        } else {
          return dateFilteredForCount.filter(p => p.requester_name === currentUserName);
        }
      }
      
      const defaultEmployee = computeDefaultEmployee(tabKey);
      
      if (defaultEmployee === 'all' || defaultEmployee === '전체') {
        return dateFilteredForCount;
      } else {
        return dateFilteredForCount.filter(p => p.requester_name === defaultEmployee);
      }
    };
    
    // 각 탭별 데이터 필터링
    const pendingData = getFilteredDataForTab('pending');
    const purchaseData = getFilteredDataForTab('purchase');
    const receiptData = getFilteredDataForTab('receipt');
    const doneData = getFilteredDataForTab('done');
    
    const pendingFiltered = pendingData.filter(p => {
      const matches = ['pending', '대기', '', null].includes(p.final_manager_status as any);
      return matches;
    });
    
    const purchaseFiltered = purchaseData.filter(p => {
      const isRequest = p.payment_category === '구매 요청';
      const notPaid = !p.is_payment_completed;
      if (!isRequest || !notPaid) return false;
      const isSeonJin = (p.progress_type || '').includes('선진행');
      const isIlban = (p.progress_type || '').includes('일반');
      const finalApproved = p.final_manager_status === 'approved';
      return (isSeonJin) || (isIlban && finalApproved);
    });
    
    const receiptFiltered = receiptData.filter(p => {
      const notReceived = !p.is_received;
      const isSeonJin = (p.progress_type || '').includes('선진행');
      const finalApproved = p.final_manager_status === 'approved';
      return notReceived && (isSeonJin || finalApproved);
    });
    
    const counts = {
      pending: getUniqueOrderCount(pendingFiltered),
      purchase: getUniqueOrderCount(purchaseFiltered),
      receipt: getUniqueOrderCount(receiptFiltered),
      done: getUniqueOrderCount(doneData)  // 전체 항목
    };
    
    return counts;
  }, [visiblePurchases, dateFromFilter, dateToFilter, roleCase, currentUserName, computeDefaultEmployee, isLeadBuyer, isAdmin]);

  // 사용자별 저장된 기간 불러오기 (로딩 최적화)
  const loadedPreferencesRef = useRef(false);
  useEffect(() => {
    if (loadedPreferencesRef.current) return;
    loadedPreferencesRef.current = true;
    
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
  
  // 기간 변경 시 디바운스 저장 (사용자별)
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  useEffect(() => {
    if (!loadedPreferencesRef.current) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (!dateFromFilter || !dateToFilter) return;
      
      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        period_start: dateFromFilter,
        period_end: dateToFilter,
        updated_at: new Date().toISOString()
      });
    }, 1000);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
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