import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('Test User에 app_admin 역할 추가 중...\n')

const { data, error } = await supabase
  .from('employees')
  .update({ 
    purchase_role: ['app_admin', 'middle_manager', 'lead buyer', 'final_approver']
  })
  .eq('email', 'test@hansl.com')
  .select()
  .single()

if (error) {
  console.error('❌ 업데이트 실패:', error)
} else {
  console.log('✅ 역할 업데이트 완료\!')
  console.log('- 이름:', data.name)
  console.log('- 이메일:', data.email)
  console.log('- 역할:', data.purchase_role)
  console.log('\n이제 입고현황 탭에서 품목별 입고 버튼이 표시됩니다\!')
  console.log('\n사용 방법:')
  console.log('1. 발주요청 관리 → 입고 현황 탭')
  console.log('2. 항목 클릭하여 상세 모달 열기')
  console.log('3. 품목별 "미입고" 버튼 클릭 → "입고완료"로 변경')
}

process.exit(0)
