import { useState, useEffect } from 'react'
import { Vendor, VendorContact } from '@/types/purchase'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Search, Plus, Trash2, UserPlus } from 'lucide-react'

interface VendorContactsModalProps {
  isOpen: boolean
  onClose: () => void
  vendor: Vendor | null
  onSave: () => void
}

export default function VendorContactsModal({ isOpen, onClose, vendor, onSave }: VendorContactsModalProps) {
  const [contacts, setContacts] = useState<Partial<VendorContact>[]>([])
  const [allVendors, setAllVendors] = useState<{ id: number, vendor_name: string }[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newContact, setNewContact] = useState({
    vendor_id: '',
    contact_name: '',
    position: '',
    contact_phone: '',
    contact_email: ''
  })

  // Load contacts and fetch all vendors
  useEffect(() => {
    const fetchVendors = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('vendors')
        .select('id, vendor_name')
        .order('vendor_name', { ascending: true })
      
      if (error) {
        console.error('Error fetching vendors:', error)
      } else if (data) {
        setAllVendors(data)
      }
    }

    if (isOpen && vendor) {
      setContacts(vendor.vendor_contacts || [])
      setSearchQuery('')
      setNewContact({
        vendor_id: String(vendor.id),
        contact_name: '',
        position: '',
        contact_phone: '',
        contact_email: ''
      })
      fetchVendors()
    }
  }, [vendor, isOpen])

  const getVendorSelectWidth = (vendorId: number | string) => {
    const vName = allVendors.find(v => String(v.id) === String(vendorId))?.vendor_name || '';
    return `${Math.max(160, vName.length * 11 + 32)}px`;
  }

  const getInputWidth = (text: string | null | undefined, minWidth = 60, charMultiplier = 11) => {
    const val = text || '';
    return `${Math.max(minWidth, val.length * charMultiplier + 16)}px`;
  }

  const handleAddContact = () => {
    if (!newContact.contact_name.trim()) {
      toast.error('담당자 이름을 입력해주세요.')
      return
    }
    
    const targetVendorId = Number(newContact.vendor_id || vendor?.id)
    
    setContacts([
      ...contacts,
      {
        vendor_id: targetVendorId,
        contact_name: newContact.contact_name.trim(),
        position: newContact.position.trim(),
        contact_phone: newContact.contact_phone.trim(),
        contact_email: newContact.contact_email.trim()
      }
    ])
    
    setNewContact({
      vendor_id: String(vendor?.id || ''),
      contact_name: '',
      position: '',
      contact_phone: '',
      contact_email: ''
    })
  }

  const handleUpdateContactField = (index: number, field: keyof VendorContact, value: any) => {
    const updated = [...contacts]
    const contactToUpdate = filteredContacts[index]
    const fullIndex = contacts.findIndex(c => c === contactToUpdate)
    
    if (fullIndex !== -1) {
      updated[fullIndex] = {
        ...updated[fullIndex],
        [field]: value
      }
      setContacts(updated)
    }
  }

  const handleDeleteContactRow = (index: number) => {
    const contactToDelete = filteredContacts[index]
    setContacts(contacts.filter(c => c !== contactToDelete))
  }

  // Filter contacts by search query
  const filteredContacts = contacts.filter(contact => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return true
    
    const matchedVendor = allVendors.find(v => v.id === contact.vendor_id)
    const vendorName = matchedVendor ? matchedVendor.vendor_name : ''

    return (
      vendorName.toLowerCase().includes(query) ||
      (contact.contact_name || '').toLowerCase().includes(query) ||
      (contact.position || '').toLowerCase().includes(query) ||
      (contact.contact_phone || '').toLowerCase().includes(query) ||
      (contact.contact_email || '').toLowerCase().includes(query)
    )
  })

  const handleSaveChanges = async () => {
    if (!vendor) return
    setIsSubmitting(true)
    const supabase = createClient()

    try {
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
          console.error('Error deleting contacts:', deleteError)
        }
      }

      // Insert or update remaining contacts
      for (const contact of validContacts) {
        const targetVendorId = contact.vendor_id || vendor.id
        if (contact.id) {
          const { error: updateError } = await supabase
            .from('vendor_contacts')
            .update({
              vendor_id: targetVendorId,
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
              vendor_id: targetVendorId,
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

      toast.success('담당자 정보가 성공적으로 수정되었습니다.')
      onSave()
      onClose()
    } catch (error) {
      toast.error('저장 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        maxWidth="none" 
        style={{ width: 'fit-content', maxWidth: '95vw' }}
        className="p-0 overflow-hidden business-radius-modal border border-gray-200 bg-white shadow-2xl flex flex-col max-h-[88vh]"
      >
        <div className="compact-inputs flex-1 flex flex-col overflow-hidden min-h-0">
          <DialogHeader className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <DialogTitle className="page-title text-gray-900 flex items-center gap-2">
              <span className="w-1.5 h-4 bg-blue-600 rounded-full"></span>
              <span>{vendor?.vendor_name} - 담당자 정보 수정</span>
            </DialogTitle>
          </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          {/* 검색 창 */}
          <div className="relative flex items-center flex-shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="업체명, 이름, 직함, 연락처, 이메일로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '26px', width: '280px', height: '24px' }}
              className="pr-3 border border-gray-300 bg-white text-[11px] text-gray-850 placeholder:text-gray-400 placeholder:text-[10px] business-radius-input focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none shadow-sm transition-all"
            />
          </div>

          {/* 담당자 목록 테이블 */}
          <div className="border border-gray-200 business-radius-card overflow-hidden bg-white shadow-sm flex flex-col">
            <div className="overflow-x-auto max-h-[40vh]">
              <table className="w-auto text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 sticky top-0 z-10">
                    <th className="p-3 header-title bg-slate-50">업체(변경) *</th>
                    <th className="p-3 header-title bg-slate-50">이름 *</th>
                    <th className="p-3 header-title bg-slate-50">직함</th>
                    <th className="p-3 header-title bg-slate-50">연락처</th>
                    <th className="p-3 header-title bg-slate-50">이메일</th>
                    <th className="p-3 w-12 text-center header-title bg-slate-50">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-400">
                        {searchQuery ? '검색 결과에 맞는 담당자가 없습니다.' : '등록된 담당자가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredContacts.map((contact, idx) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                        <td className="p-2">
                          <select
                            value={contact.vendor_id || ''}
                            onChange={(e) => handleUpdateContactField(idx, 'vendor_id', Number(e.target.value))}
                            style={{ height: '20px', width: getVendorSelectWidth(contact.vendor_id || '') }}
                            className="bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-0.5 text-[11px] h-8 shadow-sm transition-all cursor-pointer"
                          >
                            {allVendors.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.vendor_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={contact.contact_name || ''}
                            onChange={(e) => handleUpdateContactField(idx, 'contact_name', e.target.value)}
                            style={{ height: '20px', width: getInputWidth(contact.contact_name, 70, 11) }}
                            className="bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-0.5 text-[11px] h-8 shadow-sm transition-all"
                            placeholder="이름"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={contact.position || ''}
                            onChange={(e) => handleUpdateContactField(idx, 'position', e.target.value)}
                            style={{ height: '20px', width: getInputWidth(contact.position, 60, 11) }}
                            className="bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-0.5 text-[11px] h-8 shadow-sm transition-all"
                            placeholder="직함"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={contact.contact_phone || ''}
                            onChange={(e) => handleUpdateContactField(idx, 'contact_phone', e.target.value)}
                            style={{ height: '20px', width: getInputWidth(contact.contact_phone, 110, 8) }}
                            className="bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-0.5 text-[11px] h-8 shadow-sm transition-all"
                            placeholder="연락처"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={contact.contact_email || ''}
                            onChange={(e) => handleUpdateContactField(idx, 'contact_email', e.target.value)}
                            style={{ height: '20px', width: getInputWidth(contact.contact_email, 160, 7) }}
                            className="bg-white border border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 business-radius-input px-2.5 py-0.5 text-[11px] h-8 shadow-sm transition-all"
                            placeholder="이메일"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteContactRow(idx)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 새 담당자 추가 폼 */}
          <div className="p-4 bg-slate-50/50 border border-gray-200 business-radius-card space-y-2.5 shadow-sm flex-shrink-0">
            <div className="section-title text-gray-700 flex items-center gap-1.5 pb-1 border-b border-gray-100">
              <UserPlus className="w-3.5 h-3.5 text-blue-600" />
              <span>새 담당자 추가</span>
            </div>
            <div className="flex flex-wrap gap-2.5 items-end">
              <div className="space-y-1 flex flex-col">
                <label className="text-[10px] text-gray-500 font-medium">업체(변경) *</label>
                <select
                  value={newContact.vendor_id}
                  onChange={(e) => setNewContact({ ...newContact, vendor_id: e.target.value })}
                  style={{ height: '20px', width: getVendorSelectWidth(newContact.vendor_id) }}
                  className="px-2.5 py-0 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all cursor-pointer"
                >
                  {allVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vendor_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-[10px] text-gray-500 font-medium">이름 *</label>
                <input
                  type="text"
                  placeholder="이름"
                  value={newContact.contact_name}
                  onChange={(e) => setNewContact({ ...newContact, contact_name: e.target.value })}
                  style={{ height: '20px', width: getInputWidth(newContact.contact_name, 70, 11) }}
                  className="px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all"
                />
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-[10px] text-gray-500 font-medium">직함</label>
                <input
                  type="text"
                  placeholder="직함"
                  value={newContact.position}
                  onChange={(e) => setNewContact({ ...newContact, position: e.target.value })}
                  style={{ height: '20px', width: getInputWidth(newContact.position, 60, 11) }}
                  className="px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all"
                />
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-[10px] text-gray-500 font-medium">연락처</label>
                <input
                  type="text"
                  placeholder="연락처"
                  value={newContact.contact_phone}
                  onChange={(e) => setNewContact({ ...newContact, contact_phone: e.target.value })}
                  style={{ height: '20px', width: getInputWidth(newContact.contact_phone, 110, 8) }}
                  className="px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all"
                />
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-[10px] text-gray-500 font-medium">이메일</label>
                <input
                  type="email"
                  placeholder="이메일"
                  value={newContact.contact_email}
                  onChange={(e) => setNewContact({ ...newContact, contact_email: e.target.value })}
                  style={{ height: '20px', width: getInputWidth(newContact.contact_email, 160, 7) }}
                  className="px-2.5 text-[11px] border border-gray-300 bg-white text-gray-850 business-radius-input focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all"
                />
              </div>
              <button
                type="button"
                onClick={handleAddContact}
                style={{ height: '20px', margin: 0 }}
                className="button-action-primary shadow-sm flex items-center justify-center gap-1 self-end"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                <span>추가</span>
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="button-action-secondary shadow-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={isSubmitting}
            className="button-action-primary shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '저장 중...' : '저장'}
          </button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
