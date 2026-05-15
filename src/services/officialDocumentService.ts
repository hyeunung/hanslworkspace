import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export type ApprovalStatus =
  | 'pending_manager'
  | 'pending_executive'
  | 'pending_ceo'
  | 'approved'
  | 'rejected'

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending_manager: '담당자 승인필요',
  pending_executive: '전무이사 승인필요',
  pending_ceo: '대표이사 승인필요',
  approved: '승인 완료',
  rejected: '반려',
}

export const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending_manager: 'bg-amber-100 text-amber-800 border-amber-200',
  pending_executive: 'bg-blue-100 text-blue-800 border-blue-200',
  pending_ceo: 'bg-purple-100 text-purple-800 border-purple-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
}

export interface OfficialDocument {
  id: number
  sender_id: string | null
  sender_name: string
  sender_department: string | null
  doc_number: string | null
  recipient: string
  subject: string
  body: string
  issue_date: string
  approval_status: ApprovalStatus
  manager_approved_by: string | null
  manager_approved_at: string | null
  executive_approved_by: string | null
  executive_approved_at: string | null
  ceo_approved_by: string | null
  ceo_approved_at: string | null
  rejection_reason: string | null
  rejected_by: string | null
  rejected_at: string | null
  created_at: string
  updated_at: string
}

/**
 * 현재 status의 결재 단계를 통과시킬 수 있는지 권한 체크.
 * - hr / superadmin: 모든 단계 결재 가능
 * - middle_manager: 담당자 단계
 * - final_approver: 전무 단계
 * - ceo: 대표 단계
 */
export function canApproveCurrentStep(status: ApprovalStatus, roles: string[]): boolean {
  if (roles.includes('hr') || roles.includes('superadmin')) {
    return ['pending_manager', 'pending_executive', 'pending_ceo'].includes(status)
  }
  if (status === 'pending_manager') return roles.includes('middle_manager')
  if (status === 'pending_executive') return roles.includes('final_approver')
  if (status === 'pending_ceo') return roles.includes('ceo')
  return false
}

export async function fetchOfficialDocuments(): Promise<OfficialDocument[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('official_documents')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    logger.error('공문 목록 조회 실패', error)
    throw error
  }
  return (data ?? []) as OfficialDocument[]
}

export async function createOfficialDocument(payload: {
  sender_id: string | null
  sender_name: string
  sender_department: string | null
  doc_number: string | null
  recipient: string
  subject: string
  body: string
}): Promise<OfficialDocument> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('official_documents')
    .insert(payload)
    .select('*')
    .single()
  if (error) {
    logger.error('공문 생성 실패', error)
    throw error
  }
  return data as OfficialDocument
}

/**
 * 현재 단계 승인 → 다음 단계로 진행. 마지막 단계면 'approved'.
 */
export async function approveOfficialDocument(
  id: number,
  currentStatus: ApprovalStatus,
  userId: string
): Promise<OfficialDocument> {
  const supabase = createClient()
  const now = new Date().toISOString()

  const update: Partial<OfficialDocument> = {}
  if (currentStatus === 'pending_manager') {
    update.manager_approved_by = userId
    update.manager_approved_at = now
    update.approval_status = 'pending_executive'
  } else if (currentStatus === 'pending_executive') {
    update.executive_approved_by = userId
    update.executive_approved_at = now
    update.approval_status = 'pending_ceo'
  } else if (currentStatus === 'pending_ceo') {
    update.ceo_approved_by = userId
    update.ceo_approved_at = now
    update.approval_status = 'approved'
  } else {
    throw new Error(`승인할 수 없는 상태: ${currentStatus}`)
  }

  const { data, error } = await supabase
    .from('official_documents')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    logger.error('공문 승인 실패', error)
    throw error
  }
  return data as OfficialDocument
}

/**
 * 가장 최근 결재 한 단계를 취소(되돌리기).
 * @param step 취소할 단계 (해당 단계의 *_approved_by/at을 비우고 status를 그 step으로 되돌림)
 */
export async function cancelOfficialDocumentApproval(
  id: number,
  step: 'pending_manager' | 'pending_executive' | 'pending_ceo'
): Promise<OfficialDocument> {
  const supabase = createClient()
  const update: Partial<OfficialDocument> = { approval_status: step }
  if (step === 'pending_manager') {
    update.manager_approved_by = null
    update.manager_approved_at = null
  } else if (step === 'pending_executive') {
    update.executive_approved_by = null
    update.executive_approved_at = null
  } else if (step === 'pending_ceo') {
    update.ceo_approved_by = null
    update.ceo_approved_at = null
  }
  const { data, error } = await supabase
    .from('official_documents')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    logger.error('공문 결재 취소 실패', error)
    throw error
  }
  return data as OfficialDocument
}

export async function updateOfficialDocument(
  id: number,
  payload: {
    sender_id: string | null
    sender_name: string
    sender_department: string | null
    doc_number: string | null
    recipient: string
    subject: string
    body: string
  }
): Promise<OfficialDocument> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('official_documents')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    logger.error('공문 수정 실패', error)
    throw error
  }
  return data as OfficialDocument
}

export async function deleteOfficialDocument(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('official_documents').delete().eq('id', id)
  if (error) {
    logger.error('공문 삭제 실패', error)
    throw error
  }
}

export async function rejectOfficialDocument(
  id: number,
  userId: string,
  reason: string
): Promise<OfficialDocument> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('official_documents')
    .update({
      approval_status: 'rejected',
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    logger.error('공문 반려 실패', error)
    throw error
  }
  return data as OfficialDocument
}
