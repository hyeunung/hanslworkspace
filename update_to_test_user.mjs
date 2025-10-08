import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('F20250921_001의 요청자를 Test User로 변경 중...\n')

const { data, error } = await supabase
  .from('purchase_requests')
  .update({ requester_name: 'Test User' })
  .eq('purchase_order_number', 'F20250921_001')
  .select()
  .single()

if (error) {
  console.error('❌ 업데이트 실패:', error)
} else {
  console.log('✅ 변경 완료\!')
  console.log('- 발주번호:', data.purchase_order_number)
  console.log('- 변경된 요청자:', data.requester_name)
  console.log('- 입고상태: 대기')
  console.log('- 진행타입:', data.progress_type, '(승인 관계없이 입고대기 표시)')
  console.log('\n이제 대시보드에서 입고대기 항목이 표시됩니다\!')
}

// F20250918_002도 변경
const { data: data2 } = await supabase
  .from('purchase_requests')
  .update({ requester_name: 'Test User' })
  .eq('purchase_order_number', 'F20250918_002')
  .select()
  .single()

if (data2) {
  console.log('\n✅ F20250918_002도 변경 완료\!')
  console.log('- 발주번호:', data2.purchase_order_number)
  console.log('- 변경된 요청자:', data2.requester_name)
}

process.exit(0)
