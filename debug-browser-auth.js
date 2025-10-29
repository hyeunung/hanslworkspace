// 브라우저 콘솔에서 실행할 디버깅 스크립트
// 1. 브라우저에서 F12를 눌러 개발자 도구를 엽니다
// 2. Console 탭으로 이동합니다
// 3. 아래 코드를 복사해서 붙여넣고 Enter를 누릅니다

console.log('🔍 HANSL 발주관리 시스템 인증 상태 디버깅');
console.log('================================================');

// Supabase 클라이언트 가져오기 (전역 변수에서)
if (typeof window !== 'undefined' && window.supabase) {
  console.log('✅ Supabase 클라이언트 발견');
  
  // 현재 사용자 확인
  window.supabase.auth.getUser().then(({ data: { user }, error }) => {
    console.log('\n👤 사용자 인증 상태:');
    if (error) {
      console.log('❌ 인증 오류:', error.message);
    } else if (user) {
      console.log('✅ 로그인된 사용자:', user.email);
      console.log('  - 사용자 ID:', user.id);
      console.log('  - 로그인 방법:', user.app_metadata.provider);
      
      // 세션 정보 확인
      window.supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
        if (sessionError) {
          console.log('❌ 세션 오류:', sessionError.message);
        } else if (session) {
          console.log('✅ 활성 세션 존재');
          console.log('  - 토큰 만료시간:', new Date(session.expires_at * 1000).toLocaleString());
        } else {
          console.log('❌ 활성 세션 없음');
        }
      });
      
      // 사용자 권한 확인
      window.supabase
        .from('employees')
        .select('name, email, purchase_role')
        .eq('email', user.email)
        .single()
        .then(({ data: employee, error: empError }) => {
          console.log('\n🔐 사용자 권한 정보:');
          if (empError) {
            console.log('❌ 권한 조회 오류:', empError.message);
          } else if (employee) {
            console.log('✅ 직원 정보 발견:');
            console.log('  - 이름:', employee.name);
            console.log('  - 권한:', employee.purchase_role || '권한 없음');
            
            // 권한 파싱
            let roles = [];
            if (employee.purchase_role) {
              if (Array.isArray(employee.purchase_role)) {
                roles = employee.purchase_role.map(r => String(r).trim());
              } else {
                const roleString = String(employee.purchase_role);
                roles = roleString.split(',').map(r => r.trim()).filter(r => r.length > 0);
              }
            }
            
            const canEdit = roles.includes('final_approver') || 
                          roles.includes('app_admin') || 
                          roles.includes('ceo');
            
            console.log('  - 파싱된 권한:', roles);
            console.log('  - 삭제 권한 (관리자):', canEdit);
            
            if (!canEdit) {
              console.log('\n⚠️  관리자 권한이 없습니다.');
              console.log('   → 자신이 요청한 미승인 발주요청만 삭제할 수 있습니다.');
            } else {
              console.log('\n✅ 관리자 권한이 있습니다.');
              console.log('   → 모든 발주요청을 삭제할 수 있습니다.');
            }
          } else {
            console.log('❌ 직원 정보를 찾을 수 없습니다.');
          }
        });
    } else {
      console.log('❌ 로그인된 사용자 없음');
      console.log('\n📝 해결 방법:');
      console.log('1. 로그인 페이지로 이동하여 다시 로그인하세요');
      console.log('2. 브라우저 쿠키/localStorage를 확인하세요');
      console.log('3. 네트워크 연결을 확인하세요');
    }
  });
} else {
  console.log('❌ Supabase 클라이언트를 찾을 수 없습니다.');
  console.log('페이지가 완전히 로드되었는지 확인하세요.');
}

// LocalStorage에서 인증 토큰 확인
console.log('\n🗂️  브라우저 저장소 확인:');
const authKey = Object.keys(localStorage).find(key => key.includes('supabase'));
if (authKey) {
  console.log('✅ Supabase 인증 데이터 발견:', authKey);
  try {
    const authData = JSON.parse(localStorage.getItem(authKey));
    if (authData && authData.access_token) {
      console.log('✅ 액세스 토큰 존재');
      console.log('  - 토큰 길이:', authData.access_token.length);
      console.log('  - 만료시간:', authData.expires_at ? new Date(authData.expires_at * 1000).toLocaleString() : '불명');
    } else {
      console.log('❌ 액세스 토큰 없음');
    }
  } catch (e) {
    console.log('❌ 인증 데이터 파싱 오류:', e.message);
  }
} else {
  console.log('❌ Supabase 인증 데이터 없음');
}

console.log('\n================================================');
console.log('💡 삭제 기능이 작동하지 않는 경우:');
console.log('1. 위 결과를 확인하여 로그인 상태를 점검하세요');
console.log('2. 로그인이 안 되어 있으면 다시 로그인하세요');
console.log('3. 권한이 없으면 관리자에게 문의하세요');
console.log('4. 승인된 요청은 관리자만 삭제할 수 있습니다');