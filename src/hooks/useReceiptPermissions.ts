import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ReceiptPermissions, UserRole } from '@/types/receipt';

/**
 * 영수증 관리 권한을 관리하는 React Hook
 * 
 * 사용자의 역할(role)에 따라 영수증 관련 권한을 계산하고 제공합니다.
 * 
 * @returns {Object} 권한 정보와 관련 상태
 * @returns {ReceiptPermissions} permissions - 권한 객체
 * @returns {UserRole | null} userRole - 사용자 역할
 * @returns {boolean} loading - 권한 로딩 상태
 * @returns {Function} refreshPermissions - 권한 새로고침 함수
 * 
 * @example
 * ```tsx
 * const { permissions, userRole, loading } = useReceiptPermissions();
 * 
 * if (loading) return <div>로딩 중...</div>;
 * 
 * return (
 *   <div>
 *     {permissions.canUpload && <UploadButton />}
 *     {permissions.canDelete && <DeleteButton />}
 *   </div>
 * );
 * ```
 */
export function useReceiptPermissions() {
  const [permissions, setPermissions] = useState<ReceiptPermissions>({
    canView: false,
    canUpload: false,
    canDownload: false,
    canPrint: false,
    canDelete: false,
    canViewUploaderInfo: false,
  });
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const checkPermissions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: employee } = await supabase
        .from('employees')
        .select('purchase_role')
        .eq('email', user.email)
        .single();

      const role = employee?.purchase_role || '';
      setUserRole(role);

      // 권한 계산
      const isAppAdmin = role.includes('app_admin');
      const isHr = role.includes('hr');
      const isLeadBuyer = role.includes('lead buyer');
      
      // 영수증 관리 접근 가능 권한
      const hasReceiptAccess = isAppAdmin || isHr || isLeadBuyer;

      setPermissions({
        canView: hasReceiptAccess,
        canUpload: hasReceiptAccess,
        canDownload: hasReceiptAccess,
        canPrint: hasReceiptAccess,
        canDelete: isAppAdmin, // 오직 app_admin만
        canViewUploaderInfo: isAppAdmin, // 오직 app_admin만
      });
    } catch (error) {
      console.error('영수증 권한 확인 실패', error)
      setUserRole(null)
      setPermissions({
        canView: false,
        canUpload: false,
        canDownload: false,
        canPrint: false,
        canDelete: false,
        canViewUploaderInfo: false,
      })
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkPermissions();
  }, []);

  return {
    permissions,
    userRole,
    loading,
    refreshPermissions: checkPermissions,
  };
}