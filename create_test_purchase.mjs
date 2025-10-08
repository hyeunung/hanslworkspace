import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('test@hansl.com 사용자를 위한 테스트 발주 요청 생성 중...\n')

// 오늘 날짜 기준으로 발주번호 생성
const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
const purchaseOrderNumber = `F${today}_TEST01`

// 테스트 발주 요청 데이터
const testPurchase = {
  purchase_order_number: purchaseOrderNumber,
  requester_name: 'Test User',  // test@hansl.com의 이름
  request_date: new Date().toISOString().split('T')[0],
  delivery_request_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7일 후
  vendor_name: '테스트 업체',
  payment_category: '구매요청',
  progress_type: '선진행',  // 선진행으로 설정하여 승인 없이도 입고대기 표시
  middle_manager_status: 'pending',
  final_manager_status: 'pending',
  is_payment_completed: false,
  is_received: false,  // 입고 미완료
  total_amount: 1500000,
  currency: 'KRW',
  project_vendor: '테스트 프로젝트',
  project_item: '테스트 품목'
}

// 발주 요청 생성
const { data: purchase, error } = await supabase
  .from('purchase_requests')
  .insert(testPurchase)
  .select()
  .single()

if (error) {
  console.error('❌ 발주 요청 생성 실패:', error)
} else {
  console.log('✅ 테스트 발주 요청 생성 완료!')
  console.log('- 발주번호:', purchase.purchase_order_number)
  console.log('- 요청자:', purchase.requester_name)
  console.log('- 진행타입:', purchase.progress_type)
  console.log('- 입고상태: 대기중')
  
  // 테스트 품목 추가
  const testItems = [
    {
      purchase_request_id: purchase.id,
      purchase_order_number: purchase.purchase_order_number,
      line_number: 1,
      item_name: '테스트 모니터',
      specification: '27인치 FHD',
      quantity: 2,
      unit_price_value: 300000,
      amount_value: 600000,
      is_received: false
    },
    {
      purchase_request_id: purchase.id,
      purchase_order_number: purchase.purchase_order_number,
      line_number: 2,
      item_name: '테스트 키보드',
      specification: '기계식',
      quantity: 5,
      unit_price_value: 100000,
      amount_value: 500000,
      is_received: false
    },
    {
      purchase_request_id: purchase.id,
      purchase_order_number: purchase.purchase_order_number,
      line_number: 3,
      item_name: '테스트 마우스',
      specification: '무선',
      quantity: 5,
      unit_price_value: 80000,
      amount_value: 400000,
      is_received: false
    }
  ]
  
  const { error: itemError } = await supabase
    .from('purchase_request_items')
    .insert(testItems)
  
  if (itemError) {
    console.error('❌ 품목 추가 실패:', itemError)
  } else {
    console.log('\n✅ 품목 3개 추가 완료!')
    console.log('\n이제 대시보드에서 "입고 대기" 항목이 표시됩니다.')
  }
}

// 추가로 승인 완료된 일반 항목도 하나 생성
const approvedPurchase = {
  purchase_order_number: `F${today}_TEST02`,
  requester_name: 'Test User',
  request_date: new Date().toISOString().split('T')[0],
  delivery_request_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  vendor_name: '승인된 업체',
  payment_category: '발주요청',
  progress_type: '일반',
  middle_manager_status: 'approved',
  final_manager_status: 'approved',  // 최종 승인 완료
  is_payment_completed: true,
  is_received: false,  // 입고 미완료
  total_amount: 2000000,
  currency: 'KRW'
}

const { data: purchase2, error: error2 } = await supabase
  .from('purchase_requests')
  .insert(approvedPurchase)
  .select()
  .single()

if (!error2) {
  console.log('\n✅ 승인 완료된 테스트 발주 요청도 생성!')
  console.log('- 발주번호:', purchase2.purchase_order_number)
  console.log('- 최종승인: 완료')
  console.log('- 입고상태: 대기중')
}

process.exit(0)