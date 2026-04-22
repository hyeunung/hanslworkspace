import ProductAcceptanceCertificate from '@/components/receipts/ProductAcceptanceCertificate'

/**
 * 인수증 프리뷰 페이지 (디자인 확인용)
 * 공개 라우트: /preview/acceptance
 */
export default function ProductAcceptanceCertificatePreview() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#e5e7eb',
        padding: '24px 0',
        overflowX: 'auto',
      }}
    >
      {/* 인쇄 버튼 (print에서는 숨김) */}
      <div
        className="print:hidden"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 50,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={() => window.print()}
          style={{
            padding: '8px 16px',
            background: '#111827',
            color: '#fff',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            border: 'none',
          }}
        >
          🖨 인쇄 / PDF 저장
        </button>
      </div>

      <ProductAcceptanceCertificate
        shipping_date="2026-04-18"
        receiving_date="2026-04-20"
        receiver_name="박담당"
        supplier={{
          company_name: '(주)한슬',
          representative: '홍길동',
          phone: '053-626-7805',
          mobile: '010-1111-2222',
          email: 'sales@hansl.com',
        }}
        recipients={[
          {
            company_name: '(주)수요처',
            representative: '김영수',
            phone: '031-987-6543',
            mobile: '010-3333-4444',
            email: 'buyer@customer.com',
          },
          {
            company_name: '(주)제2수요처',
            representative: '이철수',
            phone: '02-555-1212',
            mobile: '010-5555-6666',
            email: 'lee@second.com',
          },
        ]}
        items={[
          {
            line_number: 1,
            item_name: '볼트 M10 x 50',
            specification: 'SUS304',
            quantity: 100,
            unit: 'EA',
            unit_price: 500,
            supply_amount: 50000,
            tax_amount: 5000,
            remark: '',
          },
          {
            line_number: 2,
            item_name: '너트 M10',
            specification: 'SUS304',
            quantity: 100,
            unit: 'EA',
            unit_price: 300,
            supply_amount: 30000,
            tax_amount: 3000,
            remark: '',
          },
          {
            line_number: 3,
            item_name: '와셔 M10',
            specification: 'SUS304 (평와셔)',
            quantity: 200,
            unit: 'EA',
            unit_price: 100,
            supply_amount: 20000,
            tax_amount: 2000,
            remark: '샘플 포함',
          },
        ]}
        note="상기 품목에 이상 없음을 확인하며, 검수 기준에 부합함."
      />
    </div>
  )
}
