import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── 제작현황 셀 프레즌스 (구글시트式 동시편집 표시) ─────────────────────
// Supabase Realtime Presence로 "지금 누가 어떤 셀을 선택/편집 중인지"를
// 접속자끼리 실시간 공유한다. DB 테이블과 무관하며 접속이 끊기면 서버가
// 상태를 자동 정리한다.
//
// 동일 토픽을 여러 훅 인스턴스가 중복 구독하면 기존 구독이 닫혀 실시간이
// 죽는 문제(PR #268)가 있으므로, 채널은 모듈 레벨 refcount 싱글톤으로
// 1개만 유지한다. (StrictMode 이중 마운트 포함)

export interface RemoteCellUser {
  name: string
  color: string
  editing: boolean // 이 셀을 입력(편집) 중인지
  anchor: boolean // 이름 라벨을 표시할 대표 셀인지 (편집 셀 또는 선택 앵커)
}

// 화면을 함께 열어둔 다른 접속자 (같은 사람이 여러 탭을 열어도 1명으로 합침)
export interface RemoteViewer {
  name: string
  color: string
}

interface PresencePayload {
  name: string
  color: string
  editing: string | null // 편집 중 셀 키 (`${id}::${field}`)
  cells: string[] // 선택 중 셀 키 목록 (MAX_TRACKED_CELLS 상한)
}

const TOPIC = 'production-cell-presence'
// 열 전체 드래그처럼 수백~수천 칸 선택 시 presence 페이로드가 비대해지므로 상한을 둔다
const MAX_TRACKED_CELLS = 200
const TRACK_THROTTLE_MS = 200

// 자기 선택 표시(파랑 #3b82f6)와 겹치지 않는 색상 팔레트 — 이름 해시로 고정 배정
const PALETTE = ['#e8590c', '#2f9e44', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#6741d9', '#c2255c']

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// 탭(접속)마다 고유 키 — 같은 사람이 두 탭을 열어도 각각 표시된다
const connId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `conn-${Math.random().toString(36).slice(2)}`

let channel: RealtimeChannel | null = null
let refCount = 0
let joined = false
let remoteSnapshot: PresencePayload[] = []
const listeners = new Set<() => void>()

let pendingPayload: PresencePayload | null = null
let trackTimer: ReturnType<typeof setTimeout> | null = null
let lastTrackAt = 0

function emit() {
  listeners.forEach(l => l())
}

function readPresenceState() {
  if (!channel) return
  const state = channel.presenceState<PresencePayload>()
  const rows: PresencePayload[] = []
  for (const key of Object.keys(state)) {
    if (key === connId) continue // 내 접속은 제외
    for (const meta of state[key]) {
      rows.push({ name: meta.name, color: meta.color, editing: meta.editing, cells: meta.cells || [] })
    }
  }
  remoteSnapshot = rows
  emit()
}

function flushTrack() {
  trackTimer = null
  if (!channel || !joined || !pendingPayload) return
  lastTrackAt = Date.now()
  channel.track(pendingPayload as unknown as { [key: string]: unknown })
}

function scheduleTrack(payload: PresencePayload) {
  pendingPayload = payload
  if (trackTimer != null) return
  const wait = Math.max(0, TRACK_THROTTLE_MS - (Date.now() - lastTrackAt))
  trackTimer = setTimeout(flushTrack, wait)
}

function acquire() {
  refCount++
  if (channel) return
  const supabase = createClient()
  channel = supabase
    .channel(TOPIC, { config: { presence: { key: connId } } })
    .on('presence', { event: 'sync' }, readPresenceState)
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        joined = true
        if (pendingPayload) scheduleTrack(pendingPayload)
      }
    })
}

function release() {
  refCount--
  if (refCount > 0) return
  if (trackTimer != null) {
    clearTimeout(trackTimer)
    trackTimer = null
  }
  if (channel) {
    createClient().removeChannel(channel)
    channel = null
  }
  joined = false
  remoteSnapshot = []
  pendingPayload = null
}

function subscribeStore(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return remoteSnapshot
}

/**
 * 내 선택/편집 상태를 presence로 브로드캐스트하고,
 * 다른 접속자들의 셀 점유 현황(`셀키 → 사용자 목록` Map)과
 * 화면을 함께 보고 있는 사람 목록(viewers)을 돌려준다.
 */
export function useProductionPresence(args: {
  name: string
  editing: string | null
  cells: string[]
}): { cellMap: Map<string, RemoteCellUser[]>; viewers: RemoteViewer[] } {
  const { name, editing, cells } = args

  useEffect(() => {
    acquire()
    return release
  }, [])

  // 배열 내용이 같으면 track을 다시 보내지 않도록 문자열 시그니처로 비교
  const cellsSig = useMemo(() => {
    const capped = cells.length > MAX_TRACKED_CELLS ? cells.slice(0, MAX_TRACKED_CELLS) : cells
    return capped.join('|')
  }, [cells])

  useEffect(() => {
    const displayName = name.trim() || '익명'
    scheduleTrack({
      name: displayName,
      color: colorFor(displayName),
      editing,
      cells: cellsSig ? cellsSig.split('|') : [],
    })
  }, [name, editing, cellsSig])

  const remote = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot)

  return useMemo(() => {
    const map = new Map<string, RemoteCellUser[]>()
    const add = (key: string, user: RemoteCellUser) => {
      const list = map.get(key)
      if (list) list.push(user)
      else map.set(key, [user])
    }
    const viewerByName = new Map<string, RemoteViewer>()
    for (const p of remote) {
      const base = { name: p.name, color: p.color }
      if (!viewerByName.has(p.name)) viewerByName.set(p.name, base)
      p.cells.forEach((key, i) => {
        if (key === p.editing) return // 편집 셀은 아래에서 별도 표시
        add(key, { ...base, editing: false, anchor: !p.editing && i === 0 })
      })
      if (p.editing) add(p.editing, { ...base, editing: true, anchor: true })
    }
    const viewers = [...viewerByName.values()].sort((a, b) => a.name.localeCompare(b.name))
    return { cellMap: map, viewers }
  }, [remote])
}
