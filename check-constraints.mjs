#!/usr/bin/env node

/**
 * support_inquires 테이블의 제약 조건 확인
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkConstraints() {
  console.log('🔍 support_inquires 테이블 제약 조건 확인\n');

  try {
    // 1. 테이블 스키마 확인
    console.log('📊 테이블 스키마 확인...');
    const { data: schemaData, error: schemaError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_name', 'support_inquires')
      .eq('table_schema', 'public')
      .order('ordinal_position');

    if (schemaError) {
      console.log('❌ 스키마 조회 실패. 시스템 테이블 접근 시도...');
      
      // 2. 시스템 테이블로 직접 확인
      const { data, error } = await supabase
        .from('support_inquires')
        .select('*')
        .limit(1);
      
      if (error) {
        console.log('❌ 테이블 접근 실패:', error.message);
        if (error.message.includes('violates foreign key constraint')) {
          console.log('🎯 외래 키 제약 조건이 여전히 존재합니다!');
          console.log('데이터베이스 관리자 권한으로 수동 제거가 필요합니다.');
        }
      } else {
        console.log('✅ 테이블 접근 가능');
        console.log('테이블의 첫 번째 레코드 확인됨');
      }
    } else {
      console.log('✅ 테이블 스키마:');
      schemaData.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
      
      // purchase_info 컬럼 존재 확인
      const hasPurchaseInfo = schemaData.some(col => col.column_name === 'purchase_info');
      if (hasPurchaseInfo) {
        console.log('✅ purchase_info 컬럼이 존재합니다.');
      } else {
        console.log('⚠️ purchase_info 컬럼이 없습니다.');
      }
    }

    // 3. 실제 데이터 삭제 테스트
    console.log('\n🧪 실제 삭제 테스트...');
    
    // 먼저 테스트용 발주요청 생성 시도
    console.log('테스트용 데이터 생성 확인...');
    const { data: testData, error: testError } = await supabase
      .from('purchase_requests')
      .select('id, purchase_order_number')
      .limit(1)
      .single();

    if (testError) {
      console.log('⚠️ 테스트 데이터 조회 실패:', testError.message);
    } else if (testData) {
      console.log(`📋 테스트 대상: ${testData.purchase_order_number} (ID: ${testData.id})`);
      
      // 해당 발주요청에 연결된 support_inquires가 있는지 확인
      const { data: linkedInquiries, error: linkedError } = await supabase
        .from('support_inquires')
        .select('id, subject')
        .eq('purchase_request_id', testData.id);

      if (linkedError) {
        console.log('⚠️ 연결된 문의 확인 실패:', linkedError.message);
      } else {
        if (linkedInquiries && linkedInquiries.length > 0) {
          console.log(`⚠️ 이 발주요청에 연결된 문의 ${linkedInquiries.length}개 발견`);
          console.log('🎯 이것이 삭제를 막는 외래 키 제약 조건의 원인입니다!');
        } else {
          console.log('✅ 이 발주요청에는 연결된 문의가 없습니다.');
        }
      }
    }

    console.log('\n💡 해결 방법:');
    console.log('1. Supabase 대시보드 → Database → Tables에서 support_inquires 테이블 선택');
    console.log('2. Structure 탭에서 Foreign Keys 섹션 확인');
    console.log('3. purchase_request_id와 관련된 외래 키가 있다면 삭제');
    console.log('4. 또는 SQL Editor에서 다음 명령 실행:');
    console.log('   ALTER TABLE support_inquires DROP CONSTRAINT IF EXISTS support_inquires_purchase_request_id_fkey;');

  } catch (error) {
    console.error('💥 오류:', error);
  }

  process.exit(0);
}

checkConstraints().catch(console.error);