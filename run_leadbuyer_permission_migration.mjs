#!/usr/bin/env node

/**
 * Lead buyer 권한 추가 마이그레이션 실행
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 현재 파일의 디렉토리 경로 가져오기
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  console.log('🚀 Lead buyer 인쇄 권한 추가 마이그레이션 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 실행 시간: ${new Date().toLocaleString('ko-KR')}\n`);

  try {
    // 마이그레이션 파일 읽기
    const migrationPath = join(__dirname, 'scripts/migrations/20251029_add_leadbuyer_print_permission.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    console.log('📋 실행할 SQL:');
    console.log('─'.repeat(50));
    console.log(migrationSQL);
    console.log('─'.repeat(50));
    console.log('');
    
    // SQL 문을 개별적으로 실행
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      
      // 코멘트나 SELECT 문은 다르게 처리
      if (statement.trim().toUpperCase().startsWith('SELECT')) {
        console.log(`${i + 1}. 정책 확인 쿼리 실행 중...`);
        const { data, error } = await supabase.rpc('exec_sql', { 
          sql: statement 
        });
        
        if (error) {
          console.error(`❌ 쿼리 실행 실패: ${error.message}`);
        } else {
          console.log('✅ 현재 UPDATE 정책:');
          console.log(data);
        }
      } else {
        console.log(`${i + 1}. ${statement.substring(0, 50)}... 실행 중`);
        const { error } = await supabase.rpc('exec_sql', { 
          sql: statement 
        });
        
        if (error) {
          console.error(`❌ SQL 실행 실패: ${error.message}`);
          // DROP 문의 에러는 무시 (이미 없는 정책일 수 있음)
          if (!statement.toUpperCase().includes('DROP POLICY')) {
            throw error;
          }
        } else {
          console.log('✅ 성공');
        }
      }
    }
    
    console.log('\n📊 변경된 정책 확인...');
    const { data: policies, error: checkError } = await supabase
      .rpc('exec_sql', {
        sql: `
          SELECT 
            policyname,
            cmd,
            qual
          FROM pg_policies 
          WHERE tablename = 'purchase_request_items'
          AND cmd = 'UPDATE';
        `
      });
    
    if (!checkError && policies) {
      console.log('\n현재 purchase_request_items 테이블의 UPDATE 정책:');
      console.log(policies);
    }
    
    console.log('\n🎉 마이그레이션이 성공적으로 완료되었습니다!');
    console.log('✅ app_admin과 lead buyer 모두 인쇄 완료 업데이트가 가능합니다.');

  } catch (error) {
    console.error('\n💥 마이그레이션 실행 중 오류:', error);
    process.exit(1);
  }

  console.log(`\n🕒 완료 시간: ${new Date().toLocaleString('ko-KR')}`);
  process.exit(0);
}

// 실행
runMigration().catch(console.error);
