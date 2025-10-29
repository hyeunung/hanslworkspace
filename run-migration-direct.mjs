#!/usr/bin/env node

/**
 * support_inquires 외래 키 제약 조건 제거 (직접 SQL 실행)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runDirectSQL(sql, description) {
  console.log(`🔄 ${description}...`);
  try {
    const { data, error } = await supabase.rpc('sql', { query: sql });
    if (error) {
      console.log(`⚠️ ${description}:`, error.message);
      return false;
    } else {
      console.log(`✅ ${description} 완료`);
      return true;
    }
  } catch (e) {
    console.log(`❌ ${description} 실패:`, e.message);
    return false;
  }
}

async function runMigration() {
  console.log('🚀 외래 키 제약 조건 제거 마이그레이션 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 실행 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 1. 먼저 현재 테이블 상태 확인
    console.log('📊 현재 테이블 상태 확인...');
    const { data: tableData, error: tableError } = await supabase
      .from('support_inquires')
      .select('*')
      .limit(1);

    if (tableError) {
      console.log('⚠️ 테이블 접근 확인:', tableError.message);
    } else {
      console.log('✅ support_inquires 테이블 접근 가능');
    }

    // 2. 외래 키 제약 조건 확인
    console.log('\n🔍 외래 키 제약 조건 확인...');
    const { data, error } = await supabase.rpc('sql', {
      query: `
        SELECT 
          conname as constraint_name,
          pg_get_constraintdef(oid) as constraint_definition
        FROM pg_constraint 
        WHERE conrelid = 'support_inquires'::regclass 
        AND contype = 'f';
      `
    });

    if (error) {
      console.log('⚠️ 제약 조건 조회 실패:', error.message);
    } else {
      console.log('현재 외래 키 제약 조건:');
      if (data && data.length > 0) {
        data.forEach(constraint => {
          console.log(`  - ${constraint.constraint_name}: ${constraint.constraint_definition}`);
        });
      } else {
        console.log('  외래 키 제약 조건이 없습니다.');
      }
    }

    // 3. 제약 조건 제거 시도
    const constraintNames = [
      'support_inquires_purchase_request_id_fkey',
      'support_inquires_purchase_request_id_fkey1',
      'fk_support_inquires_purchase_request'
    ];

    for (const constraintName of constraintNames) {
      await runDirectSQL(
        `ALTER TABLE support_inquires DROP CONSTRAINT IF EXISTS ${constraintName};`,
        `외래 키 제약 조건 ${constraintName} 제거`
      );
    }

    // 4. 컬럼 추가
    await runDirectSQL(
      `ALTER TABLE support_inquires ADD COLUMN IF NOT EXISTS purchase_info TEXT;`,
      'purchase_info 컬럼 추가'
    );

    // 5. 기존 데이터 정리
    console.log('\n📝 기존 데이터 정리...');
    const { data: updateData, error: updateError } = await supabase
      .from('support_inquires')
      .update({ purchase_request_id: null })
      .not('purchase_request_id', 'is', null);

    if (updateError) {
      console.log('⚠️ 데이터 정리:', updateError.message);
    } else {
      console.log('✅ 기존 purchase_request_id 데이터 정리 완료');
    }

    // 6. 최종 확인
    console.log('\n🔍 최종 외래 키 제약 조건 확인...');
    const { data: finalData, error: finalError } = await supabase.rpc('sql', {
      query: `
        SELECT 
          conname as constraint_name,
          pg_get_constraintdef(oid) as constraint_definition
        FROM pg_constraint 
        WHERE conrelid = 'support_inquires'::regclass 
        AND contype = 'f';
      `
    });

    if (finalError) {
      console.log('⚠️ 최종 확인 실패:', finalError.message);
    } else {
      console.log('최종 외래 키 제약 조건:');
      if (finalData && finalData.length > 0) {
        finalData.forEach(constraint => {
          console.log(`  - ${constraint.constraint_name}: ${constraint.constraint_definition}`);
        });
        console.log('⚠️ 아직 외래 키 제약 조건이 남아있습니다.');
      } else {
        console.log('✅ 모든 외래 키 제약 조건이 제거되었습니다!');
      }
    }

    console.log('\n🎉 마이그레이션 작업이 완료되었습니다!');
    console.log('이제 발주요청 삭제를 다시 테스트해보세요.');

  } catch (error) {
    console.error('\n💥 마이그레이션 실행 중 오류:', error);
    process.exit(1);
  }

  console.log(`\n🕒 완료 시간: ${new Date().toLocaleString()}`);
  process.exit(0);
}

// 실행
runMigration().catch(console.error);