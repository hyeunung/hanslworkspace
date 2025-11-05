
import { useState, lazy, Suspense, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePurchaseData, clearPurchaseCache } from "@/hooks/usePurchaseData";
import { useFastPurchaseFilters } from "@/hooks/useFastPurchaseFilters";
import LazyPurchaseTable from "@/components/purchase/LazyPurchaseTable";
import FilterToolbar, { FilterRule, SortRule } from "@/components/purchase/FilterToolbar";

import { Plus, Package } from "lucide-react";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";

// Lazy load modal for better performance
const PurchaseItemsModal = lazy(() => import("@/components/purchase/PurchaseItemsModal"));
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Tabs 컴포넌트를 제거하고 직접 구현 (hanslwebapp 방식)
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Purchase } from "@/hooks/usePurchaseData";
import { logger } from "@/lib/logger";

interface PurchaseListMainProps {
  onEmailToggle?: () => void;
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
export default function PurchaseListMain({ onEmailToggle, showEmailButton = true }: PurchaseListMainProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const supabase = createClient();
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 고급 필터 상태 관리
  const [activeFilters, setActiveFilters] = useState<FilterRule[]>([]);
  const [sortConfig, setSortConfig] = useState<SortRule | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [availableEmployees, setAvailableEmployees] = useState<string[]>([]);
  const [availableVendors, setAvailableVendors] = useState<string[]>([]);
  const [availableContacts, setAvailableContacts] = useState<string[]>([]);
  const [availablePaymentSchedules, setAvailablePaymentSchedules] = useState<string[]>([]);
  
  // 발주 데이터 및 사용자 정보
  const {
    purchases,
    loading,
    currentUserRoles,
    currentUserName,
    currentUserEmail,
    currentUserId,
    refreshPurchases: loadPurchases,
    updatePurchaseOptimistic
  } = usePurchaseData();
  
  const isAdmin = currentUserRoles?.includes('app_admin');
  

  // 필터링 및 탭 관리
  const {
    activeTab,
    selectedEmployee,
    setActiveTab,
    setSelectedEmployee,
    filteredPurchases,
    tabCounts
  } = useFastPurchaseFilters(purchases, currentUserRoles, currentUserName, currentUserId, currentUserEmail);
  
  // URL 쿼리 파라미터에서 탭 설정
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab === 'purchase') {
      setActiveTab('purchase');
    }
  }, [location.search, setActiveTab]);

  // 필터 옵션 데이터 로드
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        // 요청자 목록 (employees 테이블)
        const { data: employees } = await supabase
          .from('employees')
          .select('name')
          .not('name', 'is', null);
        
        if (employees) {
          const employeeNames = [...new Set(employees.map((e: any) => e.name).filter(Boolean))];
          setAvailableEmployees(employeeNames as string[]);
        }

        // 업체 목록 (vendors 테이블)
        const { data: vendors } = await supabase
          .from('vendors')
          .select('vendor_name')
          .not('vendor_name', 'is', null);
        
        if (vendors) {
          const vendorNames = [...new Set(vendors.map((v: any) => v.vendor_name).filter(Boolean))];
          setAvailableVendors(vendorNames as string[]);
        }

        // 담당자 목록 (vendor_contacts 테이블)
        const { data: contacts } = await supabase
          .from('vendor_contacts')
          .select('contact_name')
          .not('contact_name', 'is', null);
        
        if (contacts) {
          const contactNames = [...new Set(contacts.map((c: any) => c.contact_name).filter(Boolean))];
          setAvailableContacts(contactNames as string[]);
        }

        // 지출예정일 목록 (vendors 테이블의 payment_schedule)
        const { data: schedules } = await supabase
          .from('vendors')
          .select('payment_schedule')
          .not('payment_schedule', 'is', null);
        
        if (schedules) {
          const scheduleNames = [...new Set(schedules.map((s: any) => s.payment_schedule).filter(Boolean))];
          setAvailablePaymentSchedules(scheduleNames as string[]);
        }
      } catch (error) {
        logger.error('필터 옵션 데이터 로드 실패', error);
      }
    };

    loadFilterOptions();
  }, [supabase]);
  
  // 탭 이동 시 최신 데이터 무음 새로고침
  const hasInitializedTabRefresh = useRef(false);
  useEffect(() => {
    if (!hasInitializedTabRefresh.current) {
      hasInitializedTabRefresh.current = true;
      return;
    }

    const refreshLatestData = async () => {
      try {
        await loadPurchases(true, { silent: true });
      } catch (error) {
        console.error('탭 전환 시 발주 데이터 새로고침 실패', error);
      }
    };

    refreshLatestData();
  }, [activeTab, loadPurchases]);


  // 상태에 따른 배지 생성 - 메모이제이션 적용
  const getStatusBadge = useCallback((purchase: Purchase) => {
    if (purchase.is_received) {
      return <Badge variant={null} className="badge-success">입고완료</Badge>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <Badge variant={null} className="badge-primary">구매진행</Badge>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <Badge variant={null} className="badge-danger">반려</Badge>;
    } else {
      return <Badge variant={null} className="badge-warning">승인대기</Badge>;
    }
  }, []);

  // 입고 현황 계산
  const getReceiptProgress = (purchase: Purchase) => {
    if (!purchase.items || purchase.items.length === 0) return { received: 0, total: 0, percentage: 0 };
    
    const total = purchase.items.length;
    const received = purchase.items.filter(item => 
      item.actual_received_date !== null && item.actual_received_date !== undefined
    ).length;
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    
    return { received, total, percentage };
  };

  // 선진행 체크 함수
  const isAdvancePayment = (progress_type?: string) => {
    return progress_type === '선진행' || progress_type?.trim() === '선진행' || progress_type?.includes('선진행');
  };

  // 고급 필터링 로직
  const applyAdvancedFilters = useCallback((purchases: Purchase[]) => {
    let filtered = [...purchases];

    // 검색어 필터링
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(purchase => 
        purchase.purchase_order_number?.toLowerCase().includes(searchLower) ||
        purchase.vendor_name?.toLowerCase().includes(searchLower) ||
        purchase.requester_name?.toLowerCase().includes(searchLower) ||
        purchase.item_name?.toLowerCase().includes(searchLower) ||
        purchase.specification?.toLowerCase().includes(searchLower) ||
        purchase.remark?.toLowerCase().includes(searchLower) ||
        purchase.project_vendor?.toLowerCase().includes(searchLower) ||
        purchase.project_item?.toLowerCase().includes(searchLower) ||
        purchase.sales_order_number?.toLowerCase().includes(searchLower)
      );
    }

    // 개별 필터 적용
    activeFilters.forEach(filter => {
      console.log('🔍 필터 적용:', {
        field: filter.field,
        dateField: filter.dateField,
        condition: filter.condition,
        value: filter.value,
        label: filter.label
      });
      
      filtered = filtered.filter(purchase => {
        // 날짜 필터의 경우 실제 날짜 필드 사용
        const actualField = (filter.field === 'date_range' || filter.field === 'date_month') 
          ? filter.dateField || filter.field 
          : filter.field;
        
        const fieldValue = getFieldValue(purchase, actualField);
        
        // 필터 필드 타입 감지
        const filterFieldType = filter.field === 'date_month' ? 'date_month' : 
                               filter.field === 'date_range' ? 'date_range' : null;
        
        const result = applyFilterCondition(fieldValue, filter.condition, filter.value, filterFieldType);
        
        // 첫 번째 항목만 디버깅 로그 출력
        if (purchase === filtered[0]) {
          console.log('📝 필터 결과:', {
            actualField,
            fieldValue,
            filterValue: filter.value,
            filterFieldType,
            result
          });
        }
        
        return result;
      });
      
      console.log(`✅ 필터 적용 후 결과: ${filtered.length}개 항목`);
    });

    return filtered;
  }, [searchTerm, activeFilters]);

  // 필드 값 추출 함수
  const getFieldValue = (purchase: Purchase, field: string): any => {
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
        return purchase.contact_name;
      case 'item_name':
        return purchase.item_name;
      case 'specification':
        return purchase.specification;
      case 'quantity':
        return purchase.quantity;
      case 'unit_price_value':
        return purchase.unit_price_value;
      case 'total_amount':
        return purchase.total_amount;
      case 'remark':
        return purchase.remark;
      case 'project_vendor':
        return purchase.project_vendor;
      case 'project_item':
        return purchase.project_item;
      case 'sales_order_number':
        return purchase.sales_order_number;
      case 'payment_schedule':
        return (purchase as any).payment_schedule;
      case 'is_payment_completed':
        return purchase.is_payment_completed ? '완료' : '대기';
      case 'is_received':
        return purchase.is_received ? '완료' : '대기';
      case 'is_statement_received':
        return (purchase as any).is_statement_received ? '완료' : '대기';
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
        return (purchase as any).statement_received_at;
      default:
        return null;
    }
  };

  // 필터 조건 적용 함수
  const applyFilterCondition = (fieldValue: any, condition: string, filterValue: any, filterField?: string): boolean => {
    if (fieldValue === null || fieldValue === undefined) {
      return condition === 'is_empty';
    }

    // 날짜 범위 필터 특별 처리 (시작일~종료일)
    if (filterField === 'date_range' && filterValue && filterValue.includes('~')) {
      if (!fieldValue) return false;
      
      const [startDate, endDate] = filterValue.split('~');
      const fieldDate = new Date(fieldValue);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // 시작일과 종료일 포함하여 범위 내에 있는지 확인
      return fieldDate >= start && fieldDate <= end;
    }

    // 월별 범위 필터 특별 처리 (시작월~종료월)
    if (filterField === 'date_month' && filterValue && filterValue.includes('~')) {
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
        if (filterField === 'date_range' || filterValue.match(/^\d{4}-\d{2}-\d{2}/)) {
          if (!fieldValue) return false;
          try {
            const fieldDate = new Date(fieldValue).toISOString().split('T')[0];
            const filterDate = filterValue.split('T')[0];
            return fieldDate === filterDate;
          } catch (error) {
            console.error('날짜 비교 오류:', error);
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
  };

  // 정렬 적용 함수
  const applySorting = useCallback((purchases: Purchase[]) => {
    if (!sortConfig) return purchases;

    return [...purchases].sort((a, b) => {
      const aValue = getFieldValue(a, sortConfig.field);
      const bValue = getFieldValue(b, sortConfig.field);

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      let comparison = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else if (aValue instanceof Date && bValue instanceof Date) {
        comparison = aValue.getTime() - bValue.getTime();
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  }, [sortConfig]);

  // 고급 필터가 적용된 최종 구매 목록
  const advancedFilteredPurchases = useMemo(() => {
    let result = applyAdvancedFilters(filteredPurchases);
    result = applySorting(result);
    return result;
  }, [filteredPurchases, applyAdvancedFilters, applySorting]);


  // 엑셀 다운로드
  const handleExcelDownload = async (purchase: Purchase) => {
    try {
      // DB에서 직접 모든 품목 조회
      const { data: purchaseRequest, error: requestError } = await supabase
        .from('purchase_requests')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .single();

      if (requestError || !purchaseRequest) {
        toast.error('해당 발주요청번호의 데이터를 찾을 수 없습니다.');
        return;
      }

      // 품목 데이터 조회
      const { data: orderItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .order('line_number');

      if (itemsError || !orderItems || orderItems.length === 0) {
        toast.error('해당 발주요청번호의 품목 데이터를 찾을 수 없습니다.');
        return;
      }

      // 업체 상세 정보 및 담당자 정보 조회
      const vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: ''
      };

      try {
        const vendorId = purchaseRequest.vendor_id || purchase.vendor_id;
        const contactId = purchaseRequest.contact_id || purchase.contact_id;
        
        // vendor 정보 조회
        if (vendorId) {
          const { data: vendorData, error: vendorError } = await supabase
            .from('vendors')
            .select('vendor_phone, vendor_fax')
            .eq('id', vendorId)
            .single();

          if (vendorData && !vendorError) {
            vendorInfo.vendor_phone = vendorData.vendor_phone || '';
            vendorInfo.vendor_fax = vendorData.vendor_fax || '';
          }
        }

        // vendor_contacts에서 contact_id로 담당자 정보 조회
        if (contactId) {
          const { data: contactData, error: contactError } = await supabase
            .from('vendor_contacts')
            .select('contact_name, contact_phone, contact_email')
            .eq('id', contactId)
            .single();
          if (contactData && !contactError) {
            vendorInfo.vendor_contact_name = contactData.contact_name || '';
          }
        }
      } catch (error) {
      }

      const excelData: PurchaseOrderData = {
        purchase_order_number: purchaseRequest.purchase_order_number || '',
        request_date: purchaseRequest.request_date,
        delivery_request_date: purchaseRequest.delivery_request_date,
        requester_name: purchaseRequest.requester_name,
        vendor_name: vendorInfo.vendor_name || '',
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchaseRequest.project_vendor,
        sales_order_number: purchaseRequest.sales_order_number,
        project_item: purchaseRequest.project_item,
        items: orderItems.map((item: any) => ({
          line_number: item.line_number,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price_value,
          amount_value: item.amount_value,
          remark: item.remark,
          currency: purchaseRequest.currency || 'KRW'
        }))
      };

      // 코드 기반 ExcelJS 생성 (템플릿 없이 서식 직접 정의)
      const blob = await generatePurchaseOrderExcelJS(excelData);
      
      // 다운로드용 파일명: 발주서_{업체명}_발주요청번호
      const downloadFilename = `발주서_${excelData.vendor_name}_${excelData.purchase_order_number}.xlsx`;

      // 사용자에게 즉시 다운로드 제공
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
      
      // DB에 다운로드 완료 플래그(is_po_download) 업데이트 - lead buyer만 해당
      try {
        const isLeadBuyer = currentUserRoles && currentUserRoles.includes('lead buyer');

        if (isLeadBuyer) {
          const { error: downloadFlagErr } = await supabase
            .from('purchase_requests')
            .update({ is_po_download: true })
            .eq('purchase_order_number', purchase.purchase_order_number);
          if (downloadFlagErr) {
          } else {
            // 화면 업데이트
            await loadPurchases();
          }
        }
      } catch (flagErr) {
      }
    } catch (error) {
      toast.error('엑셀 다운로드에 실패했습니다.');
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
            is_payment_completed: true
          })
          .eq('purchase_request_id', purchaseId)
      ]);

      if (requestResult.error) throw requestResult.error;
      if (itemsResult.error) throw itemsResult.error;
      
      toast.success('구매완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="page-title">발주요청 관리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Purchase Management</p>
        </div>
        <Button 
          onClick={() => navigate('/purchase/new')}
          className="mt-4 sm:mt-0 bg-hansl-500 hover:bg-hansl-600"
        >
          <Plus className="w-4 h-4 mr-2" />
          새 발주요청 작성
        </Button>
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
        />
      </div>

      {/* 직접 구현한 탭 (hanslwebapp 방식) - 빠른 성능 */}
      <div className="space-y-3">
        {/* 탭 버튼들 - 모바일 반응형 개선 */}
        <div className="flex flex-col sm:flex-row sm:space-x-1 space-y-1 sm:space-y-0 bg-gray-50 p-1 business-radius-card border border-gray-200">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
              }}
              className={`flex-1 flex items-center justify-center space-x-2 py-1.5 px-3 sm:px-4 business-radius-button button-text font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-hansl-600 bg-white shadow-sm border border-gray-200'
                  : 'text-gray-600 bg-transparent hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span className="whitespace-nowrap">{tab.label}</span>
              <Badge 
                variant="secondary" 
                className={
                  activeTab === tab.key 
                    ? 'badge-stats-active' 
                    : 'badge-stats-secondary'
                }
              >
                {tabCounts[tab.key as keyof typeof tabCounts]}
              </Badge>
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <Card className="overflow-hidden border border-gray-200">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 card-subtitle">로딩 중...</span>
              </div>
            ) : advancedFilteredPurchases.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
                <p className="card-subtitle">새로운 발주요청서를 작성해보세요.</p>
              </div>
            ) : (
              <LazyPurchaseTable 
                purchases={advancedFilteredPurchases} 
                activeTab={activeTab}
                currentUserRoles={currentUserRoles}
                onRefresh={loadPurchases}
                onOptimisticUpdate={updatePurchaseOptimistic}
                onPaymentComplete={handlePaymentComplete}
                onReceiptComplete={handleReceiptComplete}
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