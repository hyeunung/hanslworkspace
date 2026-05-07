import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { logger } from '@/lib/logger'
import {
  fetchOfficialDocuments,
  type OfficialDocument,
} from '@/services/officialDocumentService'
import OfficialDocumentView from './OfficialDocumentView'

const STORAGE_KEY = 'dismissed_official_documents_v1'
const SESSION_FLAG = 'official_documents_modal_shown_this_session'

function getDismissedIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as number[]) : []
  } catch {
    return []
  }
}

function addDismissedId(id: number) {
  try {
    const ids = getDismissedIds()
    if (!ids.includes(id)) {
      ids.push(id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    }
  } catch {
    // ignore
  }
}

interface ApproverInfo {
  name: string | null
  department: string | null
  roles: string | string[] | null
}

/**
 * 메인 화면 진입 시 사용자가 아직 확인하지 않은
 * 최종 결재 완료(approved) 공문이 있으면 모달로 표시.
 * "다시 보지 않기" 클릭 시 해당 공문은 localStorage 에 기록되어
 * 이후 워크스페이스 접속 시에도 자동 노출되지 않는다.
 * 같은 브라우저 세션 내에서는 한 번만 표시한다.
 */
export default function OfficialDocumentApprovedModal() {
  const { user, employee, currentUserRoles } = useAuth()
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<OfficialDocument[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [approvers, setApprovers] = useState<Record<string, ApproverInfo>>({})

  useEffect(() => {
    let cancelled = false
    if (!user) return

    // 같은 세션에서 이미 표시했으면 skip
    let alreadyShown = false
    try {
      alreadyShown = sessionStorage.getItem(SESSION_FLAG) === 'true'
    } catch {
      // ignore
    }
    if (alreadyShown) return

    ;(async () => {
      try {
        const all = await fetchOfficialDocuments()
        if (cancelled) return

        const dismissed = getDismissedIds()
        const candidates = all
          .filter((d) => d.approval_status === 'approved' && !dismissed.includes(d.id))
          .sort((a, b) => {
            const ta = a.ceo_approved_at ? new Date(a.ceo_approved_at).getTime() : 0
            const tb = b.ceo_approved_at ? new Date(b.ceo_approved_at).getTime() : 0
            return tb - ta
          })

        if (candidates.length === 0) return

        // 결재자 이름 캐시 로드
        const ids = new Set<string>()
        for (const d of candidates) {
          if (d.manager_approved_by) ids.add(d.manager_approved_by)
          if (d.executive_approved_by) ids.add(d.executive_approved_by)
          if (d.ceo_approved_by) ids.add(d.ceo_approved_by)
        }
        const approverMap: Record<string, ApproverInfo> = {}
        if (ids.size > 0) {
          const supabase = createClient()
          const { data } = await supabase
            .from('employees')
            .select('id, name, department, roles')
            .in('id', Array.from(ids))
          if (data) {
            for (const row of data as Array<{
              id: string
              name: string | null
              department: string | null
              roles: string | string[] | null
            }>) {
              approverMap[row.id] = {
                name: row.name,
                department: row.department,
                roles: row.roles,
              }
            }
          }
        }

        if (cancelled) return
        setDocs(candidates)
        setApprovers(approverMap)
        setOpen(true)

        try {
          sessionStorage.setItem(SESSION_FLAG, 'true')
        } catch {
          // ignore
        }
      } catch (err) {
        logger.error('승인 공문 알림 로드 실패', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  const current = docs[currentIdx]
  if (!current) return null

  const moveNext = () => {
    if (currentIdx + 1 < docs.length) {
      setCurrentIdx((idx) => idx + 1)
    } else {
      setOpen(false)
    }
  }

  const handleNeverShow = () => {
    addDismissedId(current.id)
    moveNext()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>최종 결재 완료된 공문</DialogTitle>
        </DialogHeader>

        <OfficialDocumentView
          doc={current}
          approvers={approvers}
          currentUser={
            user
              ? { id: user.id, roles: currentUserRoles, name: employee?.name ?? '' }
              : null
          }
          onUpdated={(next) => {
            setDocs((prev) => prev.map((d) => (d.id === next.id ? next : d)))
          }}
        />

        <div className="flex justify-between items-center pt-3 border-t border-gray-200">
          <span className="text-[11px] text-gray-500">
            {currentIdx + 1} / {docs.length}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleNeverShow}
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              다시 보지 않기
            </Button>
            <Button
              type="button"
              onClick={moveNext}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {currentIdx + 1 < docs.length ? '다음' : '닫기'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
