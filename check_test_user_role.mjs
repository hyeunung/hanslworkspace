import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: employee } = await supabase
  .from('employees')
  .select('name, email, purchase_role')
  .eq('email', 'test@hansl.com')
  .single()

console.log('Test User 권한 확인:')
console.log('- 이름:', employee.name)
console.log('- 이메일:', employee.email)
console.log('- 역할:', employee.purchase_role)

const roles = employee.purchase_role || []
const canReceiptCheck = roles.includes('final_approver') || 
                       roles.includes('app_admin') || 
                       roles.includes('ceo')

console.log('\n입고 버튼 표시 가능?', canReceiptCheck ? '✅ YES' : '❌ NO')

if (\!canReceiptCheck) {
  console.log('\n필요한 역할 중 하나가 있어야 합니다:')
  console.log('- final_approver')
  console.log('- app_admin')
  console.log('- ceo')
  
  console.log('\n현재 Test User의 역할:', roles.join(', '))
}

process.exit(0)
