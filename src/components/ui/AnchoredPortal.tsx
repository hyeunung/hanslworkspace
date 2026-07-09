import React, { useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── 앵커 고정 포털 팝오버 ─────────────────────────────────────────────
// 셀/버튼에 붙는 팝오버를 document.body로 포털해 테이블·카드의 overflow에 잘리지 않게 띄운다.
// anchorEl 바로 아래에 fixed로 배치하고, 화면 우/하단을 벗어나면 안쪽(위쪽)으로 보정한다.
// 스크롤·리사이즈 시 앵커를 따라 재배치. (React 이벤트는 포털을 넘어 부모로 버블되므로 기존 stopPropagation 동작 유지)
export function AnchoredPortal({ anchorEl, children, align = 'left', gap = 2, zIndex = 9999 }: {
  anchorEl: HTMLElement | null
  children: React.ReactNode
  align?: 'left' | 'right'
  gap?: number
  zIndex?: number
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchorEl) return
    const place = () => {
      const a = anchorEl.getBoundingClientRect()
      const w = boxRef.current?.offsetWidth ?? 0
      const h = boxRef.current?.offsetHeight ?? 0
      let left = align === 'right' ? a.right - w : a.left
      let top = a.bottom + gap
      if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w
      if (left < 8) left = 8
      // 아래 공간이 부족하면 앵커 위로 뒤집기 (위도 부족하면 화면 안으로 클램프)
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - gap - h)
      setPos({ left, top })
    }
    place()
    // 내용 크기가 렌더 후 확정되거나 이후 변하는 팝오버(가변 폭 메모, 정렬 규칙 추가 등)를 따라 재배치
    const raf = requestAnimationFrame(place)
    const ro = boxRef.current ? new ResizeObserver(place) : null
    if (boxRef.current) ro?.observe(boxRef.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorEl, align, gap])
  if (!anchorEl) return null
  return createPortal(
    <div ref={boxRef} style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex }}>
      {children}
    </div>,
    document.body
  )
}
