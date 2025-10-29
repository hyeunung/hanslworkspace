#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔄 === 캐시 및 발주 데이터 확인 ===\n')

// 최신 발주요청 확인
const { data: latestPurchases, error } = await supabase
  .from('purchase_requests')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5)

if (error) {
  console.error('❌ 데이터 조회 실패:', error)
} else {
  console.log('📋 최신 발주요청 5건:')
  latestPurchases.forEach((req, idx) => {
    console.log(`\n${idx + 1}. 발주번호: ${req.purchase_order_number}`)
    console.log(`   요청자: ${req.requester_name}`)
    console.log(`   청구일: ${req.request_date}`)
    console.log(`   생성시간: ${req.created_at}`)
    console.log(`   상태: 중간(${req.middle_manager_status}), 최종(${req.final_manager_status})`)
  })
}

console.log('\n\n💡 해결 방법:')
console.log('=====================================')
console.log('1. 브라우저에서 F12 > Console 탭 열기')
console.log('2. 다음 명령어 실행:')
console.log('\n   localStorage.clear();')
console.log('   sessionStorage.clear();')
console.log('   location.reload();')
console.log('\n3. 또는 브라우저 강제 새로고침:')
console.log('   - Windows: Ctrl + F5')
console.log('   - Mac: Cmd + Shift + R')
console.log('\n4. 5분 후 자동으로 캐시가 만료됩니다.')

process.exit(0)
