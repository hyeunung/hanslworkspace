
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePurchaseMemory } from "@/hooks/usePurchaseMemory";
import { useServerSearch } from "@/hooks/useServerSearch";
import { useColumnSettings } from "@/hooks/useColumnSettings";
import { usePurchaseTableFilters } from "@/hooks/usePurchaseTableFilters";
import { usePurchaseSortRules } from "@/hooks/usePurchaseSortRules";
import { useSavedColumnViews } from "@/hooks/useSavedColumnViews";
import SavedColumnViewsMenu from "@/components/ui/SavedColumnViewsMenu";
import { DEFAULT_COLUMN_VISIBILITY } from "@/constants/columnSettings";
import { ColumnVisibility } from "@/types/columnSettings";
import { toast } from "sonner";
import PurchaseCompactTable from "@/components/purchase/PurchaseCompactTable";
import PurchaseFilterToolbar from "@/components/purchase/PurchaseFilterToolbar";
import PurchaseSortControl from "@/components/purchase/PurchaseSortControl";
import PurchaseColumnMenu from "@/components/purchase/PurchaseColumnMenu";
import PurchaseMonthlySummary from "@/components/purchase/PurchaseMonthlySummary";
import { updatePurchaseInMemory, loadAllPurchaseData } from "@/services/purchaseDataLoader";
import { isCacheValid, purchaseMemoryCache } from '@/stores/purchaseMemoryStore';
import DeliveryDateWarningModal, { useDeliveryWarningCount } from "@/components/purchase/DeliveryDateWarningModal";
import { Package, AlertTriangle, Search, Filter, ChevronDown, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { Purchase } from "@/types/purchase";
import { parseRoles, getRoleCase, filterByEmployeeVisibility } from '@/utils/roleHelper';
import { calculateTabCounts } from "@/utils/purchaseFilters";
import { purchaseYearsFor, newPurchaseRuleId, PurchaseOptionsKey } from "@/utils/purchaseTableFilters";
import { compareByPurchaseSortRules } from "@/utils/purchaseTableSort";
import { logger } from "@/lib/logger";

interface PurchaseListMainProps {
  showEmailButton?: boolean;
}

// 화면 상단의 진행상태 뷰 버튼 목록 (기존 4탭 → 제작현황식 뷰 버튼)
const NAV_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: '승인대기' },
  { key: 'purchase', label: '구매 현황' },
  { key: 'receipt', label: '입고 현황' },
  { key: 'done', label: '전체 항목' },
];

const FILTER_COLLAPSED_KEY = 'hansl_purchase_filter_collapsed';

// 발주 목록 메인 컴포넌트 — 제작현황과 같은 테이블 형식(뷰 버튼 + 노션식 필터 카드 + 컴팩트 표).
// 데이터 파이프라인(메모리 캐시·탭 필터·서버 폴백 검색·realtime)과 승인/상세 플로우는 기존 유지.
export default function PurchaseListMain(_props: PurchaseListMainProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const supabase = createClient();
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const hasShownWarningRef = useRef(false);

  useEffect(() => {
    hasShownWarningRef.current = false;
  }, []);

  // 검색어 + 필터 옵션 데이터
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
  } = usePurchaseMemory();

  // 칼럼 가시성 설정 (DB 저장 — 기기 간 동기화)
  const { columnVisibility, toggleColumn, applyColumnSettings, resetToDefault } = useColumnSettings();

  // 저장된 칼럼 구성 (이름 저장 + 적용, DB 동기화 — 저장된 필터와 동일 UX)
  const savedColumnViews = useSavedColumnViews<ColumnVisibility>('purchase_columns');
  const handleSaveColumnView = async (name: string) => {
    const ok = await savedColumnViews.saveView({ id: `c${Date.now()}`, name, payload: columnVisibility });
    if (ok) toast.success(`칼럼 구성 '${name}'을(를) 저장했습니다.`);
    else toast.error('칼럼 구성 저장에 실패했습니다.');
  };
  const handleApplyColumnView = (viewId: string) => {
    const view = savedColumnViews.views.find(v => v.id === viewId);
    if (!view?.payload) return;
    // 이후 추가된 신규 칼럼은 기본값으로 채워 적용
    applyColumnSettings({ ...DEFAULT_COLUMN_VISIBILITY, ...view.payload });
  };
  const handleRenameColumnView = async (viewId: string, prevName: string) => {
    const name = window.prompt('칼럼 구성 이름 변경', prevName)?.trim();
    if (!name || name === prevName) return;
    const ok = await savedColumnViews.renameView(viewId, name);
    if (!ok) toast.error('이름 변경에 실패했습니다.');
  };
  const handleDeleteColumnView = async (viewId: string, name: string) => {
    if (!window.confirm(`저장된 칼럼 구성 '${name}'을(를) 삭제하시겠습니까?`)) return;
    const ok = await savedColumnViews.deleteView(viewId);
    if (ok) toast.success('저장된 칼럼 구성을 삭제했습니다.');
    else toast.error('삭제에 실패했습니다.');
  };

  const currentUserRoles = useMemo(() => parseRoles(currentUser?.roles), [currentUser?.roles]);
  const currentUserName = currentUser?.name || null;

  // 노션식 필터 규칙 + 저장뷰 / 다중 정렬
  const dynamicOptions: Partial<Record<PurchaseOptionsKey, string[]>> = useMemo(() => ({
    employees: availableEmployees,
    vendors: availableVendors,
    contacts: availableContacts,
    paymentSchedules: availablePaymentSchedules,
  }), [availableEmployees, availableVendors, availableContacts, availablePaymentSchedules]);

  const tableFilters = usePurchaseTableFilters(dynamicOptions);
  const { sortRules, addSortRule, updateSortRule, removeSortRule, clearSort } = usePurchaseSortRules();

  // 필터 카드 여닫기 (제작현황과 동일하게 localStorage에 기억)
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(FILTER_COLLAPSED_KEY) !== '0' } catch { return true }
  });
  const toggleFilterCollapsed = useCallback(() => {
    setFilterCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(FILTER_COLLAPSED_KEY, next ? '1' : '0') } catch { /* 무시 */ }
      return next;
    });
  }, []);

  // 강제 리렌더링 트리거 (메모리 캐시 갱신 후 UI 반영용)
  const [, setRefreshTrigger] = useState(0);
  const loadPurchases = useCallback(async () => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Optimistic Update: 메모리 캐시 즉시 업데이트
  const updatePurchaseOptimistic = useCallback((purchaseId: number, updater: (prev: Purchase) => Purchase) => {
    updatePurchaseInMemory(purchaseId, updater);
  }, []);

  // 탭별 기본 직원 필터 (권한별 본인/전체)
  const roleCase = useMemo(() => getRoleCase(currentUserRoles), [currentUserRoles]);
  const defaultEmployeeByTab = useMemo(() => {
    if (!currentUserName) {
      return { pending: 'all', purchase: 'all', receipt: 'all', done: 'all' };
    }
    const hasManagerRole = currentUserRoles.some((role: string) =>
      ['superadmin', 'ceo', 'lead buyer', 'raw_material_manager', 'consumable_manager', 'purchase_manager', 'hr'].includes(role)
    );
    const hasApprovalRole = currentUserRoles.some((role: string) =>
      ['superadmin', 'ceo', 'middle_manager', 'final_approver', 'raw_material_manager', 'consumable_manager'].includes(role)
    );
    return {
      pending: hasApprovalRole ? 'all' : currentUserName,
      purchase: hasManagerRole ? 'all' : (roleCase === 3 ? 'all' : currentUserName),
      receipt: 'all', // 입고현황은 요청자 필터 규칙으로 제어
      done: 'all',
    };
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
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');

  // 권한별 필터링된 데이터 (입고 지연 경고용)
  const visiblePurchases = useMemo(() => {
    return filterByEmployeeVisibility(purchases, currentUserRoles);
  }, [purchases, currentUserRoles]);

  // 입고 일정 경고 항목 수 계산 (본인 발주만) + 로딩 후 자동 팝업 (마운트당 1회)
  const deliveryWarningCount = useDeliveryWarningCount(visiblePurchases, currentUserName);
  useEffect(() => {
    if (hasShownWarningRef.current) return;
    if (!loading && deliveryWarningCount > 0 && visiblePurchases.length > 0) {
      const timer = setTimeout(() => {
        if (!hasShownWarningRef.current) {
          hasShownWarningRef.current = true;
          setIsWarningModalOpen(true);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, deliveryWarningCount, visiblePurchases.length]);

  // URL 쿼리 파라미터 변경 시 탭 상태 동기화
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab && ['pending', 'purchase', 'receipt', 'done'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [location.search]);

  // 탭 변경 또는 기본 직원 정보 로드 시 직원 필터 자동 설정
  useEffect(() => {
    const defaultEmp = defaultEmployeeByTab[activeTab as keyof typeof defaultEmployeeByTab];
    if (defaultEmp !== undefined) {
      setSelectedEmployee(defaultEmp);
    }
  }, [activeTab, defaultEmployeeByTab]);

  // 입고현황 탭 진입 시 비관리자는 요청자=본인 필터 규칙 자동 추가 (관리자는 전체)
  useEffect(() => {
    if (activeTab !== 'receipt' || !currentUserName) return;
    const isReceiptFullAccess = currentUserRoles.some((role: string) =>
      ['superadmin', 'ceo', 'hr', 'raw_material_manager', 'consumable_manager', 'purchase_manager'].includes(role)
    );
    if (isReceiptFullAccess) return;
    tableFilters.setRules(prev => {
      if (prev.some(f => f.field === 'requester_name')) return prev;
      return [...prev, { id: newPurchaseRuleId(), field: 'requester_name', op: 'equals', value: currentUserName }];
    });
  }, [activeTab, currentUserName, currentUserRoles, tableFilters.setRules]);

  // 캐시 상태 확인 및 필요시 데이터 새로고침
  useEffect(() => {
    const checkAndRefreshCache = async () => {
      if (!isCacheValid() || !purchaseMemoryCache.allPurchases) {
        try {
          await loadAllPurchaseData(currentUser?.id);
        } catch (error) {
          logger.error('❌ [PurchaseListMain] 데이터 새로고침 실패:', error);
        }
      }
    };
    checkAndRefreshCache();
  }, [currentUser?.id, location.key]);

  // 필터 옵션 데이터 로드 (요청자/업체/담당자/지출예정일)
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const { data: employees } = await supabase.from('employees').select('name');
        if (employees) {
          setAvailableEmployees([...new Set(employees.map((e: { name: string }) => e.name).filter(Boolean))] as string[]);
        }
        const { data: vendors } = await supabase.from('vendors').select('vendor_name, vendor_payment_schedule');
        if (vendors) {
          setAvailableVendors([...new Set(vendors.map((v: { vendor_name: string }) => v.vendor_name).filter(Boolean))] as string[]);
          setAvailablePaymentSchedules([...new Set(vendors.map((v: { vendor_payment_schedule?: string }) => v.vendor_payment_schedule).filter(Boolean))] as string[]);
        }
        const { data: contacts } = await supabase.from('vendor_contacts').select('contact_name');
        if (contacts) {
          setAvailableContacts([...new Set(contacts.map((c: { contact_name: string }) => c.contact_name).filter(Boolean))] as string[]);
        }
      } catch (error) {
        logger.error('필터 옵션 데이터 로드 실패', error);
      }
    };
    loadFilterOptions();
  }, [supabase]);

  // ── 필터 파이프라인: 탭/직원/검색/규칙(메모리) → 템플릿 → 서버 폴백 병합 → 다중 정렬 ──
  const baseFilteredPurchases = useMemo(() => {
    const employeeName = selectedEmployee === 'all' || selectedEmployee === '전체' ? null : selectedEmployee;
    return getFilteredPurchases({
      tab: activeTab as 'pending' | 'purchase' | 'receipt' | 'done',
      employeeName,
      searchTerm,
      advancedFilters: tableFilters.advancedFilters,
    });
  }, [getFilteredPurchases, activeTab, selectedEmployee, searchTerm, tableFilters.advancedFilters, purchases]);

  // 발주/구매 템플릿 데이터만 표시 (기존 데이터 호환: '일반' 및 null 포함)
  const tabFilteredPurchases = useMemo(() => {
    return baseFilteredPurchases.filter((p: Purchase) => {
      const templateType = p.po_template_type;
      return !templateType || templateType === '발주/구매' || templateType === '일반';
    });
  }, [baseFilteredPurchases]);

  // 서버 폴백 검색 (메모리 결과 0건일 때 자동 실행)
  const { serverResults, isSearching, hasSearchedServer } = useServerSearch(
    searchTerm,
    tabFilteredPurchases.length,
    activeTab
  );

  // 메모리 결과 + 서버 결과 병합 후 다중 정렬 적용
  const displayPurchases = useMemo(() => {
    let merged = tabFilteredPurchases;
    if (serverResults.length > 0) {
      const memoryIds = new Set(tabFilteredPurchases.map(p => p.id));
      const filteredServer = serverResults
        .filter(p => !memoryIds.has(p.id))
        .filter(p => {
          const t = p.po_template_type;
          return !t || t === '발주/구매' || t === '일반';
        });
      merged = [...tabFilteredPurchases, ...filteredServer];
    }
    if (sortRules.length === 0) return merged;
    return [...merged].sort((a, b) => compareByPurchaseSortRules(a, b, sortRules));
  }, [tabFilteredPurchases, serverResults, sortRules]);

  // ── 뷰 버튼 건수 배지 ─────────────────────────────────────────────────
  const [cachedTabCounts, setCachedTabCounts] = useState({ pending: 0, purchase: 0, receipt: 0, done: 0 });
  useEffect(() => {
    if (purchases && purchases.length > 0) {
      setCachedTabCounts(calculateTabCounts(purchases, currentUser));
    } else if (purchaseMemoryCache.allPurchases && purchaseMemoryCache.allPurchases.length > 0) {
      setCachedTabCounts(calculateTabCounts(purchaseMemoryCache.allPurchases, currentUser));
    }
  }, [purchases, currentUser]);

  // 검색어 또는 필터 규칙이 적용된 경우 각 탭별 카운트 재계산
  const hasActiveFilters = !!searchTerm || tableFilters.advancedFilters.length > 0;
  const filteredTabCountsWithSearch = useMemo(() => {
    if (!hasActiveFilters) return cachedTabCounts;
    const counts = { pending: 0, purchase: 0, receipt: 0, done: 0 };
    (Object.keys(counts) as Array<keyof typeof counts>).forEach(tab => {
      const filtered = getFilteredPurchases({
        tab,
        employeeName: defaultEmployeeByTab[tab] === 'all' ? null : defaultEmployeeByTab[tab],
        searchTerm,
        advancedFilters: tableFilters.advancedFilters,
      });
      counts[tab] = filtered.length;
    });
    return counts;
  }, [hasActiveFilters, searchTerm, tableFilters.advancedFilters, cachedTabCounts, getFilteredPurchases, defaultEmployeeByTab]);

  const getTabBadgeText = useCallback((tabKey: string) => {
    if (hasActiveFilters) {
      return filteredTabCountsWithSearch[tabKey as keyof typeof filteredTabCountsWithSearch].toString();
    }
    if (tabKey === 'done') return "전체";
    return cachedTabCounts[tabKey as keyof typeof cachedTabCounts].toString();
  }, [hasActiveFilters, filteredTabCountsWithSearch, cachedTabCounts]);

  // 뷰 버튼 클릭 — URL 갱신 + 탭 상태 + 탭별 기본 직원 필터
  const handleTabClick = useCallback((tabKey: string) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('tab', tabKey);
    navigate({ search: searchParams.toString() }, { replace: true });
    setActiveTab(tabKey);
    const newEmployeeValue = defaultEmployeeByTab[tabKey as keyof typeof defaultEmployeeByTab];
    setSelectedEmployee(newEmployeeValue ?? 'all');
  }, [location.search, navigate, defaultEmployeeByTab]);

  // 연도 드롭다운 옵션 (month_in 규칙용)
  const yearsFor = useCallback((dateField: string) => purchaseYearsFor(purchases, dateField), [purchases]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">발주요청 관리</h1>
            <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Purchase Management</p>
          </div>

          {/* 입고 지연 경고 버튼 */}
          {deliveryWarningCount > 0 && (
            <Button
              onClick={() => setIsWarningModalOpen(true)}
              variant="outline"
              className="flex items-center gap-2 border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-400"
            >
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">입고 지연</span>
              <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300 text-[10px] px-1.5 py-0">
                {deliveryWarningCount}건
              </Badge>
            </Button>
          )}
        </div>
      </div>

      {/* 진행상태 뷰 버튼 (기존 4탭 → 제작현황식, 건수 배지 유지) */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabClick(tab.key)}
              className={`hansl-view-btn ${isActive ? 'hansl-view-btn-on' : 'hansl-view-btn-off'}`}
            >
              <span className={`button-text ${isActive ? 'text-white' : 'text-gray-700'}`}>{tab.label}</span>
              <span className={`badge-stats ml-1 ${isActive ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {getTabBadgeText(tab.key)}
              </span>
            </button>
          );
        })}
      </div>

      {/* 월간 필터 적용 시 합계금액 표시 */}
      <PurchaseMonthlySummary rules={tableFilters.rules} purchases={tabFilteredPurchases} />

      {/* 필터 카드 (여닫이) — 표 카드와 위아래로 붙는다 */}
      <div className="card-professional rounded-b-none border-b-0 overflow-hidden">
        <button
          type="button"
          onClick={toggleFilterCollapsed}
          className="w-full flex items-center gap-1 px-3 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <Filter className="w-3 h-3" />
          <span>필터</span>
          <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${filterCollapsed ? '-rotate-90' : ''}`} />
        </button>
        {!filterCollapsed && (
          <div className="px-3 pb-3 pt-3 space-y-3 border-t border-gray-100">
            {/* 검색란 (제작현황 표준 규격) */}
            <div className="flex items-center">
              <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
                <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="발주번호, 품명, 규격, 업체, 요청자 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ paddingLeft: '26px', height: '20px' }}
                  className="hansl-search-input"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    title="검색어 지우기"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            {/* 조건 행만 좌/우 분할: 좌=조건 필터, 구분선, 우=칼럼 버튼 */}
            <div className="flex items-stretch">
            <div className="flex-1 min-w-0">
            <PurchaseFilterToolbar
              rules={tableFilters.rules}
              dynamicOptions={dynamicOptions}
              yearsFor={yearsFor}
              addRule={tableFilters.addRule}
              updateRule={tableFilters.updateRule}
              changeRuleField={tableFilters.changeRuleField}
              removeRule={tableFilters.removeRule}
              resetRules={tableFilters.resetRules}
              filterViewsConfig={tableFilters.filterViewsConfig}
              viewsMenuOpen={tableFilters.viewsMenuOpen}
              setViewsMenuOpen={tableFilters.setViewsMenuOpen}
              viewsAnchor={tableFilters.viewsAnchor}
              setViewsAnchor={tableFilters.setViewsAnchor}
              namingView={tableFilters.namingView}
              setNamingView={tableFilters.setNamingView}
              newViewName={tableFilters.newViewName}
              setNewViewName={tableFilters.setNewViewName}
              closeViewsMenu={tableFilters.closeViewsMenu}
              commitSaveView={tableFilters.commitSaveView}
              handleApplyView={tableFilters.handleApplyView}
              handleRenameView={tableFilters.handleRenameView}
              handleDeleteView={tableFilters.handleDeleteView}
              handleSetDefault={tableFilters.handleSetDefault}
              handleClearDefault={tableFilters.handleClearDefault}
            />
            </div>
            {/* 세로 구분선 */}
            <div className="w-px bg-gray-200 self-stretch mx-3" />
            {/* 우측 절반: 칼럼 버튼(드롭다운) + 저장된 칼럼 + 초기화 */}
            <div className="flex-1 min-w-0 pt-2 border-t border-gray-100 flex items-center gap-2">
              <PurchaseColumnMenu
                columnVisibility={columnVisibility}
                toggleColumn={toggleColumn}
                resetToDefault={resetToDefault}
                currentUserRoles={currentUserRoles}
              />
              <SavedColumnViewsMenu
                views={savedColumnViews.views}
                onSaveCurrent={handleSaveColumnView}
                onApply={handleApplyColumnView}
                onRename={handleRenameColumnView}
                onDelete={handleDeleteColumnView}
              />
              <button
                type="button"
                onClick={resetToDefault}
                className="hansl-ctl-chip-reset"
                title="칼럼 표시 초기화 (모두 표시)"
              >
                <RotateCcw className="w-3 h-3" />
                초기화
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      {/* 표 카드 — 제목행(정렬·칼럼 메뉴) + 컴팩트 테이블 */}
      <div className="card-professional rounded-t-none overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <span className="modal-section-title">발주/구매 현황</span>
            <PurchaseSortControl
              sortRules={sortRules}
              addSortRule={addSortRule}
              updateSortRule={updateSortRule}
              removeSortRule={removeSortRule}
              clearSort={clearSort}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 card-subtitle">로딩 중...</span>
          </div>
        ) : displayPurchases.length === 0 && isSearching ? (
          <div className="flex items-center justify-center py-12">
            <Search className="w-6 h-6 text-hansl-500 animate-pulse mr-3" />
            <span className="card-subtitle">서버에서 추가 검색 중...</span>
          </div>
        ) : displayPurchases.length === 0 && searchTerm && hasSearchedServer ? (
          <div className="text-center py-12">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">검색 결과가 없습니다</h3>
            <p className="card-subtitle">전체 데이터를 검색했지만 일치하는 항목이 없습니다.</p>
          </div>
        ) : displayPurchases.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
            <p className="card-subtitle">새로운 발주요청서를 작성해보세요.</p>
          </div>
        ) : (
          <PurchaseCompactTable
            purchases={displayPurchases}
            activeTab={activeTab}
            currentUserRoles={currentUserRoles}
            columnVisibility={columnVisibility}
            onRefresh={loadPurchases}
            onOptimisticUpdate={updatePurchaseOptimistic}
          />
        )}
      </div>

      {/* 입고 일정 지연 경고 모달 */}
      <DeliveryDateWarningModal
        isOpen={isWarningModalOpen}
        onClose={() => {
          setIsWarningModalOpen(false);
          window.location.reload();
        }}
        purchases={visiblePurchases}
        currentUserName={currentUserName}
      />
    </div>
  );
}
