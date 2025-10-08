import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

console.log('=== 인증 및 DB 연결 상태 진단 시작 ===\n')

// 1. 환경 변수 확인
console.log('1. 환경 변수 상태:')
console.log('   VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL ? '✅ 설정됨' : '❌ 없음')
console.log('   SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 없음')

// Service Role로 연결 (관리자 권한)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n2. test@hansl.com 계정 정보 확인:')

// employees 테이블에서 test@hansl.com 검색
const { data: testUser, error: testError } = await supabase
  .from('employees')
  .select('*')
  .eq('email', 'test@hansl.com')
  .single()

if (testUser) {
  console.log('   ✅ employees 테이블에 존재함!')
  console.log('   - ID:', testUser.id)
  console.log('   - 이름:', testUser.name)
  console.log('   - 이메일:', testUser.email)
  console.log('   - 역할:', testUser.purchase_role)
  console.log('   - 생성일:', testUser.created_at)
} else {
  console.log('   ❌ employees 테이블에 없음')
  console.log('   에러:', testError?.message)
}

// 모든 이메일 목록 확인
console.log('\n3. employees 테이블의 모든 이메일:')
const { data: allEmails } = await supabase
  .from('employees')
  .select('email, name')
  .order('email')

if (allEmails) {
  allEmails.forEach(emp => {
    const isTestUser = emp.email === 'test@hansl.com'
    console.log(`   ${isTestUser ? '👉' : '  '} ${emp.email} (${emp.name})`)
  })
}

// Auth 사용자 확인 (Service Role로는 모든 사용자 조회 가능)
console.log('\n4. Supabase Auth 사용자 확인:')
try {
  const { data: { users }, error: authListError } = await supabase.auth.admin.listUsers()
  
  if (users) {
    const testAuthUser = users.find(u => u.email === 'test@hansl.com')
    if (testAuthUser) {
      console.log('   ✅ Auth에 test@hansl.com 존재!')
      console.log('   - Auth ID:', testAuthUser.id)
      console.log('   - 이메일:', testAuthUser.email)
      console.log('   - 생성일:', testAuthUser.created_at)
    } else {
      console.log('   ❌ Auth에 test@hansl.com 없음')
      console.log('   Auth에 등록된 이메일들:')
      users.slice(0, 5).forEach(u => {
        console.log(`     - ${u.email}`)
      })
    }
  }
} catch (e) {
  console.log('   Auth 사용자 목록 조회 실패:', e.message)
}

process.exit(0)