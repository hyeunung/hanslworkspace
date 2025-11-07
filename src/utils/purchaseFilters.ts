/**
 * 클라이언트 사이드 구매 필터링 유틸리티
 * 메모리에 있는 데이터를 즉시 필터링
 */

import type { Purchase } from '@/types/purchase'
import type { Employee } from '@/types/schema'
import { HIDDEN_EMPLOYEES } from '@/config/constants'

// 탭 타입 정의
export type TabType = 'pending' | 'purchase' | 'receipt' | 'done'

/**
 * 탭별 필터링
 */
export const filterByTab = (
  purchases: Purchase[],
  tab: TabType,
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = typeof currentUser.purchase_role === 'string' 
    ? currentUser.purchase_role.split(',').map(r => r.trim())
    : []
  
  switch (tab) {
    case 'pending': {
      // 승인 대기 탭: 승인자별 필터링
      return purchases.filter(purchase => {
        // 기본 조건: 승인 대기 상태
        if (purchase.approval_status !== '승인 대기') return false
        
        // 역할별 필터링
        if (userRoles.includes('lead_buyer')) {
          // lead_buyer: 구매 요청만
          return purchase.purchase_type === '구매 요청'
        } else if (userRoles.includes('ceo')) {
          // CEO: 대표이사 승인 필요한 것만
          return purchase.requires_ceo_approval === true
        } else if (userRoles.includes('finance_team')) {
          // 재무팀: 결제 요청만
          return purchase.purchase_type === '결제 요청'
        } else if (userRoles.includes('raw_material_manager')) {
          // 원자재 관리자: 발주만
          return purchase.purchase_type === '발주'
        } else if (userRoles.includes('consumable_manager')) {
          // 소모품 관리자: 구매 요청만
          return purchase.purchase_type === '구매 요청'
        }
        return false
      })
    }
    
    case 'purchase': {
      // 구매 현황 탭: 진행 중인 구매들
      return purchases.filter(purchase => {
        // 승인됨 + 미입고 상태
        return purchase.approval_status === '승인됨' && 
               !purchase.is_all_received &&
               purchase.purchase_type !== '결제 요청' // 결제 요청 제외
      })
    }
    
    case 'receipt': {
      // 입고 현황 탭: 부분 입고 상태
      return purchases.filter(purchase => {
        // 부분 입고 (일부만 입고됨)
        return purchase.approval_status === '승인됨' &&
               purchase.received_count > 0 &&
               purchase.received_count < purchase.total_count &&
               purchase.purchase_type !== '결제 요청'
      })
    }
    
    case 'done':
    default: {
      // 전체 항목 탭: 모든 데이터
      return purchases
    }
  }
}

/**
 * 직원별 필터링
 */
export const filterByEmployee = (
  purchases: Purchase[],
  employeeName: string | null,
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !employeeName || employeeName === '전체') return purchases
  
  // HIDDEN_EMPLOYEES 체크 (관리자 권한 필요)
  const userRoles = typeof currentUser?.purchase_role === 'string' 
    ? currentUser.purchase_role.split(',').map(r => r.trim())
    : []
  const hasManagerRole = userRoles.some(role => 
    ['lead_buyer', 'ceo', 'finance_team', 'raw_material_manager', 'consumable_manager'].includes(role)
  )
  
  return purchases.filter(purchase => {
    const requestorName = purchase.requestor_name || ''
    
    // HIDDEN_EMPLOYEES 처리
    if (HIDDEN_EMPLOYEES.includes(requestorName) && !hasManagerRole) {
      return false
    }
    
    return requestorName === employeeName
  })
}

/**
 * 고급 필터 적용
 */
export const applyAdvancedFilters = (
  purchases: Purchase[],
  filters: any[]
): Purchase[] => {
  if (!filters || filters.length === 0) return purchases
  
  return purchases.filter(purchase => {
    return filters.every(filter => {
      const { field, operator, value } = filter
      const fieldValue = getFieldValue(purchase, field)
      
      switch (operator) {
        case 'contains':
          return String(fieldValue).toLowerCase().includes(String(value).toLowerCase())
        case 'equals':
          return fieldValue === value
        case 'notEquals':
          return fieldValue !== value
        case 'greaterThan':
          return Number(fieldValue) > Number(value)
        case 'lessThan':
          return Number(fieldValue) < Number(value)
        case 'between':
          const [min, max] = value.split(',').map(Number)
          const numValue = Number(fieldValue)
          return numValue >= min && numValue <= max
        case 'in':
          const values = value.split(',').map((v: string) => v.trim())
          return values.includes(String(fieldValue))
        case 'startsWith':
          return String(fieldValue).toLowerCase().startsWith(String(value).toLowerCase())
        case 'endsWith':
          return String(fieldValue).toLowerCase().endsWith(String(value).toLowerCase())
        default:
          return true
      }
    })
  })
}

/**
 * 검색어 필터링
 */
export const filterBySearchTerm = (
  purchases: Purchase[],
  searchTerm: string
): Purchase[] => {
  if (!searchTerm || searchTerm.trim() === '') return purchases
  
  const term = searchTerm.toLowerCase().trim()
  
  return purchases.filter(purchase => {
    // 검색 대상 필드들
    const searchableFields = [
      purchase.purchase_order_number,
      purchase.requestor_name,
      purchase.pr_number,
      purchase.vendor_name,
      purchase.approval_status,
      purchase.purchase_type,
      purchase.additional_requests,
      // 품목 정보도 검색
      ...(purchase.items || []).map(item => [
        item.item_name,
        item.item_detail,
        item.manufacturer,
        item.model,
        item.spec
      ]).flat()
    ]
    
    // 어느 하나라도 매치하면 true
    return searchableFields.some(field => 
      field && String(field).toLowerCase().includes(term)
    )
  })
}

/**
 * 날짜 범위 필터링
 */
export const filterByDateRange = (
  purchases: Purchase[],
  startDate?: string,
  endDate?: string
): Purchase[] => {
  if (!startDate && !endDate) return purchases
  
  return purchases.filter(purchase => {
    const requestDate = new Date(purchase.request_date)
    
    if (startDate && requestDate < new Date(startDate)) return false
    if (endDate && requestDate > new Date(endDate)) return false
    
    return true
  })
}

/**
 * 정렬 적용
 */
export const sortPurchases = (
  purchases: Purchase[],
  sortConfig?: { key: string; direction: 'asc' | 'desc' }
): Purchase[] => {
  if (!sortConfig) return purchases
  
  return [...purchases].sort((a, b) => {
    const aValue = getFieldValue(a, sortConfig.key)
    const bValue = getFieldValue(b, sortConfig.key)
    
    if (aValue === null || aValue === undefined) return 1
    if (bValue === null || bValue === undefined) return -1
    
    let comparison = 0
    if (aValue > bValue) comparison = 1
    if (aValue < bValue) comparison = -1
    
    return sortConfig.direction === 'desc' ? -comparison : comparison
  })
}

/**
 * 필드 값 추출 헬퍼
 */
const getFieldValue = (purchase: Purchase, field: string): any => {
  // 중첩된 필드 처리 (예: items.0.item_name)
  const keys = field.split('.')
  let value: any = purchase
  
  for (const key of keys) {
    if (value === null || value === undefined) return null
    value = value[key]
  }
  
  return value
}

/**
 * 탭별 카운트 계산
 */
export const calculateTabCounts = (
  allPurchases: Purchase[],
  currentUser: Employee | null
): Record<TabType, number> => {
  return {
    pending: filterByTab(allPurchases, 'pending', currentUser).length,
    purchase: filterByTab(allPurchases, 'purchase', currentUser).length,
    receipt: filterByTab(allPurchases, 'receipt', currentUser).length,
    done: allPurchases.length
  }
}

/**
 * 통합 필터링 함수
 */
export interface FilterOptions {
  tab?: TabType
  employeeName?: string | null
  searchTerm?: string
  advancedFilters?: any[]
  startDate?: string
  endDate?: string
  sortConfig?: { key: string; direction: 'asc' | 'desc' }
}

export const applyAllFilters = (
  purchases: Purchase[],
  options: FilterOptions,
  currentUser: Employee | null
): Purchase[] => {
  let filtered = purchases
  
  // 1. 탭 필터
  if (options.tab) {
    filtered = filterByTab(filtered, options.tab, currentUser)
  }
  
  // 2. 직원 필터
  if (options.employeeName) {
    filtered = filterByEmployee(filtered, options.employeeName, currentUser)
  }
  
  // 3. 검색어 필터
  if (options.searchTerm) {
    filtered = filterBySearchTerm(filtered, options.searchTerm)
  }
  
  // 4. 고급 필터
  if (options.advancedFilters) {
    filtered = applyAdvancedFilters(filtered, options.advancedFilters)
  }
  
  // 5. 날짜 범위 필터
  if (options.startDate || options.endDate) {
    filtered = filterByDateRange(filtered, options.startDate, options.endDate)
  }
  
  // 6. 정렬
  if (options.sortConfig) {
    filtered = sortPurchases(filtered, options.sortConfig)
  }
  
  return filtered
}
