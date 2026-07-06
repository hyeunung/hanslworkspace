import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Building2, Search, ChevronDown, ChevronUp, Loader2, Plus, Trash2, CheckCircle } from 'lucide-react'
import { supportService, type SupportInquiry, type NewVendorInquiryPayload } from '@/services/supportService'
import { vendorService } from '@/services/vendorService'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { Vendor } from '@/types/purchase'

type ContactRow = {
  id: string
  contact_name: string
  position: string
  contact_phone: string
  contact_email: string
}

type VendorEditForm = {
  vendor_name: string
  vendor_alias: string
  vendor_phone: string
  vendor_fax: string
  vendor_payment_schedule: string
  vendor_address: string
  note: string
}

const emptyVendorForm: VendorEditForm = {
  vendor_name: '',
  vendor_alias: '',
  vendor_phone: '',
  vendor_fax: '',
  vendor_payment_schedule: '',
  vendor_address: '',
  note: ''
}

const createRowId = () => `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const isNewVendorPayload = (payload: unknown): payload is NewVendorInquiryPayload =>
  !!payload && typeof payload === 'object' && 'vendor' in (payload as Record<string, unknown>)

export default function VendorRequestAdminPanel() {
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 좌측: 요청 내역 수정 폼
  const [editForm, setEditForm] = useState<VendorEditForm>(emptyVendorForm)
  const [editContacts, setEditContacts] = useState<ContactRow[]>([])
  const [registering, setRegistering] = useState(false)

  // 우측: 업체관리 검색
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loadingVendors, setLoadingVendors] = useState(false)
  const [vendorSearch, setVendorSearch] = useState('')

  const loadInquiries = useCallback(async () => {
    const result = await supportService.getNewVendorInquiries()
    if (result.success) {
      setInquiries(result.data)
    } else {
      toast.error(result.error || '업체등록 요청 목록 조회에 실패했습니다.')
    }
    setLoadingList(false)
  }, [])

  const loadVendors = useCallback(async () => {
    setLoadingVendors(true)
    const result = await vendorService.getVendors()
    if (result.success) {
      setVendors(result.data || [])
    } else {
      toast.error(result.error || '업체 목록 조회에 실패했습니다.')
    }
    setLoadingVendors(false)
  }, [])

  useEffect(() => {
    loadInquiries()
    loadVendors()
  }, [loadInquiries, loadVendors])

  // 업체등록 요청 실시간 반영 (신규 접수/상태 변경)
  useEffect(() => {
    const subscription = supportService.subscribeToInquiries((payload) => {
      const row = (payload?.new || payload?.old) as SupportInquiry | undefined
      if (row?.inquiry_type === 'new_vendor' || !row?.inquiry_type) {
        loadInquiries()
      }
    })
    return () => subscription.unsubscribe()
  }, [loadInquiries])

  // 업체관리 검색 필터 (VendorMain과 동일한 클라이언트 사이드 검색)
  const filteredVendors = useMemo(() => {
    const normalized = vendorSearch.trim().toLowerCase()
    if (!normalized) return vendors
    return vendors.filter((vendor) => {
      const fields = [
        vendor.vendor_name,
        vendor.vendor_alias,
        vendor.vendor_phone,
        vendor.vendor_fax,
        vendor.vendor_address,
        vendor.vendor_payment_schedule,
        vendor.note
      ]
      const vendorMatch = fields.some((v) => (v || '').toLowerCase().includes(normalized))
      if (vendorMatch) return true
      return (vendor.vendor_contacts || []).some((contact) =>
        [contact.contact_name, contact.contact_phone, contact.contact_email, contact.position]
          .some((v) => (v || '').toLowerCase().includes(normalized))
      )
    })
  }, [vendors, vendorSearch])

  // 요청 건 펼치기: payload로 좌측 폼 초기화 + 우측 검색어를 요청 업체명으로 세팅(유사 업체 바로 확인)
  const handleToggleExpand = (inquiry: SupportInquiry) => {
    if (expandedId === inquiry.id) {
      setExpandedId(null)
      return
    }
    const payload = inquiry.inquiry_payload
    if (isNewVendorPayload(payload)) {
      setEditForm({
        vendor_name: payload.vendor.vendor_name || '',
        vendor_alias: payload.vendor.vendor_alias || '',
        vendor_phone: payload.vendor.vendor_phone || '',
        vendor_fax: payload.vendor.vendor_fax || '',
        vendor_payment_schedule: payload.vendor.vendor_payment_schedule || '',
        vendor_address: payload.vendor.vendor_address || '',
        note: payload.vendor.note || ''
      })
      setEditContacts(
        (payload.contacts || []).map((c) => ({
          id: createRowId(),
          contact_name: c.contact_name || '',
          position: c.position || '',
          contact_phone: c.contact_phone || '',
          contact_email: c.contact_email || ''
        }))
      )
      setVendorSearch(payload.vendor.vendor_name || '')
    } else {
      setEditForm(emptyVendorForm)
      setEditContacts([])
      setVendorSearch('')
    }
    setExpandedId(inquiry.id ?? null)
  }

  const handleFormChange = (field: keyof VendorEditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleContactChange = (rowId: string, field: keyof Omit<ContactRow, 'id'>, value: string) => {
    setEditContacts((prev) => prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)))
  }

  const handleAddContactRow = () => {
    setEditContacts((prev) => [...prev, { id: createRowId(), contact_name: '', position: '', contact_phone: '', contact_email: '' }])
  }

  const handleRemoveContactRow = (rowId: string) => {
    setEditContacts((prev) => prev.filter((row) => row.id !== rowId))
  }

  // 업체 등록 확정: 수정된 좌측 내역 그대로 vendors에 등록 → 문의 완료 처리 → 요청자에게 푸시
  const handleRegisterVendor = async (inquiry: SupportInquiry) => {
    if (!inquiry.id) return
    if (!editForm.vendor_name.trim()) {
      toast.error('업체명을 입력해주세요.')
      return
    }

    setRegistering(true)
    try {
      const vendorData = {
        vendor_name: editForm.vendor_name.trim(),
        vendor_alias: editForm.vendor_alias.trim(),
        vendor_phone: editForm.vendor_phone.trim(),
        vendor_fax: editForm.vendor_fax.trim(),
        vendor_payment_schedule: editForm.vendor_payment_schedule.trim(),
        vendor_address: editForm.vendor_address.trim(),
        note: editForm.note.trim()
      }

      const createResult = await vendorService.createVendor(vendorData)
      if (!createResult.success || !createResult.data) {
        toast.error(createResult.error || '업체 등록에 실패했습니다.')
        setRegistering(false)
        return
      }

      // 담당자 등록 (이름이 있는 행만)
      const validContacts = editContacts.filter((c) => c.contact_name.trim())
      if (validContacts.length > 0) {
        const supabase = createClient()
        const { error: contactError } = await supabase
          .from('vendor_contacts')
          .insert(
            validContacts.map((c) => ({
              vendor_id: createResult.data!.id,
              contact_name: c.contact_name.trim(),
              position: c.position.trim(),
              contact_phone: c.contact_phone.trim(),
              contact_email: c.contact_email.trim()
            }))
          )
        if (contactError) {
          toast.error('업체는 등록됐지만 담당자 저장에 실패했습니다. 업체관리에서 담당자를 추가해주세요.')
        }
      }

      // 수정된 요청 내역을 payload에 반영 (처리 이력 보존)
      await supportService.updateInquiryPayload(inquiry.id, {
        vendor: vendorData,
        contacts: validContacts.map((c) => ({
          contact_name: c.contact_name.trim(),
          position: c.position.trim(),
          contact_phone: c.contact_phone.trim(),
          contact_email: c.contact_email.trim()
        }))
      })

      // 문의 완료 처리
      const statusResult = await supportService.updateInquiryStatus(inquiry.id, 'resolved', `업체 등록 완료: ${vendorData.vendor_name}`)
      if (!statusResult.success) {
        toast.error(statusResult.error || '업체는 등록됐지만 문의 완료 처리에 실패했습니다.')
      }

      // 요청자에게 등록 완료 푸시 알림
      if (inquiry.user_email) {
        await supportService.notifyVendorRegistered({
          targetEmail: inquiry.user_email,
          vendorName: vendorData.vendor_name,
          inquiryId: inquiry.id
        })
      }

      toast.success(`업체(${vendorData.vendor_name})가 등록되었습니다.`)
      setExpandedId(null)
      loadInquiries()
      loadVendors()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '업체 등록 처리 중 오류가 발생했습니다.')
    } finally {
      setRegistering(false)
    }
  }

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'open':
        return <span className="badge-stats bg-yellow-100 text-yellow-800">대기</span>
      case 'in_progress':
        return <span className="badge-stats bg-blue-100 text-blue-800">처리중</span>
      case 'resolved':
        return <span className="badge-stats bg-green-100 text-green-800">완료</span>
      case 'closed':
        return <span className="badge-stats bg-gray-100 text-gray-800">종료</span>
      default:
        return <span className="badge-stats border border-gray-300 bg-white text-gray-600">-</span>
    }
  }

  const inputClass =
    'h-8 px-2.5 text-[11px] border border-gray-300 bg-white text-gray-800 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all w-full'

  return (
    <Card className="business-radius-card border border-gray-200 shadow-sm">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="section-title flex items-center gap-2 text-gray-900">
          <Building2 className="w-4 h-4 text-gray-600" />
          업체등록 요청 관리
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loadingList ? (
          <div className="py-10 flex items-center justify-center text-gray-500 text-[12px]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            업체등록 요청을 불러오는 중...
          </div>
        ) : inquiries.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-[12px]">접수된 업체등록 요청이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {inquiries.map((inquiry) => {
              const isExpanded = expandedId === inquiry.id
              const isCompleted = inquiry.status === 'resolved' || inquiry.status === 'closed'
              const payload = inquiry.inquiry_payload
              const requestedVendorName = isNewVendorPayload(payload) ? payload.vendor.vendor_name : ''
              return (
                <div key={inquiry.id} className="border border-gray-200 business-radius-card overflow-hidden bg-white">
                  {/* 요청 행 (클릭 시 펼침) */}
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(inquiry)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="badge-stats bg-indigo-100 text-indigo-800 flex-shrink-0">업체등록 요청</span>
                      {getStatusBadge(inquiry.status)}
                      <span className="text-[12px] font-medium text-gray-900 truncate">
                        {requestedVendorName || inquiry.subject}
                      </span>
                      <span className="text-[11px] text-gray-500 flex-shrink-0">
                        {inquiry.user_name || inquiry.user_email}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-gray-400">
                        {inquiry.created_at ? format(new Date(inquiry.created_at), 'yyyy-MM-dd HH:mm') : '-'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* 펼침: 좌우 분할 (좌: 요청 내역 수정, 우: 업체관리 검색) */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                      {/* 좌측: 요청 온 내역 (인풋 수정 가능) */}
                      <div className="p-4 space-y-3">
                        <div className="modal-section-title text-gray-900">요청 내역 (수정 가능)</div>

                        {inquiry.message && (
                          <div className="p-2.5 bg-slate-50 border border-gray-150 business-radius-card text-[11px] text-gray-600 whitespace-pre-wrap">
                            {inquiry.message}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 font-medium">업체명 *</label>
                            <input
                              type="text"
                              value={editForm.vendor_name}
                              onChange={(e) => handleFormChange('vendor_name', e.target.value)}
                              className={inputClass}
                              placeholder="업체명"
                              disabled={isCompleted}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 font-medium">참조명</label>
                            <input
                              type="text"
                              value={editForm.vendor_alias}
                              onChange={(e) => handleFormChange('vendor_alias', e.target.value)}
                              className={inputClass}
                              placeholder="영문명, 약칭 등"
                              disabled={isCompleted}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 font-medium">전화번호</label>
                            <input
                              type="text"
                              value={editForm.vendor_phone}
                              onChange={(e) => handleFormChange('vendor_phone', e.target.value)}
                              className={inputClass}
                              placeholder="02-1234-5678"
                              disabled={isCompleted}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 font-medium">팩스번호</label>
                            <input
                              type="text"
                              value={editForm.vendor_fax}
                              onChange={(e) => handleFormChange('vendor_fax', e.target.value)}
                              className={inputClass}
                              placeholder="02-1234-5679"
                              disabled={isCompleted}
                            />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[10px] text-gray-500 font-medium">결제조건</label>
                            <input
                              type="text"
                              value={editForm.vendor_payment_schedule}
                              onChange={(e) => handleFormChange('vendor_payment_schedule', e.target.value)}
                              className={inputClass}
                              placeholder="월말결제, 현금결제 등"
                              disabled={isCompleted}
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500 font-medium">주소</label>
                          <Textarea
                            value={editForm.vendor_address}
                            onChange={(e) => handleFormChange('vendor_address', e.target.value)}
                            className="text-[11px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none p-2.5 w-full business-radius-input shadow-sm bg-white text-gray-800 min-h-[52px]"
                            placeholder="주소"
                            disabled={isCompleted}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500 font-medium">비고</label>
                          <Textarea
                            value={editForm.note}
                            onChange={(e) => handleFormChange('note', e.target.value)}
                            className="text-[11px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none p-2.5 w-full business-radius-input shadow-sm bg-white text-gray-800 min-h-[40px]"
                            placeholder="메모"
                            disabled={isCompleted}
                          />
                        </div>

                        {/* 담당자 */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-gray-500 font-medium">담당자</label>
                            {!isCompleted && (
                              <button
                                type="button"
                                onClick={handleAddContactRow}
                                className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium"
                              >
                                <Plus className="w-3 h-3" />
                                담당자 추가
                              </button>
                            )}
                          </div>
                          {editContacts.length === 0 ? (
                            <div className="text-[11px] text-gray-400 py-1">등록된 담당자가 없습니다.</div>
                          ) : (
                            <div className="space-y-1.5">
                              {editContacts.map((row) => (
                                <div key={row.id} className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={row.contact_name}
                                    onChange={(e) => handleContactChange(row.id, 'contact_name', e.target.value)}
                                    className={`${inputClass} !w-24 flex-shrink-0`}
                                    placeholder="이름"
                                    disabled={isCompleted}
                                  />
                                  <input
                                    type="text"
                                    value={row.position}
                                    onChange={(e) => handleContactChange(row.id, 'position', e.target.value)}
                                    className={`${inputClass} !w-20 flex-shrink-0`}
                                    placeholder="직함"
                                    disabled={isCompleted}
                                  />
                                  <input
                                    type="text"
                                    value={row.contact_phone}
                                    onChange={(e) => handleContactChange(row.id, 'contact_phone', e.target.value)}
                                    className={`${inputClass} !w-28 flex-shrink-0`}
                                    placeholder="연락처"
                                    disabled={isCompleted}
                                  />
                                  <input
                                    type="text"
                                    value={row.contact_email}
                                    onChange={(e) => handleContactChange(row.id, 'contact_email', e.target.value)}
                                    className={inputClass}
                                    placeholder="이메일"
                                    disabled={isCompleted}
                                  />
                                  {!isCompleted && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveContactRow(row.id)}
                                      className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 업체 등록 버튼 */}
                        {!isCompleted ? (
                          <div className="flex justify-end pt-2 border-t border-gray-100">
                            <button
                              type="button"
                              onClick={() => handleRegisterVendor(inquiry)}
                              disabled={registering}
                              className="button-action-primary shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                              {registering ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  등록 중...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  업체 등록
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100 text-[11px] text-green-700">
                            <CheckCircle className="w-3.5 h-3.5" />
                            {inquiry.resolution_note || '처리 완료된 요청입니다.'}
                          </div>
                        )}
                      </div>

                      {/* 우측: 업체관리 검색 (중복 업체 확인용) */}
                      <div className="p-4 space-y-3 bg-slate-50/40">
                        <div className="modal-section-title text-gray-900">업체관리 검색 (중복 확인)</div>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <Input
                            value={vendorSearch}
                            onChange={(e) => setVendorSearch(e.target.value)}
                            placeholder="업체명, 전화번호, 주소, 담당자 검색"
                            className="h-8 pl-8 text-[11px] border border-gray-300 bg-white business-radius-input"
                          />
                        </div>
                        {loadingVendors ? (
                          <div className="py-8 flex items-center justify-center text-gray-500 text-[11px]">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            업체 목록을 불러오는 중...
                          </div>
                        ) : (
                          <>
                            <div className="text-[10px] text-gray-500">
                              검색 결과 {filteredVendors.length}건 / 전체 {vendors.length}건
                            </div>
                            <div className="border border-gray-200 business-radius-card overflow-hidden bg-white max-h-[420px] overflow-y-auto">
                              {filteredVendors.length === 0 ? (
                                <div className="py-8 text-center text-[11px] text-gray-400">
                                  검색된 업체가 없습니다. (중복 없음)
                                </div>
                              ) : (
                                <table className="w-full text-left border-collapse text-[11px]">
                                  <thead className="sticky top-0 bg-slate-50">
                                    <tr className="border-b border-gray-200 text-gray-500 font-semibold">
                                      <th className="p-2 header-title">업체명</th>
                                      <th className="p-2 header-title">전화번호</th>
                                      <th className="p-2 header-title">주소</th>
                                      <th className="p-2 header-title w-16 text-center">담당자</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredVendors.map((vendor) => (
                                      <tr key={vendor.id} className="border-b border-gray-100 last:border-0 hover:bg-slate-50/50">
                                        <td className="p-2 text-gray-900 font-medium">
                                          {vendor.vendor_name}
                                          {vendor.vendor_alias && (
                                            <span className="text-gray-400 font-normal ml-1">({vendor.vendor_alias})</span>
                                          )}
                                        </td>
                                        <td className="p-2 text-gray-600 whitespace-nowrap">{vendor.vendor_phone || '-'}</td>
                                        <td className="p-2 text-gray-600">{vendor.vendor_address || '-'}</td>
                                        <td className="p-2 text-center text-gray-600">
                                          {(vendor.vendor_contacts || []).length > 0 ? `${vendor.vendor_contacts!.length}명` : '-'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
