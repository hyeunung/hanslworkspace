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
  /** 새로고침이 필요한지 (탭 열어둔 채 감지된 경우) */
  needsReload: boolean
  /** 확인 또는 업데이트 적용 */
  applyUpdate: () => void
}

/** 폴링 주기 (5분) */
const CHECK_INTERVAL = 5 * 60 * 1000

/** localStorage 키 */
const SEEN_BUILD_KEY = 'hansl_seen_build_id'
const SEEN_VERSION_KEY = 'hansl_seen_version'

declare const __APP_BUILD_ID__: string
declare const __APP_VERSION__: string
declare const __APP_BUILD_TIME__: string

/**
 * 새 버전 배포를 감지하고 업데이트 알림을 관리하는 훅
 *
 * 두 가지 시나리오를 모두 커버:
 * 1) 새로고침/재방문 시: localStorage의 "마지막 본 buildId"와 현재 buildId 비교
 * 2) 페이지 열어둔 채 새 배포: 폴링으로 서버 version.json의 buildId와 현재 buildId 비교
 *
 * changelog: "마지막으로 본 버전" 이후의 모든 변경사항을 누적 표시
 * → 5번 업데이트 동안 미접속한 사용자도 놓친 변경사항을 전부 확인 가능
 */
export function useVersionCheck(): VersionCheckState {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [newVersion, setNewVersion] = useState<VersionInfo | null>(null)
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([])
  const [showModal, setShowModal] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentBuildId = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
  const currentBuildTime = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : ''

  /**
   * changelog.json에서 변경사항 로드
   * "마지막으로 본 버전(seenVersion)" 이후의 모든 항목을 표시
   */
  const loadChangelog = useCallback(async () => {
    try {
      const res = await fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const entries: ChangelogEntry[] = await res.json()

      // 마지막으로 본 버전 (localStorage에 저장된 값)
      const seenVersion = localStorage.getItem(SEEN_VERSION_KEY) || '0.0.0'

      // seenVersion보다 새로운 모든 항목 (놓친 업데이트 전부 포함)
      const missedEntries = entries.filter(e => e.version > seenVersion)
      setChangelog(missedEntries.length > 0 ? missedEntries : entries.slice(0, 1))
    } catch {
      // changelog 로드 실패는 무시
    }
  }, [])

  /** 업데이트 모달 띄우기 */
  const showUpdate = useCallback((version: VersionInfo, requiresReload: boolean) => {
    setNewVersion(version)
    setHasUpdate(true)
    setNeedsReload(requiresReload)
    setShowModal(true)
    loadChangelog()
  }, [loadChangelog])

  // ── 시나리오 1: 페이지 로드 시 "이전에 본 빌드"와 현재 빌드 비교 ──
  useEffect(() => {
    if (import.meta.env.DEV || !currentBuildId) return

    const seenBuildId = localStorage.getItem(SEEN_BUILD_KEY)

    // 처음 방문이면 현재 빌드와 버전을 기록하고 끝
    if (!seenBuildId) {
      localStorage.setItem(SEEN_BUILD_KEY, currentBuildId)
      localStorage.setItem(SEEN_VERSION_KEY, currentVersion)
      return
    }

    // 이전에 본 빌드와 다르면 → 새 배포 후 재방문 (이미 최신 코드 로드됨, 새로고침 불필요)
    if (seenBuildId !== currentBuildId) {
      showUpdate({
        version: currentVersion,
        buildId: currentBuildId,
        buildTime: currentBuildTime,
      }, false)
    }
  }, [currentBuildId, currentVersion, currentBuildTime, showUpdate])

  // ── 시나리오 2: 페이지 열어둔 채 폴링으로 서버 새 빌드 감지 ──
  const checkRemoteVersion = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return

      const remote: VersionInfo = await res.json()

      // 탭 열어둔 채 새 배포 감지 → 새로고침 필요
      if (currentBuildId && remote.buildId && remote.buildId !== currentBuildId) {
        showUpdate(remote, true)
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

  const applyUpdate = useCallback(() => {
    // 현재 빌드 + 버전을 "본 것"으로 기록
    const buildId = newVersion?.buildId || currentBuildId
    const version = newVersion?.version || currentVersion
    if (buildId) localStorage.setItem(SEEN_BUILD_KEY, buildId)
    if (version) localStorage.setItem(SEEN_VERSION_KEY, version)

    if (needsReload) {
      // 탭 열어둔 채 감지 → 새로고침으로 새 코드 적용
      window.location.reload()
    } else {
      // 재방문 → 이미 최신 코드, 모달만 닫기
      setShowModal(false)
    }
  }, [currentBuildId, currentVersion, newVersion, needsReload])

  return {
    hasUpdate,
    currentVersion,
    newVersion,
    changelog,
    showModal,
    needsReload,
    applyUpdate,
  }
}
