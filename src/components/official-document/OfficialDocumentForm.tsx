import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { logger } from '@/lib/logger'
import { employeeService } from '@/services/employeeService'
import type { Employee } from '@/types/purchase'
import {
  createOfficialDocument,
  updateOfficialDocument,
  type OfficialDocument,
} from '@/services/officialDocumentService'

const OFFICIAL_DOC_NOTICE = `• 본 문서는 회사 내부 결재 및 외부 발송용 공문 양식입니다.
• 작성 완료 후 담당자 → 전무이사 → 대표이사 순으로 결재가 진행됩니다.
• 결재 시작 후에는 수정이 불가하므로 신중히 작성해 주세요.`

interface Props {
  senderUser: { id: string | null; name: string; department: string | null } | null
  loadingUser: boolean
  /** 수정 모드일 때 기존 공문 데이터 (없으면 신규 작성 모드) */
  editingDoc?: OfficialDocument | null
  onCreated: (doc: OfficialDocument) => void
  onCancel: () => void
}

export default function OfficialDocumentForm({
  senderUser,
  loadingUser,
  editingDoc,
  onCreated,
  onCancel,
}: Props) {
  const isEditMode = !!editingDoc
  const isApprovedDoc = editingDoc?.approval_status === 'approved'

  const [docNumber, setDocNumber] = useState(editingDoc?.doc_number ?? '')
  const [subject, setSubject] = useState(editingDoc?.subject ?? '')
  const [body, setBody] = useState(editingDoc?.body ?? '')
  const [submitting, setSubmitting] = useState(false)

  // 발신자 선택용 직원 목록 + 현재 선택된 발신자 id
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedSenderId, setSelectedSenderId] = useState<string>(
    editingDoc?.sender_id ?? senderUser?.id ?? ''
  )

  const issueDate = format(new Date(), 'yyyy-MM-dd', { locale: ko })

  // 활성 직원 목록 로드
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await employeeService.getEmployees({ is_active: true })
      if (cancelled) return
      if (res.success && res.data) {
        setEmployees(res.data)
      } else if (res.error) {
        logger.error('직원 목록 조회 실패', res.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // senderUser가 늦게 로드되는 경우 기본값으로 채워주기
  useEffect(() => {
    if (!selectedSenderId && senderUser?.id) setSelectedSenderId(senderUser.id)
  }, [senderUser?.id, selectedSenderId])

  const senderOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: `${e.department ? e.department + ' ' : ''}${e.name}`.trim(),
        primary: e.name,
        secondary: e.department || undefined,
      })),
    [employees]
  )

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedSenderId) ?? null,
    [employees, selectedSenderId]
  )

  const senderName = selectedEmployee?.name ?? senderUser?.name ?? ''
  const senderDepartment = selectedEmployee?.department ?? senderUser?.department ?? ''

  const allRequiredFilled =
    !loadingUser &&
    senderName.trim() &&
    subject.trim() &&
    body.trim()

  const submitDisabled = submitting || !allRequiredFilled

  const handleSubmit = async () => {
    if (submitDisabled) return
    if (!senderName.trim()) {
      toast.error('이름 정보를 불러올 수 없습니다. 다시 로그인해 주세요.')
      return
    }
    try {
      setSubmitting(true)
      const payload = {
        sender_id: selectedSenderId || senderUser?.id || null,
        sender_name: senderName.trim(),
        sender_department: senderDepartment.trim() || null,
        doc_number: docNumber.trim() || null,
        // 수신은 더 이상 작성 시점에 입력하지 않음. 화면 표시는 status에 따라 자동 결정됨.
        // DB NOT NULL 제약 충족용으로 최종 표기값을 그대로 저장.
        recipient: '(주)한슬 임직원',
        subject: subject.trim(),
        body: body.trim(),
      }
      const doc = isEditMode
        ? await updateOfficialDocument(editingDoc!.id, payload)
        : await createOfficialDocument(payload)
      toast.success(
        isEditMode ? '공문이 수정되었습니다.' : '공문이 작성되었습니다. 담당자 승인 대기 중입니다.'
      )
      onCreated(doc)
    } catch (err) {
      logger.error(isEditMode ? '공문 수정 실패' : '공문 작성 실패', err)
      toast.error(isEditMode ? '공문 수정에 실패했습니다.' : '공문 작성에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="doc-form">
      <div className="doc-form-header">
        <h1>{isApprovedDoc ? '공 문' : '품 의 서'}</h1>
        <div className="doc-subtitle">{isApprovedDoc ? 'Official Document' : 'Proposal'}</div>
      </div>

      {/* 문서번호 / 시행일자 + 결재란 */}
      <div className="px-8 pt-4 flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-500 w-14 shrink-0">문서번호</span>
            <Input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="예: HSL-2026-001"
              className="doc-form-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-500 w-14 shrink-0">시행일자</span>
            <span className="text-[11px] text-gray-700">{issueDate}</span>
          </div>
        </div>

        <div
          className="flex shrink-0"
          style={{ width: 200, border: '1px solid #c0c0c0' }}
        >
          {(['경영팀', '전무이사', '대표이사'] as const).map((role, idx, arr) => (
            <div
              key={role}
              className="flex-1"
              style={{ borderRight: idx < arr.length - 1 ? '1px solid #c0c0c0' : undefined }}
            >
              <div
                className="text-[10px] font-semibold text-gray-600 text-center py-1"
                style={{ borderBottom: '1px solid #c0c0c0', letterSpacing: '0.05em' }}
              >
                {role}
              </div>
              <div className="h-12" aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>

      <div className="doc-form-body">
        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label doc-form-cell-label-title">
              발신 <span className="required">*</span>
            </div>
            <Combobox
              options={senderOptions}
              value={selectedSenderId}
              onValueChange={setSelectedSenderId}
              placeholder={loadingUser ? '로딩 중...' : '발신자 선택'}
              searchPlaceholder="이름 또는 부서 검색..."
              emptyText="검색 결과가 없습니다."
            />
          </div>
        </div>

        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">
              제목 <span className="required">*</span>
            </div>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="공문 제목을 입력하세요"
              className="doc-form-input"
            />
          </div>
        </div>

        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">
              본문 <span className="required">*</span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="공문 본문을 작성해 주세요."
              className="doc-form-textarea"
              rows={10}
            />
          </div>
        </div>
      </div>

      <div className="doc-form-notice">
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{OFFICIAL_DOC_NOTICE}</pre>
      </div>

      <div className="doc-form-footer flex flex-col sm:flex-row gap-3 justify-end items-stretch sm:items-center">
        <Button
          type="button"
          onClick={onCancel}
          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        >
          취소
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
        >
          {submitting
            ? isEditMode
              ? '수정 중...'
              : '작성 중...'
            : isEditMode
            ? '수정 완료'
            : '작성 완료'}
        </Button>
      </div>
    </div>
  )
}
