#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkReceiptsTableRLS() {
  console.log('🔍 purchase_receipts 테이블 RLS 정책 확인\n');
  
  try {
    // 1. 테이블 존재 여부 확인
    const { data: tableExists, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', 'purchase_receipts')
      .eq('table_schema', 'public')
      .single();
    
    if (!tableExists) {
      console.log('⚠️  purchase_receipts 테이블이 존재하지 않습니다.');
      return;
    }
    
    console.log('✅ purchase_receipts 테이블 확인됨\n');
    
    // 2. RLS 정책 조회
    const { data: policies, error: policiesError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          policyname,
          cmd,
          permissive,
          roles,
          qual,
          with_check
        FROM pg_policies 
        WHERE tablename = 'purchase_receipts'
        AND schemaname = 'public'
        ORDER BY cmd, policyname;
      `
    });
    
    if (policiesError) {
      console.error('❌ 정책 조회 실패:', policiesError);
    } else if (!policies || policies.length === 0) {
      console.log('⚠️  purchase_receipts 테이블에 RLS 정책이 없습니다!');
    } else {
      console.log('📋 현재 purchase_receipts 테이블의 RLS 정책:\n');
      
      // UPDATE 정책만 따로 표시
      const updatePolicies = policies.filter(p => p.cmd === 'UPDATE');
      
      if (updatePolicies.length === 0) {
        console.log('❌ UPDATE 정책이 없습니다! 이것이 문제입니다.\n');
      } else {
        console.log('UPDATE 정책:');
        updatePolicies.forEach(policy => {
          console.log(`  - ${policy.policyname}`);
          console.log(`    권한 조건: ${policy.qual || '없음'}`);
        });
      }
      
      console.log('\n전체 정책 목록:');
      policies.forEach(policy => {
        console.log(`\n정책: ${policy.policyname}`);
        console.log(`  - 명령: ${policy.cmd}`);
        console.log(`  - 권한 조건: ${policy.qual || '없음'}`);
      });
    }
    
    // 3. RLS 활성화 여부 확인
    const { data: rlsStatus, error: rlsError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT relrowsecurity
        FROM pg_class
        WHERE relname = 'purchase_receipts'
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
      `
    });
    
    if (!rlsError && rlsStatus && rlsStatus.length > 0) {
      console.log(`\n\nRLS 활성화 상태: ${rlsStatus[0].relrowsecurity ? '✅ 활성화됨' : '❌ 비활성화됨'}`);
    }
    
  } catch (error) {
    console.error('오류:', error);
  }
  
  process.exit(0);
}

checkReceiptsTableRLS();
