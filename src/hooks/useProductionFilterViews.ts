import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

// 제작현황 필터 저장 기능 — 사용자별 저장 필터(무제한)와 시작 기본값을 DB(user_ui_settings)에 보관해
// 어느 장치/브라우저에서 로그인해도 본인 설정이 따라오게 한다.
// 저장 위치: user_ui_settings(setting_type='production_filter', setting_key='config'), 사용자당 1행(jsonb).
//  - RLS: user_email = auth.email() 로 본인 행만 읽기/쓰기 가능 (기존 정책 재사용, 신규 테이블/정책 없음)

export type StoredFilterRule = {
  field: string
  op: string
  value?: string
  year?: number | null
  month?: number | null
}

// 저장 필터 한 건 = 특정 표(pcb/cable)의 조건+제작구분+그룹순서 스냅샷
export type SavedFilterView = {
  id: string
  name: string
  scope: 'pcb' | 'cable'
  rules: StoredFilterRule[]
  categories: string[]
  categoryOrder?: string[] | null
}

// 표별 시작 기본값 스냅샷 (없으면 코드 기본값 사용)
export type FilterDefaultSnapshot = {
  rules: StoredFilterRule[]
  categories: string[]
  categoryOrder?: string[] | null
}

export type ProductionFilterConfig = {
  views: SavedFilterView[]
  defaults: { pcb?: FilterDefaultSnapshot | null; cable?: FilterDefaultSnapshot | null }
}

const EMPTY_CONFIG: ProductionFilterConfig = { views: [], defaults: {} }

const SETTING_TYPE = 'production_filter'
const SETTING_KEY = 'config'

// jsonb 파싱 방어 — 형식이 어긋나면 빈 설정으로 폴백
const normalizeConfig = (raw: any): ProductionFilterConfig => {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONFIG }
  const views = Array.isArray(raw.views)
    ? raw.views.filter((v: any) =>
        v && typeof v.id === 'string' && typeof v.name === 'string' &&
        (v.scope === 'pcb' || v.scope === 'cable') &&
        Array.isArray(v.rules) && Array.isArray(v.categories))
    : []
  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}
  const cleanDefault = (d: any): FilterDefaultSnapshot | null =>
    d && Array.isArray(d.rules) && Array.isArray(d.categories)
      ? { rules: d.rules, categories: d.categories, categoryOrder: Array.isArray(d.categoryOrder) ? d.categoryOrder : null }
      : null
  return {
    views,
    defaults: { pcb: cleanDefault(defaults.pcb), cable: cleanDefault(defaults.cable) },
  }
}

export function useProductionFilterViews() {
  const supabase = createClient()
  const [config, setConfig] = useState<ProductionFilterConfig>(EMPTY_CONFIG)
  const [loaded, setLoaded] = useState(false)
  // 최신 config를 동기 참조 (연속 저장 시 이전 상태 덮어쓰기 방지)
  const configRef = useRef<ProductionFilterConfig>(EMPTY_CONFIG)
  configRef.current = config

  const load = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user?.email) {
        logger.warn('[useProductionFilterViews] 인증 정보 없음 — 저장 필터 로드 생략')
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
        logger.error('[useProductionFilterViews] 저장 필터 조회 실패', error)
      } else if (data?.setting_value) {
        setConfig(normalizeConfig(data.setting_value))
      }
    } catch (e) {
      logger.error('[useProductionFilterViews] 저장 필터 로드 예외', e)
    } finally {
      setLoaded(true)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  // config 전체를 upsert (낙관적 갱신: 먼저 state 반영 후 DB 저장, 실패 시 롤백)
  const persist = useCallback(async (next: ProductionFilterConfig): Promise<boolean> => {
    const prev = configRef.current
    setConfig(next)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user?.email) {
        logger.warn('[useProductionFilterViews] 인증 정보 없음 — 저장 실패')
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
        logger.error('[useProductionFilterViews] 저장 실패', error)
        setConfig(prev)
        return false
      }
      return true
    } catch (e) {
      logger.error('[useProductionFilterViews] 저장 예외', e)
      setConfig(prev)
      return false
    }
  }, [supabase])

  // 저장 필터 추가 (id는 호출부에서 생성해 전달)
  const saveView = useCallback((view: SavedFilterView) =>
    persist({ ...configRef.current, views: [...configRef.current.views, view] }), [persist])

  const deleteView = useCallback((id: string) =>
    persist({ ...configRef.current, views: configRef.current.views.filter(v => v.id !== id) }), [persist])

  const renameView = useCallback((id: string, name: string) =>
    persist({ ...configRef.current, views: configRef.current.views.map(v => v.id === id ? { ...v, name } : v) }), [persist])

  // 표별 시작 기본값 설정/해제
  const setDefault = useCallback((scope: 'pcb' | 'cable', snapshot: FilterDefaultSnapshot | null) =>
    persist({ ...configRef.current, defaults: { ...configRef.current.defaults, [scope]: snapshot } }), [persist])

  return { config, loaded, saveView, deleteView, renameView, setDefault }
}
