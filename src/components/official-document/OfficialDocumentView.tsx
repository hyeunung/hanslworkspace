import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Printer, Check, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { format } from 'date-fns'
import { parseRoles } from '@/utils/roleHelper'
import {
  approveOfficialDocument,
  rejectOfficialDocument,
  cancelOfficialDocumentApproval,
  canApproveCurrentStep,
  type OfficialDocument,
} from '@/services/officialDocumentService'

interface ApproverInfo {
  name: string | null
  department: string | null
  roles: string | string[] | null
}

// 대리 결재(hr/superadmin) 시 표기되는 실제 직책자 이름
const PROXY_DISPLAY_NAME: Record<'pending_executive' | 'pending_ceo', string> = {
  pending_executive: '양승진',  // 전무
  pending_ceo: '정영수',        // 대표이사
}

// status에 따라 자동 표기되는 수신
const RECIPIENT_BY_STATUS: Record<'pending_manager' | 'pending_executive' | 'pending_ceo' | 'approved', string> = {
  pending_manager: '경영팀 팀장',
  pending_executive: '전무이사',
  pending_ceo: '대표이사',
  approved: '(주)한슬 임직원',
}

// 최종승인 후 발신 표기 (작성자 본인 이름 대신 직책자로 노출)
const APPROVED_SENDER_DISPLAY = '대표이사 정영수'

/**
 * A4 공문 영역만 새 창으로 복제해 인쇄.
 * @media print 방식은 부모 positioning 컨텍스트 때문에 백지가 나오는 케이스가 있어
 * 새 창 + 스타일시트 복제 방식으로 격리한다.
 */
function printOfficialDoc() {
  const docEl = document.querySelector('.official-doc-print') as HTMLElement | null
  if (!docEl) {
    toast.error('인쇄할 공문을 찾을 수 없습니다.')
    return
  }

  const stylesheetLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((link) => (link as HTMLLinkElement).href)
    .filter(Boolean)

  const inlineStyles = Array.from(document.querySelectorAll('style'))
    .map((s) => s.innerHTML)
    .join('\n')

  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) {
    toast.error('팝업 차단을 해제해 주세요.')
    return
  }

  win.document.open()
  win.document.write(`<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8">
    <title>공문 인쇄</title>
    ${stylesheetLinks.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n    ')}
    <style>${inlineStyles}</style>
    <style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0; padding: 0; background: white; }
      body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif; }
      .official-doc-print {
        box-shadow: none !important;
        border: none !important;
        margin: 0 auto !important;
      }
    </style>
  </head>
  <body>${docEl.outerHTML}</body>
</html>`)
  win.document.close()
  win.focus()

  // 외부 스타일시트 로드 완료 대기 후 인쇄
  setTimeout(() => {
    win.print()
    setTimeout(() => win.close(), 200)
  }, 700)
}

interface Props {
  doc: OfficialDocument
  approvers: Record<string, ApproverInfo> // key: user_id
  currentUser: { id: string; roles: string[]; name: string } | null
  /** hr/superadmin이 수정 버튼 클릭 시 호출 */
  onEdit?: () => void
  onUpdated: (next: OfficialDocument) => void
}

function formatStampDate(iso?: string | null) {
  if (!iso) return ''
  return format(new Date(iso), 'yy.MM.dd')
}

export default function OfficialDocumentView({ doc, approvers, currentUser, onEdit, onUpdated }: Props) {
  const canEdit =
    !!currentUser &&
    (currentUser.roles.includes('hr') || currentUser.roles.includes('superadmin'))

  const [acting, setActing] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const canApprove = useMemo(
    () => !!currentUser && canApproveCurrentStep(doc.approval_status, currentUser.roles),
    [doc.approval_status, currentUser]
  )

  const handleApprove = async () => {
    if (!currentUser) return
    if (acting) return
    try {
      setActing(true)
      const next = await approveOfficialDocument(doc.id, doc.approval_status, currentUser.id)
      toast.success('승인 처리되었습니다.')
      onUpdated(next)
    } catch (err) {
      logger.error('공문 승인 실패', err)
      toast.error('승인 처리에 실패했습니다.')
    } finally {
      setActing(false)
    }
  }

  const handleCancel = async (step: 'pending_manager' | 'pending_executive' | 'pending_ceo') => {
    if (!currentUser) return
    if (acting) return
    try {
      setActing(true)
      const next = await cancelOfficialDocumentApproval(doc.id, step)
      toast.success('결재가 취소되었습니다.')
      onUpdated(next)
    } catch (err) {
      logger.error('공문 결재 취소 실패', err)
      toast.error('결재 취소에 실패했습니다.')
    } finally {
      setActing(false)
    }
  }

  const handleReject = async () => {
    if (!currentUser) return
    if (acting) return
    if (!rejectReason.trim()) {
      toast.error('반려 사유를 입력해 주세요.')
      return
    }
    try {
      setActing(true)
      const next = await rejectOfficialDocument(doc.id, currentUser.id, rejectReason.trim())
      toast.success('반려 처리되었습니다.')
      setShowReject(false)
      setRejectReason('')
      onUpdated(next)
    } catch (err) {
      logger.error('공문 반려 실패', err)
      toast.error('반려 처리에 실패했습니다.')
    } finally {
      setActing(false)
    }
  }

  const stamps: Array<{
    label: string
    step: 'pending_manager' | 'pending_executive' | 'pending_ceo'
    approvedBy: string | null
    approvedAt: string | null
  }> = [
    {
      label: '경영팀',
      step: 'pending_manager',
      approvedBy: doc.manager_approved_by,
      approvedAt: doc.manager_approved_at,
    },
    {
      label: '전무이사',
      step: 'pending_executive',
      approvedBy: doc.executive_approved_by,
      approvedAt: doc.executive_approved_at,
    },
    {
      label: '대표이사',
      step: 'pending_ceo',
      approvedBy: doc.ceo_approved_by,
      approvedAt: doc.ceo_approved_at,
    },
  ]

  const isApproved = doc.approval_status === 'approved'
  const isRejected = doc.approval_status === 'rejected'

  // 수신: status별 자동 치환. rejected는 작성 시 입력값 그대로 노출(폴백).
  const displayRecipient = isRejected
    ? doc.recipient
    : RECIPIENT_BY_STATUS[doc.approval_status as keyof typeof RECIPIENT_BY_STATUS] ?? doc.recipient

  // 발신: 최종승인 후엔 직책자 표기, 그 외엔 작성자 본인 정보
  const senderLine = isApproved
    ? APPROVED_SENDER_DISPLAY
    : `${doc.sender_department ? doc.sender_department + ' ' : ''}${doc.sender_name}`.trim()

  return (
    <div className="space-y-3">
      {/* 상단 액션 바 (반려 사유 + 수정 + 인쇄) */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          {doc.approval_status === 'rejected' && doc.rejection_reason && (
            <span className="text-[11px] text-red-700">반려 사유: {doc.rejection_reason}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canEdit && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-gray-600 hover:text-hansl-700"
              title="공문 수정"
            >
              <Pencil className="w-3.5 h-3.5" />
              수정
            </button>
          )}
          <button
            type="button"
            onClick={() => printOfficialDoc()}
            className="inline-flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900"
            title="인쇄"
          >
            <Printer className="w-3.5 h-3.5" />
            인쇄
          </button>
        </div>
      </div>

      {/* A4 문서 — lg+에서는 mm 단위 실측, 모바일에서는 픽셀 기반 패딩으로 가독성 확보 */}
      <div
        className="official-doc-print bg-white shadow-sm mx-auto print:shadow-none px-4 py-5 lg:px-[18mm] lg:py-[20mm]"
        style={{
          width: '210mm',
          maxWidth: '100%',
          border: '1px solid #c0c0c0',
          fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div className="text-center pb-4 mb-4" style={{ borderBottom: '2px solid #333' }}>
          <h1 className="text-[22px] font-bold text-gray-900" style={{ letterSpacing: '0.4em' }}>
            공 문
          </h1>
          <div className="text-[10px] text-gray-400 mt-1" style={{ letterSpacing: '0.08em' }}>
            Official Document
          </div>
        </div>

        {/* 헤더: 좌측 메타 / 우측 결재란 */}
        <div className="flex justify-between items-start gap-4 mb-6">
          <div className="flex-1 min-w-0 space-y-1 text-[12px] text-gray-700">
            {doc.doc_number && (
              <div>
                <span className="text-gray-500 mr-2">문서번호</span>
                {doc.doc_number}
              </div>
            )}
            <div>
              <span className="text-gray-500 mr-2">시행일자</span>
              {doc.issue_date}
            </div>
          </div>

          <div
            className="flex shrink-0"
            style={{ width: 200, border: '1px solid #c0c0c0' }}
          >
            {stamps.map((stamp, idx) => {
              // 결재자 이름: 캐시 우선, 없으면 현재 로그인 사용자가 본인이면 본인 이름, 아니면 dash
              const cachedApprover = stamp.approvedBy ? approvers[stamp.approvedBy] : null
              const approverName =
                cachedApprover?.name ??
                (currentUser && stamp.approvedBy === currentUser.id ? currentUser.name : null)

              // 결재자의 role 파악 (캐시 → 본인이면 currentUser.roles)
              const approverRoles =
                cachedApprover?.roles !== undefined && cachedApprover?.roles !== null
                  ? parseRoles(cachedApprover.roles)
                  : currentUser && stamp.approvedBy === currentUser.id
                  ? currentUser.roles
                  : null

              // 대리 결재(hr/superadmin이 final_approver/ceo 대신 결재) 시 직책자 이름으로 치환
              let displayName = approverName
              if (stamp.approvedAt && (stamp.step === 'pending_executive' || stamp.step === 'pending_ceo')) {
                if (approverRoles) {
                  const hasOwnRole =
                    (stamp.step === 'pending_executive' && approverRoles.includes('final_approver')) ||
                    (stamp.step === 'pending_ceo' && approverRoles.includes('ceo'))
                  if (!hasOwnRole) {
                    displayName = PROXY_DISPLAY_NAME[stamp.step]
                  }
                }
              }

              const isCurrentStep = doc.approval_status === stamp.step
              const showApproveBtn = isCurrentStep && canApprove && !showReject
              // 가장 최근 결재(=다음 단계가 현재 status인 칸)만 취소 가능
              const isMostRecentApproval =
                (stamp.step === 'pending_manager' && doc.approval_status === 'pending_executive') ||
                (stamp.step === 'pending_executive' && doc.approval_status === 'pending_ceo') ||
                (stamp.step === 'pending_ceo' && doc.approval_status === 'approved')
              const canCancelThisStep =
                !!stamp.approvedAt &&
                isMostRecentApproval &&
                !!currentUser &&
                canApproveCurrentStep(stamp.step, currentUser.roles)
              return (
                <div
                  key={stamp.label}
                  className="flex-1"
                  style={{ borderRight: idx < stamps.length - 1 ? '1px solid #c0c0c0' : undefined }}
                >
                  <div
                    className="text-[10px] font-semibold text-gray-600 text-center py-1"
                    style={{ borderBottom: '1px solid #c0c0c0', letterSpacing: '0.05em' }}
                  >
                    {stamp.label}
                  </div>
                  <div className="h-12 flex flex-col items-center justify-center">
                    {stamp.approvedAt ? (
                      canCancelThisStep ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(stamp.step)}
                          disabled={acting}
                          className="w-full h-full flex flex-col items-center justify-center hover:bg-red-50 disabled:opacity-60 transition-colors group cursor-pointer"
                          title="클릭하면 결재가 취소됩니다"
                        >
                          <span className="text-red-600 font-semibold text-[11px] underline decoration-dotted underline-offset-2 group-hover:line-through group-hover:decoration-solid">
                            {displayName ?? '—'}
                          </span>
                          <span className="text-gray-500 text-[9px] mt-0.5 group-hover:text-red-500">
                            {acting ? '취소 중...' : formatStampDate(stamp.approvedAt)}
                          </span>
                        </button>
                      ) : (
                        <>
                          <span className="text-red-600 font-semibold text-[11px]">
                            {displayName ?? '—'}
                          </span>
                          <span className="text-gray-500 text-[9px] mt-0.5">
                            {formatStampDate(stamp.approvedAt)}
                          </span>
                        </>
                      )
                    ) : showApproveBtn ? (
                      <button
                        type="button"
                        onClick={handleApprove}
                        disabled={acting}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-white bg-hansl-600 hover:bg-hansl-700 disabled:opacity-60 rounded px-2 py-0.5"
                        title="승인"
                      >
                        <Check className="w-3 h-3" />
                        {acting ? '처리 중' : '승인'}
                      </button>
                    ) : isCurrentStep ? (
                      <span className="text-amber-600 text-[9px] font-medium">결재 대기</span>
                    ) : (
                      <span className="text-gray-300 text-[10px]">—</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 본문 영역 */}
        <div className="space-y-4 text-[13px] text-gray-900">
          <div className="flex gap-2">
            <span className="font-semibold text-gray-700 w-12 shrink-0">수신</span>
            <span>{displayRecipient}</span>
          </div>

          <div
            className="flex gap-2 pb-3"
            style={{ borderBottom: '1px solid #e5e7eb' }}
          >
            <span className="font-semibold text-gray-700 w-12 shrink-0">제목</span>
            <span className="font-semibold">{doc.subject}</span>
          </div>

          <div className="whitespace-pre-wrap leading-relaxed pt-2" style={{ minHeight: '180px' }}>
            {/* 본문 끝에 사용자가 직접 타이핑해둔 "상기 내용에 대한 결재 부탁드립니다." 류 문구는
                시스템에서 자동 노출하므로 표시 시점에 제거해 중복을 방지한다. */}
            {doc.body.replace(/\s*상기\s*내용에?\s*대한\s*결재\s*부탁드립니다\.?\s*$/, '')}
          </div>

          {/* 결재 진행 중일 때만 노출. 최종승인 후엔 사라짐 */}
          {!isApproved && !isRejected && (
            <div className="text-center pt-6 text-[13px] text-gray-700">
              상기 내용에 대한 결재 부탁드립니다.
            </div>
          )}

          <div className="text-right pt-12 text-[13px] text-gray-900">
            <div className="font-semibold">{senderLine || '—'}</div>
          </div>
        </div>
      </div>

      {/* 반려 액션 (승인은 결재란 내부 버튼에서 처리) */}
      {canApprove && !showReject && (
        <div className="flex justify-end gap-2 px-1">
          <Button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={acting}
            className="button-base border border-red-300 bg-white text-red-700 hover:bg-red-50"
          >
            <X className="w-3 h-3" />반려
          </Button>
        </div>
      )}

      {/* 반려 사유 입력 */}
      {showReject && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
          <div className="text-[12px] font-semibold text-red-700">반려 사유</div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="반려 사유를 입력해 주세요."
            className="w-full text-[12px] p-2 border border-gray-300 rounded resize-y bg-white"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => {
                setShowReject(false)
                setRejectReason('')
              }}
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={handleReject}
              disabled={acting || !rejectReason.trim()}
              className="button-base bg-red-600 hover:bg-red-700 text-white"
            >
              {acting ? '처리 중...' : '반려 확정'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
