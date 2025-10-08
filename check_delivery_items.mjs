import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const userEmail = 'test@hansl.com'

// 사용자 정보 가져오기
const { data: employee } = await supabase
  .from('employees')
  .select('*')
  .eq('email', userEmail)
  .single()

if (!employee) {
  console.log('사용자를 찾을 수 없습니다')
  process.exit(1)
}

const requesterName = employee.name || employee.email

console.log('=== 입고대기 항목 확인 ===')
console.log('사용자:', requesterName, '(' + userEmail + ')')
console.log('')

// 사용자의 모든 요청 가져오기
const { data: allRequests } = await supabase
  .from('purchase_requests')
  .select('*')
  .eq('requester_name', requesterName)
  .order('created_at', { ascending: false })

console.log('전체 요청 개수:', allRequests?.length || 0)

if (allRequests) {
  // 입고대기 필터링 (dashboardService와 동일한 로직)
  const waitingDelivery = allRequests.filter(item => {
    const notReceived = !item.is_received
    const isSeonJin = (item.progress_type || '').includes('선진행')
    
    // 선진행은 승인 상태와 무관하게 입고 대기
    if (notReceived && isSeonJin) {
      return true
    }
    
    // 일반은 최종 승인 완료되어야 입고 대기
    const finalApproved = item.final_manager_status === 'approved'
    
    return notReceived && finalApproved
  })

  console.log('\n입고대기 항목:', waitingDelivery.length + '건')
  
  if (waitingDelivery.length > 0) {
    console.log('\n상세 내용:')
    waitingDelivery.forEach((item, idx) => {
      console.log(`\n${idx + 1}. 발주번호: ${item.purchase_order_number}`)
      console.log('   - 요청일:', item.request_date)
      console.log('   - 업체:', item.vendor_name)
      console.log('   - 입고여부:', item.is_received ? '완료' : '대기')
      console.log('   - 진행타입:', item.progress_type || '일반')
      console.log('   - 최종승인:', item.final_manager_status || 'pending')
      console.log('   - 결제완료:', item.is_payment_completed ? '완료' : '미완료')
    })
  }

  // 입고 완료된 항목도 확인
  const completed = allRequests.filter(item => item.is_received === true)
  console.log('\n입고 완료 항목:', completed.length + '건')
  
  // 승인 대기중인 항목 확인
  const pendingApproval = allRequests.filter(item => 
    item.final_manager_status !== 'approved' && !item.is_received
  )
  console.log('승인 대기중 항목:', pendingApproval.length + '건')
}

process.exit(0)