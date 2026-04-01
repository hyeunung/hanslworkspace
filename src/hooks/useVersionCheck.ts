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

/** 체크 주기 (5분) */
const CHECK_INTERVAL = 5 * 60 * 1000

/** localStorage 키 - 마지막으로 dismiss한 빌드 ID */
const DISMISSED_KEY = 'hansl_dismissed_build_id'

declare const __APP_BUILD_ID__: string
declare const __APP_VERSION__: string

/**
 * 새 버전 배포를 감지하고 업데이트 알림을 관리하는 훅
 * - 5분 간격으로 /version.json 폴링
 * - buildId 비교로 새 배포 감지
 * - changelog.json에서 변경사항 로드
 */
export function useVersionCheck(): VersionCheckState {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [newVersion, setNewVersion] = useState<VersionInfo | null>(null)
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([])
  const [showModal, setShowModal] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentBuildId = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

  const checkVersion = useCallback(async () => {
    try {
      // cache-busting으로 version.json 가져오기
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return

      const remote: VersionInfo = await res.json()

      // 빌드 ID가 다르면 새 배포 감지
      if (currentBuildId && remote.buildId && remote.buildId !== currentBuildId) {
        // 이미 dismiss한 버전이면 무시
        const dismissed = localStorage.getItem(DISMISSED_KEY)
        if (dismissed === remote.buildId) return

        setNewVersion(remote)
        setHasUpdate(true)

        // 변경사항 로드
        try {
          const clRes = await fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' })
          if (clRes.ok) {
            const entries: ChangelogEntry[] = await clRes.json()
            // 현재 버전보다 새로운 항목만 필터링
            const newEntries = entries.filter(e => e.version > currentVersion || e.version === remote.version)
            setChangelog(newEntries.length > 0 ? newEntries : entries.slice(0, 1))
          }
        } catch {
          // changelog 로드 실패는 무시
        }

        setShowModal(true)
      }
    } catch {
      // 네트워크 에러는 조용히 무시 (오프라인 등)
    }
  }, [currentBuildId, currentVersion])

  useEffect(() => {
    // 개발모드에서는 체크하지 않음
    if (import.meta.env.DEV) return

    // 초기 체크 (로드 후 30초 뒤)
    const initialTimeout = setTimeout(checkVersion, 30 * 1000)

    // 주기적 체크
    intervalRef.current = setInterval(checkVersion, CHECK_INTERVAL)

    // visibility change 시에도 체크 (탭 복귀 시)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(initialTimeout)
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkVersion])

  const dismissUpdate = useCallback(() => {
    setShowModal(false)
    if (newVersion?.buildId) {
      localStorage.setItem(DISMISSED_KEY, newVersion.buildId)
    }
  }, [newVersion])

  const applyUpdate = useCallback(() => {
    window.location.reload()
  }, [])

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
