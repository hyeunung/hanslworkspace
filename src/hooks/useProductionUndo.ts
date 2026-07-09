import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ProductionPcb, ProductionCable } from '@/services/productionService'
import { useStableHandler } from '@/hooks/useStableHandler'

// ─── 되돌리기(Undo) 인프라 ──────────────────────────────────────────
// 각 변경(텍스트 수정·값삭제·색상·행추가/삭제) 직전에 "이전 상태"를 스택에 쌓고,
// Ctrl+Z(편집칸 밖)로 스택에서 꺼내 DB에 되돌려 쓴다. 브라우저 세션(메모리) 한정.
// ProductionListMain.tsx에서 분리 — 동작 동일.
export type UndoEntry =
  | { kind: 'restore'; table: 'production_pcbs' | 'production_cables'; rows: Array<{ id: string; data: Record<string, any> }>; label: string }
  | { kind: 'deleteInserted'; table: 'production_pcbs' | 'production_cables'; id: string; label: string }
  | { kind: 'reinsert'; table: 'production_pcbs' | 'production_cables'; row: Record<string, any>; label: string }

export function useProductionUndo({ pcbs, cables, editingCell, loadData }: {
  pcbs: ProductionPcb[]
  cables: ProductionCable[]
  editingCell: { id: string, type: 'pcb' | 'cable', field: string } | null
  loadData: () => Promise<void>
}) {
  const undoStackRef = useRef<UndoEntry[]>([])
  const redoStackRef = useRef<UndoEntry[]>([])
  const undoingRef = useRef(false)
  const UNDO_LIMIT = 100
  // 최신 데이터/편집상태를 stale closure 없이 참조하기 위한 ref (렌더마다 갱신)
  const liveDataRef = useRef<{ pcbs: ProductionPcb[]; cables: ProductionCable[] }>({ pcbs, cables })
  liveDataRef.current = { pcbs, cables }
  const editingCellRef = useRef(editingCell)
  editingCellRef.current = editingCell

  const tableOf = (type: 'pcb' | 'cable') => (type === 'pcb' ? 'production_pcbs' : 'production_cables') as 'production_pcbs' | 'production_cables'
  // 되돌리기용 행 스냅샷: id/created_at/updated_at 제외한 전체 칼럼을 복사(색상·삭제표식 포함)
  const UNDO_EXCLUDE = new Set(['id', 'created_at', 'updated_at'])
  const snapshotRows = (type: 'pcb' | 'cable', ids: string[]): Array<{ id: string; data: Record<string, any> }> => {
    const list: any[] = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
    const rows: Array<{ id: string; data: Record<string, any> }> = []
    for (const id of ids) {
      const item = list.find(i => i.id === id)
      if (!item) continue
      const data: Record<string, any> = {}
      for (const k of Object.keys(item)) if (!UNDO_EXCLUDE.has(k)) data[k] = item[k]
      rows.push({ id, data })
    }
    return rows
  }
  const pushUndo = (entry: UndoEntry) => {
    if (entry.kind === 'restore' && entry.rows.length === 0) return
    redoStackRef.current = [] // 새 작업이 생기면 '다시 실행' 이력은 무효화 (표준 undo/redo 규칙)
    const s = undoStackRef.current
    s.push(entry)
    if (s.length > UNDO_LIMIT) s.shift()
  }
  const pushRestoreUndo = (type: 'pcb' | 'cable', ids: string[], label: string) => {
    pushUndo({ kind: 'restore', table: tableOf(type), rows: snapshotRows(type, ids), label })
  }

  // 엔트리 하나를 DB에 적용하고, 그 반대 동작(다른 스택에 쌓을 엔트리)을 돌려준다.
  // 적용 직전의 현재 상태를 스냅샷해 두므로 undo↔redo가 완전히 대칭이 된다.
  const applyUndoEntry = async (entry: UndoEntry): Promise<UndoEntry | null> => {
    const supabase = createClient()
    const type: 'pcb' | 'cable' = entry.table === 'production_pcbs' ? 'pcb' : 'cable'
    if (entry.kind === 'restore') {
      const inverseRows = snapshotRows(type, entry.rows.map(r => r.id)) // 적용 전(=반대편이 되돌릴) 상태
      for (const row of entry.rows) {
        const { error } = await supabase.from(entry.table)
          .update({ ...row.data, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw error
      }
      return { kind: 'restore', table: entry.table, rows: inverseRows, label: entry.label }
    }
    if (entry.kind === 'deleteInserted') {
      // 행 추가 되돌리기 = 방금 만든 행을 완전히 제거. 재실행(redo)을 위해 전체 행을 보관.
      const list: any[] = type === 'pcb' ? liveDataRef.current.pcbs : liveDataRef.current.cables
      const full = list.find(i => i.id === entry.id)
      const { error } = await supabase.from(entry.table).delete().eq('id', entry.id)
      if (error) throw error
      return full ? { kind: 'reinsert', table: entry.table, row: { ...full }, label: entry.label } : null
    }
    // reinsert: 제거됐던 행을 원래 id/값 그대로 되살림
    const { error } = await supabase.from(entry.table).insert([entry.row])
    if (error) throw error
    return { kind: 'deleteInserted', table: entry.table, id: entry.row.id, label: entry.label }
  }

  const handleUndo = useStableHandler(async () => {
    if (undoingRef.current) return
    const entry = undoStackRef.current.pop()
    if (!entry) { toast('되돌릴 작업이 없습니다.'); return }
    undoingRef.current = true
    try {
      const inverse = await applyUndoEntry(entry)
      if (inverse) redoStackRef.current.push(inverse)
      await loadData()
      toast.success(`되돌렸습니다 · ${entry.label}`)
    } catch (err) {
      console.error(err)
      undoStackRef.current.push(entry) // 실패 시 항목 보존(재시도 가능)
      toast.error('되돌리기에 실패했습니다.')
    } finally {
      undoingRef.current = false
    }
  })

  const handleRedo = useStableHandler(async () => {
    if (undoingRef.current) return
    const entry = redoStackRef.current.pop()
    if (!entry) { toast('다시 실행할 작업이 없습니다.'); return }
    undoingRef.current = true
    try {
      const inverse = await applyUndoEntry(entry)
      if (inverse) undoStackRef.current.push(inverse)
      await loadData()
      toast.success(`다시 실행 · ${entry.label}`)
    } catch (err) {
      console.error(err)
      redoStackRef.current.push(entry)
      toast.error('다시 실행에 실패했습니다.')
    } finally {
      undoingRef.current = false
    }
  })

  // Ctrl/Cmd+Z 되돌리기 · Ctrl/Cmd+Shift+Z(또는 Ctrl+Y) 다시 실행
  // 편집칸(input/textarea/select)·편집모드에서는 브라우저 기본(타이핑 취소)에 양보
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.altKey) return
      const k = (e.key || '').toLowerCase()
      const isUndo = !e.shiftKey && k === 'z'
      const isRedo = (e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')
      if (!isUndo && !isRedo) return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
      if (editingCellRef.current) return
      e.preventDefault()
      if (isRedo) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { liveDataRef, editingCellRef, tableOf, snapshotRows, pushUndo, pushRestoreUndo, handleUndo, handleRedo }
}
