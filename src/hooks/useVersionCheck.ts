import { useState, useEffect, useCallback, useRef } from 'react'

interface VersionInfo {
  version: string
  buildId: string
  buildTime: string
}

interface ChangelogEntry {
  version: string
  date: string
  title: string
  changes: { type: string; text: string }[]
}

interface VersionCheckState {
  /** 새 버전이 감지되었는지 */
  hasUpdate: boolean
  /** 현재 앱 버전 */
  currentVersion: string
  /** 새 버전 정보 */
  newVersion: VersionInfo | null
  /** 새 버전의 변경사항 */
  changelog: ChangelogEntry[]
  /** 업데이트 모달 표시 여부 */
  showModal: boolean
  /** 모달 닫기 */
  dismissUpdate: () => void
  /** 새로고침으로 업데이트 적용 */
  applyUpdate: () => void
}

/** 폴링 주기 (5분) */
const CHECK_INTERVAL = 5 * 60 * 1000

/** localStorage 키 - 마지막으로 확인(dismiss 또는 본)한 빌드 ID */
const SEEN_BUILD_KEY = 'hansl_seen_build_id'

declare const __APP_BUILD_ID__: string
declare const __APP_VERSION__: string

/**
 * 새 버전 배포를 감지하고 업데이트 알림을 관리하는 훅
 *
 * 두 가지 시나리오를 모두 커버:
 * 1) 새로고침/재방문 시: localStorage의 "마지막 본 buildId"와 현재 buildId 비교
 * 2) 페이지 열어둔 채 새 배포: 폴링으로 서버 version.json의 buildId와 현재 buildId 비교
 */
export function useVersionCheck(): VersionCheckState {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [newVersion, setNewVersion] = useState<VersionInfo | null>(null)
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([])
  const [showModal, setShowModal] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentBuildId = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
  const currentBuildTime = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : ''

  /** changelog.json에서 변경사항 로드 */
  const loadChangelog = useCallback(async (targetVersion: string) => {
    try {
      const res = await fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const entries: ChangelogEntry[] = await res.json()
      const newEntries = entries.filter(e => e.version > currentVersion || e.version === targetVersion)
      setChangelog(newEntries.length > 0 ? newEntries : entries.slice(0, 1))
    } catch {
      // changelog 로드 실패는 무시
    }
  }, [currentVersion])

  /** 업데이트 모달 띄우기 */
  const showUpdate = useCallback((version: VersionInfo) => {
    setNewVersion(version)
    setHasUpdate(true)
    setShowModal(true)
    loadChangelog(version.version)
  }, [loadChangelog])

  // ── 시나리오 1: 페이지 로드 시 "이전에 본 빌드"와 현재 빌드 비교 ──
  useEffect(() => {
    if (import.meta.env.DEV || !currentBuildId) return

    const seenBuildId = localStorage.getItem(SEEN_BUILD_KEY)

    // 처음 방문이면 현재 빌드를 기록만 하고 끝
    if (!seenBuildId) {
      localStorage.setItem(SEEN_BUILD_KEY, currentBuildId)
      return
    }

    // 이전에 본 빌드와 다르면 → 새 배포 후 재방문
    if (seenBuildId !== currentBuildId) {
      showUpdate({
        version: currentVersion,
        buildId: currentBuildId,
        buildTime: currentBuildTime,
      })
    }
  }, [currentBuildId, currentVersion, currentBuildTime, showUpdate])

  // ── 시나리오 2: 페이지 열어둔 채 폴링으로 서버 새 빌드 감지 ──
  const checkRemoteVersion = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return

      const remote: VersionInfo = await res.json()

      if (currentBuildId && remote.buildId && remote.buildId !== currentBuildId) {
        showUpdate(remote)
      }
    } catch {
      // 네트워크 에러는 조용히 무시
    }
  }, [currentBuildId, showUpdate])

  useEffect(() => {
    if (import.meta.env.DEV) return

    // 첫 폴링은 30초 후
    const initialTimeout = setTimeout(checkRemoteVersion, 30 * 1000)
    intervalRef.current = setInterval(checkRemoteVersion, CHECK_INTERVAL)

    // 탭 복귀 시에도 체크
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkRemoteVersion()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(initialTimeout)
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkRemoteVersion])

  const dismissUpdate = useCallback(() => {
    setShowModal(false)
    // dismiss 시 현재 빌드를 "본 것"으로 기록
    if (currentBuildId) {
      localStorage.setItem(SEEN_BUILD_KEY, currentBuildId)
    }
    // 폴링으로 감지된 원격 버전도 기록
    if (newVersion?.buildId && newVersion.buildId !== currentBuildId) {
      localStorage.setItem(SEEN_BUILD_KEY, newVersion.buildId)
    }
  }, [currentBuildId, newVersion])

  const applyUpdate = useCallback(() => {
    // 업데이트 적용 시 새 빌드를 "본 것"으로 미리 기록
    if (newVersion?.buildId) {
      localStorage.setItem(SEEN_BUILD_KEY, newVersion.buildId)
    } else if (currentBuildId) {
      localStorage.setItem(SEEN_BUILD_KEY, currentBuildId)
    }
    window.location.reload()
  }, [currentBuildId, newVersion])

  return {
    hasUpdate,
    currentVersion,
    newVersion,
    changelog,
    showModal,
    dismissUpdate,
    applyUpdate,
  }
}
