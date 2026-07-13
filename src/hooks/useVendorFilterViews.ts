import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import type { StoredVendorFilterRule } from '@/utils/vendorTable'

// 업체관리 필터 저장 기능 — 사용자별 저장 필터와 시작 기본값을 DB(user_ui_settings)에 보관.
// useBomBoardFilterViews 패턴 그대로, setting_type만 분리 (신규 테이블/정책 없음).

export type SavedVendorFilterView = {
  id: string
  name: string
  rules: StoredVendorFilterRule[]
}

export type VendorFilterConfig = {
  views: SavedVendorFilterView[]
  default?: { rules: StoredVendorFilterRule[] } | null
}

const EMPTY_CONFIG: VendorFilterConfig = { views: [], default: null }

const SETTING_TYPE = 'vendor_filter'
const SETTING_KEY = 'config'

// jsonb 파싱 방어 — 형식이 어긋나면 빈 설정으로 폴백
const normalizeConfig = (raw: unknown): VendorFilterConfig => {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONFIG }
  const obj = raw as Record<string, unknown>
  const views = Array.isArray(obj.views)
    ? (obj.views as SavedVendorFilterView[]).filter(v =>
        v && typeof v.id === 'string' && typeof v.name === 'string' && Array.isArray(v.rules))
    : []
  const d = obj.default as { rules?: unknown } | null | undefined
  const def = d && Array.isArray(d.rules) ? { rules: d.rules as StoredVendorFilterRule[] } : null
  return { views, default: def }
}

export function useVendorFilterViews() {
  const supabase = createClient()
  const [config, setConfig] = useState<VendorFilterConfig>(EMPTY_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const configRef = useRef<VendorFilterConfig>(EMPTY_CONFIG)
  configRef.current = config

  const load = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user?.email) {
        logger.warn('[useVendorFilterViews] 인증 정보 없음 — 저장 필터 로드 생략')
        setLoaded(true)
        return
      }
      const { data, error } = await supabase
        .from('user_ui_settings')
        .select('setting_value')
        .eq('user_email', user.email)
        .eq('setting_type', SETTING_TYPE)
        .eq('setting_key', SETTING_KEY)
        .maybeSingle()
      if (error) {
        logger.error('[useVendorFilterViews] 저장 필터 조회 실패', error)
      } else if (data?.setting_value) {
        setConfig(normalizeConfig(data.setting_value))
      }
    } catch (e) {
      logger.error('[useVendorFilterViews] 저장 필터 로드 예외', e)
    } finally {
      setLoaded(true)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  // config 전체 upsert (낙관적 갱신, 실패 시 롤백)
  const persist = useCallback(async (next: VendorFilterConfig): Promise<boolean> => {
    const prev = configRef.current
    setConfig(next)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user?.email) {
        setConfig(prev)
        return false
      }
      const { error } = await supabase
        .from('user_ui_settings')
        .upsert({
          user_email: user.email,
          setting_type: SETTING_TYPE,
          setting_key: SETTING_KEY,
          setting_value: next,
        }, { onConflict: 'user_email,setting_type,setting_key' })
      if (error) {
        logger.error('[useVendorFilterViews] 저장 실패', error)
        setConfig(prev)
        return false
      }
      return true
    } catch (e) {
      logger.error('[useVendorFilterViews] 저장 예외', e)
      setConfig(prev)
      return false
    }
  }, [supabase])

  const saveView = useCallback((view: SavedVendorFilterView) =>
    persist({ ...configRef.current, views: [...configRef.current.views, view] }), [persist])

  const deleteView = useCallback((id: string) =>
    persist({ ...configRef.current, views: configRef.current.views.filter(v => v.id !== id) }), [persist])

  const renameView = useCallback((id: string, name: string) =>
    persist({ ...configRef.current, views: configRef.current.views.map(v => v.id === id ? { ...v, name } : v) }), [persist])

  const setDefault = useCallback((snapshot: { rules: StoredVendorFilterRule[] } | null) =>
    persist({ ...configRef.current, default: snapshot }), [persist])

  return { config, loaded, saveView, deleteView, renameView, setDefault }
}
