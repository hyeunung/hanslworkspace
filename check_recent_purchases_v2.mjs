import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n🔍 === 최근 발주요청 확인 ===\n')

// 오늘 날짜
const today = new Date()
const todayStr = today.toISOString().split('T')[0]
console.log(`📅 오늘 날짜: ${todayStr}`)

// 최근 7일간의 발주요청 조회
const sevenDaysAgo = new Date()
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

console.log('\n📋 최근 7일간 생성된 발주요청:')
console.log('=====================================')

const { data: recentRequests, error } = await supabase
  .from('purchase_requests')
  .select('id, purchase_order_number, requester_name, request_date, created_at, middle_manager_status, final_manager_status, payment_category, progress_type')
  .gte('created_at', sevenDaysAgo.toISOString())
  .order('created_at', { ascending: false })
  .limit(20)
  
if (error) {
  console.error('❌ 조회 실패:', error)
  process.exit(1)
}

if (!recentRequests || recentRequests.length === 0) {
  console.log('⚠️  최근 7일간 생성된 발주요청이 없습니다.')
} else {
  console.log(`✅ 총 ${recentRequests.length}건 조회됨\n`)
  recentRequests.forEach((req, index) => {
    console.log(`${index + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   요청자: ${req.requester_name}`)
    console.log(`   청구일: ${req.request_date}`)
    console.log(`   생성시간: ${req.created_at}`)
    console.log(`   결제종류: ${req.payment_category || '-'}`)
    console.log(`   진행구분: ${req.progress_type || '-'}`)
    console.log(`   승인상태: 중간(${req.middle_manager_status}), 최종(${req.final_manager_status})`)
    console.log('   ---')
  })
}

// 오늘 생성된 발주요청만 확인
console.log('\n\n📋 오늘 생성된 발주요청:')
console.log('=====================================')

const { data: todayRequests, error: todayError } = await supabase
  .from('purchase_requests')
  .select('*')
  .gte('created_at', todayStr + 'T00:00:00')
  .lte('created_at', todayStr + 'T23:59:59')
  .order('created_at', { ascending: false })
  
if (todayError) {
  console.error('❌ 오늘 데이터 조회 실패:', todayError)
} else if (!todayRequests || todayRequests.length === 0) {
  console.log('⚠️  오늘 생성된 발주요청이 없습니다.')
} else {
  console.log(`✅ 오늘 생성된 발주요청: ${todayRequests.length}건`)
  todayRequests.forEach((req, index) => {
    console.log(`\n${index + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   - ID: ${req.id}`)
    console.log(`   - 요청자: ${req.requester_name}`)
    console.log(`   - 청구일: ${req.request_date}`)
    console.log(`   - 생성시간: ${req.created_at}`)
    console.log(`   - 결제종류: ${req.payment_category}`)
    console.log(`   - 진행구분: ${req.progress_type}`)
    console.log(`   - 업체ID: ${req.vendor_id}`)
  })
}

// 가장 최근 발주요청 5건 확인 (날짜 제한 없이)
console.log('\n\n📋 가장 최근 생성된 발주요청 5건:')
console.log('=====================================')

const { data: latestRequests, error: latestError } = await supabase
  .from('purchase_requests')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5)
  
if (latestError) {
  console.error('❌ 최근 데이터 조회 실패:', latestError)
} else if (latestRequests && latestRequests.length > 0) {
  latestRequests.forEach((req, index) => {
    console.log(`\n${index + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   - 생성시간: ${req.created_at}`)
    console.log(`   - 요청자: ${req.requester_name}`)
    console.log(`   - 청구일: ${req.request_date}`)
    console.log(`   - 결제종류: ${req.payment_category}`)
    console.log(`   - 진행구분: ${req.progress_type}`)
  })
}

// 3개월 필터 테스트
console.log('\n\n📊 3개월 필터 테스트:')
console.log('=====================================')
const threeMonthsAgo = new Date()
threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
console.log(`3개월 전 날짜: ${threeMonthsAgo.toISOString().split('T')[0]}`)

const { data: filteredData, error: filterError } = await supabase
  .from('purchase_requests')
  .select('id, request_date', { count: 'exact' })
  .gte('request_date', threeMonthsAgo.toISOString())
  
if (!filterError && filteredData) {
  console.log(`✅ 3개월 필터로 조회된 발주요청: ${filteredData.length}건`)
}

// 전체 발주요청 수 확인
const { count: totalCount } = await supabase
  .from('purchase_requests')
  .select('id', { count: 'exact', head: true })
  
console.log(`📊 전체 발주요청 수: ${totalCount}건`)

// request_date가 미래인 데이터 확인
console.log('\n\n⚠️  날짜 이상 확인:')
console.log('=====================================')
const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

const { data: futureDates, error: futureError } = await supabase
  .from('purchase_requests')
  .select('id, purchase_order_number, request_date, created_at')
  .gt('request_date', todayStr)
  .order('request_date', { ascending: false })
  .limit(10)
  
if (!futureError && futureDates && futureDates.length > 0) {
  console.log(`⚠️  미래 날짜로 설정된 발주요청: ${futureDates.length}건`)
  futureDates.forEach((req) => {
    console.log(`   - ${req.purchase_order_number}: 청구일 ${req.request_date} (생성: ${req.created_at})`)
  })
} else {
  console.log('✅ 미래 날짜로 설정된 발주요청 없음')
}

process.exit(0)
