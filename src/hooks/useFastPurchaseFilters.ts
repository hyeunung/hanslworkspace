import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { createClient } from '@/lib/supabase/client';
import { Purchase } from './usePurchaseData';

// 상수 정의 - 특정 직원의 발주요청 숨김 (본인이 아닌 경우에만)
const HIDDEN_EMPLOYEES = ['정희웅'];  // 정현웅 제거

// 향상된 메모이제이션 캐시 시스템
const filterCache = new Map();
const resultCache = new Map(); // 최종 결과 캐시
const CACHE_SIZE_LIMIT = 200;
const RESULT_CACHE_DURATION = 15 * 1000; // 15초 결과 캐시

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
  
  // 1단계: 권한별 필터링 (향상된 캐싱)
  const visiblePurchases = useMemo(() => {
    const cacheKey = `visible_${purchases.length}_${currentUserRoles.join(',')}`;
    
    // 캐시 확인
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    // 권한 체크 최적화 - 한 번만 계산
    const hasManagerRole = currentUserRoles.includes('purchase_manager') || currentUserRoles.includes('app_admin');
    
    const result = hasManagerRole 
      ? purchases 
      : purchases.filter(p => !HIDDEN_EMPLOYEES.includes(p.requester_name));
    
    // 캐시 관리
    if (filterCache.size >= CACHE_SIZE_LIMIT) {
      const firstKey = filterCache.keys().next().value;
      filterCache.delete(firstKey);
    }
    filterCache.set(cacheKey, result);
    return result;
  }, [purchases, currentUserRoles]);


  // 2단계: 탭별 필터링 (최적화 적용)
  const tabFilteredPurchases = useMemo(() => {
    const cacheKey = `tab_${visiblePurchases.length}_${activeTab}`;
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    // 오늘 날짜 계산 (한국 시간 기준)
    const today = new Date().toISOString().split('T')[0];
    
    const result = visiblePurchases.filter((purchase: Purchase) => {
      let matches = false;
      
      switch (activeTab) {
        case 'pending':
          // 중간승인자나 최종승인자 중 하나라도 pending이면 승인대기
          const middlePending = ['pending', '대기', '', null, undefined].includes(purchase.middle_manager_status as any);
          const finalPending = ['pending', '대기', '', null, undefined].includes(purchase.final_manager_status as any);
          
          // 반려된 경우는 제외
          const middleRejected = purchase.middle_manager_status === 'rejected';
          const finalRejected = purchase.final_manager_status === 'rejected';
          
          if (middleRejected || finalRejected) return false;
          
          // 승인 완료된 경우 즉시 제거
          const middleApproved = purchase.middle_manager_status === 'approved';
          const finalApproved = purchase.final_manager_status === 'approved';
          
          if (middleApproved && finalApproved) {
            return false; // 최종 승인 완료된 항목은 즉시 제거
          }
          
          // 중간승인 대기 또는 최종승인 대기
          matches = middlePending || finalPending;
          
          return matches;
          
        case 'purchase': {
          // DB 확인 결과: '구매 요청' (띄어쓰기 있음) 또는 '발주'
          const isRequest = purchase.payment_category === '구매 요청';
          const isSeonJin = (purchase.progress_type || '').includes('선진행');
          const isIlban = (purchase.progress_type || '').includes('일반');
          const finalApproved = purchase.final_manager_status === 'approved';
          
          // 구매 완료된 경우 즉시 제거
          if (purchase.is_payment_completed) {
            return false; // 구매완료된 항목은 즉시 제거
          }
          
          // 기본 구매현황 조건: 요청 유형이고 아직 결제되지 않음
          if (!isRequest) {
            matches = false;
          } else {
            matches = (isSeonJin) || (isIlban && finalApproved);
          }
          
          return matches;
        }
        
        case 'receipt': {
          // 입고현황: 미입고 & (선진행 or 최종승인)
          const isSeonJin = (purchase.progress_type || '').includes('선진행');
          const finalApproved = purchase.final_manager_status === 'approved';
          
          // 입고 완료된 경우 즉시 제거
          if (purchase.is_received) {
            return false; // 입고완료된 항목은 즉시 제거
          }
          
          // 기본 입고현황 조건: (선진행 or 최종승인)
          matches = (isSeonJin || finalApproved);
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
  }, [visiblePurchases, activeTab]);

  // 3단계: 직원 필터링 (최적화 적용)
  const employeeFilteredPurchases = useMemo(() => {
    const cacheKey = `employee_${tabFilteredPurchases.length}_${selectedEmployee}`;
    if (filterCache.has(cacheKey)) {
      return filterCache.get(cacheKey);
    }
    
    let result;
    if (selectedEmployee && selectedEmployee !== 'all' && selectedEmployee !== '전체') {
      result = tabFilteredPurchases.filter((purchase: Purchase) => purchase.requester_name === selectedEmployee);
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

  // 4단계: 업체 필터링 (업체 선택시만 실행)
  const vendorFilteredPurchases = useMemo(() => {
    if (!vendorFilter) {
      return employeeFilteredPurchases;
    }
    return employeeFilteredPurchases.filter((purchase: Purchase) => purchase.vendor_name === vendorFilter);
  }, [employeeFilteredPurchases, vendorFilter]);

  // 5단계: 추가 필터 적용
  const additionalFilteredPurchases = useMemo(() => {
    let filtered = vendorFilteredPurchases;
    
    // 발주요청번호 필터
    if (purchaseNumberFilter) {
      const term = purchaseNumberFilter.trim().toLowerCase();
      filtered = filtered.filter((p: Purchase) => p.purchase_order_number?.toLowerCase().includes(term));
    }
    
    // 품명 필터
    if (itemNameFilter) {
      const term = itemNameFilter.trim().toLowerCase();
      filtered = filtered.filter((p: Purchase) => {
        if (p.items && p.items.length > 0) {
          return p.items.some((item: any) => item.item_name?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    // 규격 필터
    if (specificationFilter) {
      const term = specificationFilter.trim().toLowerCase();
      filtered = filtered.filter((p: Purchase) => {
        if (p.items && p.items.length > 0) {
          return p.items.some((item: any) => item.specification?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    // 승인상태 필터
    if (approvalStatusFilter && approvalStatusFilter !== 'all') {
      filtered = filtered.filter((p: Purchase) => {
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
      filtered = filtered.filter((p: Purchase) => {
        if (p.items && p.items.length > 0) {
          return p.items.some((item: any) => item.remark?.toLowerCase().includes(term));
        }
        return false;
      });
    }
    
    return filtered;
  }, [vendorFilteredPurchases, purchaseNumberFilter, itemNameFilter, specificationFilter, approvalStatusFilter, remarkFilter]);

  // 6단계: 검색 필터링 (검색어 변경시만 실행)
  const searchFilteredPurchases = useMemo(() => {
    if (!debouncedSearchTerm) {
      return additionalFilteredPurchases;
    }
    
    const term = debouncedSearchTerm.trim().toLowerCase();
    
    return additionalFilteredPurchases.filter((purchase: Purchase) => {
      // 빠른 검색 (기본 필드만)
      if (purchase.purchase_order_number?.toLowerCase().includes(term) ||
          purchase.vendor_name?.toLowerCase().includes(term) ||
          purchase.requester_name?.toLowerCase().includes(term) ||
          purchase.project_vendor?.toLowerCase().includes(term)) {
        return true;
      }
      
      // 품목 검색 (필요할 때만)
      if (purchase.items && purchase.items.length > 0) {
        return purchase.items.some((item: any) => 
          (item.item_name && item.item_name.toLowerCase().includes(term)) ||
          (item.specification && item.specification.toLowerCase().includes(term))
        );
      }
      
      return false;
    });
  }, [additionalFilteredPurchases, debouncedSearchTerm]);

  // 7단계: 최종 정렬 및 결과 캐싱 - 최신순 (내림차순)
  const filteredPurchases = useMemo(() => {
    // 결과 캐시 키 생성
    const resultKey = `final_${searchFilteredPurchases.length}_${activeTab}_${Date.now()}`;
    
    // 최근 결과 캐시 확인 (15초 내)
    const now = Date.now();
    for (const [key, value] of resultCache.entries()) {
      if (key.includes(`${searchFilteredPurchases.length}_${activeTab}`) && 
          (now - value.timestamp) < RESULT_CACHE_DURATION) {
        return value.data;
      }
    }
    
    // 새로 계산
    const result = [...searchFilteredPurchases].sort((a, b) => {
      // request_date를 기준으로 내림차순 정렬 (최신이 위로)
      const dateA = a.request_date ? new Date(a.request_date).getTime() : 0;
      const dateB = b.request_date ? new Date(b.request_date).getTime() : 0;
      return dateB - dateA;
    });
    
    // 결과 캐시 저장
    resultCache.set(resultKey, { data: result, timestamp: now });
    
    // 결과 캐시 크기 제한
    if (resultCache.size > 10) {
      const oldestKey = resultCache.keys().next().value;
      resultCache.delete(oldestKey);
    }
    
    return result;
  }, [searchFilteredPurchases, activeTab]);

  // 탭 카운트 (hanslwebapp과 동일한 조건)
  const tabCounts = useMemo(() => {
    // 특정 직원 발주요청 숨김 처리
    const countPurchases = visiblePurchases;
    
    // 날짜 필터 제거 - 전체 데이터 사용
    const dateFilteredForCount = countPurchases;
    
    // 각 탭의 고유 발주요청번호 카운트 (중복 제거)
    const getUniqueOrderCount = (filtered: Purchase[]) => {
      return new Set(filtered.map(p => p.purchase_order_number)).size;
    };
    
    // 각 탭별로 기본 직원 필터 계산 (카운트용)
    const getFilteredDataForTab = (tabKey: string) => {
      // 구매현황 탭은 특별 처리
      if (tabKey === 'purchase') {
        if (isLeadBuyer || isAdmin) {
          return countPurchases;
        } else {
          return countPurchases.filter((p: Purchase) => p.requester_name === currentUserName);
        }
      }
      
      const defaultEmployee = computeDefaultEmployee(tabKey);
      
      if (defaultEmployee === 'all' || defaultEmployee === '전체') {
        return countPurchases;
      } else {
        return countPurchases.filter((p: Purchase) => p.requester_name === defaultEmployee);
      }
    };
    
    // 각 탭별 데이터 필터링
    const pendingData = getFilteredDataForTab('pending');
    const purchaseData = getFilteredDataForTab('purchase');
    const receiptData = getFilteredDataForTab('receipt');
    const doneData = getFilteredDataForTab('done');
    
    const pendingFiltered = pendingData.filter((p: Purchase) => {
      // 오늘 날짜
      const today = new Date().toISOString().split('T')[0];
      
      // 중간승인자나 최종승인자 중 하나라도 pending이면 승인대기
      const middlePending = ['pending', '대기', '', null, undefined].includes(p.middle_manager_status as any);
      const finalPending = ['pending', '대기', '', null, undefined].includes(p.final_manager_status as any);
      
      // 반려된 경우는 제외
      const middleRejected = p.middle_manager_status === 'rejected';
      const finalRejected = p.final_manager_status === 'rejected';
      
      if (middleRejected || finalRejected) return false;
      
      // 승인 완료된 경우 즉시 제거
      const middleApproved = p.middle_manager_status === 'approved';
      const finalApproved = p.final_manager_status === 'approved';
      
      if (middleApproved && finalApproved) {
        return false; // 최종 승인 완료된 항목은 즉시 제거
      }
      
      // 중간승인 대기 또는 최종승인 대기
      return middlePending || finalPending;
    });
    
    const purchaseFiltered = purchaseData.filter((p: Purchase) => {
      // 오늘 날짜
      const today = new Date().toISOString().split('T')[0];
      
      const isRequest = p.payment_category === '구매 요청';
      const isSeonJin = (p.progress_type || '').includes('선진행');
      const isIlban = (p.progress_type || '').includes('일반');
      const finalApproved = p.final_manager_status === 'approved';
      
      // 구매 완료된 경우 즉시 제거
      if (p.is_payment_completed) {
        return false; // 구매완료된 항목은 즉시 제거
      }
      
      if (!isRequest) return false;
      return (isSeonJin) || (isIlban && finalApproved);
    });
    
    const receiptFiltered = receiptData.filter((p: Purchase) => {
      // 오늘 날짜
      const today = new Date().toISOString().split('T')[0];
      
      const isSeonJin = (p.progress_type || '').includes('선진행');
      const finalApproved = p.final_manager_status === 'approved';
      
      // 입고 완료된 경우 즉시 제거
      if (p.is_received) {
        return false; // 입고완료된 항목은 즉시 제거
      }
      
      return (isSeonJin || finalApproved);
    });
    
    const counts = {
      pending: getUniqueOrderCount(pendingFiltered),
      purchase: getUniqueOrderCount(purchaseFiltered),
      receipt: getUniqueOrderCount(receiptFiltered),
      done: getUniqueOrderCount(doneData)  // 전체 항목
    };
    
    return counts;
  }, [visiblePurchases, roleCase, currentUserName, computeDefaultEmployee, isLeadBuyer, isAdmin]);


  return {
    // States
    activeTab,
    searchTerm,
    vendorFilter,
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