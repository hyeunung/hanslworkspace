import { useState } from 'react';
import { Filter, SortAsc, SortDesc, Search, X, Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';

// 필터 조건 타입 정의
export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string | DateRange | undefined;
  label: string;
}

export interface SortCondition {
  field: string;
  direction: 'asc' | 'desc';
  label: string;
}

// 필터 가능한 필드 정의
const FILTER_FIELDS = [
  { value: 'date_range', label: '기간', type: 'date_range' },
  { value: 'requester_name', label: '요청자', type: 'select' },
  { value: 'vendor_name', label: '업체', type: 'select' },
  { value: 'purchase_order_number', label: '발주번호', type: 'text' },
  { value: 'item_name', label: '품명', type: 'text' },
  { value: 'specification', label: '규격', type: 'text' },
  { value: 'project_vendor', label: 'PJ업체', type: 'text' },
  { value: 'project_item', label: 'PJ ITEM', type: 'text' },
  { value: 'sales_order_number', label: '수주번호', type: 'text' },
  { value: 'payment_category', label: '결제종류', type: 'select' },
  { value: 'delivery_request_date', label: '입고요청일', type: 'date' },
  { value: 'revised_delivery_request_date', label: '변경입고일', type: 'date' },
  { value: 'remark', label: '비고', type: 'text' },
  { value: 'approval_status', label: '승인상태', type: 'select' }
] as const;

// 정렬 가능한 필드 정의
const SORT_FIELDS = [
  { value: 'request_date', label: '요청일' },
  { value: 'delivery_request_date', label: '입고요청일' },
  { value: 'total_amount', label: '총액' },
  { value: 'vendor_name', label: '업체명' },
  { value: 'requester_name', label: '요청자' },
  { value: 'purchase_order_number', label: '발주번호' }
] as const;

// 연산자 정의
const OPERATORS = {
  text: [
    { value: 'contains', label: '포함' },
    { value: 'equals', label: '일치' },
    { value: 'starts_with', label: '시작' },
    { value: 'ends_with', label: '끝' }
  ],
  select: [
    { value: 'equals', label: '일치' },
    { value: 'not_equals', label: '다름' }
  ],
  date: [
    { value: 'equals', label: '같은 날' },
    { value: 'before', label: '이전' },
    { value: 'after', label: '이후' }
  ],
  date_range: [
    { value: 'between', label: '기간 내' }
  ]
} as const;

interface AdvancedFilterToolbarProps {
  // 현재 필터 상태
  filters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
  
  // 정렬 상태
  sortCondition: SortCondition | null;
  onSortChange: (sort: SortCondition | null) => void;
  
  // 전체 검색
  globalSearch: string;
  onGlobalSearchChange: (search: string) => void;
  
  // 옵션 데이터
  employees: Array<{ name: string }>;
  vendors: Array<{ vendor_name: string }>;
  
  // 활성 필터 수
  activeFilterCount: number;
}

export function AdvancedFilterToolbar({
  filters,
  onFiltersChange,
  sortCondition,
  onSortChange,
  globalSearch,
  onGlobalSearchChange,
  employees,
  vendors,
  activeFilterCount
}: AdvancedFilterToolbarProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);

  // 새 필터 추가
  const addFilter = (field: string) => {
    const fieldConfig = FILTER_FIELDS.find(f => f.value === field);
    if (!fieldConfig) return;

    const newFilter: FilterCondition = {
      id: Math.random().toString(36).substr(2, 9),
      field,
      operator: OPERATORS[fieldConfig.type][0].value,
      value: '',
      label: fieldConfig.label
    };

    onFiltersChange([...filters, newFilter]);
    setIsFilterOpen(false);
  };

  // 필터 업데이트
  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    onFiltersChange(filters.map(filter => 
      filter.id === id ? { ...filter, ...updates } : filter
    ));
  };

  // 필터 제거
  const removeFilter = (id: string) => {
    onFiltersChange(filters.filter(filter => filter.id !== id));
  };

  // 정렬 변경
  const handleSortChange = (field: string, direction: 'asc' | 'desc') => {
    const fieldConfig = SORT_FIELDS.find(f => f.value === field);
    if (!fieldConfig) return;

    onSortChange({
      field,
      direction,
      label: fieldConfig.label
    });
    setIsSortOpen(false);
  };

  // 필터 값 렌더링
  const renderFilterValue = (filter: FilterCondition) => {
    const fieldConfig = FILTER_FIELDS.find(f => f.value === filter.field);
    if (!fieldConfig) return null;

    switch (fieldConfig.type) {
      case 'text':
        return (
          <Input
            value={filter.value as string || ''}
            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
            placeholder="값을 입력하세요"
            className="h-8 text-xs w-32"
          />
        );

      case 'select':
        if (filter.field === 'requester_name') {
          return (
            <Combobox
              value={filter.value as string || ''}
              onValueChange={(value) => updateFilter(filter.id, { value })}
              options={employees.map(emp => ({ value: emp.name, label: emp.name }))}
              placeholder="선택"
              className="h-8 text-xs w-32"
              searchPlaceholder="직원 검색..."
              emptyText="일치하는 직원이 없습니다"
            />
          );
        } else if (filter.field === 'vendor_name') {
          return (
            <Select 
              value={filter.value as string || ''} 
              onValueChange={(value) => updateFilter(filter.id, { value })}
            >
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map(vendor => (
                  <SelectItem key={vendor.vendor_name} value={vendor.vendor_name}>
                    {vendor.vendor_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else if (filter.field === 'approval_status') {
          return (
            <Select 
              value={filter.value as string || ''} 
              onValueChange={(value) => updateFilter(filter.id, { value })}
            >
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">대기</SelectItem>
                <SelectItem value="approved">승인</SelectItem>
                <SelectItem value="rejected">반려</SelectItem>
              </SelectContent>
            </Select>
          );
        } else if (filter.field === 'payment_category') {
          return (
            <Select 
              value={filter.value as string || ''} 
              onValueChange={(value) => updateFilter(filter.id, { value })}
            >
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="카드 결제">카드 결제</SelectItem>
                <SelectItem value="현금 결제">현금 결제</SelectItem>
              </SelectContent>
            </Select>
          );
        }
        break;

      case 'date_range':
        return (
          <DateRangePicker
            date={filter.value as DateRange}
            onDateChange={(range) => updateFilter(filter.id, { value: range })}
            placeholder="기간 선택"
            className="w-48"
          />
        );

      case 'date':
        return (
          <Input
            type="date"
            value={filter.value as string || ''}
            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
            className="h-8 text-xs w-32"
          />
        );
    }

    return null;
  };

  return (
    <div className="space-y-3">
      {/* 메인 툴바 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 전체 검색 */}
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="전체 검색..."
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>

        {/* 필터 버튼 */}
        <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-gray-200 hover:border-gray-300"
            >
              <Filter className="w-4 h-4 mr-2" />
              필터
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 min-w-5 text-xs">
                  {activeFilterCount}
                </Badge>
              )}
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600 px-2 py-1">필터 추가</div>
              {FILTER_FIELDS.map(field => (
                <Button
                  key={field.value}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-8 text-xs"
                  onClick={() => addFilter(field.value)}
                >
                  <Plus className="w-3 h-3 mr-2" />
                  {field.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* 정렬 버튼 */}
        <Popover open={isSortOpen} onOpenChange={setIsSortOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-gray-200 hover:border-gray-300"
            >
              {sortCondition ? (
                sortCondition.direction === 'asc' ? (
                  <SortAsc className="w-4 h-4 mr-2" />
                ) : (
                  <SortDesc className="w-4 h-4 mr-2" />
                )
              ) : (
                <SortAsc className="w-4 h-4 mr-2" />
              )}
              정렬
              {sortCondition && (
                <span className="ml-2 text-xs text-gray-600">
                  {sortCondition.label}
                </span>
              )}
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600 px-2 py-1">정렬 기준</div>
              {SORT_FIELDS.map(field => (
                <div key={field.value} className="space-y-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-7 text-xs"
                    onClick={() => handleSortChange(field.value, 'asc')}
                  >
                    <SortAsc className="w-3 h-3 mr-2" />
                    {field.label} (오름차순)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-7 text-xs"
                    onClick={() => handleSortChange(field.value, 'desc')}
                  >
                    <SortDesc className="w-3 h-3 mr-2" />
                    {field.label} (내림차순)
                  </Button>
                </div>
              ))}
              {sortCondition && (
                <div className="border-t pt-1 mt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-7 text-xs text-red-600 hover:text-red-700"
                    onClick={() => onSortChange(null)}
                  >
                    <X className="w-3 h-3 mr-2" />
                    정렬 제거
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* 활성 필터 표시 */}
      {filters.length > 0 && (
        <Card className="border border-gray-200">
          <CardContent className="p-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-600">활성 필터</div>
              <div className="space-y-2">
                {filters.map(filter => {
                  const fieldConfig = FILTER_FIELDS.find(f => f.value === filter.field);
                  const operatorConfig = fieldConfig ? OPERATORS[fieldConfig.type].find(op => op.value === filter.operator) : null;
                  
                  return (
                    <div key={filter.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                      <span className="text-xs font-medium text-gray-700 min-w-16">
                        {filter.label}
                      </span>
                      
                      <Select
                        value={filter.operator}
                        onValueChange={(value) => updateFilter(filter.id, { operator: value })}
                      >
                        <SelectTrigger className="h-7 text-xs w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {fieldConfig && OPERATORS[fieldConfig.type].map(op => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {renderFilterValue(filter)}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeFilter(filter.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              
              {filters.length > 0 && (
                <div className="flex justify-end pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-gray-600 hover:text-gray-800"
                    onClick={() => onFiltersChange([])}
                  >
                    모든 필터 지우기
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}