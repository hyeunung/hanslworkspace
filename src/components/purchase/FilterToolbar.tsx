import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Sliders, 
  ArrowUpDown, 
  Search, 
  X, 
  Plus,
  Calendar,
  User,
  Building,
  Package,
  DollarSign,
  CheckCircle,
  Check
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'

// 필터 타입 정의
export interface FilterRule {
  id: string
  field: string
  condition: string
  value: any
  label: string
  dateField?: string // 기간별/월별 필터에서 실제 날짜 필드
}

export interface SortRule {
  field: string
  direction: 'asc' | 'desc'
  label: string
}

interface FilterToolbarProps {
  activeFilters: FilterRule[]
  sortConfig: SortRule | null
  searchTerm: string
  onFiltersChange: (filters: FilterRule[]) => void
  onSortChange: (sort: SortRule | null) => void
  onSearchChange: (search: string) => void
  availableEmployees?: string[]
  availableVendors?: string[]
  availableContacts?: string[]
  availablePaymentSchedules?: string[]
}

// 필터 항목 정의
const FILTER_FIELDS = [
  // 날짜 필터
  { 
    key: 'date_range', 
    label: '기간별', 
    type: 'date_range',
    icon: Calendar,
    category: '날짜'
  },
  { 
    key: 'date_month', 
    label: '월별', 
    type: 'date_month',
    icon: Calendar,
    category: '날짜'
  },
  
  // 검색&드롭다운 필터
  { 
    key: 'requester_name', 
    label: '요청자', 
    type: 'searchable_select',
    icon: User,
    category: '사용자'
  },
  { 
    key: 'vendor_name', 
    label: '업체', 
    type: 'searchable_select',
    icon: Building,
    category: '사용자'
  },
  { 
    key: 'contact_name', 
    label: '담당자', 
    type: 'searchable_select',
    icon: User,
    category: '사용자'
  },
  
  // 텍스트 필터
  { 
    key: 'purchase_order_number', 
    label: '발주번호', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  { 
    key: 'item_name', 
    label: '품명', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  { 
    key: 'specification', 
    label: '규격', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  { 
    key: 'remark', 
    label: '비고', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  { 
    key: 'project_vendor', 
    label: 'PJ업체', 
    type: 'text',
    icon: Building,
    category: '텍스트'
  },
  { 
    key: 'project_item', 
    label: 'PJ ITEM', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  { 
    key: 'sales_order_number', 
    label: '수주번호', 
    type: 'text',
    icon: Package,
    category: '텍스트'
  },
  
  // 숫자 필터
  { 
    key: 'quantity', 
    label: '수량', 
    type: 'number',
    icon: DollarSign,
    category: '숫자'
  },
  { 
    key: 'unit_price_value', 
    label: '단가', 
    type: 'number',
    icon: DollarSign,
    category: '숫자'
  },
  { 
    key: 'total_amount', 
    label: '합계', 
    type: 'number',
    icon: DollarSign,
    category: '숫자'
  },
  
  // 상태 필터
  { 
    key: 'payment_category', 
    label: '결제종류', 
    type: 'select',
    icon: CheckCircle,
    category: '상태',
    options: ['현장결제', '구매요청', '발주요청']
  },
  { 
    key: 'payment_schedule', 
    label: '지출예정일', 
    type: 'select_with_empty',
    icon: Calendar,
    category: '상태'
  },
  { 
    key: 'is_payment_completed', 
    label: '구매현황', 
    type: 'select',
    icon: CheckCircle,
    category: '상태',
    options: ['대기', '완료']
  },
  { 
    key: 'is_received', 
    label: '입고현황', 
    type: 'select',
    icon: CheckCircle,
    category: '상태',
    options: ['대기', '완료']
  },
  { 
    key: 'is_statement_received', 
    label: '거래명세서 확인', 
    type: 'select',
    icon: CheckCircle,
    category: '상태',
    options: ['대기', '완료']
  }
]

// 조건 옵션 정의
const TEXT_CONDITIONS = [
  { value: 'contains', label: '포함' },
  { value: 'equals', label: '같음' },
  { value: 'starts_with', label: '시작함' },
  { value: 'ends_with', label: '끝남' },
  { value: 'is_empty', label: '비어있음' },
  { value: 'is_not_empty', label: '비어있지 않음' }
]

const NUMBER_CONDITIONS = [
  { value: 'equals', label: '같음' },
  { value: 'greater_than', label: '이상' },
  { value: 'less_than', label: '이하' },
  { value: 'between', label: '범위' },
  { value: 'is_empty', label: '비어있음' },
  { value: 'is_not_empty', label: '비어있지 않음' }
]

const DATE_CONDITIONS = [
  { value: 'equals', label: '같음' },
  { value: 'after', label: '이후' },
  { value: 'before', label: '이전' },
  { value: 'between', label: '범위' },
  { value: 'is_empty', label: '비어있음' },
  { value: 'is_not_empty', label: '비어있지 않음' }
]

const SELECT_CONDITIONS = [
  { value: 'equals', label: '같음' },
  { value: 'not_equals', label: '아님' }
]

// 날짜 필드 옵션 정의
const DATE_FIELDS = [
  { value: 'request_date', label: '청구일' },
  { value: 'delivery_request_date', label: '입고요청일' },
  { value: 'payment_completed_at', label: '구매완료일' },
  { value: 'received_at', label: '입고완료일' },
  { value: 'created_at', label: '생성일' },
  { value: 'statement_received_at', label: '거래명세서입고일' }
]

// 정렬 옵션 정의
const SORT_FIELDS = [
  { value: 'request_date', label: '요청일' },
  { value: 'purchase_order_number', label: '발주번호' },
  { value: 'vendor_name', label: '업체명' },
  { value: 'requester_name', label: '요청자' },
  { value: 'total_amount', label: '합계' },
  { value: 'delivery_request_date', label: '입고요청일' },
  { value: 'created_at', label: '생성일' }
]

export default function FilterToolbar({
  activeFilters,
  sortConfig,
  searchTerm,
  onFiltersChange,
  onSortChange,
  onSearchChange,
  availableEmployees = [],
  availableVendors = [],
  availableContacts = [],
  availablePaymentSchedules = []
}: FilterToolbarProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [newFilter, setNewFilter] = useState<Partial<FilterRule>>({})
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [tempDateRange, setTempDateRange] = useState<{from?: Date, to?: Date}>({})
  const [tempMonth, setTempMonth] = useState<Date | undefined>()
  const [tempMonthRange, setTempMonthRange] = useState<{from?: Date, to?: Date}>({})
  const [tempSort, setTempSort] = useState<{field?: string, direction?: 'asc' | 'desc'}>({})
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 검색 확장 시 포커스
  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isSearchExpanded])

  // 정렬 팝오버 열 때 현재 설정 불러오기
  useEffect(() => {
    if (isSortOpen) {
      setTempSort({
        field: sortConfig?.field || '',
        direction: sortConfig?.direction || 'asc'
      })
    }
  }, [isSortOpen, sortConfig])

  const handleAddFilter = (field: string) => {
    const fieldConfig = FILTER_FIELDS.find(f => f.key === field)
    if (!fieldConfig) return

    // 날짜 타입 필터는 기본 조건 설정
    let defaultCondition = 'contains'
    if (fieldConfig.type === 'date_range' || fieldConfig.type === 'date_month') {
      defaultCondition = 'equals'
    }

    setNewFilter({
      id: `${field}_${Date.now()}`,
      field,
      condition: defaultCondition,
      value: '',
      label: fieldConfig.label
    })
  }

  const handleApplyFilter = () => {
    const isDateFilter = newFilter.field === 'date_range' || newFilter.field === 'date_month'
    const requiresDateField = isDateFilter && !newFilter.dateField
    
    // 조건이 없으면 자동으로 기본 조건 설정
    let finalCondition = newFilter.condition
    if (!finalCondition) {
      if (isDateFilter) {
        finalCondition = 'equals'
      } else {
        // 텍스트 필터는 'contains', 선택 필터는 'equals'
        const fieldConfig = FILTER_FIELDS.find(f => f.key === newFilter.field)
        finalCondition = (fieldConfig?.type === 'select' || fieldConfig?.type === 'select_with_empty' || fieldConfig?.type === 'searchable_select') 
          ? 'equals' 
          : 'contains'
      }
    }
    
    if (newFilter.field && finalCondition !== undefined && newFilter.value !== '' && !requiresDateField) {
      const filter: FilterRule = {
        id: newFilter.id!,
        field: newFilter.field,
        condition: finalCondition,
        value: newFilter.value,
        label: newFilter.label!,
        dateField: newFilter.dateField // 날짜 필드 정보 포함
      }
      onFiltersChange([...activeFilters, filter])
      setNewFilter({})
      setIsFilterOpen(false)
    }
  }

  const handleRemoveFilter = (filterId: string) => {
    onFiltersChange(activeFilters.filter(f => f.id !== filterId))
  }

  const handleClearAllFilters = () => {
    onFiltersChange([])
    setIsFilterOpen(false)
  }

  const handleSortFieldChange = (field: string) => {
    setTempSort(prev => ({ ...prev, field }))
  }

  const handleSortDirectionChange = (direction: 'asc' | 'desc') => {
    setTempSort(prev => ({ ...prev, direction }))
  }

  const handleApplySort = () => {
    if (tempSort.field && tempSort.direction) {
      const fieldConfig = SORT_FIELDS.find(f => f.value === tempSort.field)
      if (fieldConfig) {
        onSortChange({
          field: tempSort.field,
          direction: tempSort.direction,
          label: fieldConfig.label
        })
      }
    }
    setIsSortOpen(false)
    setTempSort({})
  }

  const handleClearSort = () => {
    onSortChange(null)
    setTempSort({})
    setIsSortOpen(false)
  }

  const getConditionOptions = (fieldType: string) => {
    switch (fieldType) {
      case 'text':
      case 'searchable_select':
        return TEXT_CONDITIONS
      case 'number':
        return NUMBER_CONDITIONS
      case 'date_range':
      case 'date_month':
        return DATE_CONDITIONS
      case 'select':
      case 'select_with_empty':
        return SELECT_CONDITIONS
      default:
        return TEXT_CONDITIONS
    }
  }

  const renderValueInput = () => {
    const fieldConfig = FILTER_FIELDS.find(f => f.key === newFilter.field)
    if (!fieldConfig) return null

    switch (fieldConfig.type) {
      case 'text':
        return (
          <Input
            placeholder="값 입력"
            value={newFilter.value || ''}
            onChange={(e) => setNewFilter(prev => ({ ...prev, value: e.target.value }))}
            className="w-full business-radius-input border border-gray-300 bg-white text-gray-700 card-description h-auto"
            style={{padding: '2px 10px', fontSize: '10px', fontWeight: '500'}}
          />
        )
      
      case 'number':
        return (
          <Input
            type="number"
            placeholder="숫자 입력"
            value={newFilter.value || ''}
            onChange={(e) => setNewFilter(prev => ({ ...prev, value: e.target.value }))}
            className="w-full business-radius-input border border-gray-300 bg-white text-gray-700 card-description h-auto"
            style={{padding: '2px 10px', fontSize: '10px', fontWeight: '500'}}
          />
        )

      case 'searchable_select':
        let options: string[] = []
        let placeholder = "선택"
        if (fieldConfig.key === 'requester_name') {
          options = availableEmployees
          placeholder = "요청자"
        } else if (fieldConfig.key === 'vendor_name') {
          options = availableVendors
          placeholder = "업체"
        } else if (fieldConfig.key === 'contact_name') {
          options = availableContacts
          placeholder = "담당자"
        }

        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full button-base business-radius-button border border-gray-300 bg-white text-gray-700 justify-between [&>svg]:hidden"
              >
                <span className="truncate text-left" style={{fontSize: '12px', fontWeight: '500'}}>
                  {newFilter.value || placeholder}
                </span>
                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0 border-0 shadow-lg" align="start">
              <Command className="border-0">
                <CommandInput placeholder={`${placeholder} 검색...`} className="h-auto border-0 focus:ring-0 focus:outline-none card-description placeholder:card-description" style={{padding: '2px 10px'}} />
                <CommandEmpty>{placeholder}를 찾을 수 없습니다.</CommandEmpty>
                <CommandGroup className="max-h-[200px] overflow-y-auto">
                  {options.map(option => (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={(value) => {
                        setNewFilter(prev => ({ ...prev, value: value }));
                      }}
                      className="cursor-pointer"
                    >
                      <Check
                        className={`mr-2 h-3 w-3 ${
                          newFilter.value === option ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="card-description">{option}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        )

      case 'select':
        return (
          <Select value={newFilter.value || ''} onValueChange={(value) => setNewFilter(prev => ({ ...prev, value }))}>
            <SelectTrigger className="button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden text-center">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              {fieldConfig.options?.map(option => (
                <SelectItem key={option} value={option}>
                  <span className="card-description">{option}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'select_with_empty':
        const scheduleOptions = ['공란', ...availablePaymentSchedules]
        return (
          <Select value={newFilter.value || ''} onValueChange={(value) => setNewFilter(prev => ({ ...prev, value }))}>
            <SelectTrigger className="button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden text-center">
              <SelectValue placeholder="지출예정일" />
            </SelectTrigger>
            <SelectContent>
              {scheduleOptions.map(option => (
                <SelectItem key={option} value={option}>
                  <span className="card-description">{option}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'date_range':
        return (
          <Popover open={datePickerOpen} onOpenChange={(open) => {
            if (open) {
              // 팝오버 열릴 때 기존 값 로드
              if (newFilter.value) {
                if (newFilter.value.includes('~')) {
                  const [start, end] = newFilter.value.split('~');
                  setTempDateRange({
                    from: new Date(start),
                    to: new Date(end)
                  });
                } else {
                  setTempDateRange({
                    from: new Date(newFilter.value),
                    to: undefined
                  });
                }
              } else {
                setTempDateRange({});
              }
            }
            setDatePickerOpen(open);
          }}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="w-full button-base business-radius-button border border-gray-300 bg-white text-gray-700 justify-between h-auto"
              >
                <div className="flex items-center gap-1.5 min-h-[32px]">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span className="card-description leading-tight whitespace-pre-line">
                    {newFilter.value ? (() => {
                      if (newFilter.value.includes('~')) {
                        const [start, end] = newFilter.value.split('~');
                        return `${format(new Date(start), 'yy/MM/dd')}\n~ ${format(new Date(end), 'yy/MM/dd')}`;
                      } else {
                        return format(new Date(newFilter.value), 'yy/MM/dd');
                      }
                    })() : '날짜 선택'}
                  </span>
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="space-y-3">
                <div className="p-3 pb-0">
                  <div className="text-xs font-medium text-gray-600 mb-2">날짜 범위 선택</div>
                  <CalendarComponent
                    mode="range"
                    selected={tempDateRange}
                    onSelect={(range) => {
                      if (range) {
                        setTempDateRange(range);
                      }
                    }}
                    numberOfMonths={1}
                    initialFocus
                    className="compact-calendar"
                  />
                </div>
                <div className="flex gap-2 p-3 pt-0">
                  <Button
                    onClick={() => {
                      setTempDateRange({});
                      setDatePickerOpen(false);
                    }}
                    variant="outline"
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex-1"
                  >
                    취소
                  </Button>
                  <Button
                    onClick={() => {
                      if (tempDateRange.from) {
                        if (tempDateRange.to) {
                          // 시작~종료 날짜
                          const rangeValue = `${format(tempDateRange.from, 'yyyy-MM-dd')}~${format(tempDateRange.to, 'yyyy-MM-dd')}`;
                          setNewFilter(prev => ({ ...prev, value: rangeValue }));
                        } else {
                          // 시작날짜만 (해당일만 검색)
                          setNewFilter(prev => ({ ...prev, value: format(tempDateRange.from, 'yyyy-MM-dd') }));
                        }
                        setDatePickerOpen(false);
                      }
                    }}
                    disabled={!tempDateRange.from}
                    className="button-base bg-blue-500 text-white hover:bg-blue-600 flex-1"
                  >
                    확인
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )

      case 'date_month':
        return (
          <Popover open={monthPickerOpen} onOpenChange={(open) => {
            if (open) {
              // 팝오버 열릴 때 기존 값 로드
              if (newFilter.value) {
                if (newFilter.value.includes('~')) {
                  const [start, end] = newFilter.value.split('~');
                  setTempMonthRange({
                    from: new Date(`${start}-01`),
                    to: new Date(`${end}-01`)
                  });
                } else {
                  setTempMonthRange({
                    from: new Date(`${newFilter.value}-01`),
                    to: undefined
                  });
                }
              } else {
                setTempMonthRange({});
              }
            }
            setMonthPickerOpen(open);
          }}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="w-full button-base business-radius-button border border-gray-300 bg-white text-gray-700 justify-between h-auto"
              >
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span className="card-description leading-tight whitespace-pre-line">
                    {newFilter.value ? (() => {
                      if (newFilter.value.includes('~')) {
                        const [start, end] = newFilter.value.split('~');
                        const [startYear, startMonth] = start.split('-');
                        const [endYear, endMonth] = end.split('-');
                        return `${startYear.slice(-2)}/${startMonth}\n~ ${endYear.slice(-2)}/${endMonth}`;
                      } else {
                        const [year, month] = newFilter.value.split('-');
                        return `${year.slice(-2)}/${month}`;
                      }
                    })() : '월 선택'}
                  </span>
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="space-y-3">
                <div className="p-3 pb-0">
                  <div className="text-xs font-medium text-gray-600 mb-3">월 선택</div>
                  
                  {/* 월 선택기 - 년도별 12개월 그리드 */}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">시작 월 선택</div>
                      {/* 년도 선택 */}
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <Button
                            onClick={() => {
                              const currentYear = tempMonthRange.from ? tempMonthRange.from.getFullYear() : new Date().getFullYear();
                              const newDate = new Date(currentYear - 1, tempMonthRange.from ? tempMonthRange.from.getMonth() : 0, 1);
                              setTempMonthRange(prev => ({ ...prev, from: newDate }));
                            }}
                            variant="outline"
                            size="sm"
                            className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                          >
                            ‹
                          </Button>
                          <span className="text-sm font-medium text-gray-700">
                            {tempMonthRange.from ? tempMonthRange.from.getFullYear() : new Date().getFullYear()}년
                          </span>
                          <Button
                            onClick={() => {
                              const currentYear = tempMonthRange.from ? tempMonthRange.from.getFullYear() : new Date().getFullYear();
                              const newDate = new Date(currentYear + 1, tempMonthRange.from ? tempMonthRange.from.getMonth() : 0, 1);
                              setTempMonthRange(prev => ({ ...prev, from: newDate }));
                            }}
                            variant="outline"
                            size="sm"
                            className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                          >
                            ›
                          </Button>
                        </div>
                      </div>
                      
                      {/* 12개월 그리드 */}
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 12 }, (_, i) => {
                          const currentYear = tempMonthRange.from ? tempMonthRange.from.getFullYear() : new Date().getFullYear();
                          const monthDate = new Date(currentYear, i, 1);
                          const isSelected = tempMonthRange.from && 
                            tempMonthRange.from.getFullYear() === currentYear && 
                            tempMonthRange.from.getMonth() === i;
                          
                          return (
                            <Button
                              key={i}
                              onClick={() => {
                                setTempMonthRange(prev => ({ ...prev, from: monthDate }));
                              }}
                              variant="outline"
                              className={`button-base text-xs h-8 ${
                                isSelected 
                                  ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600' 
                                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {i + 1}월
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    
                    {tempMonthRange.from && (
                      <div>
                        <div className="text-xs text-gray-500 mb-2">종료 월 선택 (선택사항)</div>
                        {/* 종료 월 년도 선택 */}
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-2">
                            <Button
                              onClick={() => {
                                const currentYear = tempMonthRange.to ? tempMonthRange.to.getFullYear() : tempMonthRange.from.getFullYear();
                                const newDate = new Date(currentYear - 1, tempMonthRange.to ? tempMonthRange.to.getMonth() : 11, 1);
                                setTempMonthRange(prev => ({ ...prev, to: newDate }));
                              }}
                              variant="outline"
                              size="sm"
                              className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                            >
                              ‹
                            </Button>
                            <span className="text-sm font-medium text-gray-700">
                              {tempMonthRange.to ? tempMonthRange.to.getFullYear() : tempMonthRange.from.getFullYear()}년
                            </span>
                            <Button
                              onClick={() => {
                                const currentYear = tempMonthRange.to ? tempMonthRange.to.getFullYear() : tempMonthRange.from.getFullYear();
                                const newDate = new Date(currentYear + 1, tempMonthRange.to ? tempMonthRange.to.getMonth() : 11, 1);
                                setTempMonthRange(prev => ({ ...prev, to: newDate }));
                              }}
                              variant="outline"
                              size="sm"
                              className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                            >
                              ›
                            </Button>
                          </div>
                        </div>
                        
                        {/* 종료 월 12개월 그리드 */}
                        <div className="grid grid-cols-3 gap-2">
                          {Array.from({ length: 12 }, (_, i) => {
                            const currentYear = tempMonthRange.to ? tempMonthRange.to.getFullYear() : tempMonthRange.from.getFullYear();
                            const monthDate = new Date(currentYear, i, 1);
                            const isSelected = tempMonthRange.to && 
                              tempMonthRange.to.getFullYear() === currentYear && 
                              tempMonthRange.to.getMonth() === i;
                            const isDisabled = monthDate < tempMonthRange.from;
                            
                            return (
                              <Button
                                key={i}
                                onClick={() => {
                                  if (!isDisabled) {
                                    setTempMonthRange(prev => ({ ...prev, to: monthDate }));
                                  }
                                }}
                                variant="outline"
                                disabled={isDisabled}
                                className={`button-base text-xs h-8 ${
                                  isSelected 
                                    ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600' 
                                    : isDisabled
                                    ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {i + 1}월
                              </Button>
                            );
                          })}
                        </div>
                        
                        <div className="mt-3">
                          <Button
                            onClick={() => {
                              setTempMonthRange(prev => ({ ...prev, to: undefined }));
                            }}
                            variant="outline"
                            size="sm"
                            className="button-base border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 text-xs"
                          >
                            종료 월 제거
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 p-3 pt-0">
                  <Button
                    onClick={() => {
                      setTempMonthRange({});
                      setMonthPickerOpen(false);
                    }}
                    variant="outline"
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex-1"
                  >
                    취소
                  </Button>
                  <Button
                    onClick={() => {
                      if (tempMonthRange.from) {
                        if (tempMonthRange.to) {
                          // 월 범위
                          const rangeValue = `${format(tempMonthRange.from, 'yyyy-MM')}~${format(tempMonthRange.to, 'yyyy-MM')}`;
                          setNewFilter(prev => ({ ...prev, value: rangeValue }));
                        } else {
                          // 단일 월
                          setNewFilter(prev => ({ ...prev, value: format(tempMonthRange.from, 'yyyy-MM') }));
                        }
                        setMonthPickerOpen(false);
                      }
                    }}
                    disabled={!tempMonthRange.from}
                    className="button-base bg-blue-500 text-white hover:bg-blue-600 flex-1"
                  >
                    확인
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )

      default:
        return null
    }
  }

  return (
    <div className="w-full space-y-3">
      {/* 필터 툴바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 필터 버튼 */}
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <Sliders className="w-4 h-4 mr-1" />
                <span className="button-text">필터</span>
                {activeFilters.length > 0 && (
                  <Badge variant="secondary" className="ml-1 badge-stats-primary">
                    {activeFilters.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="card-title">필터</h4>
                  {activeFilters.length > 0 && (
                    <Button
                      variant="ghost"
                      onClick={handleClearAllFilters}
                      className="button-base text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <span className="button-text">모두 지우기</span>
                    </Button>
                  )}
                </div>

                {/* 활성 필터 목록 */}
                {activeFilters.length > 0 && (
                  <div className="space-y-2">
                    {activeFilters.map(filter => (
                      <div key={filter.id} className="flex items-center justify-between p-2 bg-gray-50 business-radius">
                        <span className="card-description">
                          {filter.label}
                          {filter.dateField && (
                            <span className="text-blue-600">
                              ({DATE_FIELDS.find(df => df.value === filter.dateField)?.label})
                            </span>
                          )}
                          : {filter.value}
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() => handleRemoveFilter(filter.id)}
                          className="button-base h-6 w-6 p-0 hover:bg-red-50"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 my-2" />
                  </div>
                )}

                {/* 새 필터 추가 */}
                <div className="space-y-2">
                  <Select onValueChange={handleAddFilter}>
                    <SelectTrigger className="button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden text-center">
                      <SelectValue placeholder="+ 필터 추가" />
                    </SelectTrigger>
                    <SelectContent 
                      className="w-64 max-h-80 overflow-y-auto"
                      style={{
                        scrollbarWidth: 'auto',
                        scrollbarColor: '#9ca3af #f3f4f6',
                        WebkitScrollbarWidth: '8px'
                      }}
                    >
                      {Object.entries(
                        FILTER_FIELDS.reduce((acc, field) => {
                          if (!acc[field.category]) acc[field.category] = []
                          acc[field.category].push(field)
                          return acc
                        }, {} as Record<string, typeof FILTER_FIELDS>)
                      ).map(([category, fields]) => (
                        <div key={category}>
                          <div className="px-2 py-1 card-description uppercase">
                            {category}
                          </div>
                          {fields.map(field => (
                            <SelectItem key={field.key} value={field.key}>
                              <div className="flex items-center gap-2">
                                <field.icon className="w-4 h-4" />
                                <span className="card-description">{field.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* 필터 설정 UI */}
                  {newFilter.field && (
                    <div className="space-y-2 p-3 border business-radius bg-white">
                      <div className="flex items-center gap-2">
                        <span className="card-title">{newFilter.label} 필터</span>
                      </div>
                      
                      {/* 날짜 필터인 경우 */}
                      {(newFilter.field === 'date_range' || newFilter.field === 'date_month') ? (
                        <div className="grid grid-cols-2 gap-2">
                          {/* 날짜 필드 선택 */}
                          <div className="flex items-start">
                            <Select 
                              value={newFilter.dateField || ''} 
                              onValueChange={(value) => setNewFilter(prev => ({ ...prev, dateField: value }))}
                            >
                              <SelectTrigger className="w-full button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden text-center justify-center">
                                <SelectValue placeholder="날짜 항목" className="text-center" />
                              </SelectTrigger>
                              <SelectContent>
                                {DATE_FIELDS.map(dateField => (
                                  <SelectItem key={dateField.value} value={dateField.value}>
                                    <span className="card-description">{dateField.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* 날짜 값 입력 */}
                          <div className="flex items-start">
                            {renderValueInput()}
                          </div>
                        </div>
                      ) : (
                        /* 일반 필터인 경우 - 조건 선택 없이 바로 값 입력 */
                        <div>
                          {renderValueInput()}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={handleApplyFilter}
                          disabled={
                            !newFilter.field || 
                            newFilter.value === '' ||
                            ((newFilter.field === 'date_range' || newFilter.field === 'date_month') && !newFilter.dateField)
                          }
                          className="button-base bg-blue-500 text-white hover:bg-blue-600 flex-1"
                        >
                          적용
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setNewFilter({})}
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex-1"
                        >
                          취소
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* 정렬 버튼 */}
          <Popover open={isSortOpen} onOpenChange={setIsSortOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <ArrowUpDown className="w-4 h-4 mr-1" />
                <span className="button-text">정렬</span>
                {sortConfig && (
                  <span className="ml-1 card-description">
                    ({sortConfig.direction === 'asc' ? '↑' : '↓'})
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="start">
              <div className="space-y-3">
                <h4 className="card-title">정렬 설정</h4>
                
                <div className="space-y-2">
                  {/* 정렬 필드 선택 */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">정렬 기준</label>
                    <Select 
                      value={tempSort.field || ''} 
                      onValueChange={handleSortFieldChange}
                    >
                      <SelectTrigger className="button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden">
                        <SelectValue placeholder="선택하세요" />
                      </SelectTrigger>
                      <SelectContent>
                        {SORT_FIELDS.map(field => (
                          <SelectItem key={field.value} value={field.value}>
                            <span className="card-description">{field.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 정렬 방향 선택 */}
                  {tempSort.field && (
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">정렬 방향</label>
                      <Select 
                        value={tempSort.direction || ''} 
                        onValueChange={handleSortDirectionChange}
                      >
                        <SelectTrigger className="button-base business-radius-button border border-gray-300 bg-white text-gray-700 [&>svg]:hidden">
                          <SelectValue placeholder="선택하세요" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">
                            <span className="card-description">오름차순 ↑</span>
                          </SelectItem>
                          <SelectItem value="desc">
                            <span className="card-description">내림차순 ↓</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* 적용/초기화 버튼 */}
                  <div className="flex gap-2 pt-2">
                    <Button 
                      onClick={handleApplySort}
                      disabled={!tempSort.field || !tempSort.direction}
                      className="button-base bg-blue-500 hover:bg-blue-600 text-white flex-1"
                    >
                      적용
                    </Button>
                    <Button 
                      onClick={handleClearSort}
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      초기화
                    </Button>
                  </div>
                </div>

                {sortConfig && (
                  <div className="border-t pt-2">
                    <Button
                      variant="outline"
                      onClick={() => onSortChange(null)}
                      className="button-base w-full border border-gray-300 text-gray-700"
                    >
                      <span className="button-text">정렬 해제</span>
                    </Button>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* 검색 버튼 */}
          <div className="flex items-center gap-2">
            {!isSearchExpanded ? (
              <Button
                variant="outline"
                onClick={() => setIsSearchExpanded(true)}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <Search className="w-4 h-4 mr-1" />
                <span className="button-text">검색</span>
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  ref={searchInputRef}
                  placeholder="전체 검색..."
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-64 business-radius-input button-base border border-gray-300 bg-white text-gray-700"
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsSearchExpanded(false)
                    onSearchChange('')
                  }}
                  className="button-base h-8 w-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* 전체 초기화 버튼 */}
          <Button
            variant="outline"
            onClick={() => {
              onSearchChange('')
              onFiltersChange([])
              onSortChange({
                field: 'created_at',
                direction: 'desc',
                label: '생성일'
              })
              setIsSearchExpanded(false)
            }}
            className="button-base border border-gray-300 bg-white text-blue-600 hover:bg-blue-50 hover:border-blue-300"
          >
            ↻ <span className="button-text">초기화</span>
          </Button>
        </div>
      </div>

      {/* 활성 필터 태그 */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map(filter => (
            <Badge
              key={filter.id}
              variant="secondary"
              className="badge-base flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-200"
            >
              {filter.label}
              {filter.dateField && (
                <span className="text-blue-600">
                  ({DATE_FIELDS.find(df => df.value === filter.dateField)?.label})
                </span>
              )}
              : {filter.value}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveFilter(filter.id)}
                className="h-4 w-4 p-0 hover:bg-blue-100 ml-1"
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}