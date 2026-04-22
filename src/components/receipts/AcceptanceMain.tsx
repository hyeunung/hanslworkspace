import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Printer, Trash2, Search, X, Calendar as CalendarIcon, Star } from 'lucide-react'
import { format } from 'date-fns'
import { DatePickerPopover } from '@/components/ui/date-picker-popover'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { deliveryOrderService } from '@/services/deliveryOrderService'
import { shippingService } from '@/services/shippingService'
import type {
  DeliveryOrder,
  DeliveryOrderFormData,
  DeliveryOrderItem,
} from '@/types/deliveryOrder'
import type { ShippingAddress } from '@/types/shipping'
import { hasHonorificSuffix, formatContactDisplay } from '@/types/shipping'
import { cn } from '@/lib/utils'
import ProductAcceptanceCertificate, {
  formatAcceptanceDocNumber,
} from '@/components/receipts/ProductAcceptanceCertificate'
import type { AcceptanceParty } from '@/components/receipts/ProductAcceptanceCertificate'
import NewWindow from '@/components/common/NewWindow'

interface EmployeeLite {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

/** 인수자 입력 상태 — 주소록 선택 + 수동 편집 모두 지원 */
interface RecipientInput {
  id: string            // '' = 신규(주소록에 없음), 값 있음 = 주소록 id
  company_name: string
  contact_name_only: string // 이름만
  contact_title: string     // 직함 (님 제외)
  contact_memo: string      // 비고 (소속/메모 등)
  phone: string             // TEL
  mobile: string            // H.P
  email: string
  address: string           // 주소 (주소록 매칭 키)
}

const emptyRecipient = (): RecipientInput => ({
  id: '',
  company_name: '',
  contact_name_only: '',
  contact_title: '',
  contact_memo: '',
  phone: '',
  mobile: '',
  email: '',
  address: '',
})

/** 이름+직함을 레거시 contact_name 형식으로 조립 (예: "홍길동 선임") */
const composeContactName = (r: Pick<RecipientInput, 'contact_name_only' | 'contact_title'>): string =>
  [r.contact_name_only, r.contact_title].filter(Boolean).join(' ').trim()

/** 인쇄용 representative: "홍길동 선임님" 또는 "홍길동님" (직함 없어도 '님' 부여) */
const composeRepresentative = (r: Pick<RecipientInput, 'contact_name_only' | 'contact_title'>): string => {
  const name = r.contact_name_only?.trim() ?? ''
  const title = r.contact_title?.trim() ?? ''
  if (!name) return ''
  return title ? `${name} ${title}님` : `${name}님`
}

/**
 * 전화번호 분류 헬퍼
 * - 010, 011, 016, 017, 018, 019 로 시작하면 H.P
 * - 그 외(02, 053, 031 등 지역번호)는 TEL
 */
const classifyPhone = (num?: string | null): 'mobile' | 'tel' | null => {
  if (!num) return null
  const digits = num.replace(/[^0-9]/g, '')
  if (/^(010|011|016|017|018|019)/.test(digits)) return 'mobile'
  return 'tel'
}

/**
 * phone + mobile 두 값으로부터 TEL과 H.P 로 자동 정리
 * - 기존 phone 이 010 이면 mobile 로 자동 분류
 * - 그 외면 TEL 로 사용, mobile 은 별도 H.P 값 사용
 */
const splitPhones = (
  phone?: string | null,
  mobile?: string | null
): { tel: string; mobile: string } => {
  const p = phone ?? ''
  const m = mobile ?? ''
  if (classifyPhone(p) === 'mobile') {
    // phone 이 휴대폰이면 H.P 로 취급. mobile 값이 따로 있으면 그대로 H.P.
    return { tel: '', mobile: m || p }
  }
  return { tel: p, mobile: m }
}

const emptyItem = (line: number): Omit<DeliveryOrderItem, 'id' | 'delivery_order_id' | 'created_at'> => ({
  line_number: line,
  item_name: '',
  specification: '',
  quantity: null,
  unit: '',
  unit_price: null,
  supply_amount: 0,
  tax_amount: 0,
  remark: '',
})

export default function AcceptanceMain() {
  const { employee } = useAuth()

  const [addresses, setAddresses] = useState<ShippingAddress[]>([])
  const [employees, setEmployees] = useState<EmployeeLite[]>([])
  const [history, setHistory] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ---- 입력 상태 ----
  // 인도자는 항상 한슬(내부 직원). 기본값 = 로그인 사용자, 필요시 다른 직원 선택 가능.
  const [supplierEmployeeId, setSupplierEmployeeId] = useState<string>('')

  const [recipients, setRecipients] = useState<RecipientInput[]>([emptyRecipient()])
  const [shippingDate, setShippingDate] = useState('')
  const [receivingDate, setReceivingDate] = useState('')
  const [receiverName, setReceiverName] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<Array<Omit<DeliveryOrderItem, 'id' | 'delivery_order_id' | 'created_at'>>>(
    [emptyItem(1)]
  )

  // ---- 이력 검색/인쇄 ----
  const [historySearch, setHistorySearch] = useState('')
  const [printTarget, setPrintTarget] = useState<DeliveryOrder | null>(null)

  // ---- 초기 로드 ----
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [addrRes, empRes, hisRes] = await Promise.all([
        shippingService.getAddresses(),
        shippingService.getEmployees(),
        deliveryOrderService.list(),
      ])
      if (addrRes.success && addrRes.data) setAddresses(addrRes.data)
      if (empRes.success && empRes.data) setEmployees(empRes.data)
      if (hisRes.success && hisRes.data) setHistory(hisRes.data)
      setLoading(false)
    })()
  }, [])

  // 로그인 사용자로 인도자 기본값
  useEffect(() => {
    if (employee?.id && !supplierEmployeeId) {
      setSupplierEmployeeId(employee.id)
    }
  }, [employee, supplierEmployeeId])

  // 인쇄 자동 실행 여부 플래그 (발행+인쇄 버튼 클릭 시 true)
  const [autoPrintPending, setAutoPrintPending] = useState(false)
  const previewWinRef = useRef<Window | null>(null)

  // 인수자 주소록 검색/드롭다운 상태 (택배 페이지와 동일한 디자인)
  const [recipientSearches, setRecipientSearches] = useState<Record<number, string>>({})
  const [openDropdownIdx, setOpenDropdownIdx] = useState<number | null>(null)
  const recipientDropdownRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  // 브라우저 autofill 무력화용 랜덤 suffix (mount 당 1회)
  const autofillSalt = useMemo(() => Math.random().toString(36).slice(2, 10), [])

  useEffect(() => {
    if (openDropdownIdx === null) return
    const handler = (e: MouseEvent) => {
      const el = recipientDropdownRefs.current.get(openDropdownIdx)
      if (el && !el.contains(e.target as Node)) setOpenDropdownIdx(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openDropdownIdx])

  const filteredAddressesForIdx = (idx: number) => {
    const q = (recipientSearches[idx] || '').toLowerCase().trim()
    if (!q) return addresses
    return addresses.filter((a) =>
      a.company_name.toLowerCase().includes(q) ||
      (a.contact_name_only || a.contact_name || '').toLowerCase().includes(q) ||
      (a.contact_title || '').toLowerCase().includes(q) ||
      (a.contact_memo || '').toLowerCase().includes(q) ||
      (a.phone || '').includes(q) ||
      (a.address || '').toLowerCase().includes(q)
    )
  }

  const handleSelectAddressForRecipient = (idx: number, addrId: string) => {
    const a = addresses.find((x) => x.id === addrId)
    if (!a) return
    selectRecipientAddress(idx, addrId)
    setRecipientSearches((prev) => ({
      ...prev,
      [idx]: `${a.company_name} · ${formatContactDisplay(a)}`,
    }))
    setOpenDropdownIdx(null)
  }

  const handleClearRecipient = (idx: number) => {
    setRecipients((prev) => prev.map((r, i) => (i === idx ? emptyRecipient() : r)))
    setRecipientSearches((prev) => ({ ...prev, [idx]: '' }))
  }

  // ---- 주소록 Combobox 옵션 (검색 가능) ----
  const addressOptions = useMemo(
    () =>
      addresses.map((a) => {
        // 2줄: "이름 직함 (비고)" - 직함/비고는 있을 때만
        const name = a.contact_name_only ?? a.contact_name ?? ''
        const title = a.contact_title ?? ''
        const memo = a.contact_memo ?? ''
        const nameWithTitle = title ? `${name} ${title}` : name
        const secondary = memo ? `${nameWithTitle} (${memo})` : nameWithTitle

        // 3줄: 전화번호 (mobile 우선, 없으면 phone)
        const tertiary = [a.mobile, a.phone].filter(Boolean).join(' · ')

        // 검색용 label (모든 필드 연결)
        const label = [a.company_name, secondary, tertiary].filter(Boolean).join(' · ')

        return {
          value: a.id,
          label,
          primary: a.company_name ?? '',
          secondary,
          tertiary,
        }
      }),
    [addresses]
  )

  // ---- 합계 계산 ----
  const totalSupply = useMemo(
    () => items.reduce((s, it) => s + (Number(it.supply_amount) || 0), 0),
    [items]
  )
  const totalTax = useMemo(
    () => items.reduce((s, it) => s + (Number(it.tax_amount) || 0), 0),
    [items]
  )
  const totalAmount = totalSupply + totalTax

  // ---- 품목 편집 ----
  const updateItem = (idx: number, patch: Partial<(typeof items)[number]>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  const addItem = () => setItems((prev) => [...prev, emptyItem(prev.length + 1)])
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, line_number: i + 1 })))

  // ---- 인수자 행 편집 ----
  /** 주소록에서 선택 — id 와 필드를 해당 주소 값으로 일괄 세팅 (phone 이 010 이면 H.P 로 자동 분류) */
  const selectRecipientAddress = (idx: number, addrId: string) => {
    const a = addresses.find((x) => x.id === addrId)
    if (!a) return
    const { tel, mobile } = splitPhones(a.phone, a.mobile)
    setRecipients((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              id: a.id,
              company_name: a.company_name ?? '',
              contact_name_only: a.contact_name_only ?? a.contact_name ?? '',
              contact_title: a.contact_title ?? '',
              contact_memo: a.contact_memo ?? '',
              phone: tel,
              mobile,
              email: a.email ?? '',
              address: a.address ?? '',
            }
          : r
      )
    )
  }
  const updateRecipientField = (
    idx: number,
    field: keyof RecipientInput,
    val: string
  ) => {
    setRecipients((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r))
    )
  }
  const addRecipient = () => setRecipients((prev) => [...prev, emptyRecipient()])
  const removeRecipient = (idx: number) =>
    setRecipients((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))

  // ---- 폼 유효성 검사 (미리보기/발행 공통) ----
  const validateForm = (): {
    ok: boolean
    cleanedRecipients: RecipientInput[]
    cleanedItems: typeof items
    error?: string
  } => {
    if (!supplierEmployeeId) {
      return { ok: false, cleanedRecipients: [], cleanedItems: [], error: '인도자 담당자를 선택해주세요' }
    }
    const cleanedRecipients = recipients.filter(
      (r) => r.company_name.trim() || r.contact_name_only.trim() || r.id
    )
    if (cleanedRecipients.length === 0) {
      return { ok: false, cleanedRecipients: [], cleanedItems: [], error: '인수자를 최소 1명 입력해주세요 (상호·담당자 필수)' }
    }
    const invalid = cleanedRecipients.find(
      (r) => !r.company_name.trim() || !r.contact_name_only.trim()
    )
    if (invalid) {
      return { ok: false, cleanedRecipients, cleanedItems: [], error: '인수자의 상호와 담당자는 필수입니다' }
    }
    const cleanedItems = items.filter((it) => it.item_name.trim())
    if (cleanedItems.length === 0) {
      return { ok: false, cleanedRecipients, cleanedItems: [], error: '품목(품명)을 1개 이상 입력해주세요' }
    }
    return { ok: true, cleanedRecipients, cleanedItems }
  }

  // 미리보기 불가 사유 (버튼 아래 말풍선)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // 미리보기 세션 카운터 (버튼 재클릭 시 새창 강제 재오픈)
  const [previewSession, setPreviewSession] = useState(0)

  // ---- 미리보기: 저장하지 않고 현재 폼 상태로 인수증 뷰 렌더 ----
  const handlePreview = () => {
    const { ok, cleanedRecipients, cleanedItems, error } = validateForm()
    if (!ok) {
      setPreviewError(error ?? '입력 내용을 확인해주세요')
      window.setTimeout(() => setPreviewError(null), 5000)
      return
    }
    setPreviewError(null)
    // 기존 미리보기 창 닫기
    if (previewWinRef.current && !previewWinRef.current.closed) {
      try { previewWinRef.current.close() } catch {}
    }
    previewWinRef.current = null
    setPreviewSession((s) => s + 1) // key 변경으로 NewWindow 강제 remount

    const selEmp = employees.find((e) => e.id === supplierEmployeeId)
    // 인수자는 폼 입력 값을 그대로 가상 주소로 변환
    const selRecipients = cleanedRecipients.map((r) => ({
      id: r.id || `temp-${Math.random()}`,
      company_name: r.company_name,
      contact_name: r.contact_name_only,
      contact_name_only: r.contact_name_only || null,
      contact_title: r.contact_title || null,
      contact_memo: r.contact_memo || null,
      phone: r.phone || null,
      mobile: r.mobile || null,
      email: r.email || null,
      address: r.address || '',
      is_favorite: false,
      created_at: '',
      updated_at: '',
      created_by: null,
    })) as any

    const totalSupplyV = cleanedItems.reduce((s, it) => s + (Number(it.supply_amount) || 0), 0)
    const totalTaxV = cleanedItems.reduce((s, it) => s + (Number(it.tax_amount) || 0), 0)
    const now = new Date().toISOString()

    const transient: DeliveryOrder = {
      id: 'preview',
      document_number: formatAcceptanceDocNumber(1),
      issued_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
      sequence: 1,
      supplier_employee_id: supplierEmployeeId,
      supplier_address_id: null,
      recipient_address_ids: selRecipients.map((r: any) => r.id),
      shipping_date: shippingDate || null,
      receiving_date: receivingDate || null,
      receiver_name: receiverName || null,
      note: note || null,
      total_supply_amount: totalSupplyV,
      total_tax_amount: totalTaxV,
      total_amount: totalSupplyV + totalTaxV,
      created_at: now,
      updated_at: now,
      supplier_employee: selEmp
        ? { id: selEmp.id, name: selEmp.name, phone: selEmp.phone, email: selEmp.email }
        : null,
      recipients: selRecipients,
      items: cleanedItems.map((it, i) => ({
        line_number: i + 1,
        item_name: it.item_name,
        specification: it.specification ?? null,
        quantity: it.quantity ?? null,
        unit: it.unit ?? null,
        unit_price: it.unit_price ?? null,
        supply_amount: Number(it.supply_amount) || 0,
        tax_amount: Number(it.tax_amount) || 0,
        remark: it.remark ?? null,
      })),
    }
    setAutoPrintPending(false)
    setPrintTarget(transient)
  }

  // ---- 발행 + 인쇄: DB 저장 + 자동 인쇄 ----
  const handleSubmit = async () => {
    const { ok, cleanedRecipients, cleanedItems, error } = validateForm()
    if (!ok) {
      toast.error(error ?? '입력 내용을 확인해주세요')
      return
    }

    setSaving(true)

    // 1) 인수자 주소록 저장/수정 → 최종 id 목록 수집
    //   - id 있음(드롭다운 선택): 해당 레코드 UPDATE
    //   - id 없음(수동 입력): (상호+담당자) 키로 upsert
    //     · 동일 상호+담당자 존재 → UPDATE (전화/메일 등 변경사항 반영)
    //     · 상호만 같고 담당자 다름 → 신규 INSERT (담당자 추가)
    //     · 없음 → 신규 INSERT
    // 스마트 upsert: (회사+담당자+주소) 일치 시 직함/전화/비고만 update, 달라지면 신규 추가
    const resolvedIds: string[] = []
    for (const r of cleanedRecipients) {
      const formPayload = {
        company_name: r.company_name.trim(),
        contact_name_only: r.contact_name_only.trim(),
        contact_title: r.contact_title.trim(),
        contact_memo: r.contact_memo.trim(),
        phone: r.phone.trim(),
        mobile: r.mobile.trim(),
        email: r.email.trim(),
        address: r.address.trim(),
      }
      const up = await shippingService.upsertAddressByCompanyAndContact(
        formPayload,
        employee?.id
      )
      if (!up.success || !up.data) {
        setSaving(false)
        toast.error(`주소록 저장 실패: ${up.error}`)
        return
      }
      resolvedIds.push(up.data.id)
    }

    // 생성된 주소록을 state 에도 반영 (메모리 동기화)
    const addrRefresh = await shippingService.getAddresses()
    if (addrRefresh.success && addrRefresh.data) setAddresses(addrRefresh.data)

    const formData: DeliveryOrderFormData = {
      supplier_employee_id: supplierEmployeeId,
      supplier_address_id: null,
      recipient_address_ids: resolvedIds,
      shipping_date: shippingDate || null,
      receiving_date: receivingDate || null,
      receiver_name: receiverName || null,
      note: note || null,
      items: cleanedItems.map((it, i) => ({
        ...it,
        line_number: i + 1,
        supply_amount: Number(it.supply_amount) || 0,
        tax_amount: Number(it.tax_amount) || 0,
      })),
    }
    const res = await deliveryOrderService.create(formData, employee?.id)
    setSaving(false)

    if (!res.success || !res.data) {
      toast.error(`발행 실패: ${res.error}`)
      return
    }
    toast.success(`발행 완료: ${res.data.document_number}`)
    // 이력 갱신
    setHistory((prev) => [res.data!, ...prev])
    // 폼 초기화
    resetForm()
    // 미리보기 렌더 + 자동 인쇄
    setAutoPrintPending(true)
    setPrintTarget(res.data)
  }

  const resetForm = () => {
    setSupplierEmployeeId(employee?.id ?? '')
    setRecipients([emptyRecipient()])
    setShippingDate('')
    setReceivingDate('')
    setReceiverName('')
    setNote('')
    setItems([emptyItem(1)])
    // 인수자 주소록 검색/드롭다운 상태도 함께 초기화
    setRecipientSearches({})
    setOpenDropdownIdx(null)
    setPreviewError(null)
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 인수증을 삭제하시겠습니까?')) return
    const res = await deliveryOrderService.remove(id)
    if (!res.success) {
      toast.error(`삭제 실패: ${res.error}`)
      return
    }
    toast.success('삭제되었습니다')
    setHistory((prev) => prev.filter((h) => h.id !== id))
  }

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return history
    return history.filter((h) => {
      const docMatch = h.document_number.toLowerCase().includes(q)
      const supName = (h.supplier_employee?.name ?? h.supplier_address?.company_name ?? '').toLowerCase()
      const recNames = (h.recipients ?? []).map((r) => r?.company_name ?? '').join(' ').toLowerCase()
      const receiver = (h.receiver_name ?? '').toLowerCase()
      return docMatch || supName.includes(q) || recNames.includes(q) || receiver.includes(q)
    })
  }, [history, historySearch])

  // ---- 인쇄용 인수증 데이터 변환 ----
  const buildPrintProps = (order: DeliveryOrder) => {
    // 인도자: 담당자 employees.phone 이 010 이면 H.P, 아니면 TEL 보조
    const empPhone = order.supplier_employee?.phone ?? ''
    const empIsMobile = classifyPhone(empPhone) === 'mobile'
    const supplier: AcceptanceParty = order.supplier_address
      ? (() => {
          const { tel, mobile } = splitPhones(order.supplier_address.phone, order.supplier_address.mobile)
          const supAddr = order.supplier_address
          const supName = supAddr.contact_name_only ?? supAddr.contact_name ?? ''
          const supTitle = supAddr.contact_title ?? ''
          return {
            company_name: supAddr.company_name,
            representative: supName ? (supTitle ? `${supName} ${supTitle}님` : `${supName}님`) : '',
            phone: tel,
            mobile,
            email: supAddr.email ?? '',
          }
        })()
      : {
          company_name: '(주)한슬',
          representative: order.supplier_employee?.name ?? '',
          phone: '053-626-7805',
          mobile: empIsMobile ? empPhone : '',
          email: order.supplier_employee?.email ?? '',
        }
    const recipients: AcceptanceParty[] = (order.recipients ?? []).map((r) => {
      const { tel, mobile } = splitPhones(r.phone, r.mobile)
      const recName = (r as any).contact_name_only ?? r.contact_name ?? ''
      const recTitle = (r as any).contact_title ?? ''
      return {
        company_name: r.company_name,
        representative: recName ? (recTitle ? `${recName} ${recTitle}님` : `${recName}님`) : '',
        phone: tel,
        mobile,
        email: r.email ?? '',
      }
    })
    return {
      document_number: order.document_number,
      shipping_date: order.shipping_date ?? undefined,
      receiving_date: order.receiving_date ?? undefined,
      receiver_name: order.receiver_name ?? undefined,
      supplier,
      recipients,
      items: (order.items ?? []).map((it) => ({
        line_number: it.line_number,
        item_name: it.item_name,
        specification: it.specification ?? '',
        quantity: Number(it.quantity) || 0,
        unit: it.unit ?? '',
        unit_price: Number(it.unit_price) || 0,
        supply_amount: Number(it.supply_amount) || 0,
        tax_amount: Number(it.tax_amount) || 0,
        remark: it.remark ?? '',
      })),
      note: order.note ?? undefined,
    }
  }

  // ---- 렌더 ----
  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="print:hidden">
        <h1 className="page-title text-gray-900">제품 인수증</h1>
        <p className="page-subtitle" style={{ marginTop: '-2px', marginBottom: '-4px' }}>
          Delivery Order
        </p>
      </div>

      {/* 상단 3열: 인도자 | 인수자 | 입/출고 정보 */}
      <div className="print:hidden grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)] gap-3 max-w-[1300px]">
        {/* 카드 1: 인도자 (한슬 고정, 담당자 선택 시 인쇄 뷰와 동일한 필드 표시) */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center h-7 mb-2">
            <h2 className="modal-section-title">인도자</h2>
          </div>
          {(() => {
            const selectedEmp = employees.find((e) => e.id === supplierEmployeeId)
            // 담당자의 employees.phone 이 010 계열이면 H.P 로, 아니면 TEL 로 분류
            // TEL 은 기본 회사 전화 053-626-7805 로 고정
            const empPhoneIsMobile = classifyPhone(selectedEmp?.phone) === 'mobile'
            const hpValue = empPhoneIsMobile ? selectedEmp?.phone ?? '' : ''
            return (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">상호</Label>
                    <Input className="h-7" value="(주)한슬" disabled />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">담당자</Label>
                    <Select value={supplierEmployeeId} onValueChange={setSupplierEmployeeId}>
                      <SelectTrigger className="!h-7 !min-h-0 !px-2.5 !py-0 !text-[11px]">
                        <SelectValue placeholder="담당자 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id} className="text-[11px] py-1.5">
                            {e.name ?? '(이름없음)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">TEL</Label>
                    <Input className="h-7" value="053-626-7805" disabled />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">H.P</Label>
                    <Input className="h-7" value={hpValue} disabled />
                  </div>
                </div>
                <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                  <Label className="text-[11px] !font-normal text-gray-500">E-mail</Label>
                  <Input
                    className="h-7"
                    value={selectedEmp?.email ?? ''}
                    disabled
                  />
                </div>
              </div>
            )
          })()}
        </div>

        {/* 카드 2: 인수자 (택배 패턴과 동일한 검색+드롭다운) */}
        <div className="bg-white rounded-lg border p-4">
          {/* 상단 행: 라벨 · 검색 · +추가 */}
          <div
            ref={(el) => {
              if (el) recipientDropdownRefs.current.set(0, el)
              else recipientDropdownRefs.current.delete(0)
            }}
            className="relative grid grid-cols-[50px_minmax(0,1fr)_auto] items-center gap-2 mb-2"
          >
            <h2 className="modal-section-title whitespace-nowrap">인수자</h2>
            <div className="relative flex gap-1.5 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  value={recipientSearches[0] || ''}
                  onChange={(e) => {
                    setRecipientSearches((prev) => ({ ...prev, 0: e.target.value }))
                    setOpenDropdownIdx(0)
                  }}
                  onFocus={() => setOpenDropdownIdx(0)}
                  placeholder="주소록 검색..."
                  className="pl-7"
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                  name={`search-${autofillSalt}-0`}
                  data-lpignore="true"
                  data-form-type="other"
                  data-1p-ignore=""
                />
              </div>
              {recipients[0]?.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={() => handleClearRecipient(0)}
                >
                  초기화
                </Button>
              )}
              {openDropdownIdx === 0 && filteredAddressesForIdx(0).length > 0 && (
                <div className="absolute top-full left-0 z-20 mt-1 w-max min-w-full max-w-[400px] bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                  {filteredAddressesForIdx(0).map((addr) => (
                    <button
                      type="button"
                      key={addr.id}
                      onClick={() => handleSelectAddressForRecipient(0, addr.id)}
                      className={cn(
                        'w-full text-left px-3 py-1.5 hover:bg-gray-50 text-[11px] border-b last:border-b-0',
                        addr.id === recipients[0]?.id && 'bg-primary/5'
                      )}
                    >
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        {addr.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />}
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
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] px-2 shrink-0"
              onClick={addRecipient}
            >
              <Plus className="w-3 h-3 mr-0.5" /> 추가
            </Button>
          </div>
          {/* 첫 번째 인수자 (편집 가능) */}
          {(() => {
            const r = recipients[0] ?? emptyRecipient()
            return (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">
                      상호 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      className="h-7"
                      value={r.company_name}
                      onChange={(e) => updateRecipientField(0, 'company_name', e.target.value)}
                      placeholder="예: (주)수요처"
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">
                      담당자 <span className="text-red-500">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="relative">
                        <Input
                          className={cn("h-7", hasHonorificSuffix(r.contact_name_only) && "border-red-400 focus:border-red-500")}
                          value={r.contact_name_only}
                          onChange={(e) => updateRecipientField(0, 'contact_name_only', e.target.value)}
                          placeholder="이름"
                        />
                        {hasHonorificSuffix(r.contact_name_only) && (
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
                                    현재 상태로 인쇄 시 <b>'{r.contact_name_only}님'</b>으로 표기됩니다.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          className={cn("h-7", hasHonorificSuffix(r.contact_title) && "border-red-400 focus:border-red-500")}
                          value={r.contact_title}
                          onChange={(e) => updateRecipientField(0, 'contact_title', e.target.value)}
                          placeholder="직함"
                        />
                        {hasHonorificSuffix(r.contact_title) && (
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
                                    현재 상태로 인쇄 시 <b>'{r.contact_title}님'</b>으로 표기됩니다.
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
                    <Label className="text-[11px] !font-normal text-gray-500">TEL</Label>
                    <Input
                      className="h-7"
                      value={r.phone}
                      onChange={(e) => updateRecipientField(0, 'phone', e.target.value)}
                      placeholder="02-1234-5678"
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">H.P</Label>
                    <Input
                      className="h-7"
                      value={r.mobile}
                      onChange={(e) => updateRecipientField(0, 'mobile', e.target.value)}
                      placeholder="010-1234-5678"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">E-mail</Label>
                    <Input
                      className="h-7"
                      value={r.email}
                      onChange={(e) => updateRecipientField(0, 'email', e.target.value)}
                      placeholder="name@company.com"
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">비고</Label>
                    <Input
                      className="h-7"
                      value={r.contact_memo}
                      onChange={(e) => updateRecipientField(0, 'contact_memo', e.target.value)}
                      placeholder="소속/메모 (선택)"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                  <Label className="text-[11px] !font-normal text-gray-500">주소</Label>
                  <Input
                    className="h-7"
                    value={r.address}
                    onChange={(e) => updateRecipientField(0, 'address', e.target.value)}
                    placeholder="주소 (주소 변경 시 새 레코드로 저장됨)"
                  />
                </div>
              </div>
            )
          })()}
          {/* 추가 인수자 (idx >= 1) */}
          {recipients.slice(1).map((r, i) => {
            const idx = i + 1
            return (
              <div key={idx} className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                <div
                  ref={(el) => {
                    if (el) recipientDropdownRefs.current.set(idx, el)
                    else recipientDropdownRefs.current.delete(idx)
                  }}
                  className="relative grid grid-cols-[50px_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <Label className="text-[11px] !font-normal text-gray-500">#{idx + 1}</Label>
                  <div className="relative flex gap-1.5 min-w-0">
                    <div className="relative flex-1 min-w-0">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <Input
                        value={recipientSearches[idx] || ''}
                        onChange={(e) => {
                          setRecipientSearches((prev) => ({ ...prev, [idx]: e.target.value }))
                          setOpenDropdownIdx(idx)
                        }}
                        onFocus={() => setOpenDropdownIdx(idx)}
                        placeholder="주소록 검색..."
                        className="pl-7"
                        autoComplete="new-password"
                        autoCorrect="off"
                        spellCheck={false}
                        name={`search-${autofillSalt}-${idx}`}
                        data-lpignore="true"
                        data-form-type="other"
                        data-1p-ignore=""
                      />
                    </div>
                    {r.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2"
                        onClick={() => handleClearRecipient(idx)}
                      >
                        초기화
                      </Button>
                    )}
                    {openDropdownIdx === idx && filteredAddressesForIdx(idx).length > 0 && (
                      <div className="absolute top-full left-0 z-20 mt-1 w-max min-w-full max-w-[400px] bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                        {filteredAddressesForIdx(idx).map((addr) => (
                          <button
                            type="button"
                            key={addr.id}
                            onClick={() => handleSelectAddressForRecipient(idx, addr.id)}
                            className={cn(
                              'w-full text-left px-3 py-1.5 hover:bg-gray-50 text-[11px] border-b last:border-b-0',
                              addr.id === r.id && 'bg-primary/5'
                            )}
                          >
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              {addr.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />}
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
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeRecipient(idx)}
                    title="삭제"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">
                      상호 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      className="h-7"
                      value={r.company_name}
                      onChange={(e) => updateRecipientField(idx, 'company_name', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">
                      담당자 <span className="text-red-500">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="relative">
                        <Input
                          className={cn("h-7", hasHonorificSuffix(r.contact_name_only) && "border-red-400 focus:border-red-500")}
                          value={r.contact_name_only}
                          onChange={(e) => updateRecipientField(idx, 'contact_name_only', e.target.value)}
                          placeholder="이름"
                        />
                        {hasHonorificSuffix(r.contact_name_only) && (
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
                                    현재 상태로 인쇄 시 <b>'{r.contact_name_only}님'</b>으로 표기됩니다.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          className={cn("h-7", hasHonorificSuffix(r.contact_title) && "border-red-400 focus:border-red-500")}
                          value={r.contact_title}
                          onChange={(e) => updateRecipientField(idx, 'contact_title', e.target.value)}
                          placeholder="직함"
                        />
                        {hasHonorificSuffix(r.contact_title) && (
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
                                    현재 상태로 인쇄 시 <b>'{r.contact_title}님'</b>으로 표기됩니다.
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
                    <Label className="text-[11px] !font-normal text-gray-500">TEL</Label>
                    <Input
                      className="h-7"
                      value={r.phone}
                      onChange={(e) => updateRecipientField(idx, 'phone', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">H.P</Label>
                    <Input
                      className="h-7"
                      value={r.mobile}
                      onChange={(e) => updateRecipientField(idx, 'mobile', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">E-mail</Label>
                    <Input
                      className="h-7"
                      value={r.email}
                      onChange={(e) => updateRecipientField(idx, 'email', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                    <Label className="text-[11px] !font-normal text-gray-500">비고</Label>
                    <Input
                      className="h-7"
                      value={r.contact_memo}
                      onChange={(e) => updateRecipientField(idx, 'contact_memo', e.target.value)}
                      placeholder="소속/메모 (선택)"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[50px_1fr] items-center gap-2">
                  <Label className="text-[11px] !font-normal text-gray-500">주소</Label>
                  <Input
                    className="h-7"
                    value={r.address}
                    onChange={(e) => updateRecipientField(idx, 'address', e.target.value)}
                    placeholder="주소"
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* 카드 3: 입/출고 정보 (인수자 우측, 2×2 배치) */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center h-7 mb-2">
            <h2 className="modal-section-title">입/출고 정보</h2>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[72px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500 whitespace-nowrap">출고일자</Label>
                <DatePickerPopover
                  onDateSelect={(d) => setShippingDate(format(d, 'yyyy-MM-dd'))}
                  placeholder="출고일 선택"
                  align="start"
                >
                  <div className="h-7 w-full bg-white border border-gray-300 rounded-professional text-[11px] hover:border-gray-400 transition-colors flex items-center justify-between px-2.5 cursor-pointer">
                    <span className={shippingDate ? 'text-gray-800' : 'text-gray-400'}>
                      {shippingDate || '연도.월.일'}
                    </span>
                    <CalendarIcon className="w-3 h-3 text-gray-400" />
                  </div>
                </DatePickerPopover>
              </div>
              <div className="grid grid-cols-[72px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500 whitespace-nowrap">입고일자</Label>
                <DatePickerPopover
                  onDateSelect={(d) => setReceivingDate(format(d, 'yyyy-MM-dd'))}
                  placeholder="입고일 선택"
                  align="start"
                >
                  <div className="h-7 w-full bg-white border border-gray-300 rounded-professional text-[11px] hover:border-gray-400 transition-colors flex items-center justify-between px-2.5 cursor-pointer">
                    <span className={receivingDate ? 'text-gray-800' : 'text-gray-400'}>
                      {receivingDate || '연도.월.일'}
                    </span>
                    <CalendarIcon className="w-3 h-3 text-gray-400" />
                  </div>
                </DatePickerPopover>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-[72px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500 whitespace-nowrap">
                  인수 담당자
                </Label>
                <Input
                  className="h-7"
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  placeholder="예: 박담당"
                />
              </div>
              <div className="grid grid-cols-[72px_1fr] items-center gap-2">
                <Label className="text-[11px] !font-normal text-gray-500 whitespace-nowrap">비고</Label>
                <Input
                  className="h-7"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="선택"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 품목 내역 카드 */}
      <div className="print:hidden bg-white rounded-lg border p-4 max-w-[1300px]">
        <div className="flex items-center justify-between h-7 mb-3">
          <div className="flex items-baseline gap-4">
            <h2 className="modal-section-title">품목 내역</h2>
            <span className="text-[10px] text-gray-400">
              * 문서번호는 발행 시 자동 생성됩니다 (DO + 한국 날짜 + 순번)
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={addItem}>
            <Plus className="w-3.5 h-3.5 mr-1" /> 행 추가
          </Button>
        </div>
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 w-10">No.</th>
                <th className="px-2 py-1 text-left">품명 <span className="text-red-500">*</span></th>
                <th className="px-2 py-1 text-left">규격</th>
                <th className="px-2 py-1 w-16">수량</th>
                <th className="px-2 py-1 w-14">단위</th>
                {/* 단가/공급가액/세액: 당분간 숨김 (필요 시 복원) */}
                <th className="px-2 py-1 text-left">비고</th>
                <th className="px-2 py-1 w-10"></th>
              </tr>
            </thead>
            <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-gray-200">
                    <td className="px-2 py-1 text-center">{it.line_number}</td>
                    <td className="px-1">
                      <Input
                        value={it.item_name}
                        onChange={(e) => updateItem(idx, { item_name: e.target.value })}
                        placeholder="품명"
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        value={it.specification ?? ''}
                        onChange={(e) => updateItem(idx, { specification: e.target.value })}
                        placeholder="규격"
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        type="number"
                        value={it.quantity ?? ''}
                        onChange={(e) => updateItem(idx, { quantity: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        value={it.unit ?? ''}
                        onChange={(e) => updateItem(idx, { unit: e.target.value })}
                        placeholder="EA"
                      />
                    </td>
                    {/* 단가/공급가액/세액: 당분간 숨김 (필요 시 복원) */}
                    <td className="px-1">
                      <Input
                        value={it.remark ?? ''}
                        onChange={(e) => updateItem(idx, { remark: e.target.value })}
                      />
                    </td>
                    <td className="px-1 text-center">
                      {items.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeItem(idx)}
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4 text-gray-400" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* 합계 footer: 단가/공급가액/세액 숨김 상태에서는 비활성 */}
            </table>
          </div>
        </div>

      {/* 액션 버튼 (택배 탭 스타일) */}
      <div className="print:hidden flex justify-end items-center gap-2 max-w-[1300px]">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] px-2"
          onClick={resetForm}
          disabled={saving}
        >
          초기화
        </Button>
        <div className="relative">
          <button
            onClick={handlePreview}
            disabled={saving}
            className="flex items-center gap-1 h-7 px-3 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            미리보기
          </button>
          {previewError && (
            <div className="absolute right-0 top-full mt-2 z-30 animate-in fade-in slide-in-from-top-1">
              <div className="absolute -top-[5px] right-4 w-2.5 h-2.5 rotate-45 bg-amber-50 border-l border-t border-amber-400" />
              <div className="relative border border-amber-400 bg-amber-50 px-3 py-2 shadow-md whitespace-nowrap">
                <div className="flex items-start gap-1.5">
                  <span className="text-amber-600 text-[11px] leading-tight">⚠️</span>
                  <p className="text-[11px] text-amber-700 leading-tight font-medium">
                    {previewError}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-1 h-7 px-3 rounded-md bg-[#1777CB] hover:bg-[#1265b0] disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-[11px] font-medium transition-colors"
        >
          <Printer className="w-3.5 h-3.5" />
          {saving ? '저장 중...' : '발행 + 인쇄'}
        </button>
      </div>

      {/* 이력 섹션 */}
      <section className="print:hidden bg-white border border-gray-200 rounded-lg p-4 max-w-[1300px]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">발행 이력</h2>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              className="pl-8 h-8 w-64"
              placeholder="문서번호 / 회사명 / 담당자 검색"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">문서번호</th>
                <th className="px-2 py-1.5 text-left">발행일</th>
                <th className="px-2 py-1.5 text-left">인도자</th>
                <th className="px-2 py-1.5 text-left">인수자</th>
                <th className="px-2 py-1.5 text-left">인수 담당자</th>
                <th className="px-2 py-1.5 text-right">총액</th>
                <th className="px-2 py-1.5 text-center w-40">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-gray-400">
                    불러오는 중...
                  </td>
                </tr>
              ) : filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-gray-400">
                    발행 이력이 없습니다
                  </td>
                </tr>
              ) : (
                filteredHistory.map((h) => (
                  <tr key={h.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-mono">{h.document_number}</td>
                    <td className="px-2 py-1.5">{h.issued_date}</td>
                    <td className="px-2 py-1.5">
                      {h.supplier_address?.company_name ?? h.supplier_employee?.name ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      {(h.recipients ?? []).map((r) => r?.company_name).filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-2 py-1.5">{h.receiver_name ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right">
                      ₩ {Number(h.total_amount || 0).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPrintTarget(h)}
                      >
                        <Printer className="w-3.5 h-3.5 mr-1" /> 인쇄
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(h.id)}
                        className="ml-1 text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 인쇄 미리보기 — 별도 창으로 렌더 (미리보기 세션마다 remount) */}
      {printTarget && (
        <NewWindow
          key={`${printTarget.id}-${previewSession}`}
          title={`제품 인수증 · ${printTarget.document_number}`}
          features="width=1000,height=1100"
          onClose={() => {
            previewWinRef.current = null
            setPrintTarget(null)
          }}
          onReady={(w) => {
            previewWinRef.current = w
            if (autoPrintPending) {
              setTimeout(() => {
                try { w.print() } catch {}
                setAutoPrintPending(false)
              }, 500)
            }
          }}
        >
          <div className="min-h-screen bg-gray-200 p-6">
            {/* 미리보기 상단 컨트롤 (print 에서는 숨김) */}
            <div className="print:hidden flex items-center justify-between mb-3 max-w-[1300px] mx-auto">
              <div className="text-[11px] text-gray-500">
                📄 미리보기 · <span className="font-mono">{printTarget.document_number}</span>
                {printTarget.id === 'preview' && <span className="ml-2 text-amber-600">(미저장)</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={() => {
                    previewWinRef.current?.close()
                    setPrintTarget(null)
                  }}
                >
                  닫기
                </Button>
                <button
                  onClick={() => previewWinRef.current?.print()}
                  className="flex items-center gap-1 h-7 px-3 rounded-md bg-[#1777CB] hover:bg-[#1265b0] text-white text-[11px] font-medium transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" /> 인쇄 / PDF 저장
                </button>
              </div>
            </div>
            <ProductAcceptanceCertificate {...buildPrintProps(printTarget)} />
          </div>
        </NewWindow>
      )}
    </div>
  )
}
