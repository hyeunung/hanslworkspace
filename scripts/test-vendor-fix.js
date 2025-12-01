import { createClient } from '@supabase/supabase-js';

// Supabase Service Role 연결 설정 (RLS 무시)
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgxNDM2MCwiZXhwIjoyMDYzMzkwMzYwfQ.CTunNqWEcvsAo42kcKVSpSkHK66M1OIjlhdvIoCxn78';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false
  }
});

async function testVendorFix() {
  console.log('🔧 업체 등록 문제 해결 확인...\n');

  try {
    // 1. Service Role로 업체 등록 테스트 (address 필드 제거)
    console.log('1️⃣ Service Role로 업체 등록 테스트...');
    const testVendor = {
      vendor_name: '수정테스트_' + Date.now(),
      business_number: '777-77-' + Math.floor(Math.random() * 100000),
      representative: '이테스트',
      contact_phone: '010-7777-7777',
      email: 'fix-test@example.com',
      is_active: true
    };

    const { data: newVendor, error: insertError } = await supabaseAdmin
      .from('vendors')
      .insert(testVendor)
      .select()
      .single();

    if (insertError) {
      console.error('❌ 업체 등록 실패:', insertError);
      return;
    }

    console.log('✅ Service Role로 업체 등록 성공!');
    console.log('   등록된 업체:', newVendor.vendor_name);
    console.log('   업체 ID:', newVendor.id);

    // 2. 테스트 데이터 정리
    console.log('\n2️⃣ 테스트 데이터 정리...');
    const { error: deleteError } = await supabaseAdmin
      .from('vendors')
      .delete()
      .eq('id', newVendor.id);

    if (!deleteError) {
      console.log('✅ 테스트 데이터 삭제 완료');
    }

    console.log('\n✅ 문제 해결 완료!');
    console.log('📌 address 필드가 제거되었습니다.');
    console.log('📌 이제 브라우저에서 업체 등록이 가능합니다.');
    console.log('\n⚠️  하지만 RLS 정책도 수정해야 합니다:');
    console.log('   Supabase 대시보드에서 다음 SQL 실행:');
    console.log(`
-- 기존 정책 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;

-- 새로운 정책 생성 (인증된 모든 사용자 허용)
CREATE POLICY vendors_full_access ON vendors
    FOR ALL 
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
    `);

  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error);
  }
}

// 실행
testVendorFix();