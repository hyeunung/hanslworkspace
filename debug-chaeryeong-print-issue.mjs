#!/usr/bin/env node

/**
 * 이채령 영수증 인쇄완료 실패 정확한 원인 분석
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
const anonSupabase = createClient(supabaseUrl, supabaseAnonKey);

async function findExactCause() {
  console.log('🔍 이채령 영수증 인쇄완료 실패 정확한 원인 분석 시작\n');

  try {
    // 1. 이채령 사용자 정보 정확히 확인
    console.log('1️⃣ 이채령 사용자 정보 상세 확인...');
    
    const { data: chaeryeong, error: chaeryeongError } = await adminSupabase
      .from('employees')
      .select('*')
      .eq('name', '이채령')
      .single();

    if (chaeryeongError) {
      console.log('❌ 이채령 정보 조회 실패:', chaeryeongError);
      return;
    }

    console.log('👤 이채령 정보:', {
      id: chaeryeong.id,
      email: chaeryeong.email,
      purchase_role: chaeryeong.purchase_role,
      purchase_role_type: typeof chaeryeong.purchase_role,
      purchase_role_array: Array.isArray(chaeryeong.purchase_role)
    });

    // 2. Auth 사용자로 이채령 찾기
    console.log('\n2️⃣ Auth 시스템에서 이채령 확인...');
    
    const { data: authUsers, error: authError } = await adminSupabase.auth.admin.listUsers();
    
    if (authError) {
      console.log('❌ Auth 사용자 목록 조회 실패:', authError);
    } else {
      const chaeryeongAuth = authUsers.users.find(user => user.email === chaeryeong.email);
      
      if (chaeryeongAuth) {
        console.log('✅ Auth 시스템에서 이채령 발견:', {
          id: chaeryeongAuth.id,
          email: chaeryeongAuth.email,
          created_at: chaeryeongAuth.created_at,
          last_sign_in_at: chaeryeongAuth.last_sign_in_at,
          email_confirmed_at: chaeryeongAuth.email_confirmed_at
        });
      } else {
        console.log('❌ Auth 시스템에서 이채령을 찾을 수 없음!');
        console.log('🎯 이것이 문제 원인일 수 있습니다!');
      }
    }

    // 3. 영수증 하나 선택해서 실제 업데이트 테스트
    console.log('\n3️⃣ 실제 업데이트 테스트...');
    
    const { data: testReceipt, error: receiptError } = await adminSupabase
      .from('purchase_receipts')
      .select('id, file_name, is_printed')
      .eq('is_printed', false)
      .limit(1)
      .single();

    if (receiptError) {
      console.log('⚠️ 테스트용 영수증을 찾을 수 없음');
    } else {
      console.log(`🧪 테스트 대상: ${testReceipt.file_name} (ID: ${testReceipt.id})`);

      // 이채령 권한으로 업데이트 시도 (실제 실행)
      console.log('\n🔬 이채령 권한으로 실제 업데이트 시도...');
      
      // anon 키 + 이채령 이메일로 RLS 컨텍스트 설정
      const { error: updateError } = await anonSupabase
        .from('purchase_receipts')
        .update({
          is_printed: true,
          printed_at: new Date().toISOString(),
          printed_by: chaeryeong.id,
          printed_by_name: chaeryeong.name
        })
        .eq('id', testReceipt.id);

      if (updateError) {
        console.log('❌ 업데이트 실패!');
        console.log('🎯 정확한 오류:', updateError);
        console.log('오류 코드:', updateError.code);
        console.log('오류 메시지:', updateError.message);
        console.log('오류 상세:', updateError.details);
        console.log('오류 힌트:', updateError.hint);
        
        // 이것이 실제 원인!
        if (updateError.code === '42501') {
          console.log('🎯 원인: 권한 부족 (insufficient_privilege)');
        } else if (updateError.code === '23503') {
          console.log('🎯 원인: 외래키 제약 위반');
        } else if (updateError.code === 'PGRST301') {
          console.log('🎯 원인: RLS 정책에 의한 접근 거부');
        }
      } else {
        console.log('✅ 업데이트 성공! (이상하네... 왜 실제로는 안되는거지?)');
        
        // 업데이트 롤백
        await adminSupabase
          .from('purchase_receipts')
          .update({
            is_printed: false,
            printed_at: null,
            printed_by: null,
            printed_by_name: null
          })
          .eq('id', testReceipt.id);
        console.log('📝 테스트 데이터 롤백 완료');
      }
    }

    // 4. RLS 정책 상세 확인
    console.log('\n4️⃣ RLS 정책 상세 확인...');
    
    const { data: policies, error: policyError } = await adminSupabase
      .rpc('pg_policies')
      .select()
      .eq('tablename', 'purchase_receipts');

    if (policyError) {
      console.log('❌ RLS 정책 조회 실패:', policyError);
    } else {
      console.log('📋 purchase_receipts RLS 정책:');
      policies?.forEach(policy => {
        console.log(`- ${policy.policyname}: ${policy.cmd} - ${policy.qual}`);
      });
    }

    // 5. 권한 문자열 파싱 테스트
    console.log('\n5️⃣ 권한 파싱 테스트...');
    
    const role = chaeryeong.purchase_role || '';
    console.log('원본 purchase_role:', role);
    console.log('타입:', typeof role);

    // 프론트엔드와 동일한 파싱 로직
    let roles = [];
    if (Array.isArray(role)) {
      roles = role.map(r => String(r).trim());
    } else {
      const roleString = String(role);
      roles = roleString.split(',').map(r => r.trim()).filter(r => r.length > 0);
    }

    console.log('파싱된 roles:', roles);
    
    const isAppAdmin = roles.includes('app_admin');
    const isHr = roles.includes('hr');
    const isLeadBuyer = roles.includes('lead buyer');
    const hasReceiptAccess = isAppAdmin || isHr || isLeadBuyer;

    console.log('권한 분석:', {
      isAppAdmin,
      isHr, 
      isLeadBuyer,
      hasReceiptAccess
    });

    // 6. 정현웅과 비교
    console.log('\n6️⃣ 정현웅과 비교...');
    
    const { data: hyeonwoong, error: hyeonwoongError } = await adminSupabase
      .from('employees')
      .select('*')
      .eq('name', '정현웅')
      .single();

    if (hyeonwoongError) {
      console.log('❌ 정현웅 정보 조회 실패');
    } else {
      console.log('정현웅 vs 이채령 비교:');
      console.log('정현웅 purchase_role:', hyeonwoong.purchase_role);
      console.log('이채령 purchase_role:', chaeryeong.purchase_role);
      console.log('타입 비교:', typeof hyeonwoong.purchase_role, 'vs', typeof chaeryeong.purchase_role);
      
      // Auth 사용자도 확인
      const hyeonwoongAuth = authUsers?.users?.find(user => user.email === hyeonwoong.email);
      const chaeryeongAuth = authUsers?.users?.find(user => user.email === chaeryeong.email);
      
      console.log('Auth 사용자 ID 비교:');
      console.log('정현웅:', hyeonwoongAuth?.id || '없음');
      console.log('이채령:', chaeryeongAuth?.id || '없음');
    }

    // 7. 브라우저에서 실행할 디버깅 스크립트 생성
    console.log('\n7️⃣ 브라우저 디버깅 스크립트 생성...');
    
    const browserScript = `
// 이채령 브라우저에서 실행할 디버깅 스크립트
console.log('🔍 이채령 브라우저 디버깅 시작');

// 1. 현재 사용자 확인
window.supabase.auth.getUser().then(({ data: { user }, error }) => {
  console.log('현재 로그인 사용자:', user?.email);
  console.log('사용자 ID:', user?.id);
  
  if (error) {
    console.log('❌ 사용자 정보 오류:', error);
  }
});

// 2. 직원 정보 확인
window.supabase.from('employees')
  .select('*')
  .eq('email', '${chaeryeong.email}')
  .single()
  .then(({ data, error }) => {
    console.log('직원 정보:', data);
    if (error) console.log('❌ 직원 정보 오류:', error);
  });

// 3. 실제 업데이트 테스트 (영수증 ID ${testReceipt?.id || 'XX'})
async function testUpdate() {
  const receiptId = '${testReceipt?.id || ''}';
  if (!receiptId) {
    console.log('테스트할 영수증이 없습니다');
    return;
  }
  
  console.log('📝 업데이트 테스트 시작...');
  
  const { data: { user } } = await window.supabase.auth.getUser();
  const { data: employee } = await window.supabase
    .from('employees')
    .select('name')
    .eq('email', user.email)
    .single();

  const { error } = await window.supabase
    .from('purchase_receipts')
    .update({
      is_printed: true,
      printed_at: new Date().toISOString(),
      printed_by: user.id,
      printed_by_name: employee?.name || user.email
    })
    .eq('id', receiptId);

  if (error) {
    console.log('❌ 업데이트 실패!');
    console.log('정확한 오류:', error);
  } else {
    console.log('✅ 업데이트 성공!');
  }
}

// 테스트 실행
testUpdate();
`;

    console.log('📋 이채령에게 브라우저 콘솔에서 실행하라고 전달할 스크립트:');
    console.log('='.repeat(80));
    console.log(browserScript);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('💥 분석 중 오류:', error);
  }

  console.log('\n🕒 분석 완료');
  process.exit(0);
}

findExactCause().catch(console.error);