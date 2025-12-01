import { createClient } from '@supabase/supabase-js';

// Supabase 연결 설정
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgxNDM2MCwiZXhwIjoyMDYzMzkwMzYwfQ.CTunNqWEcvsAo42kcKVSpSkHK66M1OIjlhdvIoCxn78';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fixVendorsRLS() {
  console.log('🔧 vendors 테이블 RLS 정책 수정 시작...\n');

  try {
    // SQL 실행
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        -- 기존 정책 삭제
        DROP POLICY IF EXISTS vendors_policy ON vendors;

        -- 새로운 정책 생성: 모든 인증된 사용자가 조회 및 등록 가능
        CREATE POLICY vendors_select_policy ON vendors
            FOR SELECT
            USING (true);

        CREATE POLICY vendors_insert_policy ON vendors
            FOR INSERT
            WITH CHECK (true);

        CREATE POLICY vendors_update_policy ON vendors
            FOR UPDATE
            USING (true)
            WITH CHECK (true);

        CREATE POLICY vendors_delete_policy ON vendors
            FOR DELETE
            USING (true);

        -- vendor_contacts 테이블도 동일하게 처리
        ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts;

        CREATE POLICY vendor_contacts_select_policy ON vendor_contacts
            FOR SELECT
            USING (true);

        CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts
            FOR INSERT
            WITH CHECK (true);

        CREATE POLICY vendor_contacts_update_policy ON vendor_contacts
            FOR UPDATE
            USING (true)
            WITH CHECK (true);

        CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts
            FOR DELETE
            USING (true);
      `
    });

    if (error) {
      // exec_sql 함수가 없으면 직접 SQL 실행
      console.log('exec_sql 함수를 사용할 수 없습니다. 직접 SQL을 실행합니다.');
      
      // 각 정책을 개별적으로 실행
      const queries = [
        `DROP POLICY IF EXISTS vendors_policy ON vendors`,
        `CREATE POLICY vendors_select_policy ON vendors FOR SELECT USING (true)`,
        `CREATE POLICY vendors_insert_policy ON vendors FOR INSERT WITH CHECK (true)`,
        `CREATE POLICY vendors_update_policy ON vendors FOR UPDATE USING (true) WITH CHECK (true)`,
        `CREATE POLICY vendors_delete_policy ON vendors FOR DELETE USING (true)`,
        `ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY`,
        `DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts`,
        `CREATE POLICY vendor_contacts_select_policy ON vendor_contacts FOR SELECT USING (true)`,
        `CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts FOR INSERT WITH CHECK (true)`,
        `CREATE POLICY vendor_contacts_update_policy ON vendor_contacts FOR UPDATE USING (true) WITH CHECK (true)`,
        `CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts FOR DELETE USING (true)`
      ];

      for (const query of queries) {
        console.log(`실행 중: ${query.substring(0, 50)}...`);
        // Note: Supabase JS client doesn't support direct SQL execution
        // We need to use the SQL editor in Supabase Dashboard
      }

      console.log('\n⚠️  Supabase JS 클라이언트는 직접 SQL 실행을 지원하지 않습니다.');
      console.log('📋 다음 SQL을 Supabase 대시보드의 SQL 에디터에서 실행해주세요:\n');
      console.log(`-- 기존 정책 삭제
DROP POLICY IF EXISTS vendors_policy ON vendors;

-- 새로운 정책 생성: 모든 인증된 사용자가 조회 및 등록 가능
CREATE POLICY vendors_select_policy ON vendors
    FOR SELECT
    USING (true);

CREATE POLICY vendors_insert_policy ON vendors
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY vendors_update_policy ON vendors
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY vendors_delete_policy ON vendors
    FOR DELETE
    USING (true);

-- vendor_contacts 테이블도 동일하게 처리
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts;

CREATE POLICY vendor_contacts_select_policy ON vendor_contacts
    FOR SELECT
    USING (true);

CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY vendor_contacts_update_policy ON vendor_contacts
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts
    FOR DELETE
    USING (true);`);
      return;
    }

    console.log('✅ RLS 정책이 성공적으로 업데이트되었습니다!\n');

    // 업체 등록 테스트
    console.log('🧪 업체 등록 테스트...');
    const testVendor = {
      vendor_name: '테스트업체_' + new Date().getTime(),
      business_number: '123-45-67890',
      representative: '홍길동',
      contact_phone: '010-1234-5678',
      is_active: true
    };

    const { data: newVendor, error: insertError } = await supabase
      .from('vendors')
      .insert(testVendor)
      .select()
      .single();

    if (insertError) {
      console.error('❌ 업체 등록 테스트 실패:', insertError);
    } else {
      console.log('✅ 업체 등록 테스트 성공!');
      console.log('   등록된 업체:', newVendor.vendor_name);

      // 테스트 데이터 삭제
      const { error: deleteError } = await supabase
        .from('vendors')
        .delete()
        .eq('id', newVendor.id);

      if (!deleteError) {
        console.log('   테스트 데이터 삭제 완료');
      }
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

// 함수 실행
fixVendorsRLS();