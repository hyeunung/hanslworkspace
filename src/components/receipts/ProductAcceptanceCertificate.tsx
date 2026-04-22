import React from 'react'

export interface AcceptanceParty {
  company_name?: string   // 상호
  representative?: string // 대표자
  phone?: string          // T (사무실 전화)
  mobile?: string         // H.P (휴대폰)
  email?: string          // 이메일
}

export interface AcceptanceItem {
  line_number: number
  item_name: string
  specification?: string
  quantity: number
  unit?: string
  unit_price?: number
  supply_amount?: number
  tax_amount?: number
  remark?: string
}

export interface ProductAcceptanceCertificateProps {
  document_number?: string
  shipping_date?: string              // 출고일자 'YYYY-MM-DD'
  receiving_date?: string             // 입고일자 'YYYY-MM-DD'
  receiver_name?: string              // 인수 담당자 성명
  supplier: AcceptanceParty           // 인도자 (물품을 보내는 쪽)
  recipients: AcceptanceParty[]       // 인수자 목록 (1명 또는 그 이상)
  items: AcceptanceItem[]
  note?: string
}

const formatNumber = (n?: number) =>
  typeof n === 'number' ? n.toLocaleString('ko-KR') : ''

/**
 * 인수증 문서번호 포맷터
 * 규칙: DO + YYYYMMDD(한국시간) + _ + 3자리 순번
 * 예) DO20260421_001
 */
export const formatAcceptanceDocNumber = (
  sequence: number = 1,
  date?: Date
): string => {
  const d = date ?? new Date()
  // KST 기준 YYYYMMDD
  const kstParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = kstParts.find((p) => p.type === 'year')?.value ?? ''
  const m = kstParts.find((p) => p.type === 'month')?.value ?? ''
  const dd = kstParts.find((p) => p.type === 'day')?.value ?? ''
  const seq = String(sequence).padStart(3, '0')
  return `DO${y}${m}${dd}_${seq}`
}

// 숫자 → 한글 금액 (간단 버전)
const toKoreanAmount = (num: number): string => {
  if (!num || num <= 0) return '영'
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const units = ['', '십', '백', '천']
  const bigUnits = ['', '만', '억', '조']
  const n = Math.floor(num).toString()
  let result = ''
  let group = 0
  for (let i = 0; i < n.length; i++) {
    const d = parseInt(n[n.length - 1 - i])
    const u = i % 4
    if (d > 0) result = digits[d] + units[u] + result
    if (u === 3 && group < bigUnits.length - 1) {
      group++
      result = bigUnits[group] + ' ' + result
    }
  }
  return result.replace(/\s+/g, ' ').trim()
}

export const ProductAcceptanceCertificate: React.FC<ProductAcceptanceCertificateProps> = ({
  document_number,
  shipping_date,
  receiving_date,
  receiver_name,
  supplier,
  recipients,
  items,
  note,
}) => {
  const totalSupply = items.reduce((s, it) => s + (it.supply_amount ?? 0), 0)
  const totalTax = items.reduce((s, it) => s + (it.tax_amount ?? 0), 0)
  const totalAmount = totalSupply + totalTax

  // 문서번호 미지정 시 자동 생성 (DO + KST YYYYMMDD + _ + 001)
  const resolvedDocumentNumber = document_number ?? formatAcceptanceDocNumber(1)

  return (
    <>
      {/* 인쇄 전용 스타일: A4 세로, 여백 0, 배경/다른 UI 숨김 */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body * { visibility: hidden !important; }
          .acceptance-print-root,
          .acceptance-print-root * { visibility: visible !important; }
          .acceptance-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
        }
      `}</style>
    <div className="acceptance-print-root bg-white text-gray-900 mx-auto print:shadow-none shadow-md"
         style={{ width: '210mm', minHeight: '297mm', padding: '14mm 12mm' }}>
      {/* 상단: 로고(좌) + 문서번호(우) */}
      <div className="flex items-center justify-between mb-2">
        <img
          src="/logo_eng.svg"
          alt="HANSL"
          style={{ height: '20px', width: 'auto' }}
          draggable={false}
        />
        <div className="text-xs text-gray-500">
          문서번호: <span className="font-medium text-gray-700">{resolvedDocumentNumber}</span>
        </div>
      </div>

      <h1 className="text-center font-bold tracking-[0.6em] text-3xl py-4 border-y-2 border-gray-900">
        제 품 인 수 증
      </h1>

      <p className="text-center text-[11px] text-gray-600 mt-3 mb-5">
        아래 품목을 정히 인수하였음을 확인합니다.
      </p>

      {/* 인도자 / 인수자 (1명 또는 다수) */}
      {(() => {
        const totalBlocks = 1 + recipients.length
        const multipleReceivers = recipients.length > 1
        return (
          <div
            className="grid gap-3 mb-4"
            style={{ gridTemplateColumns: `repeat(${totalBlocks}, minmax(0, 1fr))` }}
          >
            <PartyBlock
              title="인도자"
              data={supplier}
              extraRow={{ label: '출고일자', value: shipping_date ?? '' }}
            />
            {recipients.map((r, i) => (
              <PartyBlock
                key={i}
                title={multipleReceivers ? `인수자 ${i + 1}` : '인수자'}
                data={r}
                extraRow={{ label: '입고일자', value: receiving_date ?? '' }}
              />
            ))}
          </div>
        )
      })()}

      {/* 품목 테이블 (단가/공급가액/세액 당분간 숨김) */}
      <table className="w-full border-collapse text-[11px]" style={{ tableLayout: 'auto' }}>
        <thead>
          <tr className="bg-gray-100">
            <Th nowrap>No.</Th>
            <Th nowrap>품명</Th>
            <Th nowrap>규격</Th>
            <Th nowrap>수량</Th>
            <Th nowrap>단위</Th>
            <Th fill>비고</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.line_number} className="hover:bg-gray-50">
              <Td align="center" nowrap>{it.line_number}</Td>
              <Td nowrap>{it.item_name}</Td>
              <Td nowrap>{it.specification ?? ''}</Td>
              <Td align="right" nowrap>{formatNumber(it.quantity)}</Td>
              <Td align="center" nowrap>{it.unit ?? ''}</Td>
              <Td>{it.remark ?? ''}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 비고 */}
      {note && (
        <div className="mt-3 text-[11px] text-gray-700 border border-gray-300 p-2 rounded">
          <span className="font-semibold mr-2">비고</span>{note}
        </div>
      )}

      {/* 인수 담당자 서명란 — 비어있어도 서명선은 항상 표시 */}
      <div
        className="flex justify-end items-center gap-3 text-[12px] text-gray-800"
        style={{ marginTop: '20mm' }}
      >
        <span className="text-gray-600">인수 담당자 :</span>
        <span
          className="font-semibold inline-block text-center"
          style={{ minWidth: '140px', paddingBottom: '2px', borderBottom: '1px solid #374151' }}
        >
          {receiver_name || '\u00A0'}
        </span>
      </div>
    </div>
    </>
  )
}

/* ---------- sub components ---------- */

const Th: React.FC<React.PropsWithChildren<{ nowrap?: boolean; fill?: boolean }>> = ({
  children,
  nowrap,
  fill,
}) => (
  <th
    className="border border-gray-400 px-1.5 py-1.5 font-semibold text-center"
    style={{
      ...(nowrap ? { whiteSpace: 'nowrap' } : {}),
      ...(fill ? { width: '100%' } : {}),
    }}
  >
    {children}
  </th>
)

const Td: React.FC<
  React.PropsWithChildren<{
    align?: 'left' | 'right' | 'center'
    colSpan?: number
    nowrap?: boolean
  }>
> = ({ children, align = 'left', colSpan, nowrap }) => (
  <td
    colSpan={colSpan}
    className="border border-gray-300 px-1.5 py-1"
    style={{ textAlign: align, ...(nowrap ? { whiteSpace: 'nowrap' } : {}) }}
  >
    {children}
  </td>
)

const PartyBlock: React.FC<{
  title: string
  data: AcceptanceParty
  extraRow?: { label: string; value?: string }
}> = ({ title, data, extraRow }) => {
  return (
    <div className="border border-gray-400">
      <div className="bg-gray-50 border-b border-gray-400 px-3 py-1.5 font-bold tracking-widest text-sm">
        {title}
      </div>
      <table className="w-full text-[11px]">
        <tbody>
          <Row label="상호" value={data.company_name} />
          <Row label="담당자" value={data.representative} />
          <Row label="TEL" value={data.phone} />
          <Row label="H.P" value={data.mobile} />
          <Row label="E-mail" value={data.email} />
          {extraRow && <Row label={extraRow.label} value={extraRow.value} />}
        </tbody>
      </table>
    </div>
  )
}

const Row: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <tr>
    <th className="bg-gray-100 border border-gray-300 px-2 py-1 text-left font-medium w-20">
      {label}
    </th>
    <td className="border border-gray-300 px-2 py-1">{value ?? ''}</td>
  </tr>
)

export default ProductAcceptanceCertificate
