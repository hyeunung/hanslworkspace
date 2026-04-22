import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface NewWindowProps {
  title?: string
  features?: string          // "width=1000,height=800"
  onClose?: () => void
  onReady?: (win: Window) => void  // 새 창 준비 완료 시 호출 (window.print() 등 접근용)
  children: React.ReactNode
}

/**
 * 자식 컴포넌트를 별도의 브라우저 창에 렌더링하는 Portal.
 * - 메인 창의 <style>, <link rel=stylesheet> 를 복제해 Tailwind 등 스타일 유지.
 * - onClose 는 창이 닫힐 때 호출.
 */
export default function NewWindow({
  title = '제품 인수증 미리보기',
  features = 'width=1000,height=1100',
  onClose,
  onReady,
  children,
}: NewWindowProps) {
  const containerEl = useMemo(() => document.createElement('div'), [])
  const [winReady, setWinReady] = useState(false)
  const winRef = useRef<Window | null>(null)

  useEffect(() => {
    const w = window.open('', '_blank', features)
    if (!w) {
      onClose?.()
      return
    }
    winRef.current = w
    w.document.title = title

    // 메인 창의 스타일 복사
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        const owner = sheet.ownerNode as HTMLElement | null
        if (owner instanceof HTMLStyleElement) {
          const clone = w.document.createElement('style')
          clone.textContent = owner.textContent ?? ''
          w.document.head.appendChild(clone)
        } else if (owner instanceof HTMLLinkElement) {
          const clone = w.document.createElement('link')
          clone.rel = 'stylesheet'
          clone.href = owner.href
          w.document.head.appendChild(clone)
        }
      } catch {
        // cross-origin 스타일시트는 스킵
      }
    })

    // 본문 기본 스타일
    w.document.body.style.margin = '0'
    w.document.body.style.background = '#e5e7eb'

    w.document.body.appendChild(containerEl)
    setWinReady(true)
    onReady?.(w)

    const handleUnload = () => onClose?.()
    w.addEventListener('beforeunload', handleUnload)

    return () => {
      w.removeEventListener('beforeunload', handleUnload)
      try {
        w.close()
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!winReady) return null
  return createPortal(children, containerEl)
}
