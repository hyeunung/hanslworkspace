import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  ColumnVisibility,
  DoneTabColumnId,
  UseColumnSettingsReturn,
} from '@/types/columnSettings';
import { DEFAULT_COLUMN_VISIBILITY } from '@/constants/columnSettings';

/**
 * 전체항목 탭 칼럼 설정 관리 훅
 * - 사용자별 칼럼 가시성 설정을 DB에 저장/조회
 * - 실시간 업데이트 및 낙관적 업데이트 지원
 */
export const useColumnSettings = (): UseColumnSettingsReturn => {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  const [isLoading, setIsLoading] = useState(true); // 초기 로딩 상태를 true로 설정
  const [error, setError] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const supabase = createClient();

  // 사용자 설정 로드
  const loadUserSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 현재 사용자 정보 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user?.email) {
        logger.warn('[useColumnSettings] 사용자 인증 정보 없음', { authError });
        setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
        return;
      }

      // 사용자별 설정 조회
      const { data: settings, error: settingsError } = await supabase
        .from('user_ui_settings')
        .select('setting_value')
        .eq('user_email', user.email)
        .eq('setting_type', 'column_visibility')
        .eq('setting_key', 'purchase_list_done')
        .maybeSingle();

      if (settingsError) {
        logger.error('[useColumnSettings] 설정 조회 실패', settingsError, {
          userEmail: user.email
        });
        setError('설정을 불러오는 중 오류가 발생했습니다.');
        setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
        return;
      }

      if (settings?.setting_value) {
        // DB에서 설정을 찾은 경우
        const savedSettings = settings.setting_value as ColumnVisibility;
        
        // 기본값과 병합 (새로운 칼럼이 추가된 경우를 대비)
        const mergedSettings = { ...DEFAULT_COLUMN_VISIBILITY, ...savedSettings };
        
        setColumnVisibility(mergedSettings);
        logger.debug('[useColumnSettings] 사용자 설정 로드 완료', {
          userEmail: user.email,
          settingsCount: Object.keys(mergedSettings).length
        });
      } else {
        // DB에 설정이 없는 경우 기본값 사용
        setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
        logger.debug('[useColumnSettings] 기본 설정 사용', {
          userEmail: user.email
        });
      }
    } catch (error) {
      logger.error('[useColumnSettings] 설정 로드 중 예외 발생', error);
      setError('설정을 불러오는 중 오류가 발생했습니다.');
      setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  // 설정 저장
  const saveUserSettings = useCallback(async (newSettings: ColumnVisibility) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user?.email) {
        logger.warn('[useColumnSettings] 사용자 인증 정보 없음 - 저장 실패', { authError });
        return;
      }

      const { error: upsertError } = await supabase
        .from('user_ui_settings')
        .upsert({
          user_email: user.email,
          setting_type: 'column_visibility',
          setting_key: 'purchase_list_done',
          setting_value: newSettings,
        }, {
          onConflict: 'user_email,setting_type,setting_key'
        });

      if (upsertError) {
        logger.error('[useColumnSettings] 설정 저장 실패', upsertError, {
          userEmail: user.email,
          settings: newSettings
        });
        throw upsertError;
      }

      logger.info('[useColumnSettings] 설정 저장 성공', {
        userEmail: user.email,
        settingsCount: Object.keys(newSettings).length,
        visibleColumns: Object.entries(newSettings).filter(([, visible]) => visible).length
      });
    } catch (error) {
      logger.error('[useColumnSettings] 설정 저장 중 예외 발생', error);
      throw error;
    }
  }, [supabase]);

  // 칼럼 토글 (개별 토글 - 기존 유지)
  const toggleColumn = useCallback((columnId: DoneTabColumnId) => {
    setColumnVisibility(prevSettings => {
      const newSettings = {
        ...prevSettings,
        [columnId]: !prevSettings[columnId]
      };

      // 백그라운드에서 DB 저장
      saveUserSettings(newSettings).catch(error => {
        // 저장 실패 시 이전 상태로 롤백
        setColumnVisibility(prevSettings);
        toast.error('설정 저장에 실패했습니다.');
        logger.error('[useColumnSettings] 토글 저장 실패, 롤백 처리', error);
      });

      return newSettings;
    });
  }, [saveUserSettings]);

  // 여러 칼럼 한번에 적용
  const applyColumnSettings = useCallback((newSettings: ColumnVisibility) => {
    logger.info('[useColumnSettings] applyColumnSettings 호출', { 
      newSettings,
      keys: Object.keys(newSettings),
      values: Object.values(newSettings)
    });
    
    // 즉시 UI 업데이트
    setColumnVisibility(newSettings);
    forceUpdate(prev => prev + 1); // 강제 리렌더링
    logger.info('[useColumnSettings] setColumnVisibility 호출됨', { newSettings });

    // 백그라운드에서 DB 저장
    saveUserSettings(newSettings).then(() => {
      toast.success('칼럼 설정이 적용되었습니다.');
      logger.info('[useColumnSettings] DB 저장 성공');
    }).catch(error => {
      logger.error('[useColumnSettings] 설정 저장 실패', error);
      toast.error('설정 저장에 실패했습니다.');
    });
  }, [saveUserSettings]);

  // 기본값으로 재설정
  const resetToDefault = useCallback(() => {
    setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);

    // DB에 기본값 저장
    saveUserSettings(DEFAULT_COLUMN_VISIBILITY).catch(error => {
      toast.error('기본 설정 저장에 실패했습니다.');
      logger.error('[useColumnSettings] 기본값 저장 실패', error);
    });

    toast.success('칼럼 설정이 기본값으로 재설정되었습니다.');
  }, [saveUserSettings]);

  // 컴포넌트 마운트 시 설정 로드
  useEffect(() => {
    loadUserSettings();
  }, [loadUserSettings]);

  return {
    columnVisibility,
    toggleColumn,
    applyColumnSettings,
    resetToDefault,
    isLoading,
    error,
  };
};