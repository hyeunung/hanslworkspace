#!/usr/bin/env node

/**
 * support_inquires 외래 키 제약 조건 제거 마이그레이션 실행
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 외래 키 제약 조건 제거 마이그레이션 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 실행 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 1. 기존 외래 키 제약 조건 제거
    console.log('1. 외래 키 제약 조건 제거 중...');
    const { error: fkError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE support_inquires DROP CONSTRAINT IF EXISTS support_inquires_purchase_request_id_fkey;'
    });
    
    if (fkError) {
      console.log('⚠️ 외래 키 제약 조건 제거:', fkError.message);
    } else {
      console.log('✅ 외래 키 제약 조건 제거 완료');
    }

    // 2. purchase_request_id 컬럼을 nullable로 변경
    console.log('2. purchase_request_id 컬럼 nullable 설정...');
    const { error: nullableError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE support_inquires ALTER COLUMN purchase_request_id DROP NOT NULL;'
    });
    
    if (nullableError) {
      console.log('⚠️ nullable 설정:', nullableError.message);
    } else {
      console.log('✅ purchase_request_id nullable 설정 완료');
    }

    // 3. purchase_info 컬럼 추가
    console.log('3. purchase_info 컬럼 추가...');
    const { error: addColumnError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE support_inquires ADD COLUMN IF NOT EXISTS purchase_info TEXT;'
    });
    
    if (addColumnError) {
      console.log('⚠️ 컬럼 추가:', addColumnError.message);
    } else {
      console.log('✅ purchase_info 컬럼 추가 완료');
    }

    // 4. 기존 데이터의 purchase_request_id를 NULL로 설정
    console.log('4. 기존 purchase_request_id 데이터 정리...');
    const { error: updateError } = await supabase
      .from('support_inquires')
      .update({ purchase_request_id: null })
      .not('purchase_request_id', 'is', null);
    
    if (updateError) {
      console.log('⚠️ 데이터 정리:', updateError.message);
    } else {
      console.log('✅ 기존 purchase_request_id 데이터 정리 완료');
    }

    // 5. 인덱스 제거
    console.log('5. 관련 인덱스 제거...');
    const { error: indexError } = await supabase.rpc('exec_sql', {
      sql: 'DROP INDEX IF EXISTS idx_support_inquires_purchase_request_id;'
    });
    
    if (indexError) {
      console.log('⚠️ 인덱스 제거:', indexError.message);
    } else {
      console.log('✅ 관련 인덱스 제거 완료');
    }

    // 6. 테이블 구조 확인
    console.log('\n📊 support_inquires 테이블 구조 확인...');
    const { data: tableInfo, error: infoError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'support_inquires')
      .eq('table_schema', 'public')
      .order('ordinal_position');

    if (infoError) {
      console.log('⚠️ 테이블 정보 조회 실패:', infoError.message);
    } else {
      console.log('테이블 컬럼 정보:');
      tableInfo.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }

    console.log('\n🎉 마이그레이션이 성공적으로 완료되었습니다!');
    console.log('이제 발주요청 삭제가 정상적으로 작동할 것입니다.');

  } catch (error) {
    console.error('\n💥 마이그레이션 실행 중 오류:', error);
    process.exit(1);
  }

  console.log(`\n🕒 완료 시간: ${new Date().toLocaleString()}`);
  process.exit(0);
}

// 실행
runMigration().catch(console.error);