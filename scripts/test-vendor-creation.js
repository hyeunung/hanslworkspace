import { createClient } from '@supabase/supabase-js';

// Supabase 연결 설정
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MTQzNjAsImV4cCI6MjA2MzM5MDM2MH0.7VZlSwnNuE0MaQpDjuzeZFgjJrDBQOWA_COyqaM8Rbg';

const supabase = createClient(supabaseUrl, anonKey);

async function testVendorCreation() {
  console.log('🧪 업체 등록 테스트 시작...\n');

  try {
    // 먼저 인증된 사용자로 로그인 (테스트용)
    const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
      email: 'scottbin.hoo@gmail.com',  // 실제 테스트 계정으로 변경 필요
      password: '1234'
    });

    if (authError) {
      console.error('❌ 로그인 실패:', authError.message);
      return;
    }

    console.log('✅ 로그인 성공:', user.email);

    // 현재 vendors 정책 확인
    console.log('\n📋 현재 vendors 테이블 정책 확인...');
    const { data: policies, error: policyError } = await supabase
      .rpc('get_policies', { table_name: 'vendors' });

    if (policyError) {
      console.log('정책 조회 실패 (get_policies 함수 없음), 직접 테스트 진행');
    } else {
      console.log('현재 정책:', policies);
    }

    // 업체 등록 테스트
    console.log('\n🔬 업체 등록 시도...');
    const testVendor = {
      vendor_name: '테스트업체_' + new Date().getTime(),
      business_number: '123-45-' + Math.floor(Math.random() * 100000),
      representative: '홍길동',
      contact_phone: '010-1234-5678',
      email: 'test@example.com',
      address: '서울시 강남구',
      is_active: true
    };

    console.log('등록할 데이터:', testVendor);

    const { data: newVendor, error: insertError } = await supabase
      .from('vendors')
      .insert(testVendor)
      .select()
      .single();

    if (insertError) {
      console.error('\n❌ 업체 등록 실패!');
      console.error('에러 코드:', insertError.code);
      console.error('에러 메시지:', insertError.message);
      console.error('에러 상세:', insertError.details);
      console.error('에러 힌트:', insertError.hint);
      
      if (insertError.message.includes('new row violates row-level security policy')) {
        console.log('\n⚠️  RLS 정책 문제입니다!');
        console.log('vendors 테이블의 INSERT 정책이 제한적입니다.');
        console.log('모든 직원이 업체를 등록할 수 있도록 정책을 수정해야 합니다.');
      }
    } else {
      console.log('\n✅ 업체 등록 성공!');
      console.log('등록된 업체 정보:');
      console.log('  - ID:', newVendor.id);
      console.log('  - 이름:', newVendor.vendor_name);
      console.log('  - 사업자번호:', newVendor.business_number);

      // 테스트 데이터 삭제
      console.log('\n🗑️  테스트 데이터 삭제 중...');
      const { error: deleteError } = await supabase
        .from('vendors')
        .delete()
        .eq('id', newVendor.id);

      if (!deleteError) {
        console.log('✅ 테스트 데이터 삭제 완료');
      } else {
        console.log('⚠️  삭제 실패:', deleteError.message);
      }
    }

    // 로그아웃
    await supabase.auth.signOut();
    console.log('\n✅ 로그아웃 완료');

  } catch (error) {
    console.error('\n❌ 예상치 못한 오류:', error);
  }
}

// 함수 실행
testVendorCreation();