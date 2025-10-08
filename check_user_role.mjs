import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// 현재 사용자 확인
const { data: { user } } = await supabase.auth.getUser()

if (user) {
  console.log('Logged in user email:', user.email)
  
  // employees 테이블에서 role 확인
  const { data: employee, error } = await supabase
    .from('employees')
    .select('name, email, purchase_role')
    .eq('email', user.email)
    .single()
  
  if (employee) {
    console.log('\nEmployee Info:')
    console.log('- Name:', employee.name)
    console.log('- Email:', employee.email)
    console.log('- Purchase Role:', employee.purchase_role)
    console.log('- Role Type:', typeof employee.purchase_role)
  } else {
    console.log('No employee found with email:', user.email)
  }
} else {
  console.log('No user logged in')
}

// 구매대기 상태의 요청들 확인
const { data: purchaseRequests, count } = await supabase
  .from('purchase_requests')
  .select('id, purchase_order_number, final_manager_status, purchase_status', { count: 'exact' })
  .eq('final_manager_status', 'approved')
  .eq('purchase_status', 'pending')

console.log('\n구매대기 상태 요청:')
console.log('- Total count:', count)
if (purchaseRequests && purchaseRequests.length > 0) {
  console.log('- Sample requests:')
  purchaseRequests.slice(0, 3).forEach(req => {
    console.log(`  * ${req.purchase_order_number}: final=${req.final_manager_status}, purchase=${req.purchase_status}`)
  })
}

process.exit(0)
