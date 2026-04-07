/**
 * 클라이언트 사이드 구매 필터링 유틸리티
 * 메모리에 있는 데이터를 즉시 필터링
 */

import type { Purchase, Employee, PurchaseRequestItem } from '@/types/purchase'
import { HIDDEN_EMPLOYEES } from '@/config/constants'
import { logger } from '@/lib/logger'
import { parseRoles } from '@/utils/roleHelper'

// 탭 타입 정의
export type TabType = 'pending' | 'purchase' | 'receipt' | 'done'

// 품목 필드 목록 정의
const ITEM_FIELDS = [
  'item_name',
  'item_detail',
  'specification',
  'spec',
  'quantity',
  'unit_price',
  'unit_price_value',
  'unit_price_currency',
  'amount',
  'amount_value',
  'amount_currency',
  'manufacturer',
  'model',
  'remark',
  'link'
]

/**
 * 탭별 필터링
 */
export const filterByTab = (
  purchases: Purchase[],
  tab: TabType,
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)

  switch (tab) {
    case 'pending': {
      // 승인 대기 탭: 권한별로 필터링
      return purchases.filter(purchase => {
        // 기본 조건: 둘 다 approved면 제외
        if (purchase.middle_manager_status === 'approved' &&
            purchase.final_manager_status === 'approved') {
          return false // 승인 완료는 승인대기 탭에서 제외
        }

        // 반려된 경우 제외
        if (purchase.middle_manager_status === 'rejected' ||
            purchase.final_manager_status === 'rejected') {
          return false
        }

        // 1. 카테고리별 관리자 먼저 체크 (특정 항목만 보기)
        if (userRoles.includes('consumable_manager')) {
          // 구매 요청만 볼 수 있음
          if (purchase.payment_category !== '구매 요청') {
            return false
          }
        }

        if (userRoles.includes('raw_material_manager')) {
          // 발주만 볼 수 있음
          if (purchase.payment_category !== '발주') {
            return false
          }
        }

        // 2. 전체 권한자 체크 (superadmin과 ceo만)
        if (userRoles.includes('superadmin') ||
            userRoles.includes('ceo')) {
          logger.debug('🔥 App Admin detected! Showing all items for:', { purchase_order_number: purchase.purchase_order_number });
          return true
        }

        // 3. middle_manager는 중간승인 대기 항목만
        if (userRoles.includes('middle_manager')) {
          const middleStatus = purchase.middle_manager_status
          const isMiddlePending = !middleStatus || middleStatus === 'pending' || middleStatus === '대기'
          return isMiddlePending
        }
        
        // 4. 일반 직원은 본인이 요청한 항목만
        return purchase.requester_name === currentUser?.name
      })
    }
    
    case 'purchase': {
      // 구매 현황 탭: 결제 대기중인 구매요청들
      // 관리자 권한 체크
      const hasManagerRole = userRoles.some((role: string) => 
        ['superadmin', 'ceo', 'lead buyer', 'raw_material_manager', 'consumable_manager', 'purchase_manager', 'hr'].includes(role)
      )
      
      return purchases.filter(purchase => {
        const isRequest = purchase.payment_category === '구매 요청'
        const notPaid = !purchase.is_payment_completed
        if (!isRequest || !notPaid) return false

        const isSeonJin = (purchase.progress_type || '').includes('선진행')
        const isIlban = (purchase.progress_type || '').includes('일반') || !purchase.progress_type || purchase.progress_type === ''
        const finalApproved = purchase.final_manager_status === 'approved'
        const matchesProgress = isSeonJin || (isIlban && finalApproved)
        
        if (!matchesProgress) return false
        
        // 관리자는 모든 항목 표시, 일반 직원은 본인 것만
        if (hasManagerRole) {
          return true
        }
        
        // 일반 직원은 본인이 요청한 항목만
        return purchase.requester_name === currentUser?.name
      })
    }
    
    case 'receipt': {
      // 입고 현황 탭: 입고 대기중인 항목들
      // hr 권한이 있으면 모든 항목 볼 수 있음
      const hasHrRole = userRoles.includes('hr')
      const hasManagerRole = userRoles.some((role: string) => 
        ['superadmin', 'ceo', 'raw_material_manager', 'consumable_manager', 'purchase_manager'].includes(role)
      )
      
      return purchases.filter(purchase => {
        if (purchase.is_received) return false
        
        // hr 권한이 있으면 모든 항목 표시
        if (hasHrRole || hasManagerRole) {
          const isSeonJin = (purchase.progress_type || '').includes('선진행')
          const finalApproved = purchase.final_manager_status === 'approved'
          return isSeonJin || finalApproved
        }
        
        // lead buyer와 일반 사용자는 본인이 요청한 항목만
        const isSeonJin = (purchase.progress_type || '').includes('선진행')
        const finalApproved = purchase.final_manager_status === 'approved'
        const isRequester = purchase.requester_name === currentUser?.name
        
        return (isSeonJin || finalApproved) && isRequester
      })
    }
    
    case 'done':
    default: {
      // 전체 항목 탭: 양쪽 승인 완료된 항목만
      return purchases.filter(purchase => 
        purchase.middle_manager_status === 'approved' && 
        purchase.final_manager_status === 'approved'
      )
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
  const userRoles = parseRoles(currentUser?.roles)
  const hasManagerRole = userRoles.some((role: string) => 
    ['lead buyer', 'ceo', 'raw_material_manager', 'consumable_manager'].includes(role)
  )
  
  return purchases.filter(purchase => {
    const requestorName = purchase.requester_name || ''
    
    // HIDDEN_EMPLOYEES 처리
    if (HIDDEN_EMPLOYEES.includes(requestorName) && !hasManagerRole) {
      return false
    }
    
    return requestorName === employeeName
  })
}

interface AdvancedFilter {
  id?: string
  field: string
  condition: string
  value: string | number | Date
  label?: string
  dateField?: string
}

/**
 * 고급 필터 적용
 */
export const applyAdvancedFilters = (
  purchases: Purchase[],
  filters: AdvancedFilter[]
): Purchase[] => {
  if (!filters || filters.length === 0) return purchases
  
  // 품목 필드 필터가 있는지 확인
  const hasItemFilter = filters.some(filter => ITEM_FIELDS.includes(filter.field))
  
  if (hasItemFilter) {
    // 품목 단위로 펼쳐서 필터링
    return purchases.flatMap(purchase => {
      const items = purchase.purchase_request_items || []
      
      // 각 품목에 대해 필터 조건 검사
      const matchedItems = items.filter((item: PurchaseRequestItem) => {
        return filters.every(filter => {
          const { field, condition, value, dateField } = filter
          const targetField = dateField || field

          // 품목 필드인 경우
          if (ITEM_FIELDS.includes(targetField)) {
            const fieldValue = (item as unknown as Record<string, unknown>)[targetField]
            return checkFilterCondition(fieldValue, condition, value)
          }

          // 헤더 필드인 경우
          const fieldValue = getFieldValue(purchase, targetField)
          return checkFilterCondition(fieldValue, condition, value)
        })
      })

      // 매칭된 품목만 포함하여 purchase 객체 반환
      return matchedItems.map((item: PurchaseRequestItem) => ({
        ...purchase,
        purchase_request_items: [item]
      }))
    })
  }
  
  // 품목 필터가 없으면 기존 방식대로 처리
  return purchases.filter(purchase => {
    return filters.every(filter => {
      const { field, condition, value, dateField } = filter
      const targetField = dateField || field
      const fieldValue = getFieldValue(purchase, targetField)
      return checkFilterCondition(fieldValue, condition, value)
    })
  })
}

/**
 * 필터 조건 체크 헬퍼 함수
 */
const checkFilterCondition = (fieldValue: unknown, condition: string, value: string | number | Date): boolean => {
  // '공란' 선택 시 빈 값 필터링
  if (value === '공란') {
    const isEmpty = !fieldValue || String(fieldValue).trim() === ''
    return condition === 'not_equals' ? !isEmpty : isEmpty
  }

  // null/undefined 체크
  if (fieldValue === null || fieldValue === undefined) {
    return condition === 'is_empty'
  }
  
  switch (condition) {
    case 'contains':
      return String(fieldValue).toLowerCase().includes(String(value).toLowerCase())
    case 'equals':
      // 날짜 범위 처리
      if (typeof value === 'string' && value.includes('~')) {
        if (!fieldValue) return false
        try {
        const [startDate, endDate] = value.split('~')
        const purchaseDate = new Date(fieldValue as string).toISOString().split('T')[0]
        return purchaseDate >= startDate && purchaseDate <= endDate
        } catch (error) {
          logger.error('날짜 범위 처리 오류', error)
          return false
        }
      }
      // 월별 필터 처리 (YYYY-MM 형식)
      if (typeof value === 'string' && (value.match(/^\d{4}-\d{2}$/) || value.match(/^\d{4}-\d{2}~\d{4}-\d{2}$/))) {
        if (!fieldValue) return false
        try {
        if (value.includes('~')) {
          const [startMonth, endMonth] = value.split('~')
          const purchaseMonth = new Date(fieldValue as string).toISOString().slice(0, 7) // YYYY-MM 형식
          return purchaseMonth >= startMonth && purchaseMonth <= endMonth
        } else {
          const purchaseMonth = new Date(fieldValue as string).toISOString().slice(0, 7)
          return purchaseMonth === value
          }
        } catch (error) {
          logger.error('월별 필터 처리 오류', error)
          return false
        }
      }
      // 일반 equals 비교
      return String(fieldValue).toLowerCase() === String(value).toLowerCase()
    case 'not_equals':
      return fieldValue !== value
    case 'starts_with':
      return String(fieldValue).toLowerCase().startsWith(String(value).toLowerCase())
    case 'ends_with':
      return String(fieldValue).toLowerCase().endsWith(String(value).toLowerCase())
    case 'greater_than':
      return Number(fieldValue) > Number(value)
    case 'less_than':
      return Number(fieldValue) < Number(value)
    case 'after':
      return new Date(fieldValue as string) > new Date(value as string | number)
    case 'before':
      return new Date(fieldValue as string) < new Date(value as string | number)
    case 'is_empty':
      return !fieldValue || fieldValue === '' || fieldValue === null
    case 'is_not_empty':
      return fieldValue && fieldValue !== '' && fieldValue !== null
    case 'between': {
      const [min, max] = String(value).split(',').map(Number)
      const numValue = Number(fieldValue)
      return numValue >= min && numValue <= max
    }
    case 'in': {
      const values = String(value).split(',').map((v: string) => v.trim())
      return values.includes(String(fieldValue))
    }
    default:
      return true
  }
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
  
  return purchases.flatMap(purchase => {
    // 헤더 필드에서 검색어 매치 확인
    const headerFields = [
      purchase.purchase_order_number,
      purchase.sales_order_number,
      purchase.requester_name,
      purchase.vendor_name,
      purchase.contact_name,
      purchase.project_item
    ]
    
    const headerMatch = headerFields.some(field => 
      field && String(field).toLowerCase().includes(term)
    )
    
    // 품목에서 검색어 매치 확인
    const items = purchase.purchase_request_items || []
    const matchedItems = items.filter((item: PurchaseRequestItem) => {
      const itemRecord = item as unknown as Record<string, unknown>
      const itemFields = [
        item.item_name,
        itemRecord.item_detail,
        itemRecord.manufacturer,
        itemRecord.model,
        item.specification,
        itemRecord.spec, // 하위 호환성을 위해 유지
        item.remark
      ]

      return itemFields.some(field =>
        field && String(field).toLowerCase().includes(term)
      )
    })

    // 헤더 매치만 있는 경우: 전체 purchase 반환
    if (headerMatch && matchedItems.length === 0) {
      return [purchase]
    }

    // 품목 매치가 있는 경우: 매치된 품목만 포함하여 반환
    if (matchedItems.length > 0) {
      return matchedItems.map((item: PurchaseRequestItem) => ({
        ...purchase,
        purchase_request_items: [item]
      }))
    }
    
    // 아무것도 매치하지 않으면 빈 배열
    return []
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
const getFieldValue = (purchase: Purchase, field: string): unknown => {
  // date_range와 date_month는 request_date를 사용
  if (field === 'date_range' || field === 'date_month') {
    return purchase.request_date
  }
  
  // 승인 상태 계산
  if (field === 'approval_status') {
    if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return '반려'
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return '최종승인'
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'pending') {
      return '1차승인'
    } else {
      return '승인대기'
    }
  }
  
  // boolean 상태 필드는 먼저 체크 (중첩 필드 처리 전)
  if (field === 'is_payment_completed') {
    const value = purchase.is_payment_completed
    return value === true ? '완료' : '대기'
  }
  if (field === 'is_received') {
    // purchase_requests.is_received만 확인 (품목별 확인 X)
    const value = purchase.is_received
    return value === true ? '완료' : '대기'
  }
  if (field === 'is_statement_received') {
    const value = purchase.is_statement_received
    return value === true ? '완료' : '대기'
  }
  if (field === 'is_utk_checked') {
    const value = purchase.is_utk_checked
    return value === true ? '완료' : '대기'
  }
  
  // 지출예정일 (vendors 테이블의 vendor_payment_schedule)
  if (field === 'payment_schedule') {
    return purchase.vendor_payment_schedule || null
  }

  // 거래명세서 입고일 (품목의 statement_received_date에서 가져옴)
  if (field === 'statement_received_at') {
    const items = purchase.purchase_request_items || []
    // 첫 번째 품목의 statement_received_date 사용
    for (const item of items) {
      if (item.statement_received_date) return item.statement_received_date
    }
    return null
  }

  // 담당자 이름
  if (field === 'contact_name') {
    return purchase.contact_name || null
  }
  
  // 중첩된 필드 처리 (예: items.0.item_name)
  const keys = field.split('.')
  let value: unknown = purchase as unknown as Record<string, unknown>
  
  for (const key of keys) {
    if (value === null || value === undefined) return null
    value = (value as Record<string, unknown>)[key]
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
    done: filterByTab(allPurchases, 'done', currentUser).length
  }
}

// ============================================================
// 🚀 대시보드용 필터 함수들
// ============================================================

/**
 * 승인 대기 항목 필터 (대시보드/승인 페이지용)
 */
export const filterPendingApprovals = (
  purchases: Purchase[],
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)
  
  return purchases.filter(purchase => {
    // 이미 양쪽 승인 완료되었거나 반려된 경우 제외
    if (purchase.middle_manager_status === 'approved' && 
        purchase.final_manager_status === 'approved') {
      return false
    }
    if (purchase.middle_manager_status === 'rejected' || 
        purchase.final_manager_status === 'rejected') {
      return false
    }
    
    // superadmin, ceo는 모든 승인 대기 항목 볼 수 있음
    if (userRoles.includes('superadmin') || userRoles.includes('ceo')) {
      return true
    }
    
    // middle_manager는 1차 승인 대기 항목만
    if (userRoles.includes('middle_manager')) {
      return purchase.middle_manager_status === 'pending'
    }
    
    // final_approver는 1차 승인 완료 + 최종 대기 항목만
    if (userRoles.includes('final_approver')) {
      return purchase.middle_manager_status === 'approved' && 
             purchase.final_manager_status === 'pending'
    }
    
    // 카테고리별 관리자
    if (userRoles.includes('consumable_manager')) {
      return purchase.payment_category === '구매 요청' && 
             purchase.middle_manager_status === 'pending'
    }
    if (userRoles.includes('raw_material_manager')) {
      return purchase.payment_category === '발주' && 
             purchase.middle_manager_status === 'pending'
    }
    
    return false
  })
}

/**
 * 사이드바 발주요청 승인대기 배지 카운트
 * - middle_manager: 1차 승인 대기만
 * - final_approver: 최종 승인 대기만
 * - superadmin: 1차/최종 모두
 * - ceo: 제외
 */
export const countPendingApprovalsForSidebarBadge = (
  purchases: Purchase[],
  purchaseRole: string | string[] | null | undefined
): number => {
  if (!purchases || purchases.length === 0) return 0

  const roles = parseRoles(purchaseRole)
  const hasAppAdmin = roles.includes('superadmin')
  const hasMiddleManager = roles.includes('middle_manager')
  const hasFinalApprover = roles.includes('final_approver')
  const hasCeo = roles.includes('ceo')

  // ceo는 알림 배지 대상에서 제외 (superadmin이 함께 있으면 superadmin 우선)
  if (hasCeo && !hasAppAdmin) return 0

  // 발주/구매요청 카테고리 관리자 역할이 있으면 해당 카테고리만 카운트
  const hasConsumableManager = roles.includes('consumable_manager')
  const hasRawMaterialManager = roles.includes('raw_material_manager')
  const hasCategoryLimiter = hasConsumableManager || hasRawMaterialManager

  const matchesManagedCategory = (purchase: Purchase) => {
    if (!hasCategoryLimiter) return true
    if (hasConsumableManager && purchase.payment_category === '구매 요청') return true
    if (hasRawMaterialManager && purchase.payment_category === '발주') return true
    return false
  }

  return purchases.filter(purchase => {
    // 승인 완료/반려 제외
    if (
      purchase.middle_manager_status === 'approved' &&
      purchase.final_manager_status === 'approved'
    ) {
      return false
    }
    if (
      purchase.middle_manager_status === 'rejected' ||
      purchase.final_manager_status === 'rejected'
    ) {
      return false
    }

    if (!matchesManagedCategory(purchase)) return false

    const middleStatus = purchase.middle_manager_status
    const isMiddlePending = !middleStatus || middleStatus === 'pending' || middleStatus === '대기'
    const finalStatus = purchase.final_manager_status
    const isFinalPending =
      purchase.middle_manager_status === 'approved' &&
      (!finalStatus || finalStatus === 'pending' || finalStatus === '대기')

    if (hasAppAdmin) {
      return isMiddlePending || isFinalPending
    }

    if (hasMiddleManager && isMiddlePending) return true
    if (hasFinalApprover && isFinalPending) return true

    return false
  }).length
}

/**
 * 1차 승인 대기 필터 (ApprovalMain용)
 */
export const filterMiddlePendingApprovals = (
  purchases: Purchase[],
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)
  
  return purchases.filter(purchase => {
    // 1차 승인 대기 상태
    if (purchase.middle_manager_status !== 'pending') return false
    
    // superadmin, ceo는 모두 볼 수 있음
    if (userRoles.includes('superadmin') || userRoles.includes('ceo')) {
      return true
    }
    
    // middle_manager 권한
    if (userRoles.includes('middle_manager')) {
      return true
    }
    
    // 카테고리별 관리자
    if (userRoles.includes('consumable_manager') && purchase.payment_category === '구매 요청') {
      return true
    }
    if (userRoles.includes('raw_material_manager') && purchase.payment_category === '발주') {
      return true
    }
    
    return false
  })
}

/**
 * 최종 승인 대기 필터 (ApprovalMain용)
 */
export const filterFinalPendingApprovals = (
  purchases: Purchase[],
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)
  
  return purchases.filter(purchase => {
    // 1차 승인 완료 + 최종 대기
    if (purchase.middle_manager_status !== 'approved' || 
        purchase.final_manager_status !== 'pending') {
      return false
    }
    
    // superadmin, ceo는 모두 볼 수 있음
    if (userRoles.includes('superadmin') || userRoles.includes('ceo')) {
      return true
    }
    
    // final_approver 권한
    if (userRoles.includes('final_approver')) {
      return true
    }
    
    return false
  })
}

/**
 * 구매 진행중 필터 (대시보드용)
 * - 구매 요청 + 승인 완료 + 결제 미완료
 */
export const filterPurchaseInProgress = (
  purchases: Purchase[],
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)
  const hasManagerRole = userRoles.some(role => 
    ['superadmin', 'ceo', 'lead buyer', 'purchase_manager'].includes(role)
  )
  
  return purchases.filter(purchase => {
    const isRequest = purchase.payment_category === '구매 요청'
    const notPaid = !purchase.is_payment_completed
    
    if (!isRequest || !notPaid) return false
    
    // 선진행이거나 최종 승인 완료
    const isSeonJin = (purchase.progress_type || '').includes('선진행')
    const finalApproved = purchase.final_manager_status === 'approved'
    
    if (!isSeonJin && !finalApproved) return false
    
    // 관리자는 모든 항목, 일반은 본인 것만
    return hasManagerRole || purchase.requester_name === currentUser.name
  })
}

/**
 * 입고 대기 필터 (대시보드용)
 */
export const filterDeliveryPending = (
  purchases: Purchase[],
  currentUser: Employee | null
): Purchase[] => {
  if (!purchases || !currentUser) return []
  
  const userRoles = parseRoles(currentUser.roles)
  const hasManagerRole = userRoles.some(role => 
    ['superadmin', 'ceo', 'hr', 'purchase_manager'].includes(role)
  )
  
  return purchases.filter(purchase => {
    if (purchase.is_received) return false
    
    // 선진행이거나 최종 승인 완료
    const isSeonJin = (purchase.progress_type || '').includes('선진행')
    const finalApproved = purchase.final_manager_status === 'approved'
    
    if (!isSeonJin && !finalApproved) return false
    
    // 관리자는 모든 항목, 일반은 본인 것만
    return hasManagerRole || purchase.requester_name === currentUser.name
  })
}

/**
 * 미다운로드 발주서 필터 (대시보드용)
 */
export const filterUndownloadedOrders = (
  purchases: Purchase[]
): Purchase[] => {
  if (!purchases) return []
  
  return purchases.filter(purchase => {
    // 최종 승인 완료
    const finalApproved = purchase.final_manager_status === 'approved'
    // PO 미다운로드
    const notDownloaded = !purchase.is_po_download
    
    return finalApproved && notDownloaded
  })
}

// ============================================================
// 통합 필터링 함수
// ============================================================

/**
 * 통합 필터링 함수
 */
export interface FilterOptions {
  tab?: TabType
  employeeName?: string | null
  searchTerm?: string
  advancedFilters?: AdvancedFilter[]
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
