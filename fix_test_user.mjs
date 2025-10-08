import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('test@hansl.com 사용자 역할 설정 중...\n')

// purchase_role 업데이트
const { data, error } = await supabase
  .from('employees')
  .update({ 
    purchase_role: 'app_admin,middle_manager,lead buyer',
    name: 'Test User'
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
  console.log('\n이제 대시보드가 정상 작동합니다\!')
}

process.exit(0)
