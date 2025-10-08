import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// 현재 로그인 사용자 확인
const { data: { user }, error: authError } = await supabase.auth.getUser()
if (authError || !user) {
  console.log('로그인된 사용자 없음:', authError?.message)
  
  // Service Role로 employees 테이블 확인
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, name, email, purchase_role')
    .limit(5)
  
  console.log('\n현재 employees 테이블 샘플 데이터:')
  if (employees) {
    employees.forEach(emp => {
      console.log(`- ${emp.name} (${emp.email}): ${emp.purchase_role || '역할 없음'}`)
    })
  }
} else {
  console.log(`현재 로그인한 사용자: ${user.email}`)
  
  // employees 테이블에서 해당 사용자 찾기
  const { data: employee, error } = await supabase
    .from('employees')
    .select('*')
    .eq('email', user.email)
    .single()
  
  if (error || !employee) {
    console.log('❌ employees 테이블에 사용자 정보 없음!')
    console.log('에러:', error?.message)
    
    // 다른 이메일로 검색해보기
    const { data: allEmployees } = await supabase
      .from('employees')
      .select('name, email')
      .limit(10)
    
    console.log('\nemployees 테이블의 이메일 목록:')
    allEmployees?.forEach(emp => console.log(`- ${emp.name}: ${emp.email}`))
  } else {
    console.log('✅ employees 테이블에 사용자 정보 있음:')
    console.log('- 이름:', employee.name)
    console.log('- 이메일:', employee.email)
    console.log('- 역할:', employee.purchase_role)
  }
}

process.exit(0)