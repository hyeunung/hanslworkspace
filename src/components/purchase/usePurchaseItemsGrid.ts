import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FormItem } from '@/types/purchase'
import { useStableHandler } from '@/hooks/useStableHandler'
import { logger } from '@/lib/logger'

// ─── 새발주 품목 테이블 엑셀식 그리드 로직 ─────────────────────────────
// 제작현황 테이블의 셀 선택/키보드/복사·붙여넣기/Delete/일괄입력/되돌리기 동작을
// 로컬 폼 배열(react-hook-form items) 위에 구현한 훅.
// 셀은 항상 input이 열려있는 하이브리드 방식: input에 포커스가 있으면 키보드는
// 네이티브 편집에 양보하고, 범위 선택(드래그/Shift+클릭) 시 포커스를 해제해
// 복사/삭제/이동 키가 선택 영역에 동작한다.

export interface GridPos { r: number; c: number }

export interface UsePurchaseItemsGridParams {
  getItems: () => FormItem[]
  replace: (items: FormItem[]) => void
  currency: string
  cols: string[] // 화면 표시 순서의 필드명 (amount_value 포함)
  containerRef: React.RefObject<HTMLElement | null>
}

const cellKey = (r: number, field: string) => `${r}::${field}`

// 합계는 계산 필드 — 선택/복사는 되지만 편집·붙여넣기·삭제 대상에서 제외
const READONLY_FIELDS = ['amount_value']

export const emptyFormItem = (lineNumber: number, currency: string): FormItem => ({
  line_number: lineNumber,
  item_name: '',
  specification: '',
  quantity: 1,
  unit_price_value: 0,
  unit_price_currency: currency,
  amount_value: 0,
  amount_currency: currency,
  remark: '',
  link: '',
})

const setItemField = (item: FormItem, field: string, raw: string): FormItem => {
  const v = raw.trim()
  const next = { ...item }
  if (field === 'quantity') next.quantity = parseInt(v.replace(/,/g, '') || '0', 10) || 0
  else if (field === 'unit_price_value') next.unit_price_value = parseFloat(v.replace(/,/g, '') || '0') || 0
  else if (field === 'item_name') next.item_name = v
  else if (field === 'specification') next.specification = v
  else if (field === 'link') next.link = v
  else if (field === 'remark') next.remark = v
  next.amount_value = (Number(next.quantity) || 0) * (Number(next.unit_price_value) || 0)
  return next
}

const getItemField = (item: FormItem, field: string): string => {
  const v = (item as unknown as Record<string, unknown>)[field]
  if (v == null) return ''
  return String(v)
}

export function usePurchaseItemsGrid({ getItems, replace, currency, cols, containerRef }: UsePurchaseItemsGridParams) {
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  const selectedSet = useMemo(() => new Set(selectedCells), [selectedCells])

  const anchorRef = useRef<GridPos | null>(null)
  const focusRef = useRef<GridPos | null>(null)
  const draggingRef = useRef(false)
  const dragMovedRef = useRef(false)
  const rowDragStartRef = useRef<number | null>(null)

  // 일괄 입력 플로팅 메뉴 (다중 선택 드래그 종료/Enter 시)
  const [bulkMenuPos, setBulkMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [bulkValue, setBulkValue] = useState('')

  // 되돌리기(Ctrl+Z): 그리드 단위 조작(붙여넣기/셀 비우기/행 삭제/일괄 입력) 전 스냅샷
  const undoStackRef = useRef<{ items: FormItem[]; label: string }[]>([])

  const colsRef = useRef(cols)
  colsRef.current = cols

  const clearSelection = () => {
    setSelectedCells(prev => (prev.length === 0 ? prev : []))
    setBulkMenuPos(null)
  }

  const pushUndo = (label: string) => {
    const snapshot = getItems().map(it => ({ ...it }))
    undoStackRef.current.push({ items: snapshot, label })
    if (undoStackRef.current.length > 50) undoStackRef.current.shift()
  }

  const commit = (next: FormItem[], undoLabel: string) => {
    pushUndo(undoLabel)
    replace(next)
  }

  const rectCells = (a: GridPos, b: GridPos): string[] => {
    const minR = Math.min(a.r, b.r), maxR = Math.max(a.r, b.r)
    const minC = Math.min(a.c, b.c), maxC = Math.max(a.c, b.c)
    const sel: string[] = []
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) sel.push(cellKey(r, colsRef.current[c]))
    return sel
  }

  const rowCells = (r: number): string[] => colsRef.current.map(f => cellKey(r, f))

  const blurGridInput = () => {
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur()
  }

  const focusCellInput = (r: number, field: string) => {
    // 셀 input은 항상 렌더돼 있으므로 즉시 포커스. 행이 방금 추가된 경우만 다음 틱에 재시도.
    // (rAF는 탭이 백그라운드일 때 발화하지 않아 사용하지 않는다)
    const query = () => containerRef.current?.querySelector<HTMLInputElement>(
      `input[data-row-index="${r}"][data-field-name="${field}"]`
    )
    const el = query()
    if (el) { el.focus(); el.select(); return }
    setTimeout(() => { const el2 = query(); if (el2) { el2.focus(); el2.select() } }, 0)
  }

  const scrollCellIntoView = (r: number, field: string) => {
    const td = containerRef.current?.querySelector<HTMLElement>(`td[data-grid-cell="${CSS.escape(cellKey(r, field))}"]`)
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // ─── 마우스: 셀 선택 ───────────────────────────────────────────────
  const onCellMouseDown = useStableHandler((e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    setBulkMenuPos(null)
    const mod = e.ctrlKey || e.metaKey
    if (e.shiftKey && anchorRef.current) {
      e.preventDefault()
      blurGridInput()
      focusRef.current = { r, c }
      setSelectedCells(rectCells(anchorRef.current, { r, c }))
      return
    }
    if (mod) {
      e.preventDefault()
      blurGridInput()
      const key = cellKey(r, colsRef.current[c])
      anchorRef.current = { r, c }
      focusRef.current = { r, c }
      setSelectedCells(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
      return
    }
    // 일반 클릭: 단일 선택 + input 포커스는 네이티브 동작에 맡김
    anchorRef.current = { r, c }
    focusRef.current = { r, c }
    draggingRef.current = true
    dragMovedRef.current = false
    setSelectedCells([cellKey(r, colsRef.current[c])])
  })

  const onCellMouseEnter = useStableHandler((e: React.MouseEvent, r: number, c: number) => {
    if (!draggingRef.current || !anchorRef.current) return
    if ((e.buttons & 1) === 0) { draggingRef.current = false; return }
    if (r === anchorRef.current.r && c === anchorRef.current.c) return
    dragMovedRef.current = true
    blurGridInput()
    focusRef.current = { r, c }
    setSelectedCells(rectCells(anchorRef.current, { r, c }))
  })

  // ─── 마우스: NO. 칼럼 행 선택 ──────────────────────────────────────
  const onRowNoMouseDown = useStableHandler((e: React.MouseEvent, r: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    blurGridInput()
    setBulkMenuPos(null)
    const mod = e.ctrlKey || e.metaKey
    if (e.shiftKey && anchorRef.current) {
      const [lo, hi] = anchorRef.current.r <= r ? [anchorRef.current.r, r] : [r, anchorRef.current.r]
      const sel: string[] = []
      for (let i = lo; i <= hi; i++) sel.push(...rowCells(i))
      focusRef.current = { r, c: colsRef.current.length - 1 }
      setSelectedCells(sel)
      return
    }
    if (mod) {
      const cells = rowCells(r)
      setSelectedCells(prev => {
        const has = cells.every(k => prev.includes(k))
        return has ? prev.filter(k => !cells.includes(k)) : [...prev, ...cells.filter(k => !prev.includes(k))]
      })
      anchorRef.current = { r, c: 0 }
      focusRef.current = { r, c: colsRef.current.length - 1 }
      return
    }
    rowDragStartRef.current = r
    anchorRef.current = { r, c: 0 }
    focusRef.current = { r, c: colsRef.current.length - 1 }
    setSelectedCells(rowCells(r))
  })

  const onRowNoMouseEnter = useStableHandler((e: React.MouseEvent, r: number) => {
    if (rowDragStartRef.current === null) return
    if ((e.buttons & 1) === 0) { rowDragStartRef.current = null; return }
    const start = rowDragStartRef.current
    const [lo, hi] = start <= r ? [start, r] : [r, start]
    const sel: string[] = []
    for (let i = lo; i <= hi; i++) sel.push(...rowCells(i))
    focusRef.current = { r, c: colsRef.current.length - 1 }
    setSelectedCells(sel)
  })

  // 드래그 종료: 다중 선택이면 일괄 입력 메뉴 표시 (제작현황과 동일)
  useEffect(() => {
    const onMouseUp = () => {
      const wasDragging = draggingRef.current && dragMovedRef.current
      draggingRef.current = false
      rowDragStartRef.current = null
      if (wasDragging) openBulkMenuAtFocus()
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openBulkMenuAtFocus = useStableHandler(() => {
    if (selectedCells.length <= 1 && !(draggingRef.current || dragMovedRef.current)) return
    const f = focusRef.current
    if (!f) return
    const editable = selectedCells.filter(k => !READONLY_FIELDS.includes(k.split('::')[1]))
    if (editable.length <= 1) return
    const td = containerRef.current?.querySelector<HTMLElement>(
      `td[data-grid-cell="${CSS.escape(cellKey(f.r, colsRef.current[f.c]))}"]`
    )
    const rect = td?.getBoundingClientRect()
    setBulkValue(computeBulkPrefill())
    setBulkMenuPos(rect ? { x: rect.right, y: rect.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 })
  })

  // 선택 셀들의 값이 모두 같으면 그 값을 일괄 입력 초기값으로
  const computeBulkPrefill = (): string => {
    const items = getItems()
    let common: string | null = null
    for (const key of selectedCells) {
      const [rStr, field] = splitKey(key)
      if (READONLY_FIELDS.includes(field)) continue
      const v = getItemField(items[Number(rStr)] ?? emptyFormItem(0, currency), field)
      if (common === null) common = v
      else if (common !== v) return ''
    }
    return common ?? ''
  }

  const splitKey = (key: string): [string, string] => {
    const sep = key.indexOf('::')
    return [key.slice(0, sep), key.slice(sep + 2)]
  }

  // ─── 선택 영역 사각형 (표시 순서 기준) ─────────────────────────────
  const getSelectionRect = () => {
    if (selectedCells.length === 0) return null
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
    for (const key of selectedCells) {
      const [rStr, field] = splitKey(key)
      const r = Number(rStr)
      const c = colsRef.current.indexOf(field)
      if (c === -1) continue
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    }
    if (!isFinite(minR)) return null
    return { minR, maxR, minC, maxC }
  }

  // ─── 복사 (Ctrl/Cmd+C) ────────────────────────────────────────────
  const handleCopyKey = useStableHandler((e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return
    const ae = document.activeElement as HTMLInputElement | null
    if (ae && ae.tagName === 'INPUT') {
      // 그리드 input 안에서 텍스트 선택 없이 복사 → 칸 전체 값 복사 (제작현황과 동일)
      const isGridInput = ae.hasAttribute('data-field-name') && ae.hasAttribute('data-row-index')
      const hasTextSel = ae.selectionStart !== ae.selectionEnd
      if (isGridInput && !hasTextSel) {
        e.preventDefault()
        navigator.clipboard?.writeText(ae.value).then(() => toast.success('셀 내용이 복사되었습니다.')).catch(() => {})
      }
      return
    }
    if (ae && (ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    const rect = getSelectionRect()
    if (!rect) return
    e.preventDefault()
    const items = getItems()
    const lines: string[] = []
    for (let r = rect.minR; r <= rect.maxR; r++) {
      const row: string[] = []
      for (let c = rect.minC; c <= rect.maxC; c++) {
        row.push(items[r] ? getItemField(items[r], colsRef.current[c]) : '')
      }
      lines.push(row.join('\t'))
    }
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => {
        const rows = rect.maxR - rect.minR + 1
        const colsN = rect.maxC - rect.minC + 1
        toast.success(rows * colsN > 1 ? `${rows}×${colsN} 셀을 복사했습니다. 엑셀에 붙여넣을 수 있습니다.` : '셀 내용이 복사되었습니다.')
      })
      .catch(() => toast.error('클립보드 복사에 실패했습니다.'))
  })

  // ─── 붙여넣기 (Ctrl/Cmd+V) ────────────────────────────────────────
  // 엑셀에서 복사한 N×M 범위를 시작 셀부터 펼쳐 채운다. 행이 모자라면 자동 추가.
  // 1×1 값을 다중 선택에 붙여넣으면 선택 전체를 같은 값으로 채운다.
  const applyGridPaste = (startR: number, startC: number, grid: string[][]) => {
    const items = getItems().map(it => ({ ...it }))
    let appended = 0
    grid.forEach((rowVals, ri) => {
      const targetR = startR + ri
      while (targetR >= items.length) {
        items.push(emptyFormItem(items.length + 1, currency))
        appended++
      }
      let item = items[targetR]
      rowVals.forEach((v, ci) => {
        const c = startC + ci
        if (c >= colsRef.current.length) return
        const field = colsRef.current[c]
        if (READONLY_FIELDS.includes(field)) return
        item = setItemField(item, field, v)
      })
      items[targetR] = item
    })
    commit(items, '붙여넣기')
    toast.success(`${grid.length}개 행 데이터를 붙여넣었습니다.${appended > 0 ? ` (${appended}행 추가)` : ''}`)
  }

  const handlePasteEvent = useStableHandler((e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text) return
    const ae = document.activeElement as HTMLInputElement | null
    const isGridInput = !!ae && ae.tagName === 'INPUT' && ae.hasAttribute('data-field-name') && ae.hasAttribute('data-row-index')

    // 탭/개행 없는 일반 텍스트: input 기본 동작에 양보 (선택만 있고 input 포커스가 없으면 채우기)
    const isTable = text.includes('\t') || /\r|\n/.test(text)

    try {
      if (isGridInput && ae) {
        if (!isTable) return // 네이티브 붙여넣기
        e.preventDefault()
        const r = parseInt(ae.getAttribute('data-row-index') || '0', 10) || 0
        const c = Math.max(0, colsRef.current.indexOf(ae.getAttribute('data-field-name') || ''))
        ae.blur()
        applyGridPaste(r, c, parseTsv(text))
        return
      }
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
      const rect = getSelectionRect()
      if (!rect) return
      e.preventDefault()
      const grid = parseTsv(text)
      if (grid.length === 1 && grid[0].length === 1 && selectedCells.length > 1) {
        // 단일 값 → 선택 전체 채우기 (엑셀과 동일)
        applyBulkValue(grid[0][0])
        return
      }
      applyGridPaste(rect.minR, rect.minC, grid)
    } catch (err) {
      logger.error('품목 그리드 붙여넣기 오류:', err)
      toast.error('붙여넣기 중 오류가 발생했습니다.')
    }
  })

  const parseTsv = (text: string): string[][] =>
    text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(line => line.split('\t'))

  // ─── 일괄 값 적용 (일괄 입력 메뉴 / 단일 값 다중 붙여넣기) ─────────
  const applyBulkValue = useStableHandler((value: string) => {
    if (selectedCells.length === 0) return
    const items = getItems().map(it => ({ ...it }))
    let applied = 0
    for (const key of selectedCells) {
      const [rStr, field] = splitKey(key)
      const r = Number(rStr)
      if (!items[r] || READONLY_FIELDS.includes(field)) continue
      items[r] = setItemField(items[r], field, value)
      applied++
    }
    if (applied === 0) return
    commit(items, '일괄 입력')
    toast.success(`${applied}개 칸에 입력했습니다.`)
    setBulkMenuPos(null)
  })

  // ─── Delete/Backspace: 일부 셀=값 비우기, 행 전체=행 삭제 ──────────
  const handleDeleteKey = useStableHandler((e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (selectedCells.length === 0) return
    e.preventDefault()

    const byRow = new Map<number, string[]>()
    for (const key of selectedCells) {
      const [rStr, field] = splitKey(key)
      const r = Number(rStr)
      if (!byRow.has(r)) byRow.set(r, [])
      byRow.get(r)!.push(field)
    }

    const isFullRows = [...byRow.values()].every(fs => fs.length >= colsRef.current.length)
    if (isFullRows) {
      deleteRows([...byRow.keys()])
      return
    }

    const items = getItems().map(it => ({ ...it }))
    let cleared = 0
    for (const [r, fs] of byRow) {
      if (!items[r]) continue
      for (const f of fs) {
        if (READONLY_FIELDS.includes(f)) continue
        items[r] = setItemField(items[r], f, '')
        cleared++
      }
    }
    if (cleared === 0) return
    commit(items, '셀 값 삭제')
    toast.success(`선택한 셀 ${cleared}개의 값이 삭제되었습니다.`)
    setSelectedCells([])
  })

  const deleteRows = useStableHandler((rows: number[]) => {
    if (rows.length === 0) return
    if (!confirm(rows.length > 1 ? `선택한 ${rows.length}개 행을 삭제하시겠습니까?` : '이 행을 삭제하시겠습니까?')) return
    const rowSet = new Set(rows)
    let next = getItems().filter((_, idx) => !rowSet.has(idx))
    if (next.length === 0) next = [emptyFormItem(1, currency)]
    next = next.map((it, idx) => ({ ...it, line_number: idx + 1 }))
    commit(next, '행 삭제')
    clearSelection()
    toast.success(`${rows.length}개 행이 삭제되었습니다. (Ctrl+Z로 되돌리기 가능)`)
  })

  // ─── 되돌리기 (Ctrl/Cmd+Z) ────────────────────────────────────────
  const handleUndoKey = useStableHandler((e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    const last = undoStackRef.current.pop()
    if (!last) return
    e.preventDefault()
    replace(last.items)
    clearSelection()
    toast.success(`'${last.label}' 작업을 되돌렸습니다.`)
  })

  // ─── 키보드 내비게이션 (방향키/Tab/Enter/F2/ESC/Space) ─────────────
  const handleNavKey = useStableHandler((e: KeyboardEvent) => {
    if (e.altKey) return
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    if (selectedCells.length === 0) return

    const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const mod = e.ctrlKey || e.metaKey
    const isTab = e.key === 'Tab'
    const isSpace = e.key === ' '
    if (!(e.key in ARROWS) && !isTab && !isSpace && e.key !== 'Enter' && e.key !== 'F2' && e.key !== 'Escape') return

    if (e.key === 'Escape') {
      e.preventDefault()
      clearSelection()
      return
    }

    const anchor = anchorRef.current
    const focus = focusRef.current
    if (!anchor || !focus) return
    const lastR = getItems().length - 1
    const lastC = colsRef.current.length - 1

    if (isSpace) {
      if (e.shiftKey && !mod) {
        // Shift+Space: 선택 범위에 걸친 행 전체 선택
        e.preventDefault()
        const sel: string[] = []
        for (let r = Math.min(anchor.r, focus.r); r <= Math.max(anchor.r, focus.r); r++) sel.push(...rowCells(r))
        setSelectedCells(sel)
        setBulkMenuPos(null)
      } else if (mod) {
        // Ctrl/Cmd(+Shift)+Space: 선택 범위에 걸친 열 전체 선택
        e.preventDefault()
        const sel: string[] = []
        for (let r = 0; r <= lastR; r++)
          for (let c = Math.min(anchor.c, focus.c); c <= Math.max(anchor.c, focus.c); c++) sel.push(cellKey(r, colsRef.current[c]))
        setSelectedCells(sel)
        setBulkMenuPos(null)
      }
      return
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      if (mod || e.shiftKey) return
      e.preventDefault()
      if (selectedCells.length > 1) {
        openBulkMenuAtFocus()
        return
      }
      // 단일 선택 셀 편집 시작
      const [rStr, field] = splitKey(selectedCells[0])
      if (!READONLY_FIELDS.includes(field)) focusCellInput(Number(rStr), field)
      return
    }

    // Tab: 우측 이동(Shift+Tab 좌측, 항상 단일 선택) · 방향키: 이동/Shift=확장/Ctrl=끝 점프
    e.preventDefault()
    const [dr, dc] = isTab ? [0, e.shiftKey ? -1 : 1] : ARROWS[e.key]
    const extend = !isTab && e.shiftKey
    const target = (!isTab && mod)
      ? dataEdgeFrom(focus.r, focus.c, dr, dc, lastR, lastC)
      : { r: Math.max(0, Math.min(lastR, focus.r + dr)), c: Math.max(0, Math.min(lastC, focus.c + dc)) }

    focusRef.current = target
    if (extend) {
      setSelectedCells(rectCells(anchor, target))
    } else {
      anchorRef.current = target
      setSelectedCells([cellKey(target.r, colsRef.current[target.c])])
    }
    setBulkMenuPos(null)
    scrollCellIntoView(target.r, colsRef.current[target.c])
  })

  // Ctrl+방향키: 값이 있는 데이터 영역의 끝으로 점프 (엑셀과 동일한 감각)
  const dataEdgeFrom = (r: number, c: number, dr: number, dc: number, lastR: number, lastC: number): GridPos => {
    const items = getItems()
    const hasVal = (rr: number, cc: number) => {
      const it = items[rr]
      if (!it) return false
      const v = getItemField(it, colsRef.current[cc])
      return v !== '' && v !== '0'
    }
    let rr = r, cc = c
    const step = () => { rr = Math.max(0, Math.min(lastR, rr + dr)); cc = Math.max(0, Math.min(lastC, cc + dc)) }
    // 진행 방향의 끝에 닿았는지 (반대쪽 끝에 있는 것은 무관)
    const atEdge = () =>
      (dr === 1 && rr === lastR) || (dr === -1 && rr === 0) ||
      (dc === 1 && cc === lastC) || (dc === -1 && cc === 0)
    if (atEdge()) return { r: rr, c: cc }
    const curHas = hasVal(rr, cc)
    step()
    if (curHas && hasVal(rr, cc)) {
      // 데이터 연속 구간: 값이 끊기기 직전까지 이동
      while (!atEdge()) {
        const pr = rr, pc = cc
        step()
        if (!hasVal(rr, cc)) return { r: pr, c: pc }
      }
      return { r: rr, c: cc }
    }
    // 빈 구간: 다음 값이 있는 셀 또는 끝까지 이동
    while (!atEdge() && !hasVal(rr, cc)) step()
    return { r: rr, c: cc }
  }

  // ─── 바깥 클릭 시 선택 해제 (엑셀처럼) ─────────────────────────────
  useEffect(() => {
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (containerRef.current && containerRef.current.contains(target)) return
      // 팝오버(달력 등)·일괄입력 메뉴 내부 클릭은 제외 — mousedown 시점 리렌더가
      // 팝오버 안의 click 이벤트를 삼키는 문제 방지
      if (target.closest?.('[data-radix-popper-content-wrapper]')) return
      if (target.closest?.('[data-items-grid-bulk-menu]')) return
      clearSelection()
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 전역 리스너 등록 ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      handleCopyKey(e)
      handleUndoKey(e)
      handleDeleteKey(e)
      handleNavKey(e)
    }
    const onPaste = (e: ClipboardEvent) => { handlePasteEvent(e) }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 셀 input 전용 키 처리: Enter=아래 이동, ESC=선택 유지·포커스 해제 ─
  const onCellInputKeyDown = useStableHandler((e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter') {
      // form submit 방지 + 엑셀처럼 아래 셀로 이동
      e.preventDefault()
      const lastR = getItems().length - 1
      const nr = Math.min(lastR, r + 1)
      anchorRef.current = { r: nr, c }
      focusRef.current = { r: nr, c }
      setSelectedCells([cellKey(nr, colsRef.current[c])])
      if (nr !== r) focusCellInput(nr, colsRef.current[c])
      else (e.target as HTMLInputElement).blur()
      scrollCellIntoView(nr, colsRef.current[c])
    } else if (e.key === 'Escape') {
      // blur 직후 window 핸들러가 같은 ESC로 선택까지 해제하지 않도록 전파를 끊는다
      e.stopPropagation();
      (e.target as HTMLInputElement).blur()
    }
  })

  // 다중 선택 시 선택된 행 집합 (X 버튼 일괄삭제 판단용)
  const selectedFullRows = useMemo(() => {
    const byRow = new Map<number, number>()
    for (const key of selectedCells) {
      const [rStr] = splitKey(key)
      const r = Number(rStr)
      byRow.set(r, (byRow.get(r) ?? 0) + 1)
    }
    const rows = new Set<number>()
    for (const [r, count] of byRow) if (count >= cols.length) rows.add(r)
    return rows
  }, [selectedCells, cols.length])

  return {
    selectedSet,
    selectedCells,
    selectedFullRows,
    bulkMenuPos,
    bulkValue,
    setBulkValue,
    setBulkMenuPos,
    applyBulkValue,
    deleteRows,
    clearSelection,
    onCellMouseDown,
    onCellMouseEnter,
    onRowNoMouseDown,
    onRowNoMouseEnter,
    onCellInputKeyDown,
    pushUndo,
  }
}
