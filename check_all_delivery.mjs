import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('=== 전체 입고대기 항목 확인 ===\n')

// 모든 입고 미완료 항목 조회
const { data: notReceivedItems } = await supabase
  .from('purchase_requests')
  .select('*')
  .eq('is_received', false)
  .order('created_at', { ascending: false })
  .limit(10)

console.log('입고 미완료 항목 총', notReceivedItems?.length || 0, '건\n')

if (notReceivedItems && notReceivedItems.length > 0) {
  console.log('상위 10개 항목:')
  notReceivedItems.forEach((item, idx) => {
    console.log(`\n${idx + 1}. 발주번호: ${item.purchase_order_number}`)
    console.log('   요청자:', item.requester_name)
    console.log('   업체:', item.vendor_name)
    console.log('   요청일:', item.request_date)
    console.log('   최종승인:', item.final_manager_status || 'pending')
    console.log('   진행타입:', item.progress_type || '일반')
    console.log('   결제완료:', item.is_payment_completed ? '✅' : '❌')
  })

  // 요청자별 통계
  const byRequester = {}
  notReceivedItems.forEach(item => {
    const name = item.requester_name || 'Unknown'
    byRequester[name] = (byRequester[name] || 0) + 1
  })

  console.log('\n\n요청자별 입고대기 항목 수:')
  Object.entries(byRequester).forEach(([name, count]) => {
    console.log(`  - ${name}: ${count}건`)
  })
}

process.exit(0)