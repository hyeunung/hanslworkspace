import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

// 재배포 후 구버전 청크(assets/*.js) 요청 실패 시 1회 자동 새로고침
// - 배포로 파일명이 바뀐 동적 import가 실패하면 Vite가 vite:preloadError를 발생시킨다
// - 10초 가드로 무한 새로고침 루프 방지 (새로고침 후에도 실패하면 ErrorBoundary가 처리)
window.addEventListener('vite:preloadError', (event) => {
  const RELOAD_GUARD_KEY = 'chunk-reload-at'
  const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
  if (Date.now() - lastReload < 10_000) return
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
