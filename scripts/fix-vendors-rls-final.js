import { createClient } from '@supabase/supabase-js';

// Supabase Service Role 연결 설정 (RLS 무시)
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgxNDM2MCwiZXhwIjoyMDYzMzkwMzYwfQ.CTunNqWEcvsAo42kcKVSpSkHK66M1OIjlhdvIoCxn78';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false
  }
});

async function fixVendorsRLS() {
  console.log('🔧 vendors 테이블 RLS 정책 수정 최종 시도...\n');

  try {
    // 1. 먼저 Service Role로 업체 등록 테스트 (RLS 무시됨)
    console.log('1️⃣ Service Role로 업체 등록 테스트...');
    const testVendor = {
      vendor_name: 'RLS테스트업체_' + Date.now(),
      business_number: '999-99-' + Math.floor(Math.random() * 100000),
      representative: '김테스트',
      contact_phone: '010-9999-9999',
      email: 'rls-test@example.com',
      address: '테스트 주소',
      is_active: true
    };

    const { data: newVendor, error: insertError } = await supabaseAdmin
      .from('vendors')
      .insert(testVendor)
      .select()
      .single();

    if (insertError) {
      console.error('❌ Service Role로도 업체 등록 실패:', insertError);
      console.log('테이블 구조나 제약 조건 문제일 수 있습니다.');
      return;
    }

    console.log('✅ Service Role로 업체 등록 성공!');
    console.log('   등록된 업체 ID:', newVendor.id);
    console.log('   업체명:', newVendor.vendor_name);

    // 2. 일반 사용자(anon)로 업체 조회 테스트
    console.log('\n2️⃣ 일반 사용자로 업체 조회 테스트...');
    const supabaseAnon = createClient(supabaseUrl, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MTQzNjAsImV4cCI6MjA2MzM5MDM2MH0.7VZlSwnNuE0MaQpDjuzeZFgjJrDBQOWA_COyqaM8Rbg');
    
    const { data: vendors, error: selectError } = await supabaseAnon
      .from('vendors')
      .select('id, vendor_name')
      .eq('id', newVendor.id);

    if (selectError) {
      console.log('⚠️  일반 사용자는 조회 불가:', selectError.message);
    } else {
      console.log('✅ 일반 사용자도 조회 가능!');
    }

    // 3. 일반 사용자로 업체 등록 테스트
    console.log('\n3️⃣ 일반 사용자로 업체 등록 테스트...');
    const testVendor2 = {
      vendor_name: '일반사용자테스트_' + Date.now(),
      business_number: '888-88-' + Math.floor(Math.random() * 100000),
      representative: '박테스트',
      contact_phone: '010-8888-8888',
      is_active: true
    };

    const { data: userVendor, error: userInsertError } = await supabaseAnon
      .from('vendors')
      .insert(testVendor2)
      .select()
      .single();

    if (userInsertError) {
      console.error('❌ 일반 사용자는 업체 등록 불가!');
      console.error('   에러:', userInsertError.message);
      
      console.log('\n📋 해결 방법:');
      console.log('1. Supabase 대시보드(https://supabase.com/dashboard) 접속');
      console.log('2. 프로젝트 선택 후 SQL Editor 열기');
      console.log('3. 아래 SQL 실행:\n');
      
      const fixSQL = `-- vendors 테이블 RLS 정책 수정
-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;
DROP POLICY IF EXISTS vendors_select_policy ON vendors;
DROP POLICY IF EXISTS vendors_insert_policy ON vendors;
DROP POLICY IF EXISTS vendors_update_policy ON vendors;
DROP POLICY IF EXISTS vendors_delete_policy ON vendors;

-- 새로운 정책 생성 (인증된 모든 사용자 허용)
CREATE POLICY vendors_full_access ON vendors
    FOR ALL 
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- vendor_contacts 테이블도 동일하게 처리
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_select_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_insert_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_update_policy ON vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_delete_policy ON vendor_contacts;

CREATE POLICY vendor_contacts_full_access ON vendor_contacts
    FOR ALL 
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- 정책 확인
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies 
WHERE tablename IN ('vendors', 'vendor_contacts')
ORDER BY tablename, policyname;`;
      
      console.log(fixSQL);
      console.log('\n4. SQL 실행 후 "Run" 클릭');
      console.log('5. 브라우저 새로고침 후 업체 등록 재시도');
    } else {
      console.log('✅ 일반 사용자도 업체 등록 성공!');
      console.log('   등록된 업체:', userVendor.vendor_name);
      
      // 테스트 데이터 삭제
      await supabaseAdmin.from('vendors').delete().eq('id', userVendor.id);
    }

    // 4. 테스트 데이터 정리
    console.log('\n4️⃣ 테스트 데이터 정리 중...');
    const { error: deleteError } = await supabaseAdmin
      .from('vendors')
      .delete()
      .eq('id', newVendor.id);

    if (!deleteError) {
      console.log('✅ 테스트 데이터 삭제 완료');
    }

  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error);
  }
}

// 실행
fixVendorsRLS();