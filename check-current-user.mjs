import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

console.log('현재 로그인 사용자 및 권한 확인 중...\n');

// 1. 현재 로그인 사용자 확인
const { data: { user }, error: authError } = await supabase.auth.getUser();

if (authError || !user) {
  console.log('❌ 로그인된 사용자 없음:', authError?.message || '인증 세션 없음');
  console.log('\n📝 삭제 기능 사용을 위해서는 로그인이 필요합니다.');
  process.exit(0);
}

console.log('✅ 현재 로그인한 사용자:', user.email);

// 2. employees 테이블에서 사용자 정보 및 권한 확인
const { data: employee, error: empError } = await supabase
  .from('employees')
  .select('*')
  .eq('email', user.email)
  .single();

if (empError || !employee) {
  console.log('❌ employees 테이블에 사용자 정보 없음:', empError?.message);
  process.exit(0);
}

console.log('✅ 사용자 정보 발견:');
console.log('  - 이름:', employee.name);
console.log('  - 이메일:', employee.email);
console.log('  - 역할:', employee.purchase_role || '역할 없음');

// 3. 권한 분석
let roles = [];
if (employee.purchase_role) {
  if (Array.isArray(employee.purchase_role)) {
    roles = employee.purchase_role.map(r => String(r).trim());
  } else {
    const roleString = String(employee.purchase_role);
    roles = roleString
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);
  }
}

console.log('🔍 파싱된 권한 목록:', roles);

// 4. 삭제 권한 체크
const canEdit = roles.includes('final_approver') || 
                roles.includes('app_admin') || 
                roles.includes('ceo');

console.log('\n🔐 권한 분석:');
console.log('  - final_approver:', roles.includes('final_approver'));
console.log('  - app_admin:', roles.includes('app_admin'));
console.log('  - ceo:', roles.includes('ceo'));
console.log('  - 편집 권한 (canEdit):', canEdit);

// 5. 테스트용 발주요청 확인 (요청자 본인 여부 확인)
const { data: testRequests, error: testError } = await supabase
  .from('purchase_requests')
  .select('id, purchase_order_number, requester_name, final_manager_status')
  .eq('requester_name', employee.name)
  .limit(3);

if (testRequests && testRequests.length > 0) {
  console.log('\n📋 사용자가 요청한 발주요청 목록:');
  testRequests.forEach(req => {
    const isApproved = req.final_manager_status === 'approved';
    const canDeleteThis = isApproved ? canEdit : (canEdit || true); // 본인 요청이므로 미승인시 삭제 가능
    console.log('  - ' + req.purchase_order_number + ' (' + req.final_manager_status + ') - 삭제 가능: ' + canDeleteThis);
  });
} else {
  console.log('\n📋 사용자가 요청한 발주요청이 없습니다.');
}

// 6. 결론
console.log('\n💡 삭제 기능 작동 조건:');
console.log('  1. 관리자 권한이 있으면 → 모든 요청 삭제 가능');
console.log('  2. 관리자 권한이 없으면 → 자신이 요청한 미승인 요청만 삭제 가능');
console.log('  3. 승인된 요청은 → 관리자만 삭제 가능');

if (!canEdit) {
  console.log('\n⚠️  현재 사용자는 관리자 권한이 없습니다.');
  console.log('   → 자신이 요청한 미승인 발주요청만 삭제할 수 있습니다.');
} else {
  console.log('\n✅ 현재 사용자는 관리자 권한이 있습니다.');
  console.log('   → 모든 발주요청을 삭제할 수 있습니다.');
}

process.exit(0);