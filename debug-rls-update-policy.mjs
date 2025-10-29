#!/usr/bin/env node

/**
 * RLS UPDATE 정책 문제 분석
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function analyzeRLSUpdatePolicy() {
  console.log('🔍 RLS UPDATE 정책 분석 시작\n');

  try {
    // 1. purchase_receipts 테이블의 RLS 정책 확인
    console.log('1️⃣ purchase_receipts RLS 정책 확인...');
    
    const { data: policies, error: policyError } = await supabase
      .rpc('get_table_policies', { table_name: 'purchase_receipts' })
      .catch(async () => {
        // fallback: 직접 SQL 쿼리
        return await supabase
          .from('pg_policies')
          .select('*')
          .eq('tablename', 'purchase_receipts');
      });

    if (policyError) {
      console.log('⚠️ RLS 정책 조회 실패 - 수동으로 확인 필요');
    } else {
      console.log('📋 RLS 정책 목록:');
      policies?.forEach(policy => {
        console.log(`- ${policy.policyname}: ${policy.cmd}`);
        console.log(`  조건: ${policy.qual || 'N/A'}`);
        console.log(`  체크: ${policy.with_check || 'N/A'}`);
      });
    }

    // 2. 영수증 ID 24 상세 정보 확인
    console.log('\n2️⃣ 영수증 ID 24 상세 정보...');
    
    const { data: receipt, error: receiptError } = await supabase
      .from('purchase_receipts')
      .select('*')
      .eq('id', 24)
      .single();

    if (receiptError) {
      console.log('❌ 영수증 조회 실패:', receiptError);
    } else {
      console.log('📄 영수증 정보:', {
        id: receipt.id,
        file_name: receipt.file_name,
        is_printed: receipt.is_printed,
        uploaded_by: receipt.uploaded_by,
        uploaded_by_name: receipt.uploaded_by_name,
        created_at: receipt.created_at
      });
    }

    // 3. test@hansl.com 사용자 정보
    console.log('\n3️⃣ test@hansl.com 사용자 정보...');
    
    const { data: testUser, error: testUserError } = await supabase
      .from('employees')
      .select('*')
      .eq('email', 'test@hansl.com')
      .single();

    if (testUserError) {
      console.log('❌ test 사용자 조회 실패:', testUserError);
    } else {
      console.log('👤 test 사용자:', {
        id: testUser.id,
        name: testUser.name,
        email: testUser.email,
        purchase_role: testUser.purchase_role
      });
    }

    // 4. 서버 권한으로 직접 업데이트 테스트
    console.log('\n4️⃣ 서버 권한으로 직접 업데이트 테스트...');
    
    const testUpdateData = {
      is_printed: true,
      printed_at: new Date().toISOString(),
      printed_by: 'test-server',
      printed_by_name: 'Server Test'
    };

    const { data: serverUpdateResult, error: serverUpdateError } = await supabase
      .from('purchase_receipts')
      .update(testUpdateData)
      .eq('id', 24)
      .select();

    if (serverUpdateError) {
      console.log('❌ 서버 권한 업데이트 실패:', serverUpdateError);
    } else {
      console.log('✅ 서버 권한 업데이트 성공:', {
        affectedRows: serverUpdateResult?.length || 0,
        result: serverUpdateResult?.[0]
      });

      // 원복
      await supabase
        .from('purchase_receipts')
        .update({
          is_printed: false,
          printed_at: null,
          printed_by: null,
          printed_by_name: null
        })
        .eq('id', 24);
      console.log('📝 원복 완료');
    }

    // 5. RLS가 있는 상태에서 anon 키 테스트
    console.log('\n5️⃣ anon 키로 업데이트 테스트...');
    
    const anonSupabase = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
    
    const { data: anonUpdateResult, error: anonUpdateError } = await anonSupabase
      .from('purchase_receipts')
      .update({
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: 'test-anon',
        printed_by_name: 'Anon Test'
      })
      .eq('id', 24)
      .select();

    if (anonUpdateError) {
      console.log('❌ anon 키 업데이트 실패:', anonUpdateError);
      console.log('🎯 이것이 실제 브라우저에서 발생하는 오류입니다!');
    } else {
      console.log('✅ anon 키 업데이트 성공:', {
        affectedRows: anonUpdateResult?.length || 0
      });
    }

    // 6. 문제 해결 방안 제시
    console.log('\n6️⃣ 문제 분석 및 해결 방안...');
    
    if (anonUpdateError) {
      console.log('🎯 문제 원인: RLS 정책이 UPDATE를 차단하고 있습니다');
      console.log('🔧 해결 방안:');
      console.log('1. purchase_receipts 테이블의 UPDATE 정책 수정');
      console.log('2. lead buyer 권한으로 is_printed 필드 업데이트 허용');
      console.log('3. 또는 특정 사용자가 업로드한 영수증만 업데이트 허용');
    } else {
      console.log('🤔 anon 키로도 업데이트가 되네요. 다른 원인일 수 있습니다.');
    }

  } catch (error) {
    console.error('💥 분석 중 오류:', error);
  }

  console.log('\n🕒 분석 완료');
  process.exit(0);
}

analyzeRLSUpdatePolicy().catch(console.error);