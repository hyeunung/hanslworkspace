import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('=== F20250921_001, F20250918_002 항목 확인 ===\n')

// 특정 발주번호 조회
const { data: orders } = await supabase
  .from('purchase_requests')
  .select('*')
  .in('purchase_order_number', ['F20250921_001', 'F20250918_002'])

if (orders) {
  orders.forEach(order => {
    console.log(`발주번호: ${order.purchase_order_number}`)
    console.log('- 요청자:', order.requester_name)
    console.log('- 업체:', order.vendor_name)
    console.log('- 입고여부:', order.is_received ? '완료' : '대기')
    console.log('- 진행타입:', order.progress_type)
    console.log('- 최종승인:', order.final_manager_status)
    console.log('- 결제완료:', order.is_payment_completed ? '✅' : '❌')
    console.log('')
  })
}

// test@hansl.com 사용자 데이터 확인
console.log('\n=== Test User 권한으로 보이는 항목 확인 ===\n')

const { data: employee } = await supabase
  .from('employees')
  .select('*')
  .eq('email', 'test@hansl.com')
  .single()

if (employee) {
  const requesterName = employee.name || employee.email
  console.log('검색할 이름:', requesterName)
  
  // Test User 이름으로 요청한 항목 찾기
  const { data: myRequests } = await supabase
    .from('purchase_requests')
    .select('purchase_order_number, requester_name, is_received, final_manager_status, progress_type')
    .eq('requester_name', requesterName)
  
  const count = myRequests ? myRequests.length : 0
  console.log(`\n${requesterName}로 요청한 항목: ${count}건`)
  
  console.log('\n💡 문제 원인:')
  console.log('F20250921_001은 "황연순"이 요청자입니다.')
  console.log('F20250918_002는 존재하지 않거나 다른 사용자가 요청자입니다.')
  console.log('\n대시보드의 "입고 대기"는 로그인한 사용자(Test User)가 요청한 항목만 표시합니다.')
  console.log('다른 사용자가 요청한 항목은 표시되지 않습니다.')
}

process.exit(0)