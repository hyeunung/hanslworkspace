import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n🔍 === 필터링 문제 분석 ===\n')

// 1. 전체 발주요청 수 확인
const { count: totalCount } = await supabase
  .from('purchase_requests')
  .select('id', { count: 'exact', head: true })
  
console.log(`📊 전체 발주요청 수: ${totalCount}건`)

// 2. 최근 3개월 이내 발주요청
const threeMonthsAgo = new Date()
threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

const { data: recentData, count: recentCount } = await supabase
  .from('purchase_requests')
  .select('*', { count: 'exact' })
  .gte('request_date', threeMonthsAgo.toISOString())
  
console.log(`📊 최근 3개월 발주요청: ${recentCount}건`)

// 3. 정현웅님의 발주요청 확인
const { data: jhwData, count: jhwCount } = await supabase
  .from('purchase_requests')
  .select('*', { count: 'exact' })
  .eq('requester_name', '정현웅')
  .gte('request_date', threeMonthsAgo.toISOString())
  
console.log(`\n👤 정현웅님의 최근 3개월 발주요청: ${jhwCount}건`)

// 4. 승인대기(pending) 상태 확인
const { data: pendingData } = await supabase
  .from('purchase_requests')
  .select('*')
  .eq('requester_name', '정현웅')
  .or('middle_manager_status.eq.pending,final_manager_status.eq.pending')
  .gte('request_date', threeMonthsAgo.toISOString())
  .order('created_at', { ascending: false })
  .limit(10)
  
console.log(`\n📋 정현웅님의 승인대기 발주요청:`)
if (pendingData && pendingData.length > 0) {
  pendingData.forEach((req, idx) => {
    console.log(`\n${idx + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   청구일: ${req.request_date}`)
    console.log(`   중간승인: ${req.middle_manager_status}`)
    console.log(`   최종승인: ${req.final_manager_status}`)
    console.log(`   생성시간: ${req.created_at}`)
  })
} else {
  console.log('   ❌ 승인대기 상태 없음')
}

// 5. 오늘 날짜 필터링 확인
const today = new Date().toISOString().split('T')[0]
const { data: todayData } = await supabase
  .from('purchase_requests')
  .select('*')
  .gte('request_date', '2025-01-01')
  .lte('request_date', today)
  .eq('requester_name', '정현웅')
  .order('request_date', { ascending: false })
  .limit(5)
  
console.log(`\n📅 날짜 필터 테스트 (2025-01-01 ~ ${today}):`)
if (todayData && todayData.length > 0) {
  todayData.forEach((req, idx) => {
    console.log(`${idx + 1}. ${req.purchase_order_number} - ${req.request_date}`)
  })
}

// 6. 가장 최근 정현웅님 발주요청
const { data: latestJHW } = await supabase
  .from('purchase_requests')
  .select('*')
  .eq('requester_name', '정현웅')
  .order('created_at', { ascending: false })
  .limit(3)
  
console.log(`\n📌 정현웅님 최신 발주요청 3건 (날짜 무관):`)
if (latestJHW) {
  latestJHW.forEach((req, idx) => {
    console.log(`\n${idx + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   청구일: ${req.request_date}`)
    console.log(`   생성시간: ${req.created_at}`)
    console.log(`   승인상태: 중간(${req.middle_manager_status}), 최종(${req.final_manager_status})`)
  })
}

// 7. 전체 최신 발주요청 확인
const { data: allLatest } = await supabase
  .from('purchase_requests')
  .select('id, purchase_order_number, requester_name, request_date, created_at, middle_manager_status, final_manager_status')
  .order('created_at', { ascending: false })
  .limit(5)
  
console.log(`\n📋 전체 최신 발주요청 5건:`)
allLatest?.forEach((req, idx) => {
  console.log(`${idx + 1}. ${req.purchase_order_number} - ${req.requester_name} - ${req.request_date}`)
})

process.exit(0)
