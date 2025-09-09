import { Employee, PurchaseRole } from '@/types/purchase'

// 권한 계층 구조 정의 (높은 권한은 하위 권한을 포함)
const ROLE_HIERARCHY: Record<PurchaseRole, number> = {
  'app_admin': 100,
  'ceo': 90,
  'final_approver': 70,
  'middle_manager': 60,
  'lead_buyer': 55,
  'purchase_manager': 55,
  'raw_material_manager': 50,
  'consumable_manager': 50,
  'buyer': 45,
  'requester': 10,
}

// 각 기능별 필요 권한 정의
export const PERMISSIONS = {
  // 업체 관리
  VENDOR_VIEW: ['app_admin', 'ceo', 'lead_buyer'],
  VENDOR_CREATE: ['app_admin', 'ceo', 'lead_buyer'],
  VENDOR_EDIT: ['app_admin', 'ceo', 'lead_buyer'],
  VENDOR_DELETE: ['app_admin', 'ceo'],
  
  // 직원 관리
  EMPLOYEE_VIEW: ['app_admin', 'ceo'],
  EMPLOYEE_CREATE: ['app_admin', 'ceo'],
  EMPLOYEE_EDIT: ['app_admin', 'ceo'],
  EMPLOYEE_DELETE: ['app_admin', 'ceo'],
  EMPLOYEE_ROLE_CHANGE: ['app_admin', 'ceo'],
  
  // 발주요청 관리
  PURCHASE_VIEW: ['all'], // 모든 권한 허용
  PURCHASE_CREATE: ['all'],
  PURCHASE_EDIT: ['app_admin', 'ceo', 'lead_buyer'],
  
  // 승인 관리
  APPROVAL_VIEW: ['app_admin', 'ceo', 'final_approver', 'middle_manager', 'lead_buyer'],
  MIDDLE_APPROVAL: ['middle_manager', 'final_approver', 'ceo', 'app_admin'],
  FINAL_APPROVAL: ['final_approver', 'ceo', 'app_admin'],
} as const

// 권한 체크 함수
export function hasPermission(userRole: string | undefined, requiredRoles: string[]): boolean {
  // 권한이 없는 경우
  if (!userRole) {
    return false
  }

  // 'all' 권한인 경우 모든 사용자에게 허용
  if (requiredRoles.includes('all')) {
    return true
  }

  // 사용자 권한이 필요 권한 목록에 있는지 확인
  return requiredRoles.includes(userRole)
}

// 최소 권한 레벨 체크 (권한 계층 구조 활용)
export function hasMinimumRole(userRole: string | undefined, minimumRole: PurchaseRole): boolean {
  if (!userRole || !(userRole in ROLE_HIERARCHY)) {
    return false
  }

  return ROLE_HIERARCHY[userRole as PurchaseRole] >= ROLE_HIERARCHY[minimumRole]
}

// 사용자의 권한 레벨 반환
export function getUserRoleLevel(userRole: string | undefined): number {
  if (!userRole || !(userRole in ROLE_HIERARCHY)) {
    return 0
  }
  
  return ROLE_HIERARCHY[userRole as PurchaseRole]
}

// 권한별 메뉴 아이템 필터링
export function filterMenuItems(menuItems: any[], userRole: string | undefined) {
  return menuItems.filter(item => {
    if (item.roles.includes('all')) {
      return true
    }
    
    if (!userRole) {
      return false
    }
    
    return item.roles.includes(userRole)
  })
}

// 권한 체크 에러 메시지
export const PERMISSION_MESSAGES = {
  ACCESS_DENIED: '접근 권한이 없습니다.',
  LOGIN_REQUIRED: '로그인이 필요합니다.',
  INSUFFICIENT_ROLE: '충분한 권한이 없습니다.',
  ADMIN_ONLY: '관리자만 접근할 수 있습니다.',
  CEO_ADMIN_ONLY: 'CEO 또는 앱 관리자만 접근할 수 있습니다.',
}

// 권한 체크 결과 타입
export interface PermissionResult {
  allowed: boolean
  message?: string
  redirectTo?: string
}

// 페이지별 권한 체크 함수
export function checkPagePermission(
  pathname: string, 
  userRole: string | undefined,
  isActive: boolean = true
): PermissionResult {
  // 비활성 사용자는 접근 불가
  if (!isActive) {
    return {
      allowed: false,
      message: '비활성 계정입니다. 관리자에게 문의하세요.',
      redirectTo: '/dashboard'
    }
  }

  // 페이지별 권한 체크
  switch (pathname) {
    case '/vendor':
      if (!hasPermission(userRole, [...PERMISSIONS.VENDOR_VIEW])) {
        return {
          allowed: false,
          message: PERMISSION_MESSAGES.ACCESS_DENIED,
          redirectTo: '/dashboard'
        }
      }
      break
      
    case '/employee':
      if (!hasPermission(userRole, [...PERMISSIONS.EMPLOYEE_VIEW])) {
        return {
          allowed: false,
          message: PERMISSION_MESSAGES.CEO_ADMIN_ONLY,
          redirectTo: '/dashboard'
        }
      }
      break
      
    case '/approval':
      if (!hasPermission(userRole, [...PERMISSIONS.APPROVAL_VIEW])) {
        return {
          allowed: false,
          message: PERMISSION_MESSAGES.ACCESS_DENIED,
          redirectTo: '/dashboard'
        }
      }
      break
      
    default:
      // 기본적으로 허용
      break
  }

  return { allowed: true }
}

// 액션별 권한 체크 함수
export function checkActionPermission(
  action: keyof typeof PERMISSIONS,
  userRole: string | undefined
): boolean {
  const requiredRoles = PERMISSIONS[action]
  return hasPermission(userRole, [...requiredRoles])
}

// 권한 표시명 반환
export function getRoleDisplayName(role: string | undefined): string {
  const roleNames: Record<string, string> = {
    'app_admin': '앱 관리자',
    'ceo': 'CEO',
    'final_approver': '최종 승인자',
    'middle_manager': '중간 관리자',
    'lead_buyer': '수석 구매자',
    'buyer': '구매자'
  }
  
  return roleNames[role || ''] || '권한 없음'
}

// 권한 색상 클래스 반환
export function getRoleColorClass(role: string | undefined): string {
  const colorClasses: Record<string, string> = {
    'app_admin': 'bg-purple-100 text-purple-800 border-purple-200',
    'ceo': 'bg-red-100 text-red-800 border-red-200',
    'final_approver': 'bg-hansl-100 text-hansl-800 border-hansl-200',
    'middle_manager': 'bg-green-100 text-green-800 border-green-200',
    'lead_buyer': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'buyer': 'bg-gray-100 text-gray-800 border-gray-200'
  }
  
  return colorClasses[role || ''] || 'bg-gray-50 text-gray-600 border-gray-200'
}