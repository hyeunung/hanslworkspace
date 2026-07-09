import { useRef } from 'react'

// ─── 행 렌더 격리 유틸 ──────────────────────────────────────────────
// 항상 같은 함수 객체를 유지하면서 내부는 "최신 렌더"의 로직을 실행한다.
// MemoRow가 렌더를 스킵한 행의 이벤트 핸들러(이전 렌더의 element에 붙어 있음)가
// 오래된 상태(stale closure)를 읽는 것을 방지하는 장치.
export function useStableHandler<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  const stableRef = useRef(((...args: any[]) => ref.current(...args)) as T)
  return stableRef.current
}
