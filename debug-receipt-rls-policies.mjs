#!/usr/bin/env node

/**
 * purchase_receipts 테이블의 RLS 정책 확인
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

async function checkReceiptRLSPolicies() {
  console.log('🔍 purchase_receipts 테이블 RLS 정책 확인\n');

  try {
    // 1. 테이블 RLS 활성화 상태 확인
    console.log('1️⃣ 테이블 RLS 활성화 상태 확인...');
    
    const { data: tableInfo, error: tableError } = await supabase
      .rpc('exec_sql', { 
        sql: `
          SELECT 
            schemaname,
            tablename,
            rowsecurity
          FROM pg_tables 
          WHERE tablename = 'purchase_receipts'
        `
      });

    if (tableError) {
      console.log('직접 쿼리로 확인...');
      // 직접 SQL 실행
    } else {
      console.log('테이블 정보:', tableInfo);
    }

    // 2. RLS 정책 목록 확인
    console.log('\n2️⃣ RLS 정책 목록 확인...');
    
    const { data: policies, error: policyError } = await supabase
      .rpc('exec_sql', {
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
          ORDER BY cmd, policyname
        `
      });

    if (policyError) {
      console.log('❌ RLS 정책 조회 실패:', policyError);
    } else {
      console.log('🔍 purchase_receipts RLS 정책들:');
      if (policies && policies.length > 0) {
        policies.forEach(policy => {
          console.log(`\n📋 정책: ${policy.policyname}`);
          console.log(`   명령: ${policy.cmd}`);
          console.log(`   대상: ${policy.roles}`);
          console.log(`   조건: ${policy.qual || 'N/A'}`);
          console.log(`   체크: ${policy.with_check || 'N/A'}`);
        });
      } else {
        console.log('⚠️ purchase_receipts 테이블에 RLS 정책이 없습니다!');
      }
    }

    // 3. 기본 권한 확인
    console.log('\n3️⃣ 테이블 기본 권한 확인...');
    
    const { data: privileges, error: privError } = await supabase
      .rpc('exec_sql', {
        sql: `
          SELECT 
            grantee,
            privilege_type
          FROM information_schema.table_privileges 
          WHERE table_name = 'purchase_receipts'
          AND table_schema = 'public'
        `
      });

    if (privError) {
      console.log('❌ 권한 조회 실패:', privError);
    } else {
      console.log('📋 테이블 기본 권한:', privileges);
    }

    // 4. UPDATE 권한 특별 확인
    console.log('\n4️⃣ UPDATE 관련 정책 상세 확인...');
    
    const updatePolicies = policies?.filter(p => p.cmd === 'UPDATE') || [];
    
    if (updatePolicies.length === 0) {
      console.log('⚠️ UPDATE 정책이 없습니다!');
      console.log('🎯 이것이 문제의 원인입니다!');
      console.log('');
      console.log('해결 방법:');
      console.log('1. app_admin과 lead buyer가 모든 영수증을 UPDATE할 수 있는 정책 생성');
      console.log('2. 또는 자신이 업로드한 영수증만 UPDATE할 수 있는 정책 생성');
    } else {
      console.log('✅ UPDATE 정책 존재:');
      updatePolicies.forEach(policy => {
        console.log(`   - ${policy.policyname}: ${policy.qual}`);
      });
    }

    // 5. 정책 생성 제안
    console.log('\n5️⃣ 권장 RLS 정책 생성 SQL...');
    
    const suggestedPolicies = `
-- purchase_receipts UPDATE 정책 생성

-- 옵션 1: app_admin과 lead buyer가 모든 영수증 업데이트 가능
CREATE POLICY "Allow receipt update for admins and lead buyers"
ON purchase_receipts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees e
    WHERE e.email = auth.jwt() ->> 'email'
    AND (
      e.purchase_role ? 'app_admin' OR
      e.purchase_role ? 'lead buyer'
    )
  )
);

-- 옵션 2: 자신이 업로드한 영수증만 업데이트 가능 + 관리자
CREATE POLICY "Allow receipt update for uploaders and admins"
ON purchase_receipts
FOR UPDATE
TO authenticated
USING (
  uploaded_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM employees e
    WHERE e.email = auth.jwt() ->> 'email'
    AND (
      e.purchase_role ? 'app_admin' OR
      e.purchase_role ? 'lead buyer'
    )
  )
);
`;

    console.log(suggestedPolicies);

  } catch (error) {
    console.error('💥 확인 중 오류:', error);
  }

  console.log('\n🕒 분석 완료');
  process.exit(0);
}

checkReceiptRLSPolicies().catch(console.error);