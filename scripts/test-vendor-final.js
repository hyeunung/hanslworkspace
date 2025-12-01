import { createClient } from '@supabase/supabase-js';

// Supabase Service Role 연결 (RLS 무시)
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgxNDM2MCwiZXhwIjoyMDYzMzkwMzYwfQ.CTunNqWEcvsAo42kcKVSpSkHK66M1OIjlhdvIoCxn78';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

async function testVendorFinal() {
  console.log('🚀 업체 등록 최종 테스트...\n');

  try {
    // DB 스키마에 맞는 업체 데이터
    const testVendor = {
      vendor_name: '최종테스트업체_' + Date.now(),
      vendor_phone: '02-1234-5678',
      vendor_fax: '02-1234-5679',
      vendor_payment_schedule: '월말결제',
      vendor_address: '서울시 강남구 테스트로 123',
      note: '테스트용 업체입니다'
    };

    console.log('📝 등록할 데이터:');
    console.log(JSON.stringify(testVendor, null, 2));

    // 업체 등록
    const { data: newVendor, error: insertError } = await supabaseAdmin
      .from('vendors')
      .insert(testVendor)
      .select()
      .single();

    if (insertError) {
      console.error('\n❌ 업체 등록 실패!');
      console.error('에러:', insertError);
      return;
    }

    console.log('\n✅ 업체 등록 성공!');
    console.log('등록된 업체 정보:');
    console.log('  ID:', newVendor.id);
    console.log('  업체명:', newVendor.vendor_name);
    console.log('  전화번호:', newVendor.vendor_phone);
    console.log('  팩스번호:', newVendor.vendor_fax);
    console.log('  결제조건:', newVendor.vendor_payment_schedule);
    console.log('  주소:', newVendor.vendor_address);

    // 테스트 데이터 삭제
    console.log('\n🗑️  테스트 데이터 정리...');
    const { error: deleteError } = await supabaseAdmin
      .from('vendors')
      .delete()
      .eq('id', newVendor.id);

    if (!deleteError) {
      console.log('✅ 테스트 데이터 삭제 완료');
    }

    console.log('\n🎉 모든 테스트 완료!');
    console.log('\n⚠️  남은 작업:');
    console.log('1. Supabase 대시보드에서 RLS 정책 수정');
    console.log('   다음 SQL을 실행하세요:');
    console.log(`
-- 기존 정책 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;

-- 새로운 정책 생성 (인증된 모든 사용자 허용)
CREATE POLICY vendors_full_access ON vendors
    FOR ALL 
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
    `);
    console.log('\n2. 브라우저에서 로그인 후 업체 등록 테스트');

  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error);
  }
}

// 실행
testVendorFinal();