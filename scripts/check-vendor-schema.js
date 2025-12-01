import { createClient } from '@supabase/supabase-js';

// Supabase Service Role 연결
const supabaseUrl = 'https://qvhbigvdfyvhoegkhvef.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkZnl2aG9lZ2todmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgxNDM2MCwiZXhwIjoyMDYzMzkwMzYwfQ.CTunNqWEcvsAo42kcKVSpSkHK66M1OIjlhdvIoCxn78';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkVendorSchema() {
  console.log('📊 vendors 테이블 구조 확인...\n');

  try {
    // vendors 테이블에서 한 행만 가져와서 컬럼 구조 확인
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ 테이블 조회 실패:', error);
      return;
    }

    if (data && data.length > 0) {
      console.log('✅ vendors 테이블 컬럼 구조:');
      const columns = Object.keys(data[0]);
      columns.forEach(col => {
        const value = data[0][col];
        const type = value === null ? 'null' : typeof value;
        console.log(`   - ${col}: ${type}`);
      });
    } else {
      console.log('⚠️  vendors 테이블이 비어있습니다.');
      
      // 빈 테이블이라도 insert로 컬럼 확인 시도
      console.log('\n📝 Insert 테스트로 필수 컬럼 확인...');
      const testVendor = {
        vendor_name: '스키마테스트',
        vendor_address: '테스트 주소',
        vendor_business_number: '123-45-67890',
        vendor_representative: '홍길동',
        vendor_phone: '010-1234-5678',
        vendor_fax: '02-1234-5678',
        vendor_email: 'test@example.com',
        vendor_payment_schedule: '월말결제',
        is_active: true
      };

      const { data: insertData, error: insertError } = await supabase
        .from('vendors')
        .insert(testVendor)
        .select();

      if (insertError) {
        console.error('❌ Insert 실패 (예상된 컬럼명과 다름):', insertError.message);
        
        // 다른 컬럼명 조합 시도
        console.log('\n📝 다른 컬럼명으로 재시도...');
        const testVendor2 = {
          vendor_name: '스키마테스트2',
          is_active: true
        };

        const { data: insertData2, error: insertError2 } = await supabase
          .from('vendors')
          .insert(testVendor2)
          .select();

        if (insertError2) {
          console.error('❌ 최소 컬럼으로도 실패:', insertError2.message);
        } else {
          console.log('✅ 최소 컬럼 Insert 성공!');
          console.log('   생성된 데이터:', insertData2);
          
          // 테스트 데이터 삭제
          if (insertData2 && insertData2[0]) {
            await supabase.from('vendors').delete().eq('id', insertData2[0].id);
            console.log('   테스트 데이터 삭제 완료');
          }
        }
      } else {
        console.log('✅ Insert 성공!');
        console.log('   생성된 데이터의 컬럼들:', Object.keys(insertData[0]));
        
        // 테스트 데이터 삭제
        if (insertData && insertData[0]) {
          await supabase.from('vendors').delete().eq('id', insertData[0].id);
          console.log('   테스트 데이터 삭제 완료');
        }
      }
    }

    console.log('\n💡 실제 DB 컬럼명이 vendor_address, vendor_business_number 등으로 되어있는 것 같습니다.');
    console.log('   코드의 인터페이스와 서비스를 DB 스키마에 맞게 수정해야 합니다.');

  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error);
  }
}

// 실행
checkVendorSchema();