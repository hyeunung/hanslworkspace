/**
 * 🔍 발주요청관리 10/29 미표시 문제 브라우저 디버깅 스크립트
 * 
 * 사용법:
 * 1. 발주요청관리 페이지에서 F12 개발자 도구 열기
 * 2. Console 탭으로 이동
 * 3. 아래 코드를 복사해서 붙여넣고 Enter
 */

console.log('🔍 발주요청관리 10/29 미표시 문제 브라우저 진단 시작');
console.log('='.repeat(60));

// 1. Supabase 클라이언트 확인
if (typeof window !== 'undefined' && window.supabase) {
  console.log('✅ Supabase 클라이언트 발견');
  
  // 2. 현재 사용자 확인
  window.supabase.auth.getUser().then(({ data: { user }, error }) => {
    if (error) {
      console.log('❌ 사용자 인증 오류:', error.message);
      return;
    }
    
    if (!user) {
      console.log('❌ 로그인된 사용자 없음');
      return;
    }
    
    console.log('👤 현재 사용자:', user.email);
    
    // 3. 실제 발주요청 쿼리 실행 (앱과 동일한 방식)
    console.log('\n📊 발주요청 데이터 조회 시작...');
    
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    console.log('📅 날짜 범위:', {
      threeMonthsAgo: threeMonthsAgo.toISOString(),
      today: new Date().toISOString()
    });
    
    window.supabase
      .from('purchase_requests')
      .select('*,vendors(vendor_name,vendor_payment_schedule),vendor_contacts(contact_name),purchase_request_items(*)')
      .gte('request_date', threeMonthsAgo.toISOString())
      .order('request_date', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) {
          console.log('❌ 발주요청 조회 실패:', error.message);
          console.log('오류 상세:', error);
          return;
        }
        
        console.log('✅ 발주요청 조회 성공:', data?.length || 0, '건');
        
        // 10/29 데이터 확인
        const todayRequests = data?.filter(req => 
          req.request_date === '2025-10-29' || 
          req.created_at?.startsWith('2025-10-29')
        );
        
        console.log('🎯 10/29 발주요청:', todayRequests?.length || 0, '건');
        
        if (todayRequests && todayRequests.length > 0) {
          console.log('10/29 발주요청 상세:');
          todayRequests.forEach(req => {
            console.log(`  - ${req.purchase_order_number}:`);
            console.log(`    요청자: ${req.requester_name}`);
            console.log(`    요청일: ${req.request_date}`);
            console.log(`    생성일: ${req.created_at}`);
            console.log(`    품목 수: ${req.purchase_request_items?.length || 0}`);
            console.log(`    상태: ${req.middle_manager_status}/${req.final_manager_status}`);
          });
        } else {
          console.log('❌ 10/29 발주요청이 조회되지 않음!');
          
          // 전체 데이터에서 가장 최근 5건 확인
          console.log('\n📋 가장 최근 5건 발주요청:');
          data?.slice(0, 5).forEach((req, index) => {
            console.log(`  ${index + 1}. ${req.purchase_order_number} (${req.request_date})`);
          });
        }
      });
      
  });
  
} else {
  console.log('❌ Supabase 클라이언트를 찾을 수 없습니다');
  console.log('페이지가 완전히 로드되었는지 확인하세요');
}

// 4. React 컴포넌트 상태 확인 (있다면)
console.log('\n🔍 React 컴포넌트 상태 확인...');
if (typeof window !== 'undefined' && window.React) {
  console.log('✅ React 발견');
} else {
  console.log('⚠️ React를 직접 접근할 수 없습니다');
}

// 5. 네트워크 요청 모니터링 안내
console.log('\n💡 추가 디버깅 방법:');
console.log('1. Network 탭에서 purchase_requests 관련 요청 확인');
console.log('2. 요청 URL과 응답 데이터 확인');
console.log('3. 필터링 로직이 클라이언트에서 적용되는지 확인');
console.log('4. 브라우저 새로고침 후 다시 테스트');

console.log('\n='.repeat(60));
console.log('🔍 발주요청관리 프론트엔드 진단 완료');