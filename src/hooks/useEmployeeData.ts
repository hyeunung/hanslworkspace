import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Employee } from '@/types/purchase';

// 전역 캐시 (탭 전환 시 재사용)
let cachedEmployee: Employee | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분 캐싱

export const useEmployeeData = () => {
  const [employee, setEmployee] = useState<Employee | null>(cachedEmployee);
  const [loading, setLoading] = useState(!cachedEmployee);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const loadEmployee = async () => {
      // 캐시가 유효하면 사용
      if (cachedEmployee && Date.now() - cacheTimestamp < CACHE_DURATION) {
        setEmployee(cachedEmployee);
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        const supabase = createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('사용자 인증이 필요합니다');
          setLoading(false);
          return;
        }
        
        // ID 또는 이메일로 직원 정보 조회 (OR 조건으로 한 번에)
        const { data: employeeData, error: employeeError } = await supabase
          .from('employees')
          .select('*')
          .or(`id.eq.${user.id},email.eq.${user.email}`)
          .limit(1)
          .single();
        
        if (employeeData) {
          cachedEmployee = employeeData;
          cacheTimestamp = Date.now();
          setEmployee(employeeData);
        } else {
          setError('직원 정보를 찾을 수 없습니다');
        }
      } catch (err) {
        setError('직원 정보 로드 중 오류 발생');
      } finally {
        setLoading(false);
      }
    };
    
    loadEmployee();
  }, []);
  
  const refreshEmployee = async () => {
    cachedEmployee = null;
    cacheTimestamp = 0;
    // Re-trigger the effect by resetting state
    setLoading(true);
    setEmployee(null);
  };
  
  return { employee, loading, error, refreshEmployee };
};