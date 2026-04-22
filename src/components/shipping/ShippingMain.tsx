import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, Plus, Printer, Star, ChevronDown, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { shippingService } from '@/services/shippingService'
import { ShippingAddress, ShippingLabelFormData, SENDER_COMPANY, SENDER_ADDRESS, formatContactDisplay, hasHonorificSuffix } from '@/types/shipping'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseRoles } from '@/utils/roleHelper'

interface Employee {
  id: string
  name: string | null
  phone: string | null
}

export default function ShippingMain() {
  const { employee } = useAuth()
  const roles = parseRoles(employee?.roles)
  const canDelete = roles.includes('superadmin') || roles.includes('hr')

  // 데이터
  const [addresses, setAddresses] = useState<ShippingAddress[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  // 보내는 사람
  const [senderEmployeeId, setSenderEmployeeId] = useState('')
  const [senderSearch, setSenderSearch] = useState('')
  const [showSenderDropdown, setShowSenderDropdown] = useState(false)
  const senderDropdownRef = useRef<HTMLDivElement>(null)

  // 받는 사람
  const [receiverAddressId, setReceiverAddressId] = useState('')
  const [receiverSearch, setReceiverSearch] = useState('')
  const [showReceiverDropdown, setShowReceiverDropdown] = useState(false)
  const receiverDropdownRef = useRef<HTMLDivElement>(null)

  // 받는 사람 직접 입력 (신규 업체용)
  const [receiverCompany, setReceiverCompany] = useState('')
  const [receiverContactName, setReceiverContactName] = useState('') // 이름
  const [receiverContactTitle, setReceiverContactTitle] = useState('') // 직함
  const [receiverPhone, setReceiverPhone] = useState('')
  const [receiverAddress, setReceiverAddress] = useState('')
  const [isNewReceiver, setIsNewReceiver] = useState(false)

  // 부가 정보
  const [deliveryType, setDeliveryType] = useState<'택배' | '퀵'>('택배')
  const [productName, setProductName] = useState('')
  const [itemValue, setItemValue] = useState('')
  const [deliveryPoint, setDeliveryPoint] = useState('')
  const [notes, setNotes] = useState('')
  const [printCount, setPrintCount] = useState(1)

  // 발송 이력
  const [labels, setLabels] = useState<any[]>([])
  const [historySearch, setHistorySearch] = useState('')

  // 초기 데이터 로드
  useEffect(() => {
    loadData()
  }, [])

  // 로그인 사용자 기본값 설정
  useEffect(() => {
    if (employee && employees.length > 0) {
      const me = employees.find(e => e.id === employee.id)
      if (me) {
        setSenderEmployeeId(me.id)
        setSenderSearch(me.name || '')
      }
    }
  }, [employee, employees])

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (senderDropdownRef.current && !senderDropdownRef.current.contains(e.target as Node)) {
        setShowSenderDropdown(false)
      }
      if (receiverDropdownRef.current && !receiverDropdownRef.current.contains(e.target as Node)) {
        setShowReceiverDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [addrRes, empRes, labelRes] = await Promise.all([
      shippingService.getAddresses(),
      shippingService.getEmployees(),
      shippingService.getLabels(),
    ])
    if (addrRes.success) setAddresses(addrRes.data || [])
    if (empRes.success) setEmployees(empRes.data || [])
    if (labelRes.success) setLabels(labelRes.data || [])
    setLoading(false)
  }

  // 보내는 사람 필터
  const filteredEmployees = useMemo(() => {
    if (!senderSearch) return employees
    const q = senderSearch.toLowerCase()
    return employees.filter(e =>
      e.name?.toLowerCase().includes(q) || e.phone?.includes(q)
    )
  }, [employees, senderSearch])

  // 받는 사람 필터
  const filteredAddresses = useMemo(() => {
    if (!receiverSearch) return addresses
    const q = receiverSearch.toLowerCase()
    return addresses.filter(a =>
      a.company_name.toLowerCase().includes(q) ||
      (a.contact_name_only || a.contact_name || '').toLowerCase().includes(q) ||
      (a.contact_title || '').toLowerCase().includes(q) ||
      (a.contact_memo || '').toLowerCase().includes(q) ||
      a.phone?.includes(q) ||
      a.address.toLowerCase().includes(q)
    )
  }, [addresses, receiverSearch])

  // 선택된 보내는 사람
  const selectedSender = useMemo(() =>
    employees.find(e => e.id === senderEmployeeId),
    [employees, senderEmployeeId]
  )

  // 선택된 받는 사람
  const selectedReceiver = useMemo(() =>
    addresses.find(a => a.id === receiverAddressId),
    [addresses, receiverAddressId]
  )

  const handleSelectSender = (emp: Employee) => {
    setSenderEmployeeId(emp.id)
    setSenderSearch(emp.name || '')
    setShowSenderDropdown(false)
  }

  const handleSelectReceiver = (addr: ShippingAddress) => {
    setReceiverAddressId(addr.id)
    setReceiverSearch(`${addr.company_name} - ${formatContactDisplay(addr)}`)
    setReceiverCompany(addr.company_name)
    setReceiverContactName(addr.contact_name_only || addr.contact_name || '')
    setReceiverContactTitle(addr.contact_title || '')
    setReceiverPhone(addr.phone || '')
    setReceiverAddress(addr.address)
    setIsNewReceiver(false)
    setShowReceiverDropdown(false)
  }

  const handleClearReceiver = () => {
    setReceiverAddressId('')
    setReceiverSearch('')
    setReceiverCompany('')
    setReceiverContactName('')
    setReceiverContactTitle('')
    setReceiverPhone('')
    setReceiverAddress('')
    setIsNewReceiver(true)
  }

  // 새업체 등록 (스마트 upsert: 동일 (회사+이름+주소) 있으면 직함/전화만 업데이트)
  const handleRegisterNewAddress = async () => {
    if (!receiverCompany || !receiverContactName || !receiverAddress) {
      toast.error('업체명, 담당자, 주소는 필수입니다.')
      return
    }
    const result = await shippingService.upsertAddressByCompanyAndContact(
      {
        company_name: receiverCompany,
        contact_name_only: receiverContactName,
        contact_title: receiverContactTitle,
        phone: receiverPhone,
        address: receiverAddress,
      },
      employee?.id
    )
    if (result.success && result.data) {
      setAddresses(prev => {
        const exists = prev.some(a => a.id === result.data!.id)
        return exists ? prev.map(a => a.id === result.data!.id ? result.data! : a) : [...prev, result.data!]
      })
      setReceiverAddressId(result.data.id)
      setReceiverSearch(`${result.data.company_name} - ${formatContactDisplay(result.data)}`)
      setIsNewReceiver(false)
      toast.success(result.mode === 'updated' ? '기존 주소록이 업데이트되었습니다.' : '새 주소록 항목이 등록되었습니다.')
    } else {
      toast.error(result.error || '등록 실패')
    }
  }

  // 인쇄 (저장 → label_code 포함하여 인쇄)
  const handlePrint = useCallback(async () => {
    if (!senderEmployeeId) { toast.error('보내는 사람을 선택해주세요.'); return }
    if (!receiverCompany || !receiverContactName || !receiverAddress) { toast.error('받는 사람 정보를 입력해주세요.'); return }

    // 1. 주소록 스마트 upsert (회사+이름+주소 일치 시 직함/전화 업데이트, 다르면 신규 추가)
    let addrId = ''
    if (receiverCompany && receiverContactName) {
      const result = await shippingService.upsertAddressByCompanyAndContact(
        {
          company_name: receiverCompany,
          contact_name_only: receiverContactName,
          contact_title: receiverContactTitle,
          phone: receiverPhone,
          address: receiverAddress,
        },
        employee?.id
      )
      if (result.success && result.data) {
        addrId = result.data.id
        setAddresses(prev => {
          const exists = prev.some(a => a.id === result.data!.id)
          return exists ? prev.map(a => a.id === result.data!.id ? result.data! : a) : [...prev, result.data!]
        })
        setReceiverAddressId(addrId)
        setIsNewReceiver(false)
        if (result.mode === 'created') {
          toast.success('새 주소록 항목이 자동 등록되었습니다.')
        }
      } else if (result.error) {
        toast.error(`주소록 저장 실패: ${result.error}`)
        return
      }
    }

    let labelCode = ''
    if (addrId) {
      const res = await shippingService.createLabel({
        sender_employee_id: senderEmployeeId,
        receiver_address_id: addrId,
        delivery_type: deliveryType,
        product_name: productName,
        item_value: itemValue ? Number(itemValue) : null,
        delivery_point: deliveryPoint,
        notes,
        print_count: printCount,
      }, employee?.id)
      if (res.success && res.data) {
        setLabels(prev => [res.data!, ...prev])
        labelCode = res.data.label_code || ''
      }
    }

    // 2. 인쇄
    const sender = selectedSender
    const printWindow = window.open('', '_blank', 'width=800,height=1000')
    if (!printWindow) { toast.error('팝업이 차단되었습니다.'); return }

    const labelHTML = (showValue: boolean, title: string) => `
      <div style="border:2pt solid #333;padding:15pt;margin-bottom:3pt;page-break-inside:avoid;height:130mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6pt;">
          <div style="font-size:9pt;font-weight:600;color:#333;">${deliveryPoint ? `배송지점: ${deliveryPoint}` : ''}</div>
          <div style="display:flex;align-items:center;gap:8pt;">
            <div style="font-size:8pt;font-weight:600;color:#333;font-family:monospace;">${labelCode}</div>
            <div style="font-size:7pt;color:#888;">${title}</div>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
          <table style="width:100%;border-collapse:collapse;font-size:10pt;">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:12pt;">
                <div style="font-weight:bold;font-size:12pt;margin-bottom:9pt;border-bottom:2pt solid #333;padding-bottom:3pt;">보내는 사람</div>
                <table style="width:100%;font-size:10pt;line-height:2;">
                  <tr><td style="color:#666;width:45pt;">업체명</td><td style="font-weight:600;">${SENDER_COMPANY}</td></tr>
                  <tr><td style="color:#666;">담당자</td><td>${sender?.name || ''}</td></tr>
                  <tr><td style="color:#666;">연락처</td><td>${sender?.phone || ''}</td></tr>
                  <tr><td style="color:#666;vertical-align:top;">주소</td><td>${SENDER_ADDRESS}</td></tr>
                </table>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:12pt;border-left:1pt solid #ddd;">
                <div style="font-weight:bold;font-size:12pt;margin-bottom:9pt;border-bottom:2pt solid #333;padding-bottom:3pt;">받는 사람</div>
                <table style="width:100%;font-size:10pt;line-height:2;">
                  <tr><td style="color:#666;width:45pt;">업체명</td><td style="font-weight:600;">${receiverCompany}</td></tr>
                  <tr><td style="color:#666;">담당자</td><td>${receiverContactName ? `${[receiverContactName, receiverContactTitle].filter(Boolean).join(' ')}님` : ''}</td></tr>
                  <tr><td style="color:#666;">연락처</td><td>${receiverPhone}</td></tr>
                  <tr><td style="color:#666;vertical-align:top;">주소</td><td>${receiverAddress}</td></tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="margin-top:12pt;border-top:1pt solid #ddd;padding-top:9pt;">
            <table style="font-size:10pt;line-height:2;">
              <tr><td style="color:#666;width:55pt;">배송타입</td><td>${deliveryType}</td></tr>
              <tr><td style="color:#666;">품명</td><td>${productName}</td></tr>
              ${showValue ? `<tr><td style="color:#666;">물품가액</td><td>${itemValue ? Number(itemValue).toLocaleString() + '원' : ''}</td></tr>` : ''}
              ${notes ? `<tr><td style="color:#666;">비고</td><td>${notes}</td></tr>` : ''}
            </table>
          </div>
        </div>
      </div>
    `

    const pages = Array.from({ length: printCount }, () =>
      `<div style="page-break-after:always;">
        ${labelHTML(false, '박스 부착용')}
        <div style="border-top:2pt dashed #999;margin:5mm 0;"></div>
        ${labelHTML(true, '택배사 전달용')}
      </div>`
    ).join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head>
        <title> </title>
        <style>
          @page { margin: 10mm; size: A4; }
          body { margin:0; padding:0; font-family: 'Malgun Gothic', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          * { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
          @media print {
            body { zoom: 1 !important; transform-origin: top left; }
            div[style*="page-break-after"] { page-break-after: always; }
          }
        </style>
      </head><body>${pages}</body></html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 300)
  }, [senderEmployeeId, selectedSender, receiverCompany, receiverContactName, receiverContactTitle, receiverPhone, receiverAddress, receiverAddressId, deliveryType, productName, itemValue, deliveryPoint, notes, printCount, employee])

  // 발송 기록 삭제
  const handleDeleteLabel = async (e: React.MouseEvent, labelId: number) => {
    e.stopPropagation()
    if (!confirm('이 발송 기록을 삭제하시겠습니까?')) return
    const result = await shippingService.deleteLabel(labelId)
    if (result.success) {
      setLabels(prev => prev.filter((l: any) => l.id !== labelId))
      toast.success('발송 기록이 삭제되었습니다.')
    } else {
      toast.error(result.error || '삭제 실패')
    }
  }

  // 이력 검색 필터
  const filteredLabels = useMemo(() => {
    if (!historySearch) return labels
    const q = historySearch.toLowerCase()
    return labels.filter((l: any) =>
      l.label_code?.toLowerCase().includes(q) ||
      l.receiver_address?.company_name?.toLowerCase().includes(q) ||
      l.receiver_address?.contact_name?.toLowerCase().includes(q) ||
      l.receiver_address?.contact_name_only?.toLowerCase().includes(q) ||
      l.receiver_address?.contact_title?.toLowerCase().includes(q) ||
      l.sender_employee?.name?.toLowerCase().includes(q) ||
      l.product_name?.toLowerCase().includes(q)
    )
  }, [labels, historySearch])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-gray-600">로딩 중...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title text-gray-900">택배</h1>
        <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Shipping Label</p>
      </div>

      {/* 카드 3개: 보내는 사람 | 받는 사람 + 부가정보 | (아래 발송이력) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-[1300px]">
        {/* 카드 1: 보내는 사람 */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center h-7 mb-2">
            <h2 className="modal-section-title">보내는 사람</h2>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">업체명</Label>
                <Input value={SENDER_COMPANY} disabled />
              </div>
              <div ref={senderDropdownRef} className="relative grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">담당자</Label>
                <div className="relative">
                  <Input
                    value={senderSearch}
                    onChange={(e) => { setSenderSearch(e.target.value); setShowSenderDropdown(true) }}
                    onFocus={() => setShowSenderDropdown(true)}
                    placeholder="이름 검색..."
                    className="pr-8"
                  />
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  {showSenderDropdown && filteredEmployees.length > 0 && (
                    <div className="absolute z-20 mt-1 min-w-[200px] bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredEmployees.map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => handleSelectSender(emp)}
                          className={cn(
                            "w-full text-left px-3 py-1.5 hover:bg-gray-50 text-[11px] flex justify-between gap-3 whitespace-nowrap",
                            emp.id === senderEmployeeId && "bg-primary/5 text-primary"
                          )}
                        >
                          <span>{emp.name}</span>
                          <span className="text-gray-400">{emp.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">연락처</Label>
                <Input value={selectedSender?.phone || ''} disabled />
              </div>
            </div>
            <div className="grid grid-cols-[50px_1fr] items-start gap-2">
              <Label className="text-[11px] !font-normal text-gray-500 pt-1.5">주소</Label>
              <Input value={SENDER_ADDRESS} disabled />
            </div>
          </div>
        </div>

        {/* 카드 2: 받는 사람 */}
        <div className="bg-white rounded-lg border p-4">
          <div ref={receiverDropdownRef} className="relative grid grid-cols-[50px_1fr] items-center gap-2 mb-2">
            <h2 className="modal-section-title whitespace-nowrap">받는 사람</h2>
            <div className="relative flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  value={receiverSearch}
                  onChange={(e) => { setReceiverSearch(e.target.value); setShowReceiverDropdown(true); setIsNewReceiver(false) }}
                  onFocus={() => setShowReceiverDropdown(true)}
                  placeholder="주소록 검색..."
                  className="pl-7"
                />
              </div>
              {receiverAddressId && (
                <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={handleClearReceiver}>
                  초기화
                </Button>
              )}
              {isNewReceiver && receiverCompany && (
                <Button
                  onClick={handleRegisterNewAddress}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white h-7 text-[10px] px-2"
                >
                  <Plus className="w-3 h-3 mr-0.5" />
                  등록
                </Button>
              )}
              {showReceiverDropdown && filteredAddresses.length > 0 && (
                <div className="absolute top-full z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredAddresses.map(addr => (
                    <button
                      key={addr.id}
                      onClick={() => handleSelectReceiver(addr)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 hover:bg-gray-50 text-[11px] border-b last:border-b-0",
                        addr.id === receiverAddressId && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {addr.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                        <span className="font-medium">{addr.company_name}</span>
                        <span className="text-gray-500">{formatContactDisplay(addr)}</span>
                        <span className="text-gray-400">{addr.phone}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 truncate">{addr.address}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">업체명</Label>
                <Input
                  value={receiverCompany}
                  onChange={(e) => { setReceiverCompany(e.target.value); if (receiverAddressId) { setReceiverAddressId(''); setIsNewReceiver(true) } }}
                  placeholder="업체명"
                />
              </div>
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">담당자</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="relative">
                    <Input
                      value={receiverContactName}
                      onChange={(e) => { setReceiverContactName(e.target.value); if (receiverAddressId) { setReceiverAddressId(''); setIsNewReceiver(true) } }}
                      placeholder="이름"
                      className={cn(hasHonorificSuffix(receiverContactName) && "border-red-400 focus:border-red-500")}
                    />
                    {hasHonorificSuffix(receiverContactName) && (
                      <div className="absolute left-0 top-full mt-2 z-20 animate-in fade-in slide-in-from-top-1">
                        <div className="absolute -top-[5px] left-4 w-2.5 h-2.5 rotate-45 bg-amber-50 border-l border-t border-amber-400" />
                        <div className="relative border border-amber-400 bg-amber-50 px-3 py-2 shadow-md whitespace-nowrap">
                          <div className="flex items-start gap-1.5">
                            <span className="text-amber-600 text-[11px] leading-tight">⚠️</span>
                            <div>
                              <p className="text-[11px] font-semibold text-amber-700 leading-tight">
                                '님'은 자동 부여됩니다
                              </p>
                              <p className="text-[10px] text-amber-600 leading-tight mt-0.5">
                                현재 상태로 인쇄 시 <b>'{receiverContactName}님'</b>으로 표기됩니다.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      value={receiverContactTitle}
                      onChange={(e) => { setReceiverContactTitle(e.target.value); if (receiverAddressId) { setReceiverAddressId(''); setIsNewReceiver(true) } }}
                      placeholder="직함"
                      className={cn(hasHonorificSuffix(receiverContactTitle) && "border-red-400 focus:border-red-500")}
                    />
                    {hasHonorificSuffix(receiverContactTitle) && (
                      <div className="absolute left-0 top-full mt-2 z-20 animate-in fade-in slide-in-from-top-1">
                        <div className="absolute -top-[5px] left-4 w-2.5 h-2.5 rotate-45 bg-amber-50 border-l border-t border-amber-400" />
                        <div className="relative border border-amber-400 bg-amber-50 px-3 py-2 shadow-md whitespace-nowrap">
                          <div className="flex items-start gap-1.5">
                            <span className="text-amber-600 text-[11px] leading-tight">⚠️</span>
                            <div>
                              <p className="text-[11px] font-semibold text-amber-700 leading-tight">
                                '님'은 자동 부여됩니다
                              </p>
                              <p className="text-[10px] text-amber-600 leading-tight mt-0.5">
                                현재 상태로 인쇄 시 <b>'{receiverContactTitle}님'</b>으로 표기됩니다.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">연락처</Label>
                <Input
                  value={receiverPhone}
                  onChange={(e) => { setReceiverPhone(e.target.value); if (receiverAddressId) { setReceiverAddressId(''); setIsNewReceiver(true) } }}
                  placeholder="연락처"
                />
              </div>
            </div>
            <div className="grid grid-cols-[50px_1fr] items-start gap-2">
              <Label className="text-[11px] !font-normal text-gray-500 pt-1.5">주소</Label>
              <Input
                value={receiverAddress}
                onChange={(e) => { setReceiverAddress(e.target.value); if (receiverAddressId) { setReceiverAddressId(''); setIsNewReceiver(true) } }}
                placeholder="주소"
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1 pl-[58px]">* 수동 입력 후 인쇄 시 주소록에 자동 등록됩니다.</p>
          </div>
        </div>

        {/* 카드 3: 부가 정보 + 출력 */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center h-7 mb-2">
            <h2 className="modal-section-title">부가 정보</h2>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">배송</Label>
                <Select value={deliveryType} onValueChange={(v) => setDeliveryType(v as '택배' | '퀵')}>
                  <SelectTrigger className="!h-7 !min-h-0 !px-2.5 !py-0 !text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="택배" className="text-[11px] py-1.5">택배</SelectItem>
                    <SelectItem value="퀵" className="text-[11px] py-1.5">퀵</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">지점</Label>
                <Input value={deliveryPoint} onChange={(e) => setDeliveryPoint(e.target.value)} placeholder="지점" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">품명</Label>
                <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="품명" />
              </div>
              <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500">가액</Label>
                <Input
                  value={itemValue ? `₩ ${Number(itemValue).toLocaleString()}` : ''}
                  onChange={(e) => setItemValue(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="₩ 0"
                />
              </div>
            </div>
            <div className="grid grid-cols-[50px_1fr] items-center gap-2">
              <Label className="text-[11px] !font-normal text-gray-500">비고</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="비고" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t">
            <div className="flex items-center gap-1.5">
              <Label className="text-[11px] !font-normal text-gray-500 mr-1">수량</Label>
              <button onClick={() => setPrintCount(Math.max(1, printCount - 1))} className="w-5 h-5 rounded border border-gray-300 flex items-center justify-center text-[11px] text-gray-600 hover:bg-gray-50">-</button>
              <span className="w-5 text-center text-[11px] text-gray-800">{printCount}</span>
              <button onClick={() => setPrintCount(printCount + 1)} className="w-5 h-5 rounded border border-gray-300 flex items-center justify-center text-[11px] text-gray-600 hover:bg-gray-50">+</button>
            </div>
            <button onClick={handlePrint} className="flex items-center gap-1 h-7 px-3 rounded-md bg-[#1777CB] hover:bg-[#1265b0] text-white text-[11px] font-medium transition-colors">
              <Printer className="w-3.5 h-3.5" />
              인쇄
            </button>
          </div>
        </div>
      </div>

      {/* 발송 이력 */}
      <div className="bg-white rounded-lg border p-4 max-w-[1300px]">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="modal-section-title whitespace-nowrap">발송 이력</h2>
          <div className="relative w-52">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="업체, 담당자, 품명 검색..."
              className="pl-7"
            />
          </div>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[400px] border rounded-lg">
          {filteredLabels.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-[11px]">발송 이력이 없습니다.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
                <tr>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">코드</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[45px]">배송</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[45px]">날짜</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">지점</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">보낸사람</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">업체명</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">담당자</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">연락처</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[15%]">품명</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">가액</th>
                  <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[15%]">비고</th>
                  {canDelete && <th className="px-2 py-1.5 w-[30px]"></th>}
                </tr>
              </thead>
              <tbody>
                {filteredLabels.map((label: any) => (
                  <tr
                    key={label.id}
                    className="border-b hover:bg-gray-100 cursor-pointer transition-colors"
                    onClick={() => {
                      if (label.sender_employee) {
                        setSenderEmployeeId(label.sender_employee.id)
                        setSenderSearch(label.sender_employee.name || '')
                      }
                      if (label.receiver_address) {
                        handleSelectReceiver(label.receiver_address)
                      }
                      setDeliveryType(label.delivery_type)
                      setProductName(label.product_name || '')
                      setItemValue(label.item_value ? String(label.item_value) : '')
                      setDeliveryPoint(label.delivery_point || '')
                      setNotes(label.notes || '')
                    }}
                  >
                    <td className="px-2 py-1.5 font-mono text-[10px] text-gray-500">{label.label_code}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px]",
                        label.delivery_type === '택배' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      )}>
                        {label.delivery_type}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 card-title">
                      {new Date(label.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                    </td>
                    <td className="px-2 py-1.5 card-title">{label.delivery_point}</td>
                    <td className="px-2 py-1.5 card-title">{label.sender_employee?.name}</td>
                    <td className="px-2 py-1.5 card-title">{label.receiver_address?.company_name}</td>
                    <td className="px-2 py-1.5 card-title">
                      {label.receiver_address ? formatContactDisplay(label.receiver_address) : ''}
                    </td>
                    <td className="px-2 py-1.5 card-title">{label.receiver_address?.phone}</td>
                    <td className="px-2 py-1.5 card-title truncate max-w-[150px]">{label.product_name}</td>
                    <td className="px-2 py-1.5 card-title">{label.item_value ? `₩${Number(label.item_value).toLocaleString()}` : ''}</td>
                    <td className="px-2 py-1.5 card-title truncate max-w-[120px]">{label.notes}</td>
                    {canDelete && (
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={(e) => handleDeleteLabel(e, label.id)}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
