// 브라우저 콘솔에서 실행할 테스트 스크립트
// 1. http://localhost:3001 에서 로그인 후
// 2. F12 개발자도구 콘솔에서 아래 코드 실행

async function testVendorCreation() {
  console.log('🧪 업체 등록 테스트 시작...');
  
  // vendorService 가져오기 시도
  const testVendor = {
    vendor_name: '테스트업체_' + Date.now(),
    business_number: '123-45-' + Math.floor(Math.random() * 100000),
    representative: '홍길동',
    contact_phone: '010-1234-5678',
    email: 'test@example.com',
    address: '서울시 강남구',
    is_active: true
  };

  console.log('등록할 데이터:', testVendor);

  try {
    // Fetch API를 직접 사용하여 Supabase에 요청
    const response = await fetch('https://qvhbigvdfyvhoegkhvef.supabase.co/rest/v1/vendors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MTQzNjAsImV4cCI6MjA2MzM5MDM2MH0.7VZlSwnNuE0MaQpDjuzeZFgjJrDBQOWA_COyqaM8Rbg',
        'Authorization': 'Bearer ' + localStorage.getItem('supabase.auth.token')?.split('"access_token":"')[1]?.split('"')[0] || ''
      },
      body: JSON.stringify(testVendor)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ 업체 등록 성공!', result);
    } else {
      console.error('❌ 업체 등록 실패:', result);
      
      if (result.message?.includes('row-level security policy')) {
        console.log('\n⚠️  RLS 정책 문제입니다!');
        console.log('해결방법:');
        console.log('1. Supabase 대시보드 접속');
        console.log('2. SQL 에디터에서 다음 SQL 실행:');
        console.log(`
-- 기존 정책 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;

-- 새로운 정책 생성
CREATE POLICY vendors_select_policy ON vendors
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY vendors_insert_policy ON vendors
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendors_update_policy ON vendors
    FOR UPDATE USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vendors_delete_policy ON vendors
    FOR DELETE USING (auth.role() = 'authenticated');
        `);
      }
    }
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

// 함수 실행
testVendorCreation();