import { useState, useMemo, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Purchase } from './usePurchaseData';

// 상수 정의 - 특정 직원의 발주요청 숨김 (본인이 아닌 경우에만)
const HIDDEN_EMPLOYEES = ['정희웅'];  // 정현웅 제거

export const useFastPurchaseFilters = (purchases: Purchase[], currentUserRoles: string[], currentUserName: string, currentUserId?: string, currentUserEmail?: string) => {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState('pending');
  // 초기값 설정 - hanslwebapp과 동일하게 빈 문자열로 시작
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');

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
                      
  // HR 권한 체크 추가
  const isHr = currentUserRoles?.includes('hr');

  // hanslwebapp과 동일한 로직 - roleCase 계산 (lead buyer 추가)
  const roleCase = useMemo(() => {
    if (!currentUserRoles || currentUserRoles.length === 0) return 1; // null
    if (isPurchaseManager) return 2; // purchase_manager
    if (currentUserRoles.some(r => ['middle_manager', 'final_approver', 'app_admin', 'ceo'].includes(r))) return 3;
    return 1;
  }, [currentUserRoles, isPurchaseManager]);
  
  // 탭별 기본 직원 필터 계산 (구매현황, 입고현황은 lead buyer, HR, app_admin만 전체 보기)
  const computeDefaultEmployee = useCallback(
    (tabKey: string): string => {
      if (!currentUserName) return 'all';
      
      // 구매현황 탭은 lead buyer, HR, app_admin만 전체 보기
      if (tabKey === 'purchase') {
        if (isLeadBuyer || isHr || isAdmin) {
          return 'all';
        }
        return currentUserName;
      }
      
      // 입고현황 탭은 lead buyer, HR, app_admin만 전체 보기
      if (tabKey === 'receipt') {
        if (isLeadBuyer || isHr || isAdmin) {
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
    [currentUserName, roleCase, isLeadBuyer, isHr, isAdmin]
  );
  
  // 탭 변경 또는 사용자/역할 로딩 시 기본값 설정 (hanslwebapp과 동일)
  useEffect(() => {
    if (!currentUserName) return;
    const defaultEmployee = computeDefaultEmployee(activeTab);
    setSelectedEmployee(defaultEmployee);
  }, [activeTab, currentUserName, roleCase, computeDefaultEmployee]);
  
  // 1단계: 권한별 필터링 (실시간 반영)
  const visiblePurchases = useMemo(() => {
    // 권한 체크 최적화 - 한 번만 계산
    const hasManagerRole = currentUserRoles.includes('purchase_manager') || currentUserRoles.includes('app_admin');
    
    const result = hasManagerRole 
      ? purchases 
      : purchases.filter(p => !HIDDEN_EMPLOYEES.includes(p.requester_name));
    return result;
  }, [purchases, currentUserRoles]);


  // 2단계: 탭별 필터링
  const tabFilteredPurchases = useMemo(() => {
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
    return result;
  }, [visiblePurchases, activeTab]);

  // 3단계: 직원 필터링
  const employeeFilteredPurchases = useMemo(() => {
    let result;
    if (selectedEmployee && selectedEmployee !== 'all' && selectedEmployee !== '전체') {
      result = tabFilteredPurchases.filter((purchase: Purchase) => purchase.requester_name === selectedEmployee);
    } else {
      result = tabFilteredPurchases;
    }
    return result;
  }, [tabFilteredPurchases, selectedEmployee]);

  // 4단계: 최종 정렬 및 결과 캐싱 - 최신순 (내림차순)
  const filteredPurchases = useMemo(() => {
    return [...employeeFilteredPurchases].sort((a, b) => {
      const dateA = a.request_date ? new Date(a.request_date).getTime() : 0
      const dateB = b.request_date ? new Date(b.request_date).getTime() : 0
      return dateB - dateA
    })
  }, [employeeFilteredPurchases]);

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
        if (isLeadBuyer || isHr || isAdmin) {
          return countPurchases;
        } else {
          return countPurchases.filter((p: Purchase) => p.requester_name === currentUserName);
        }
      }
      
      // 입고현황 탭은 특별 처리
      if (tabKey === 'receipt') {
        if (isLeadBuyer || isHr || isAdmin) {
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
  }, [visiblePurchases, roleCase, currentUserName, computeDefaultEmployee, isLeadBuyer, isHr, isAdmin]);


  return {
    // States
    activeTab,
    selectedEmployee,
    
    // Setters
    setActiveTab,
    setSelectedEmployee,
    
    // Computed values
    filteredPurchases,
    tabCounts
  };
};