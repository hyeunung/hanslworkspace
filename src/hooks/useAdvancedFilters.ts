import { useState, useMemo } from 'react';
import { DateRange } from 'react-day-picker';
import { Purchase } from './usePurchaseData';
import { FilterCondition, SortCondition } from '@/components/purchase/AdvancedFilterToolbar';

export function useAdvancedFilters(purchases: Purchase[]) {
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [sortCondition, setSortCondition] = useState<SortCondition | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');

  // 필터 적용 로직
  const applyFilters = (data: Purchase[], filterConditions: FilterCondition[]) => {
    return data.filter(purchase => {
      return filterConditions.every(filter => {
        const { field, operator, value } = filter;

        // 값이 없으면 필터 적용하지 않음
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          return true;
        }

        switch (field) {
          case 'date_range': {
            if (typeof value === 'object' && 'from' in value) {
              const dateRange = value as DateRange;
              if (!dateRange.from) return true;
              
              const requestDate = purchase.request_date ? new Date(purchase.request_date.split('T')[0]) : null;
              if (!requestDate) return false;
              
              const fromDate = dateRange.from;
              const toDate = dateRange.to || dateRange.from;
              
              return requestDate >= fromDate && requestDate <= toDate;
            }
            return true;
          }

          case 'requester_name': {
            const purchaseValue = purchase.requester_name || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'vendor_name': {
            const purchaseValue = purchase.vendor_name || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'purchase_order_number': {
            const purchaseValue = purchase.purchase_order_number || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'project_vendor': {
            const purchaseValue = purchase.project_vendor || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'project_item': {
            const purchaseValue = purchase.project_item || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'sales_order_number': {
            const purchaseValue = purchase.sales_order_number || '';
            return applyStringOperator(purchaseValue, operator, value as string);
          }

          case 'payment_category': {
            const purchaseValue = purchase.payment_category || '';
            return applySelectOperator(purchaseValue, operator, value as string);
          }

          case 'delivery_request_date': {
            const purchaseDate = purchase.delivery_request_date ? new Date(purchase.delivery_request_date.split('T')[0]) : null;
            const filterDate = new Date(value as string);
            return applyDateOperator(purchaseDate, operator, filterDate);
          }

          case 'revised_delivery_request_date': {
            const purchaseDate = purchase.revised_delivery_request_date ? new Date(purchase.revised_delivery_request_date.split('T')[0]) : null;
            const filterDate = new Date(value as string);
            return applyDateOperator(purchaseDate, operator, filterDate);
          }

          case 'approval_status': {
            const status = getApprovalStatus(purchase);
            return applySelectOperator(status, operator, value as string);
          }

          case 'item_name': {
            if (!purchase.items || purchase.items.length === 0) return false;
            return purchase.items.some(item => 
              applyStringOperator(item.item_name || '', operator, value as string)
            );
          }

          case 'specification': {
            if (!purchase.items || purchase.items.length === 0) return false;
            return purchase.items.some(item => 
              applyStringOperator(item.specification || '', operator, value as string)
            );
          }

          case 'remark': {
            if (!purchase.items || purchase.items.length === 0) return false;
            return purchase.items.some(item => 
              applyStringOperator(item.remark || '', operator, value as string)
            );
          }

          default:
            return true;
        }
      });
    });
  };

  // 문자열 연산자 적용
  const applyStringOperator = (purchaseValue: string, operator: string, filterValue: string): boolean => {
    const purchase = purchaseValue.toLowerCase();
    const filter = filterValue.toLowerCase();

    switch (operator) {
      case 'contains':
        return purchase.includes(filter);
      case 'equals':
        return purchase === filter;
      case 'starts_with':
        return purchase.startsWith(filter);
      case 'ends_with':
        return purchase.endsWith(filter);
      default:
        return true;
    }
  };

  // 선택 연산자 적용
  const applySelectOperator = (purchaseValue: string, operator: string, filterValue: string): boolean => {
    switch (operator) {
      case 'equals':
        return purchaseValue === filterValue;
      case 'not_equals':
        return purchaseValue !== filterValue;
      default:
        return true;
    }
  };

  // 날짜 연산자 적용
  const applyDateOperator = (purchaseDate: Date | null, operator: string, filterDate: Date): boolean => {
    if (!purchaseDate) return false;

    switch (operator) {
      case 'equals':
        return purchaseDate.getTime() === filterDate.getTime();
      case 'before':
        return purchaseDate < filterDate;
      case 'after':
        return purchaseDate > filterDate;
      default:
        return true;
    }
  };

  // 승인 상태 확인
  const getApprovalStatus = (purchase: Purchase): string => {
    if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return 'rejected';
    }
    
    if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return 'approved';
    }
    
    return 'pending';
  };

  // 전체 검색 적용
  const applyGlobalSearch = (data: Purchase[], searchTerm: string) => {
    if (!searchTerm.trim()) return data;

    const term = searchTerm.toLowerCase();
    
    return data.filter(purchase => {
      // 기본 필드 검색
      if (
        purchase.purchase_order_number?.toLowerCase().includes(term) ||
        purchase.vendor_name?.toLowerCase().includes(term) ||
        purchase.requester_name?.toLowerCase().includes(term) ||
        purchase.project_vendor?.toLowerCase().includes(term) ||
        purchase.project_item?.toLowerCase().includes(term) ||
        purchase.sales_order_number?.toLowerCase().includes(term)
      ) {
        return true;
      }

      // 품목 검색
      if (purchase.items && purchase.items.length > 0) {
        return purchase.items.some(item => 
          item.item_name?.toLowerCase().includes(term) ||
          item.specification?.toLowerCase().includes(term) ||
          item.remark?.toLowerCase().includes(term)
        );
      }

      return false;
    });
  };

  // 정렬 적용
  const applySorting = (data: Purchase[], sort: SortCondition | null) => {
    if (!sort) {
      // 기본 정렬: 요청일 내림차순 (최신순)
      return [...data].sort((a, b) => {
        const dateA = a.request_date ? new Date(a.request_date).getTime() : 0;
        const dateB = b.request_date ? new Date(b.request_date).getTime() : 0;
        return dateB - dateA;
      });
    }

    return [...data].sort((a, b) => {
      let valueA: any;
      let valueB: any;

      switch (sort.field) {
        case 'request_date':
          valueA = a.request_date ? new Date(a.request_date).getTime() : 0;
          valueB = b.request_date ? new Date(b.request_date).getTime() : 0;
          break;
        case 'delivery_request_date':
          valueA = a.delivery_request_date ? new Date(a.delivery_request_date).getTime() : 0;
          valueB = b.delivery_request_date ? new Date(b.delivery_request_date).getTime() : 0;
          break;
        case 'total_amount':
          valueA = a.total_amount || 0;
          valueB = b.total_amount || 0;
          break;
        case 'vendor_name':
          valueA = a.vendor_name || '';
          valueB = b.vendor_name || '';
          break;
        case 'requester_name':
          valueA = a.requester_name || '';
          valueB = b.requester_name || '';
          break;
        case 'purchase_order_number':
          valueA = a.purchase_order_number || '';
          valueB = b.purchase_order_number || '';
          break;
        default:
          return 0;
      }

      if (typeof valueA === 'string' && typeof valueB === 'string') {
        const comparison = valueA.localeCompare(valueB);
        return sort.direction === 'asc' ? comparison : -comparison;
      } else {
        const comparison = valueA - valueB;
        return sort.direction === 'asc' ? comparison : -comparison;
      }
    });
  };

  // 최종 필터된 결과
  const filteredData = useMemo(() => {
    // 1. 필터 적용
    let result = applyFilters(purchases, filters);
    
    // 2. 전체 검색 적용
    result = applyGlobalSearch(result, globalSearch);
    
    // 3. 정렬 적용
    result = applySorting(result, sortCondition);
    
    return result;
  }, [purchases, filters, globalSearch, sortCondition]);

  // 활성 필터 개수
  const activeFilterCount = useMemo(() => {
    return filters.filter(filter => {
      if (!filter.value) return false;
      if (typeof filter.value === 'string' && filter.value.trim() === '') return false;
      if (typeof filter.value === 'object' && 'from' in filter.value && !filter.value.from) return false;
      return true;
    }).length;
  }, [filters]);

  return {
    // 상태
    filters,
    sortCondition,
    globalSearch,
    filteredData,
    activeFilterCount,
    
    // 액션
    setFilters,
    setSortCondition,
    setGlobalSearch,
    
    // 유틸리티
    clearAllFilters: () => {
      setFilters([]);
      setSortCondition(null);
      setGlobalSearch('');
    }
  };
}