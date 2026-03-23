/**
 * 발주 권한 관리 헬퍼 유틸리티
 * 메모리 기반 발주 시스템의 권한 관리를 중앙화
 */

export type PurchaseRole =
  | 'superadmin'
  | 'ceo'
  | 'middle_manager'
  | 'final_approver'
  | 'raw_material_manager'
  | 'consumable_manager'
  | 'purchase_manager'
  | 'lead buyer'
  | 'hr';

/**
 * 역할 문자열/배열을 정규화된 배열로 파싱
 */
export function parseRoles(roles: string | string[] | null | undefined): string[] {
  if (!roles) return []
  if (Array.isArray(roles)) {
    return roles.filter(role => role && role.trim())
  }
  if (typeof roles === 'string') {
    return roles.split(',').map(role => role.trim()).filter(Boolean)
  }
  return []
}

// 관리자 권한 목록
export const MANAGER_ROLES: PurchaseRole[] = [
  'purchase_manager',
  'superadmin',
  'raw_material_manager',
  'consumable_manager'
];

// 승인자 권한 목록
export const APPROVER_ROLES: PurchaseRole[] = [
  'final_approver',
  'superadmin',
  'ceo',
  'middle_manager',
  'hr'
];

// 숨김 직원 목록
export const HIDDEN_EMPLOYEES = ['정희웅'];

/**
 * 관리자 권한 여부 확인
 */
export function hasManagerRole(roles: string[]): boolean {
  return MANAGER_ROLES.some(role => roles.includes(role));
}

/**
 * 승인자 권한 여부 확인
 */
export function hasApproverRole(roles: string[]): boolean {
  return APPROVER_ROLES.some(role => roles.includes(role));
}

/**
 * 역할 그룹 계산 (탭별 기본 필터용)
 * 1: 일반 사용자 (본인 데이터만)
 * 2: 카테고리별 관리자 (구매 요청 또는 발주만)
 * 3: 전체 권한자 (superadmin, ceo만 - 모든 데이터)
 */
export function getRoleCase(roles: string[]): number {
  if (!roles || roles.length === 0) return 1;
  
  // superadmin과 ceo는 전체 권한 (case 3)
  if (roles.includes('superadmin') || roles.includes('ceo')) return 3;
  
  // 카테고리별 관리자는 제한된 권한 (case 2)
  if (roles.includes('consumable_manager') || 
      roles.includes('raw_material_manager') ||
      roles.includes('purchase_manager') ||
      roles.includes('lead buyer')) return 2;  // lead buyer 추가
  
  // middle_manager도 제한된 권한
  if (roles.includes('middle_manager')) return 2;
  
  return 1;
}

/**
 * 권한별 직원 필터 적용
 */
export function filterByEmployeeVisibility<T extends { requester_name: string }>(
  items: T[],
  userRoles: string[]
): T[] {
  if (hasManagerRole(userRoles)) {
    return items; // 관리자는 모든 데이터 표시
  }
  return items.filter(item => !HIDDEN_EMPLOYEES.includes(item.requester_name));
}