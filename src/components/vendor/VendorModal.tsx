
import { useState, useEffect } from 'react'
import { Vendor, VendorFormData, VendorContact } from '@/types/purchase'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useForm } from 'react-hook-form'
import { vendorService } from '@/services/vendorService'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface VendorModalProps {
  isOpen: boolean
  onClose: () => void
  vendor?: Vendor | null
  onSave: () => void
  mode: 'create' | 'edit' | 'view'
}

export default function VendorModal({ isOpen, onClose, vendor, onSave, mode }: VendorModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [contacts, setContacts] = useState<Partial<VendorContact>[]>([])
  const [newContact, setNewContact] = useState({
    contact_name: '',
    position: '',
    contact_phone: '',
    contact_email: ''
  })

  useEffect(() => {
    if (isOpen) {
      if (vendor) {
        setContacts(vendor.vendor_contacts || [])
      } else {
        setContacts([])
      }
    }
  }, [vendor, isOpen])

  const handleAddContact = () => {
    if (!newContact.contact_name.trim()) {
      toast.error('담당자 이름을 입력해주세요.')
      return
    }
    setContacts([
      ...contacts,
      {
        contact_name: newContact.contact_name.trim(),
        position: newContact.position.trim(),
        contact_phone: newContact.contact_phone.trim(),
        contact_email: newContact.contact_email.trim()
      }
    ])
    setNewContact({
      contact_name: '',
      position: '',
      contact_phone: '',
      contact_email: ''
    })
  }

  const handleUpdateContactField = (index: number, field: keyof VendorContact, value: string) => {
    const updated = [...contacts]
    updated[index] = {
      ...updated[index],
      [field]: value
    }
    setContacts(updated)
  }

  const handleDeleteContactRow = (index: number) => {
    setContacts(contacts.filter((_, idx) => idx !== index))
  }

  const form = useForm<VendorFormData>({
    defaultValues: {
      vendor_name: '',
      vendor_alias: '',
      vendor_phone: '',
      vendor_fax: '',
      vendor_payment_schedule: '',
      vendor_address: '',
      note: ''
    }
  })

  useEffect(() => {
    if (vendor && isOpen) {
      form.reset({
        vendor_name: vendor.vendor_name || '',
        vendor_alias: vendor.vendor_alias || '',
        vendor_phone: vendor.vendor_phone || '',
        vendor_fax: vendor.vendor_fax || '',
        vendor_payment_schedule: vendor.vendor_payment_schedule || '',
        vendor_address: vendor.vendor_address || '',
        note: vendor.note || ''
      })
    } else if (!vendor && isOpen) {
      form.reset({
        vendor_name: '',
        vendor_alias: '',
        vendor_phone: '',
        vendor_fax: '',
        vendor_payment_schedule: '',
        vendor_address: '',
        note: ''
      })
    }
  }, [vendor, isOpen, form])

  const onSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true)
    const supabase = createClient()

    try {
      let result

      if (mode === 'create') {
        result = await vendorService.createVendor(data)
        if (result?.success && result?.data) {
          const newVendorId = result.data.id
          const validContacts = contacts.filter(c => c.contact_name?.trim())
          if (validContacts.length > 0) {
            const { error: insertError } = await supabase
              .from('vendor_contacts')
              .insert(
                validContacts.map(c => ({
                  vendor_id: newVendorId,
                  contact_name: c.contact_name!.trim(),
                  contact_email: c.contact_email?.trim() || '',
                  contact_phone: c.contact_phone?.trim() || '',
                  position: c.position?.trim() || ''
                }))
              )
            if (insertError) {
              console.error('Error inserting contacts on create:', insertError)
            }
          }
        }
      } else if (mode === 'edit' && vendor) {
        result = await vendorService.updateVendor(vendor.id, data)
        if (result?.success) {
          const validContacts = contacts.filter(c => c.contact_name?.trim())
          
          // Delete removed contacts
          const contactIdsToKeep = validContacts.filter(c => c.id).map(c => c.id)
          const originalContactIds = (vendor.vendor_contacts || []).map(c => c.id)
          const contactIdsToDelete = originalContactIds.filter(id => !contactIdsToKeep.includes(id))
          
          if (contactIdsToDelete.length > 0) {
            const { error: deleteError } = await supabase
              .from('vendor_contacts')
              .delete()
              .in('id', contactIdsToDelete)
            if (deleteError) {
              console.error('Error deleting contacts on edit:', deleteError)
            }
          }

          // Insert or update remaining contacts
          for (const contact of validContacts) {
            if (contact.id) {
              const { error: updateError } = await supabase
                .from('vendor_contacts')
                .update({
                  contact_name: contact.contact_name!.trim(),
                  contact_email: contact.contact_email?.trim() || '',
                  contact_phone: contact.contact_phone?.trim() || '',
                  position: contact.position?.trim() || ''
                })
                .eq('id', contact.id)
              if (updateError) {
                console.error('Error updating contact:', updateError)
              }
            } else {
              const { error: insertError } = await supabase
                .from('vendor_contacts')
                .insert({
                  vendor_id: vendor.id,
                  contact_name: contact.contact_name!.trim(),
                  contact_email: contact.contact_email?.trim() || '',
                  contact_phone: contact.contact_phone?.trim() || '',
                  position: contact.position?.trim() || ''
                })
              if (insertError) {
                console.error('Error inserting new contact:', insertError)
              }
            }
          }
        }
      }

      if (result?.success) {
        toast.success(mode === 'create' ? '업체가 등록되었습니다.' : '업체 정보가 수정되었습니다.')
        onSave()
        onClose()
      } else {
        toast.error(result?.error || '처리 중 오류가 발생했습니다.')
      }
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'create': return '업체 등록'
      case 'edit': return '업체 수정'
      case 'view': return '업체 상세'
      default: return '업체'
    }
  }

  const isReadOnly = mode === 'view'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        maxWidth="sm:max-w-2xl" 
        style={{ maxWidth: '672px', width: '95vw' }}
        className="w-full max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden business-radius-modal border border-gray-150 bg-white shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="compact-inputs flex-1 flex flex-col overflow-hidden min-h-0">
          <DialogHeader className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
            <DialogTitle className="page-title text-gray-900">{getTitle()}</DialogTitle>
          </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            {/* Scrollable content area with consistent padding */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 max-h-[calc(90vh-140px)]">
              
              {/* 업체 기본 정보 섹션 */}
              <div className="space-y-4">
                <h3 className="section-title text-gray-950 flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-blue-600 rounded-full"></span>
                  <span>업체 기본 정보</span>
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="vendor_name"
                    rules={{
                      required: '업체명을 입력해주세요.'
                    }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-gray-700">업체명 *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="업체명을 입력하세요"
                            className="h-9 text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none px-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors"
                            disabled={isReadOnly}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vendor_alias"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-gray-700">참조명</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="영문명, 약칭 등"
                            className="h-9 text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none px-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors"
                            disabled={isReadOnly}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vendor_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-gray-700">전화번호</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="02-1234-5678"
                            className="h-9 text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none px-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors"
                            disabled={isReadOnly}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vendor_fax"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-gray-700">팩스번호</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="02-1234-5679"
                            className="h-9 text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none px-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors"
                            disabled={isReadOnly}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vendor_payment_schedule"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-gray-700">결제조건</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="월말결제, 현금결제 등"
                            className="h-9 text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none px-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors"
                            disabled={isReadOnly}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="vendor_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[12px] font-medium text-gray-700">주소</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="주소를 입력하세요"
                          className="text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none p-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors min-h-[64px]"
                          disabled={isReadOnly}
                        />
                      </FormControl>
                      <FormMessage className="text-[10px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[12px] font-medium text-gray-700">비고</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="메모 사항을 입력하세요"
                          className="text-[12px] border border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none p-3 w-full business-radius-input shadow-sm bg-white text-gray-800 transition-colors min-h-[48px]"
                          disabled={isReadOnly}
                        />
                      </FormControl>
                      <FormMessage className="text-[10px]" />
                    </FormItem>
                  )}
                />
              </div>

              {/* 담당자 관리 섹션 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="section-title text-gray-950 flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-blue-600 rounded-full"></span>
                  <span>업체 담당자 관리</span>
                </h3>

                {/* 담당자 목록 */}
                <div className="border border-gray-200 business-radius-card overflow-hidden bg-white shadow-sm">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-gray-200 text-gray-500 font-semibold">
                        <th className="p-3 w-28 header-title">이름 *</th>
                        <th className="p-3 w-24 header-title">직함</th>
                        <th className="p-3 w-36 header-title">연락처</th>
                        <th className="p-3 header-title">이메일</th>
                        {!isReadOnly && <th className="p-3 w-16 text-center header-title">삭제</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.length === 0 ? (
                        <tr>
                          <td colSpan={isReadOnly ? 4 : 5} className="p-6 text-center text-gray-400">
                            등록된 담당자가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        contacts.map((contact, idx) => (
                          <tr key={idx} className="border-b border-gray-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                            <td className="p-2.5">
                              {isReadOnly ? (
                                <span className="px-1 text-gray-800 font-medium">{contact.contact_name}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={contact.contact_name || ''}
                                  onChange={(e) => handleUpdateContactField(idx, 'contact_name', e.target.value)}
                                  className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-1 text-[11px] h-8 shadow-sm transition-all"
                                  placeholder="이름"
                                />
                              )}
                            </td>
                            <td className="p-2.5">
                              {isReadOnly ? (
                                <span className="px-1 text-gray-600">{contact.position || '-'}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={contact.position || ''}
                                  onChange={(e) => handleUpdateContactField(idx, 'position', e.target.value)}
                                  className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-1 text-[11px] h-8 shadow-sm transition-all"
                                  placeholder="직함"
                                />
                              )}
                            </td>
                            <td className="p-2.5">
                              {isReadOnly ? (
                                <span className="px-1 text-gray-600">{contact.contact_phone || '-'}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={contact.contact_phone || ''}
                                  onChange={(e) => handleUpdateContactField(idx, 'contact_phone', e.target.value)}
                                  className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-1 text-[11px] h-8 shadow-sm transition-all"
                                  placeholder="연락처"
                                />
                              )}
                            </td>
                            <td className="p-2.5">
                              {isReadOnly ? (
                                <span className="px-1 text-gray-600">{contact.contact_email || '-'}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={contact.contact_email || ''}
                                  onChange={(e) => handleUpdateContactField(idx, 'contact_email', e.target.value)}
                                  className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-1 text-[11px] h-8 shadow-sm transition-all"
                                  placeholder="이메일"
                                />
                              )}
                            </td>
                            {!isReadOnly && (
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteContactRow(idx)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 business-radius-badge transition-colors text-[11px] font-semibold"
                                >
                                  삭제
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 새 담당자 추가 폼 */}
                {!isReadOnly && (
                  <div className="p-4 bg-slate-50/50 border border-gray-200 business-radius-card space-y-3 shadow-sm">
                    <div className="section-title text-gray-700 flex items-center gap-1">
                      <span>새 담당자 추가</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 font-medium">이름 *</label>
                        <input
                          type="text"
                          placeholder="이름"
                          value={newContact.contact_name}
                          onChange={(e) => setNewContact({ ...newContact, contact_name: e.target.value })}
                          className="h-8 px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 font-medium">직함</label>
                        <input
                          type="text"
                          placeholder="직함"
                          value={newContact.position}
                          onChange={(e) => setNewContact({ ...newContact, position: e.target.value })}
                          className="h-8 px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 font-medium">연락처</label>
                        <input
                          type="text"
                          placeholder="연락처"
                          value={newContact.contact_phone}
                          onChange={(e) => setNewContact({ ...newContact, contact_phone: e.target.value })}
                          className="h-8 px-2.5 text-[11px] border border-gray-350 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 font-medium">이메일</label>
                        <input
                          type="email"
                          placeholder="이메일"
                          value={newContact.contact_email}
                          onChange={(e) => setNewContact({ ...newContact, contact_email: e.target.value })}
                          className="h-8 px-2.5 text-[11px] border border-gray-350 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all w-full"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleAddContact}
                        className="button-action-primary shadow-sm"
                      >
                        추가
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 상태 및 등록일 정보 (조회 모드 전용) */}
              {mode === 'view' && vendor && (
                <div className="pt-4 border-t border-gray-150">
                  <div className="grid grid-cols-2 gap-4 text-[11px] bg-slate-50 p-3.5 business-radius-card border border-gray-150 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 font-medium">상태:</span>
                      <span className="badge-success">
                        활성
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 font-medium">등록일:</span>
                      <span className="text-gray-700 font-medium">
                        {vendor.created_at ? new Date(vendor.created_at).toLocaleDateString('ko-KR') : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 고정 푸터 (px-6 py-4로 완벽한 좌우 여백 밸런스 유지) */}
            <DialogFooter className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="button-action-secondary shadow-sm"
              >
                {mode === 'view' ? '닫기' : '취소'}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="button-action-primary shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting
                    ? (mode === 'create' ? '등록 중...' : '수정 중...')
                    : (mode === 'create' ? '등록' : '수정')
                  }
                </button>
              )}
            </DialogFooter>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
