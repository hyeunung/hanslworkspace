import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchOfficialDocuments,
  deleteOfficialDocument,
  STATUS_LABELS,
  STATUS_COLORS,
  type OfficialDocument,
} from '@/services/officialDocumentService'
import OfficialDocumentForm from './OfficialDocumentForm'
import OfficialDocumentView from './OfficialDocumentView'
import { format } from 'date-fns'

type ViewMode = 'create' | 'view' | 'empty' | 'edit'

interface ApproverInfo {
  name: string | null
  department: string | null
  roles: string | string[] | null
}

// 결재 진행 중인 공문을 볼 수 있는 role 목록.
// 그 외 사용자는 approved(최종 승인) 공문만 볼 수 있다.
const PRIVILEGED_VIEW_ROLES = [
  'middle_manager',  // 담당자
  'final_approver',  // 전무
  'ceo',             // 대표이사
  'superadmin',
  'hr',
]

// 공문 작성 권한 — hr / superadmin만 가능
const CREATE_ROLES = ['hr', 'superadmin']

export default function OfficialDocumentMain() {
  const { user, employee, currentUserRoles } = useAuth()
  const [docs, setDocs] = useState<OfficialDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ViewMode>('empty')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [approvers, setApprovers] = useState<Record<string, ApproverInfo>>({})

  const senderUser = useMemo(
    () =>
      user
        ? {
            id: user.id,
            name: employee?.name ?? '',
            department: employee?.department ?? null,
          }
        : null,
    [user, employee]
  )

  const loadDocs = useCallback(async () => {
    try {
      setLoading(true)
      const list = await fetchOfficialDocuments()
      setDocs(list)
    } catch (err) {
      logger.error('공문 목록 로드 실패', err)
      toast.error('공문 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  // 결재자 이름 캐시 로드 (sender + approver UUID 들 → employees join)
  const loadApprovers = useCallback(async (list: OfficialDocument[]) => {
    const ids = new Set<string>()
    for (const d of list) {
      if (d.manager_approved_by) ids.add(d.manager_approved_by)
      if (d.executive_approved_by) ids.add(d.executive_approved_by)
      if (d.ceo_approved_by) ids.add(d.ceo_approved_by)
    }
    if (ids.size === 0) return
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('employees')
        .select('id, name, department, roles')
        .in('id', Array.from(ids))
      if (data) {
        setApprovers((prev) => {
          const next = { ...prev }
          for (const row of data as Array<{
            id: string
            name: string | null
            department: string | null
            roles: string | string[] | null
          }>) {
            next[String(row.id)] = {
              name: row.name,
              department: row.department,
              roles: row.roles,
            }
          }
          return next
        })
      }
    } catch (err) {
      logger.error('결재자 정보 로드 실패', err)
    }
  }, [])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  useEffect(() => {
    if (docs.length > 0) loadApprovers(docs)
  }, [docs, loadApprovers])

  // Realtime 구독 — 결재 상태 변경/생성/삭제를 실시간 반영
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('official-documents-realtime')
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'official_documents' },
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE'
          new: Record<string, unknown>
          old: Record<string, unknown>
        }) => {
          if (payload.eventType === 'INSERT') {
            const newDoc = payload.new as unknown as OfficialDocument
            setDocs((prev) => (prev.some((d) => d.id === newDoc.id) ? prev : [newDoc, ...prev]))
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as unknown as OfficialDocument
            setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
          } else if (payload.eventType === 'DELETE') {
            const oldDoc = payload.old as { id?: number }
            if (typeof oldDoc.id === 'number') {
              setDocs((prev) => prev.filter((d) => d.id !== oldDoc.id))
            }
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // 권한 기반 가시성 필터: 결재 진행 중인 공문은 권한자만, 그 외는 approved만
  const isPrivilegedViewer = useMemo(
    () => currentUserRoles.some((r) => PRIVILEGED_VIEW_ROLES.includes(r)),
    [currentUserRoles]
  )

  // 작성 권한 (hr / superadmin)
  const canCreate = useMemo(
    () => currentUserRoles.some((r) => CREATE_ROLES.includes(r)),
    [currentUserRoles]
  )

  const visibleDocs = useMemo(() => {
    if (isPrivilegedViewer) return docs
    return docs.filter((d) => d.approval_status === 'approved')
  }, [docs, isPrivilegedViewer])

  // 최초 로드 시: 가장 최근 최종결재(대표이사) 완료된 공문을 기본 표시
  const initialSelectedRef = useRef(false)
  useEffect(() => {
    if (initialSelectedRef.current) return
    if (loading) return
    if (visibleDocs.length === 0) {
      initialSelectedRef.current = true
      return
    }
    const mostRecentApproved = visibleDocs
      .filter((d) => d.approval_status === 'approved' && d.ceo_approved_at)
      .sort(
        (a, b) =>
          new Date(b.ceo_approved_at as string).getTime() -
          new Date(a.ceo_approved_at as string).getTime()
      )[0]
    if (mostRecentApproved) {
      setSelectedId(mostRecentApproved.id)
      setMode('view')
    }
    initialSelectedRef.current = true
  }, [loading, visibleDocs])

  const selectedDoc = useMemo(
    () => visibleDocs.find((d) => d.id === selectedId) ?? null,
    [visibleDocs, selectedId]
  )

  const handleCreated = (doc: OfficialDocument) => {
    setDocs((prev) => [doc, ...prev])
    if (isPrivilegedViewer) {
      // 권한자: 작성 직후 자기 공문 바로 열람
      setSelectedId(doc.id)
      setMode('view')
    } else {
      // 비권한자: 결재 완료 전엔 열람 불가. 안내 후 빈 화면으로 복귀
      toast.info('공문이 제출되었습니다. 최종 결재 완료 후 열람할 수 있습니다.')
      setSelectedId(null)
      setMode('empty')
    }
  }

  const handleSelect = (doc: OfficialDocument) => {
    setSelectedId(doc.id)
    setMode('view')
  }

  const handleDocUpdated = (next: OfficialDocument) => {
    setDocs((prev) => prev.map((d) => (d.id === next.id ? next : d)))
  }

  const startCreate = () => {
    setSelectedId(null)
    setMode('create')
  }

  const startEdit = () => {
    if (!selectedDoc) return
    setMode('edit')
  }

  const handleSaved = (doc: OfficialDocument) => {
    // create 또는 update 완료 후
    if (mode === 'edit') {
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? doc : d)))
      setSelectedId(doc.id)
      setMode('view')
      return
    }
    // create
    handleCreated(doc)
  }

  const handleDelete = async (target: OfficialDocument) => {
    const ok = window.confirm(
      `"${target.subject || '(제목 없음)'}" 공문을 삭제하시겠습니까?\n삭제된 공문은 복구할 수 없습니다.`
    )
    if (!ok) return
    try {
      await deleteOfficialDocument(target.id)
      setDocs((prev) => prev.filter((d) => d.id !== target.id))
      if (selectedId === target.id) {
        setSelectedId(null)
        setMode('empty')
      }
      toast.success('공문이 삭제되었습니다.')
    } catch (err) {
      logger.error('공문 삭제 실패', err)
      toast.error('삭제에 실패했습니다.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-none mx-0 px-3 sm:px-4 lg:px-5 pb-6">
        <div className="mb-4">
          <h1 className="page-title text-gray-900">공문</h1>
          <p
            className="page-subtitle text-gray-600 mt-1"
            style={{ marginTop: '-2px', marginBottom: '-4px' }}
          >
            Official Document
          </p>
        </div>

        <div className="flex gap-4 items-start">
          {/* 좌측 영역: 새 공문 작성 버튼(권한자만) + 공문 목록 */}
          <aside className="w-96 shrink-0 space-y-2">
            {canCreate && (
              <div>
                <Button
                  type="button"
                  onClick={startCreate}
                  className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
                >
                  <Plus className="w-3 h-3" />새 공문 작성
                </Button>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-[70vh] overflow-y-auto">
                {loading ? (
                  <div className="p-4 text-[11px] text-gray-400 text-center">불러오는 중...</div>
                ) : visibleDocs.length === 0 ? (
                  <div className="p-6 text-center text-gray-400">
                    <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-[11px]">
                      {isPrivilegedViewer
                        ? '아직 작성된 공문이 없습니다.'
                        : '열람 가능한 공문이 없습니다.'}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {visibleDocs.map((d) => {
                      const isActive = d.id === selectedId && mode === 'view'
                      return (
                        <li key={d.id} className="relative group">
                          <button
                            type="button"
                            onClick={() => handleSelect(d)}
                            className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors ${
                              isActive ? 'bg-hansl-50' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="text-[12px] font-semibold text-gray-800 flex-1 pr-5 break-words leading-snug">
                                {d.subject || '(제목 없음)'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-gray-500">
                                {format(new Date(d.created_at), 'yyyy.MM.dd')}
                              </span>
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${STATUS_COLORS[d.approval_status]}`}
                              >
                                {STATUS_LABELS[d.approval_status]}
                              </span>
                            </div>
                          </button>
                          {canCreate && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(d)
                              }}
                              className="absolute top-2 right-2 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="공문 삭제"
                              aria-label="공문 삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          {/* 우측 디테일 */}
          <main className="flex-1 min-w-0">
            {mode === 'create' && (
              <OfficialDocumentForm
                senderUser={senderUser}
                loadingUser={!employee}
                onCreated={handleSaved}
                onCancel={() => {
                  if (docs.length > 0 && selectedId) {
                    setMode('view')
                  } else {
                    setMode('empty')
                  }
                }}
              />
            )}

            {mode === 'edit' && selectedDoc && (
              <OfficialDocumentForm
                senderUser={senderUser}
                loadingUser={!employee}
                editingDoc={selectedDoc}
                onCreated={handleSaved}
                onCancel={() => setMode('view')}
              />
            )}

            {mode === 'view' && selectedDoc && (
              <OfficialDocumentView
                doc={selectedDoc}
                approvers={approvers}
                currentUser={
                  user
                    ? {
                        id: user.id,
                        roles: currentUserRoles,
                        name: employee?.name ?? '',
                      }
                    : null
                }
                onEdit={startEdit}
                onUpdated={handleDocUpdated}
              />
            )}

            {mode === 'empty' && (
              <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-[12px]">
                  {canCreate
                    ? '좌측에서 공문을 선택하거나, 새 공문을 작성해 주세요.'
                    : '좌측에서 공문을 선택해 주세요.'}
                </p>
                {canCreate && (
                  <div className="mt-4 inline-block">
                    <Button
                      type="button"
                      onClick={startCreate}
                      className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
                    >
                      <Plus className="w-3 h-3" />새 공문 작성
                    </Button>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* 우측 phantom 컬럼: 좌측 aside와 동일 너비로 우측 메인을 화면 중앙으로 정렬.
              화면이 좁을 땐 숨겨 본문 공간 보존. */}
          <div className="w-96 shrink-0 hidden 2xl:block" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
