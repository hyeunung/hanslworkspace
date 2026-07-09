import { useState } from 'react'
import { loadHiddenCols, hiddenColsStorageKey } from '@/utils/productionColumns'

// ─── 제작현황 테이블 뷰 · 칼럼 숨기기 상태 훅 ─────────────────────────
// ProductionListMain.tsx에서 분리 — 동작 동일.
export function useProductionColumnVisibility({ addingPcbRow, addingCableRow }: {
  // 행 추가 중에는 입력행 셀이 칼럼 순서대로 하드코딩돼 있어(정렬 어긋남 방지 + 입력 누락 방지) 전 칼럼을 임시 표시한다.
  addingPcbRow: unknown
  addingCableRow: unknown
}) {
  // 테이블 뷰 모드 — 전체/PCB/Cable&Case 중 선택. 선택 시 localStorage에 저장해 재방문 시 복원.
  const [tableView, setTableView] = useState<'all' | 'pcb' | 'cable'>(() => {
    const saved = localStorage.getItem('hansl_prod_table_view')
    return saved === 'pcb' || saved === 'cable' || saved === 'all' ? saved : 'all'
  })
  const selectTableView = (v: 'all' | 'pcb' | 'cable') => {
    setTableView(v)
    localStorage.setItem('hansl_prod_table_view', v)
  }

  // 칼럼 숨기기 — 표별 숨긴 칼럼 목록. 토글 즉시 적용 + localStorage 저장.
  const [hiddenCols, setHiddenCols] = useState<Record<'pcb' | 'cable', string[]>>(() => ({
    pcb: loadHiddenCols('pcb'),
    cable: loadHiddenCols('cable'),
  }))
  const [columnMenuFor, setColumnMenuFor] = useState<'pcb' | 'cable' | null>(null)

  const isColHidden = (type: 'pcb' | 'cable', field: string): boolean => {
    if (type === 'pcb' ? addingPcbRow : addingCableRow) return false
    return hiddenCols[type].includes(field)
  }

  const toggleHiddenCol = (type: 'pcb' | 'cable', field: string) => {
    setHiddenCols(prev => {
      const cur = prev[type]
      const next = cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field]
      localStorage.setItem(hiddenColsStorageKey(type), JSON.stringify(next))
      return { ...prev, [type]: next }
    })
  }

  const resetHiddenCols = (type: 'pcb' | 'cable') => {
    setHiddenCols(prev => ({ ...prev, [type]: [] }))
    localStorage.setItem(hiddenColsStorageKey(type), JSON.stringify([]))
  }

  // 저장된 칼럼 구성 적용 — 숨김 목록을 통째로 교체 (저장된 칼럼 뷰 불러오기용)
  const applyHiddenCols = (type: 'pcb' | 'cable', fields: string[]) => {
    setHiddenCols(prev => ({ ...prev, [type]: fields }))
    localStorage.setItem(hiddenColsStorageKey(type), JSON.stringify(fields))
  }

  // 섹션(구분선 단위) 일괄 숨기기/표시
  const setSectionHidden = (type: 'pcb' | 'cable', fields: string[], hide: boolean) => {
    setHiddenCols(prev => {
      const cur = prev[type]
      const next = hide
        ? [...new Set([...cur, ...fields])]
        : cur.filter(f => !fields.includes(f))
      localStorage.setItem(hiddenColsStorageKey(type), JSON.stringify(next))
      return { ...prev, [type]: next }
    })
  }

  // 그룹 헤더 colSpan: 그룹 내 표시 중인 칼럼 수 (0이면 그룹 헤더를 렌더하지 않음)
  const visibleSpan = (type: 'pcb' | 'cable', fields: string[]): number =>
    fields.filter(f => !isColHidden(type, f)).length

  return {
    tableView, selectTableView,
    hiddenCols, columnMenuFor, setColumnMenuFor,
    isColHidden, toggleHiddenCol, resetHiddenCols, applyHiddenCols, setSectionHidden, visibleSpan,
  }
}
