
import { useState, lazy, Suspense, useEffect, useCallback, useMemo, useTransition } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePurchaseMemory } from "@/hooks/usePurchaseMemory";
import { useColumnSettings } from "@/hooks/useColumnSettings";
import ColumnSettingsDropdown from "@/components/purchase/ColumnSettingsDropdown";
import FastPurchaseTable from "@/components/purchase/FastPurchaseTable";
import FilterToolbar, { FilterRule, SortRule } from "@/components/purchase/FilterToolbar";
import { updatePurchaseInMemory, loadAllPurchaseData } from "@/services/purchaseDataLoader";
import { markPurchaseAsPaymentCompleted, markPurchaseAsReceived, isCacheValid, purchaseMemoryCache } from '@/stores/purchaseMemoryStore';

import { Package, Info } from "lucide-react";
import { downloadPurchaseOrderExcel } from '@/utils/excelDownload';

// Lazy load modal for better performance
const PurchaseItemsModal = lazy(() => import("@/components/purchase/PurchaseItemsModal"));
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Purchase } from "@/types/purchase";
import { hasManagerRole, getRoleCase, filterByEmployeeVisibility } from "@/utils/roleHelper";
import { filterByEmployee, sortPurchases, calculateTabCounts } from "@/utils/purchaseFilters";
import { logger } from "@/lib/logger";

interface PurchaseListMainProps {
  showEmailButton?: boolean;
}

// 화면 상단의 탭(진행상태별) 목록
const NAV_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: '승인대기' },
  { key: 'purchase', label: '구매 현황' },
  { key: 'receipt', label: '입고 현황' },
  { key: 'done', label: '전체 항목' },
];

// 발주 목록 메인 컴포넌트
export default function PurchaseListMain({ showEmailButton = true }: PurchaseListMainProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const supabase = createClient();
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 고급 필터 상태 관리
  const [activeFilters, setActiveFilters] = useState<FilterRule[]>([]);
  const [sortConfig, setSortConfig] = useState<SortRule | null>({
    field: 'created_at',
    direction: 'desc',
    label: '생성일'
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [availableEmployees, setAvailableEmployees] = useState<string[]>([]);
  const [availableVendors, setAvailableVendors] = useState<string[]>([]);
  const [availableContacts, setAvailableContacts] = useState<string[]>([]);
  const [availablePaymentSchedules, setAvailablePaymentSchedules] = useState<string[]>([]);
  
  // 발주 데이터 및 사용자 정보
  const {
    allPurchases: purchases,
    loading,
    currentUser,
    getFilteredPurchases,
    tabCounts
  } = usePurchaseMemory();
  
  // 칼럼 가시성 설정
  const { columnVisibility, isLoading: isColumnLoading, applyColumnSettings, resetToDefault } = useColumnSettings();
  
  // 숨겨진 칼럼이 있는지 확인
  const hasHiddenColumns = useMemo(() => {
    if (!columnVisibility) return false;
    return Object.values(columnVisibility).some(visible => !visible);
  }, [columnVisibility]);
  
  // 디버깅용 로그
  useEffect(() => {
    logger.info('[PurchaseListMain] columnVisibility 상태', { columnVisibility });
  }, [columnVisibility]);
  
  const currentUserRoles = Array.isArray(currentUser?.purchase_role) 
    ? currentUser.purchase_role.map((r: string) => r.trim())
    : typeof currentUser?.purchase_role === 'string' 
    ? currentUser.purchase_role.split(',').map((r: string) => r.trim())
    : [];
  
  const currentUserName = currentUser?.name || null;
  
  // 강제 리렌더링을 위한 더미 상태
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  
  // 탭 카운트를 별도 state로 관리하여 0으로 리셋되는 것 방지
  const [cachedTabCounts, setCachedTabCounts] = useState({ 
    pending: 0, 
    purchase: 0, 
    receipt: 0, 
    done: 0 
  })
  
  // 메모리 캐시 기반 강제 새로고침
  const loadPurchases = useCallback(async () => {
    logger.debug('🔄 [loadPurchases] 강제 새로고침 트리거')
    setRefreshTrigger(prev => prev + 1)
  }, []);
  
  // Optimistic Update: 메모리 캐시 즉시 업데이트
  const updatePurchaseOptimistic = useCallback((purchaseId: number, updater: (prev: Purchase) => Purchase) => {
    updatePurchaseInMemory(purchaseId, updater)
  }, []);
  
  const isAdmin = currentUserRoles?.includes('app_admin');
  
  // roleCase 계산 (탭별 기본 직원 필터용) - 먼저 정의
  const roleCase = useMemo(() => getRoleCase(currentUserRoles), [currentUserRoles]);

  // 탭별 기본 직원 필터 계산 - 미리 계산하여 성능 최적화
  const defaultEmployeeByTab = useMemo(() => {
    // currentUserName이 없으면 기본값 반환
    if (!currentUserName) {
      logger.warn('[defaultEmployeeByTab] currentUserName이 없음', {
        currentUser,
        currentUserRoles
      });
      return { pending: 'all', purchase: 'all', receipt: 'all', done: 'all' };
    }
    
    // 관리자 권한 체크
    const hasHrRole = currentUserRoles.includes('hr');
    const hasPurchaseManagerRole = currentUserRoles.includes('purchase_manager');
    const hasManagerRole = currentUserRoles.some((role: string) => 
      ['app_admin', 'ceo', 'lead buyer', 'finance_team', 'raw_material_manager', 'consumable_manager', 'purchase_manager', 'hr'].includes(role)
    );
    
    const result = {
      pending: roleCase === 3 ? 'all' : currentUserName,
      purchase: hasManagerRole ? 'all' : (roleCase === 3 ? 'all' : currentUserName),
      receipt: (hasHrRole || hasPurchaseManagerRole) ? 'all' : (roleCase === 3 ? 'all' : currentUserName),
      done: 'all' // 전체 항목 탭은 항상 모든 항목 표시
    };
    
    logger.info('[defaultEmployeeByTab 계산 결과]', {
      currentUserName,
      roleCase,
      currentUserRoles,
      hasManagerRole,
      result
    });
    
    return result;
  }, [currentUserName, roleCase, currentUserRoles]);

  // URL에서 초기 탭 확인
  const getInitialTab = () => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab && ['pending', 'purchase', 'receipt', 'done'].includes(tab)) {
      return tab;
    }
    return 'pending';
  };

  // 탭 상태 관리 - 초기값 설정
  const initialTab = getInitialTab();
  const [activeTab, setActiveTab] = useState(initialTab);
  // selectedEmployee 초기값을 안전하게 설정
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [isPending, startTransition] = useTransition();

  // 권한별 필터링된 데이터 (메모리 캐시에서 가져옴)
  const visiblePurchases = useMemo(() => {
    return filterByEmployeeVisibility(purchases, currentUserRoles);
  }, [purchases, currentUserRoles]);


  // 초기 selectedEmployee 설정 (defaultEmployeeByTab이 계산된 후)
  useEffect(() => {
    if (defaultEmployeeByTab && currentUserName !== null) {
      const initialEmployeeValue = defaultEmployeeByTab[activeTab as keyof typeof defaultEmployeeByTab];
      if (initialEmployeeValue !== undefined) {
        setSelectedEmployee(initialEmployeeValue);
        logger.info('[초기 selectedEmployee 설정]', {
          activeTab,
          initialEmployeeValue,
          defaultEmployeeByTab
        });
      }
    }
  }, []); // 최초 마운트 시에만 실행

  // URL 쿼리 파라미터 변경 시 처리
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab && ['pending', 'purchase', 'receipt', 'done'].includes(tab)) {
      setActiveTab(tab);
      // 탭에 맞는 기본 직원 필터 설정 (미리 계산된 값 사용)
      setSelectedEmployee(defaultEmployeeByTab[tab as keyof typeof defaultEmployeeByTab] || 'all');
    }
  }, [location.search, defaultEmployeeByTab]);

  // 캐시 상태 확인 및 필요시 데이터 새로고침
  useEffect(() => {
    const checkAndRefreshCache = async () => {
      // 캐시가 무효화되었거나 데이터가 없는 경우 새로고침
      if (!isCacheValid() || !purchaseMemoryCache.allPurchases) {
        logger.info('🔄 [PurchaseListMain] 캐시 무효화 감지, 데이터 새로고침 중...', {
          isCacheValid: isCacheValid(),
          hasData: !!purchaseMemoryCache.allPurchases,
          lastFetch: purchaseMemoryCache.lastFetch
        });
        
        try {
          await loadAllPurchaseData(currentUser?.id);
          logger.info('✅ [PurchaseListMain] 데이터 새로고침 완료');
        } catch (error) {
          logger.error('❌ [PurchaseListMain] 데이터 새로고침 실패:', error);
        }
      }
    };
    
    checkAndRefreshCache();
  }, [currentUser?.id]); // currentUser가 변경될 때마다 체크

  // 필터 옵션 데이터 로드
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        // 요청자 목록 (employees 테이블)
        const { data: employees } = await supabase
          .from('employees')
          .select('name');
        
        if (employees) {
          const employeeNames = [...new Set(employees.map((e: any) => e.name).filter(Boolean))];
          setAvailableEmployees(employeeNames as string[]);
        }

        // 업체 목록 (vendors 테이블)
        const { data: vendors } = await supabase
          .from('vendors')
          .select('vendor_name');
        
        if (vendors) {
          const vendorNames = [...new Set(vendors.map((v: any) => v.vendor_name).filter(Boolean))];
          setAvailableVendors(vendorNames as string[]);
        }

        // 담당자 목록 (vendor_contacts 테이블)
        const { data: contacts } = await supabase
          .from('vendor_contacts')
          .select('contact_name');
        
        if (contacts) {
          const contactNames = [...new Set(contacts.map((c: any) => c.contact_name).filter(Boolean))];
          setAvailableContacts(contactNames as string[]);
        }

        // 지출예정일 목록 (vendors 테이블의 vendor_payment_schedule)
        const { data: schedules } = await supabase
          .from('vendors')
          .select('vendor_payment_schedule');
        
        if (schedules) {
          const scheduleNames = [...new Set(schedules.map((s: any) => s.vendor_payment_schedule).filter(Boolean))];
          setAvailablePaymentSchedules(scheduleNames as string[]);
        }
      } catch (error) {
        logger.error('필터 옵션 데이터 로드 실패', error);
      }
    };

    loadFilterOptions();
  }, [supabase]);


  // 상태에 따른 배지 생성 - 메모이제이션 적용
  const getStatusBadge = useCallback((purchase: Purchase) => {
    if (purchase.is_received) {
      return <span className="badge-stats bg-green-500 text-white">입고완료</span>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <span className="badge-stats bg-blue-500 text-white">구매진행</span>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <span className="badge-stats bg-red-500 text-white">반려</span>;
    } else {
      return <span className="badge-stats bg-yellow-500 text-white">승인대기</span>;
    }
  }, []);

  // 입고 현황 계산 
  const getReceiptProgress = (purchase: Purchase) => {
    if (!purchase.purchase_request_items || purchase.purchase_request_items.length === 0) {
      return { received: 0, total: 0, percentage: 0 };
    }
    
    const total = purchase.purchase_request_items.length;
    const received = purchase.purchase_request_items.filter((item: any) => 
      item.is_received === true
    ).length;
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    
    return { received, total, percentage };
  };
  
  // 구매 진행 상태 계산
  const getPurchaseProgress = (purchase: Purchase) => {
    if (!purchase.purchase_request_items || purchase.purchase_request_items.length === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }
    
    const total = purchase.purchase_request_items.length;
    const completed = purchase.purchase_request_items.filter((item: any) => 
      item.is_payment_completed === true
    ).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return { completed, total, percentage };
  };

  // 선진행 체크 함수
  const isAdvancePayment = (progress_type?: string) => {
    return progress_type === '선진행' || progress_type?.trim() === '선진행' || progress_type?.includes('선진행');
  };

  // 필드 값 추출 함수 - useCallback으로 최적화
  const getFieldValue = useCallback((purchase: Purchase, field: string): any => {
    switch (field) {
      case 'purchase_order_number':
        return purchase.purchase_order_number;
      case 'payment_category':
        return purchase.payment_category;
      case 'requester_name':
        return purchase.requester_name;
      case 'vendor_name':
        return purchase.vendor_name;
      case 'contact_name':
        // vendor_contacts JOIN 필요 - 현재는 빈 값 반환
        return '-'; // vendor_contacts JOIN 필요
      case 'item_name':
        return purchase.purchase_request_items?.[0]?.item_name || '';
      case 'specification':
        return purchase.purchase_request_items?.[0]?.specification || '';
      case 'quantity':
        return purchase.purchase_request_items?.[0]?.quantity || 0;
      case 'unit_price_value':
        return purchase.purchase_request_items?.[0]?.unit_price_value || 0;
      case 'total_amount':
        return purchase.total_amount;
      case 'remark':
        return purchase.purchase_request_items?.[0]?.remark || '';
      case 'project_vendor':
        return purchase.project_vendor;
      case 'project_item':
        return purchase.project_item;
      case 'sales_order_number':
        return purchase.sales_order_number;
      case 'payment_schedule':
        // vendor_payment_schedule은 vendors 테이블에 있음 - JOIN 필요
        return '-';
      case 'is_payment_completed':
        // 전체 구매 완료 상태
        return purchase.is_payment_completed ? '완료' : '대기';
      case 'is_received':
        // 전체 입고 완료 상태
        return purchase.is_received ? '완료' : '대기';
      case 'is_statement_received':
        return purchase.is_statement_received ? '완료' : '대기';
      case 'is_utk_checked':
        return purchase.is_utk_checked ? '완료' : '대기';
      case 'request_date':
        return purchase.request_date;
      case 'delivery_request_date':
        return purchase.delivery_request_date;
      case 'payment_completed_at':
        return purchase.payment_completed_at;
      case 'received_at':
        return purchase.received_at;
      case 'created_at':
        return purchase.created_at;
      case 'statement_received_at':
        return purchase.purchase_request_items?.[0]?.statement_received_date || null;
      default:
        return null;
    }
  }, []);

  // 필터 조건 적용 함수 - useCallback으로 최적화
  const applyFilterCondition = useCallback((fieldValue: any, condition: string, filterValue: any, filterField?: string): boolean => {
    if (fieldValue === null || fieldValue === undefined) {
      return condition === 'is_empty';
    }

    // 날짜 범위 필터 특별 처리 (시작일~종료일)
    if (filterField === 'date_range' && filterValue && typeof filterValue === 'string' && filterValue.includes('~')) {
      if (!fieldValue) return false;
      
      const [startDate, endDate] = filterValue.split('~');
      const fieldDate = new Date(fieldValue);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // 시작일과 종료일 포함하여 범위 내에 있는지 확인
      return fieldDate >= start && fieldDate <= end;
    }

    // 월별 범위 필터 특별 처리 (시작월~종료월)
    if (filterField === 'date_month' && filterValue && typeof filterValue === 'string' && filterValue.includes('~')) {
      if (!fieldValue) return false;
      
      const [startMonth, endMonth] = filterValue.split('~');
      const fieldDate = new Date(fieldValue);
      const start = new Date(`${startMonth}-01`);
      const end = new Date(`${endMonth}-01`);
      
      // 월 범위 비교 (해당 월의 마지막 날까지 포함)
      const endOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59);
      return fieldDate >= start && fieldDate <= endOfMonth;
    }

    // 월별 필터 특별 처리 (단일 월)
    if (filterField && (filterField === 'date_month' || filterField.endsWith('_month'))) {
      if (!filterValue) return true;
      
      const fieldDate = new Date(fieldValue);
      const [filterYear, filterMonth] = filterValue.split('-');
      
      return fieldDate.getFullYear() === parseInt(filterYear) && 
             (fieldDate.getMonth() + 1) === parseInt(filterMonth);
    }

    const fieldStr = String(fieldValue).toLowerCase();
    const filterStr = String(filterValue).toLowerCase();

    switch (condition) {
      case 'contains':
        return fieldStr.includes(filterStr);
      case 'equals':
        // 날짜 필드의 경우 정확한 날짜 비교
        if (filterField === 'date_range' || filterValue.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/)) {
          if (!fieldValue) return false;
          try {
            const fieldDate = new Date(fieldValue).toISOString().split('T')[0];
            const filterDate = filterValue.split('T')[0];
            return fieldDate === filterDate;
          } catch (error) {
            logger.error('날짜 비교 오류:', error);
            return false;
          }
        }
        return fieldStr === filterStr;
      case 'starts_with':
        return fieldStr.startsWith(filterStr);
      case 'ends_with':
        return fieldStr.endsWith(filterStr);
      case 'is_empty':
        return !fieldValue || fieldStr.trim() === '';
      case 'is_not_empty':
        return !!fieldValue && fieldStr.trim() !== '';
      case 'greater_than':
        return Number(fieldValue) > Number(filterValue);
      case 'less_than':
        return Number(fieldValue) < Number(filterValue);
      case 'between':
        // 범위 필터는 추후 구현
        return true;
      case 'after':
        return new Date(fieldValue) > new Date(filterValue);
      case 'before':
        return new Date(fieldValue) < new Date(filterValue);
      case 'not_equals':
        return fieldStr !== filterStr;
      default:
        return true;
    }
  }, []);


  // 메모리 기반 필터링
  const baseFilteredPurchases = useMemo(() => {
    const employeeName = selectedEmployee === 'all' || selectedEmployee === '전체' ? null : selectedEmployee;
    
    return getFilteredPurchases({
      tab: activeTab as any,
      employeeName,
      searchTerm,
      advancedFilters: activeFilters,
      sortConfig: sortConfig ? { key: sortConfig.field, direction: sortConfig.direction } : undefined
    });
  }, [getFilteredPurchases, activeTab, selectedEmployee, searchTerm, activeFilters, sortConfig, purchases]);

  
  // 메모리 기반 필터링으로 이미 모든 필터 적용됨 
  const tabFilteredPurchases = baseFilteredPurchases;


  // 탭별 카운트 계산 및 캐싱
  useEffect(() => {
    // 데이터가 있을 때만 탭 카운트 업데이트
    if (purchases && purchases.length > 0) {
      const newCounts = calculateTabCounts(purchases, currentUser);
      setCachedTabCounts(newCounts);
    } else if (purchaseMemoryCache.allPurchases && purchaseMemoryCache.allPurchases.length > 0) {
      // 로컬 state가 비어있으면 캐시에서 직접 계산
      const newCounts = calculateTabCounts(purchaseMemoryCache.allPurchases, currentUser);
      setCachedTabCounts(newCounts);
    }
  }, [purchases, currentUser]);

  // 표시할 탭 카운트 (캐시된 값 사용)
  const filteredTabCounts = cachedTabCounts;

  // 검색어 또는 고급필터가 적용된 경우 각 탭별 카운트 계산
  const filteredTabCountsWithSearch = useMemo(() => {
    // 검색어나 고급필터가 없으면 기본 카운트 사용
    if (!searchTerm && activeFilters.length === 0) {
      return filteredTabCounts;
    }

    // 각 탭별로 필터링된 카운트 계산
    const counts = {
      pending: 0,
      purchase: 0,
      receipt: 0,
      done: 0
    };

    // 각 탭에 대해 필터링 적용하여 카운트 계산
    const tabs: Array<keyof typeof counts> = ['pending', 'purchase', 'receipt', 'done'];
    tabs.forEach(tab => {
      const filtered = getFilteredPurchases({
        tab,
        employeeName: defaultEmployeeByTab[tab] === 'all' ? null : defaultEmployeeByTab[tab],
        searchTerm,
        advancedFilters: activeFilters,
        sortConfig: sortConfig ? { key: sortConfig.field, direction: sortConfig.direction } : undefined
      });
      counts[tab] = filtered.length;
    });

    return counts;
  }, [searchTerm, activeFilters, filteredTabCounts, getFilteredPurchases, defaultEmployeeByTab, sortConfig]);

  // 탭 배지 텍스트 결정 함수
  const getTabBadgeText = useCallback((tabKey: string) => {
    // 검색어나 고급필터가 있는 경우 필터된 카운트 사용
    if (searchTerm || activeFilters.length > 0) {
      return filteredTabCountsWithSearch[tabKey as keyof typeof filteredTabCountsWithSearch].toString();
    }
    
    // 전체항목 탭에 대한 특별 처리 (검색어/필터 없을 때)
    if (tabKey === 'done') {
      return "전체";
    }
    
    // 다른 탭들은 기본 카운트 사용
    return filteredTabCounts[tabKey as keyof typeof filteredTabCounts].toString();
  }, [searchTerm, activeFilters.length, filteredTabCountsWithSearch, filteredTabCounts]);


  // 월간 필터 감지 및 합계금액 계산
  const monthlyFilterSummary = useMemo(() => {
    // 월간 필터가 활성화되어 있는지 확인
    const monthFilters = activeFilters.filter(filter => 
      filter.field === 'date_month' || 
      (filter.field === 'date_range' && filter.dateField && filter.dateField.includes('_month'))
    );
    
    if (monthFilters.length === 0) return null;
    
    // 필터에 나오는 모든 항목의 합계 계산
    const totalFilteredAmount = tabFilteredPurchases.reduce((sum, purchase) => {
      if (purchase.purchase_request_items?.length) {
        const itemsTotal = purchase.purchase_request_items.reduce((itemSum: number, item: any) => {
          // 발주 카테고리인 경우 세액도 포함
          const baseAmount = item.amount_value || 0;
          const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0;
          return itemSum + baseAmount + taxAmount;
        }, 0);
        return sum + itemsTotal;
      }
      // total_amount가 있는 경우, 발주면 세액도 추정 계산
      const baseAmount = purchase.total_amount || 0;
      const taxAmount = (purchase.payment_category === '발주') ? baseAmount * 0.1 : 0;
      return sum + baseAmount + taxAmount;
    }, 0);
    
    const monthFilter = monthFilters[0];
    const filterValue = monthFilter.value;
    
    // 월간 범위 필터인지 단일 월 필터인지 확인
    if (filterValue && typeof filterValue === 'string' && filterValue.includes('~')) {
      // 범위 필터 (예: "2024-04~2024-09")
      const [startMonth, endMonth] = filterValue.split('~');
      const startDate = new Date(`${startMonth}-01`);
      const endDate = new Date(`${endMonth}-01`);
      
      const monthlyTotals = [];
      let totalSum = 0;
      
      // 각 월별 계산
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const monthStr = `${year}-${month.toString().padStart(2, '0')}`;
        
        // 해당 월의 데이터 필터링
        const monthData = tabFilteredPurchases.filter(purchase => {
          const purchaseDate = new Date(purchase.request_date);
          return purchaseDate.getFullYear() === year && 
                 (purchaseDate.getMonth() + 1) === month;
        });
        
        // 해당 월의 합계 계산
        const monthTotal = monthData.reduce((sum, purchase) => {
          // items의 amount_value 합계 또는 total_amount 사용
          if (purchase.purchase_request_items?.length) {
            const itemsTotal = purchase.purchase_request_items.reduce((itemSum: number, item: any) => {
              // 발주 카테고리인 경우 세액도 포함
              const baseAmount = item.amount_value || 0;
              const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0;
              return itemSum + baseAmount + taxAmount;
            }, 0);
            return sum + itemsTotal;
          }
          // total_amount가 있는 경우, 발주면 세액도 추정 계산
          const baseAmount = purchase.total_amount || 0;
          const taxAmount = (purchase.payment_category === '발주') ? baseAmount * 0.1 : 0;
          return sum + baseAmount + taxAmount;
        }, 0);
        
        monthlyTotals.push({
          year,
          month,
          monthStr,
          total: monthTotal,
          count: monthData.length
        });
        
        totalSum += monthTotal;
        
        // 다음 월로 이동
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
      
      return {
        type: 'range',
        months: monthlyTotals,
        grandTotal: totalSum,
        totalFilteredAmount: totalFilteredAmount // 필터에 나오는 모든 항목의 합계
      };
    } else {
      // 단일 월 필터 (예: "2024-10")
      const [year, month] = (typeof filterValue === 'string' ? filterValue : '').split('-');
      const monthData = tabFilteredPurchases.filter(purchase => {
        const purchaseDate = new Date(purchase.request_date);
        return purchaseDate.getFullYear() === parseInt(year) && 
               (purchaseDate.getMonth() + 1) === parseInt(month);
      });
      
      const monthTotal = monthData.reduce((sum, purchase) => {
        // items의 amount_value 합계 또는 total_amount 사용
        if (purchase.purchase_request_items?.length) {
          const itemsTotal = purchase.purchase_request_items.reduce((itemSum: number, item: any) => {
            // 발주 카테고리인 경우 세액도 포함
            const baseAmount = item.amount_value || 0;
            const taxAmount = (purchase.payment_category === '발주' && item.tax_amount_value) ? item.tax_amount_value : 0;
            return itemSum + baseAmount + taxAmount;
          }, 0);
          return sum + itemsTotal;
        }
        // total_amount가 있는 경우, 발주면 세액도 추정 계산
        const baseAmount = purchase.total_amount || 0;
        const taxAmount = (purchase.payment_category === '발주') ? baseAmount * 0.1 : 0;
        return sum + baseAmount + taxAmount;
      }, 0);
      
      return {
        type: 'single',
        year: parseInt(year),
        month: parseInt(month),
        total: monthTotal,
        count: monthData.length,
        totalFilteredAmount: totalFilteredAmount // 필터에 나오는 모든 항목의 합계
      };
    }
  }, [activeFilters, tabFilteredPurchases]);


  // 엑셀 다운로드 - 공통 함수 사용
  const handleExcelDownload = async (purchase: Purchase) => {
    try {
      await downloadPurchaseOrderExcel(
        {
          id: purchase.id,
          purchase_order_number: purchase.purchase_order_number,
          vendor_name: purchase.vendor_name || '',
          vendor_id: purchase.vendor_id?.toString(),
          contact_id: purchase.contact_id?.toString()
        },
        currentUserRoles,
        () => {
          // 성공 콜백: 화면 업데이트
          loadPurchases();
        }
      );
    } catch (error) {
      logger.error('Excel 다운로드 중 오류 발생', error);
    }
  };

  // 최적화된 핸들러들 - 메모이제이션 및 배치 처리
  const handleReceiptComplete = useCallback(async (purchaseId: number) => {
    try {
      const currentTime = new Date().toISOString();
      
      // 병렬 처리로 성능 개선
      const [requestResult, itemsResult] = await Promise.all([
        supabase
          .from('purchase_requests')
          .update({ 
            is_received: true,
            received_at: currentTime
          })
          .eq('id', purchaseId),
        supabase
          .from('purchase_request_items')
          .update({ 
            is_received: true,
            delivery_status: 'received'
          })
          .eq('purchase_request_id', purchaseId)
      ]);

      if (requestResult.error) throw requestResult.error;
      if (itemsResult.error) throw itemsResult.error;
      
      // 🚀 메모리 캐시 즉시 업데이트 (UI 즉시 반영)
      const memoryUpdated = markPurchaseAsReceived(purchaseId);
      if (!memoryUpdated) {
        logger.warn('[PurchaseListMain] 메모리 캐시 입고완료 업데이트 실패', { purchaseId });
      }
      
      toast.success('입고완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }, [supabase, loadPurchases]);

  const handlePaymentComplete = useCallback(async (purchaseId: number) => {
    try {
      const currentTime = new Date().toISOString();
      
      // 병렬 처리로 성능 개선
      const [requestResult, itemsResult] = await Promise.all([
        supabase
          .from('purchase_requests')
          .update({ 
            is_payment_completed: true,
            payment_completed_at: currentTime
          })
          .eq('id', purchaseId),
        supabase
          .from('purchase_request_items')
          .update({ 
            is_payment_completed: true,
            payment_completed_at: currentTime
          })
          .eq('purchase_request_id', purchaseId)
      ]);

      if (requestResult.error) throw requestResult.error;
      if (itemsResult.error) throw itemsResult.error;
      
      // 🚀 메모리 캐시 즉시 업데이트 (UI 즉시 반영)
      const memoryUpdated = markPurchaseAsPaymentCompleted(purchaseId);
      if (!memoryUpdated) {
        logger.warn('[PurchaseListMain] 메모리 캐시 업데이트 실패, 데이터 재로드', { purchaseId });
        await loadPurchases(); // fallback: 메모리 업데이트 실패 시 전체 재로드
      }
      
      toast.success('구매완료 처리되었습니다.');
    } catch (error) {
      logger.error('[PurchaseListMain] 구매완료 처리 실패:', error);
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }, [supabase, loadPurchases]);

  const handleItemsClick = useCallback((purchase: Purchase) => {
    setSelectedPurchase(purchase);
    setIsModalOpen(true);
  }, []);
  
  // 모달 데이터 메모이제이션 - 불필요한 재계산 방지
  const modalPurchaseData = useMemo(() => {
    if (!selectedPurchase) return null;
    return {
      ...selectedPurchase,
      vendor_name: selectedPurchase.vendor_name || '',
      project_vendor: selectedPurchase.project_vendor || '',
      sales_order_number: selectedPurchase.sales_order_number || '',
      project_item: selectedPurchase.project_item || ''
    };
  }, [selectedPurchase]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <div>
          <h1 className="page-title">발주요청 관리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Purchase Management</p>
        </div>
      </div>

      {/* 고급 필터 툴바 - 탭바 위 왼쪽 상단에 여백 추가 */}
      <div className="mb-3">
        <FilterToolbar
          activeFilters={activeFilters}
          sortConfig={sortConfig}
          searchTerm={searchTerm}
          onFiltersChange={setActiveFilters}
          onSortChange={setSortConfig}
          onSearchChange={setSearchTerm}
          availableEmployees={availableEmployees}
          availableVendors={availableVendors}
          availableContacts={availableContacts}
          availablePaymentSchedules={availablePaymentSchedules}
        >
          {/* 칼럼 설정 버튼을 필터 툴바와 같은 행에 배치 */}
          <ColumnSettingsDropdown 
            isVisible={true} 
            columnVisibility={columnVisibility}
            applyColumnSettings={applyColumnSettings}
            resetToDefault={resetToDefault}
            isLoading={isColumnLoading}
            currentUserRoles={currentUserRoles}
          />
        </FilterToolbar>
        
      </div>

      {/* 직접 구현한 탭 (hanslwebapp 방식) - 빠른 성능 */}
      <div className="space-y-3">

        {/* 탭 버튼들 - 모바일 반응형 개선 */}
        <div className="flex flex-col sm:flex-row sm:space-x-1 space-y-1 sm:space-y-0 bg-gray-50 p-1 business-radius-card border border-gray-200">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                logger.info('[탭 클릭 이벤트]', {
                  tab: tab.key,
                  currentActiveTab: activeTab,
                  currentUser: currentUser?.name,
                  currentUserRoles,
                  defaultEmployeeByTab,
                  isPending
                });
                
                // startTransition이 문제일 수 있어 직접 상태 업데이트로 변경
                try {
                  const newEmployeeValue = defaultEmployeeByTab[tab.key as keyof typeof defaultEmployeeByTab];
                  
                  // undefined 체크 추가
                  if (newEmployeeValue === undefined) {
                    logger.error('[탭 전환 오류] defaultEmployeeByTab에서 값을 찾을 수 없음', {
                      tabKey: tab.key,
                      defaultEmployeeByTab,
                      availableKeys: Object.keys(defaultEmployeeByTab)
                    });
                    // 기본값 사용
                    setActiveTab(tab.key);
                    setSelectedEmployee('all');
                  } else {
                    setActiveTab(tab.key);
                    setSelectedEmployee(newEmployeeValue);
                  }
                  
                  logger.info('[탭 전환 성공]', { 
                    newTab: tab.key,
                    newEmployee: newEmployeeValue || 'all',
                    actualNewEmployee: newEmployeeValue
                  });
                } catch (error) {
                  logger.error('[탭 전환 실패]', error);
                }
              }}
              className={`flex-1 flex items-center justify-center space-x-2 py-1.5 px-3 sm:px-4 business-radius-button button-text font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-hansl-600 bg-white shadow-sm border border-gray-200'
                  : 'text-gray-600 bg-transparent hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span className="whitespace-nowrap">{tab.label}</span>
              <span 
                className={
                  `badge-stats ${
                    activeTab === tab.key 
                      ? 'bg-hansl-50 text-hansl-700' 
                      : 'bg-gray-100 text-gray-600'
                  }`
                }
              >
                {getTabBadgeText(tab.key)}
              </span>
            </button>
          ))}
        </div>

        {/* 월간 필터 적용 시 합계금액 표시 */}
        {monthlyFilterSummary && (
          <div className="mb-3">
            {monthlyFilterSummary.type === 'single' ? (
              // 단일 월 표시 - 컴팩트한 인라인 배지 스타일
              <div className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 business-radius-badge px-3 py-2 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                  <span className="card-subtitle text-gray-700">
                    {monthlyFilterSummary.year}년 {monthlyFilterSummary.month}월
                  </span>
                  <span className="badge-text text-gray-500">
                    {monthlyFilterSummary.count}건
                  </span>
                </div>
                <div className="h-4 w-px bg-blue-300"></div>
                <span className="modal-value text-blue-700 font-semibold">
                  ₩{monthlyFilterSummary.totalFilteredAmount?.toLocaleString() || '0'}
                </span>
              </div>
            ) : (
              // 월간 범위 표시
              <Card className="business-radius-card border border-gray-200 shadow-sm">
                <CardHeader className="pb-3 pt-4 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                      <CardTitle className="section-title text-gray-800">월별 발주요청 총액</CardTitle>
                    </div>
                    {/* 총합계를 제목 바로 옆에 표시 */}
                    <div className="flex items-center gap-2">
                      <span className="badge-text text-gray-600">
                        ({monthlyFilterSummary.months?.reduce((sum, m) => sum + m.count, 0) || 0}건)
                      </span>
                      <div className="h-4 w-px bg-gray-300"></div>
                      <span className="modal-value text-gray-500 font-bold">
                        ₩{monthlyFilterSummary.totalFilteredAmount?.toLocaleString() || '0'}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {/* 월별 데이터 - 가로 스크롤 한 행 */}
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {monthlyFilterSummary.months?.map((monthData) => (
                      <div 
                        key={monthData.monthStr} 
                        className="bg-gray-50 business-radius-card px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex-shrink-0"
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="modal-value font-bold text-gray-800 whitespace-nowrap">
                            {monthData.month}월
                          </span>
                          <span className="text-[9px] text-gray-500 whitespace-nowrap">
                            ({monthData.count})
                          </span>
                          <span className="modal-value text-gray-500 font-bold whitespace-nowrap ml-1">
                            ₩{monthData.total.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* 탭 콘텐츠 */}
        <Card className={`overflow-hidden border border-gray-200 ${hasHiddenColumns ? 'w-fit' : ''}`}>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 card-subtitle">로딩 중...</span>
              </div>
            ) : tabFilteredPurchases.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
                <p className="card-subtitle">새로운 발주요청서를 작성해보세요.</p>
              </div>
            ) : (
              <FastPurchaseTable 
                purchases={tabFilteredPurchases} 
                activeTab={activeTab}
                currentUserRoles={currentUserRoles}
                onRefresh={loadPurchases}
                onOptimisticUpdate={updatePurchaseOptimistic}
                onPaymentComplete={handlePaymentComplete}
                onReceiptComplete={handleReceiptComplete}
                columnVisibility={columnVisibility}
              />
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* 세부항목 모달 - 성능 최적화된 데이터 사용 */}
      {modalPurchaseData && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>}>
          <PurchaseItemsModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedPurchase(null);
            }}
            purchase={modalPurchaseData}
            isAdmin={isAdmin || false}
            onUpdate={loadPurchases}
            activeTab={activeTab}
          />
        </Suspense>
      )}
    </div>
  );
}