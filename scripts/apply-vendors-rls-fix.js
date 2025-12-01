import pg from 'pg';

// PostgreSQL 직접 연결
const connectionString = 'postgresql://postgres.qvhbigvdfyvhoegkhvef:YourPasswordHere@aws-0-us-west-1.pooler.supabase.com:5432/postgres';

async function applyVendorsRLSFix() {
  const client = new pg.Client({
    connectionString: connectionString.replace('YourPasswordHere', 'Kante6Pogba1234^')
  });

  try {
    await client.connect();
    console.log('✅ PostgreSQL 연결 성공\n');

    // 현재 정책 확인
    console.log('📋 현재 vendors 테이블 정책 확인...');
    const currentPolicies = await client.query(`
      SELECT policyname, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'vendors'
    `);
    
    console.log('현재 정책:');
    currentPolicies.rows.forEach(policy => {
      console.log(`  - ${policy.policyname} (${policy.cmd})`);
    });

    // 기존 정책 삭제
    console.log('\n🗑️  기존 정책 삭제 중...');
    await client.query('DROP POLICY IF EXISTS vendors_policy ON vendors');
    await client.query('DROP POLICY IF EXISTS vendors_select_policy ON vendors');
    await client.query('DROP POLICY IF EXISTS vendors_insert_policy ON vendors');
    await client.query('DROP POLICY IF EXISTS vendors_update_policy ON vendors');
    await client.query('DROP POLICY IF EXISTS vendors_delete_policy ON vendors');

    // 새로운 정책 생성
    console.log('🔧 새로운 정책 생성 중...');
    
    await client.query(`
      CREATE POLICY vendors_select_policy ON vendors
      FOR SELECT
      USING (true)
    `);
    console.log('  ✅ SELECT 정책 생성 완료');

    await client.query(`
      CREATE POLICY vendors_insert_policy ON vendors
      FOR INSERT
      WITH CHECK (true)
    `);
    console.log('  ✅ INSERT 정책 생성 완료');

    await client.query(`
      CREATE POLICY vendors_update_policy ON vendors
      FOR UPDATE
      USING (true)
      WITH CHECK (true)
    `);
    console.log('  ✅ UPDATE 정책 생성 완료');

    await client.query(`
      CREATE POLICY vendors_delete_policy ON vendors
      FOR DELETE
      USING (true)
    `);
    console.log('  ✅ DELETE 정책 생성 완료');

    // vendor_contacts 테이블도 처리
    console.log('\n🔧 vendor_contacts 테이블 정책 수정 중...');
    
    await client.query('ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY');
    await client.query('DROP POLICY IF EXISTS vendor_contacts_policy ON vendor_contacts');
    
    await client.query(`
      CREATE POLICY vendor_contacts_select_policy ON vendor_contacts
      FOR SELECT
      USING (true)
    `);

    await client.query(`
      CREATE POLICY vendor_contacts_insert_policy ON vendor_contacts
      FOR INSERT
      WITH CHECK (true)
    `);

    await client.query(`
      CREATE POLICY vendor_contacts_update_policy ON vendor_contacts
      FOR UPDATE
      USING (true)
      WITH CHECK (true)
    `);

    await client.query(`
      CREATE POLICY vendor_contacts_delete_policy ON vendor_contacts
      FOR DELETE
      USING (true)
    `);
    console.log('  ✅ vendor_contacts 정책 생성 완료');

    // 변경된 정책 확인
    console.log('\n📋 변경된 vendors 테이블 정책:');
    const newPolicies = await client.query(`
      SELECT policyname, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'vendors'
      ORDER BY policyname
    `);
    
    newPolicies.rows.forEach(policy => {
      console.log(`  - ${policy.policyname} (${policy.cmd}): ${policy.with_check || policy.qual || 'true'}`);
    });

    console.log('\n✅ 모든 RLS 정책이 성공적으로 업데이트되었습니다!');
    console.log('📌 이제 모든 직원이 업체를 등록할 수 있습니다.');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await client.end();
    console.log('\n연결 종료');
  }
}

// 실행
applyVendorsRLSFix();