import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

// ─── 저장된 칼럼 구성(사용자화) 공용 훅 ─────────────────────────────────
// 제작현황/발주·구매의 칼럼 표시 구성을 이름 붙여 저장 — 저장된 필터와 동일 UX.
// 저장 위치: user_ui_settings(setting_type=인자, setting_key='config'), 사용자당 1행(jsonb).
//  - RLS: user_email = auth.email() 로 본인 행만 읽기/쓰기 (기존 정책 재사용)
// payload 형태는 화면별로 다름(제네릭 T):
//  - 발주/구매: ColumnVisibility 맵
//  - 제작현황: { scope: 'pcb'|'cable', hidden: string[] }

export type SavedColumnView<T> = { id: string; name: string; payload: T }

type Config<T> = { views: SavedColumnView<T>[] }

const SETTING_KEY = 'config'

export function useSavedColumnViews<T>(settingType: string) {
  const supabase = createClient()
  const [views, setViews] = useState<SavedColumnView<T>[]>([])
  const [loaded, setLoaded] = useState(false)
  // 최신 값 동기 참조 (연속 저장 시 이전 상태 덮어쓰기 방지)
  const viewsRef = useRef<SavedColumnView<T>[]>([])
  viewsRef.current = views

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user?.email) {
          setLoaded(true)
          return
        }
        const { data, error } = await supabase
          .from('user_ui_settings')
          .select('setting_value')
          .eq('user_email', user.email)
          .eq('setting_type', settingType)
          .eq('setting_key', SETTING_KEY)
          .maybeSingle()
        if (error) {
          logger.error(`[useSavedColumnViews:${settingType}] 조회 실패`, error)
        } else if (data?.setting_value) {
          const raw = data.setting_value as Config<T>
          if (Array.isArray(raw?.views)) {
            setViews(raw.views.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string'))
          }
        }
      } catch (e) {
        logger.error(`[useSavedColumnViews:${settingType}] 로드 예외`, e)
      } finally {
        setLoaded(true)
      }
    }
    load()
  }, [supabase, settingType])

  // 전체 upsert (낙관적 갱신: 먼저 state 반영 후 DB 저장, 실패 시 롤백)
  const persist = useCallback(async (next: SavedColumnView<T>[]): Promise<boolean> => {
    const prev = viewsRef.current
    setViews(next)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user?.email) {
        setViews(prev)
        return false
      }
      const { error } = await supabase
        .from('user_ui_settings')
        .upsert({
          user_email: user.email,
          setting_type: settingType,
          setting_key: SETTING_KEY,
          setting_value: { views: next } satisfies Config<T>,
        }, { onConflict: 'user_email,setting_type,setting_key' })
      if (error) {
        logger.error(`[useSavedColumnViews:${settingType}] 저장 실패`, error)
        setViews(prev)
        return false
      }
      return true
    } catch (e) {
      logger.error(`[useSavedColumnViews:${settingType}] 저장 예외`, e)
      setViews(prev)
      return false
    }
  }, [supabase, settingType])

  const saveView = useCallback((view: SavedColumnView<T>) =>
    persist([...viewsRef.current, view]), [persist])

  const deleteView = useCallback((id: string) =>
    persist(viewsRef.current.filter(v => v.id !== id)), [persist])

  const renameView = useCallback((id: string, name: string) =>
    persist(viewsRef.current.map(v => v.id === id ? { ...v, name } : v)), [persist])

  return { views, loaded, saveView, deleteView, renameView }
}
