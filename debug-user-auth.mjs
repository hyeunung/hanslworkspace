#!/usr/bin/env node

/**
 * 사용자 인증 및 문의 조회 문제 진단
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugUserAuth() {
  console.log('🔍 사용자 인증 및 문의 조회 문제 진단\n');

  try {
    // 1. 현재 인증 상태 확인
    console.log('1️⃣ 현재 인증 상태 확인...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.log('❌ 인증 확인 실패:', authError.message);
      console.log('🎯 사용자가 로그인되어 있지 않습니다!');
      console.log('   → 웹 애플리케이션에서 로그인 후 다시 시도하세요.');
      return;
    }

    if (!user) {
      console.log('⚠️ 로그인된 사용자가 없습니다.');
      console.log('💡 해결 방법:');
      console.log('1. 웹 브라우저에서 HANSL 웹앱에 로그인');
      console.log('2. 브라우저 개발자 도구 → Console에서 다음 코드 실행:');
      console.log('   localStorage.getItem("supabase-auth-token")');
      console.log('3. 토큰이 있는지 확인');
      return;
    }

    console.log('✅ 로그인된 사용자:', user.email);
    console.log('   - User ID:', user.id);

    // 2. employees 테이블에서 사용자 정보 확인
    console.log('\n2️⃣ employees 테이블에서 사용자 정보 확인...');
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('id, name, email, purchase_role')
      .eq('email', user.email)
      .single();

    if (empError) {
      console.log('❌ 직원 정보 조회 실패:', empError.message);
      console.log('🎯 employees 테이블에 사용자 정보가 없을 수 있습니다!');
      return;
    }

    if (!employee) {
      console.log('❌ employees 테이블에 사용자 정보가 없습니다.');
      console.log('🎯 이것이 문제의 원인일 수 있습니다!');
      return;
    }

    console.log('✅ 직원 정보 확인:');
    console.log('   - 이름:', employee.name);
    console.log('   - 이메일:', employee.email);
    console.log('   - 권한:', employee.purchase_role);

    // 권한 파싱
    let roles = [];
    if (employee.purchase_role) {
      if (Array.isArray(employee.purchase_role)) {
        roles = employee.purchase_role;
      } else {
        roles = employee.purchase_role.split(',').map(r => r.trim());
      }
    }
    const isAdmin = roles.includes('app_admin');
    console.log('   - 관리자 여부:', isAdmin);

    // 3. 내 문의 조회 테스트
    console.log('\n3️⃣ 내 문의 조회 테스트...');
    const { data: myInquiries, error: myError } = await supabase
      .from('support_inquires')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (myError) {
      console.log('❌ 내 문의 조회 실패:', myError.message);
      console.log('🎯 RLS 정책 문제일 수 있습니다!');
      
      // RLS 정책 우회해서 확인
      console.log('\n🔧 user_email로 조회 시도...');
      const { data: emailInquiries, error: emailError } = await supabase
        .from('support_inquires')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });

      if (emailError) {
        console.log('❌ user_email로도 조회 실패:', emailError.message);
      } else {
        console.log('✅ user_email로 조회 성공:', emailInquiries?.length || 0, '건');
        if (emailInquiries && emailInquiries.length > 0) {
          console.log('🎯 문제 발견: user_id와 실제 데이터의 user_id가 다릅니다!');
          console.log('실제 데이터의 user_id:', emailInquiries[0].user_id);
          console.log('현재 로그인 user_id:', user.id);
        }
      }
    } else {
      console.log('✅ 내 문의 조회 성공:', myInquiries?.length || 0, '건');
      if (myInquiries && myInquiries.length > 0) {
        console.log('최근 문의:');
        myInquiries.slice(0, 3).forEach((inquiry, index) => {
          console.log(`  ${index + 1}. [${inquiry.inquiry_type}] ${inquiry.subject}`);
        });
      }
    }

    // 4. 관리자라면 전체 문의 조회 테스트
    if (isAdmin) {
      console.log('\n4️⃣ 관리자 전체 문의 조회 테스트...');
      const { data: allInquiries, error: allError } = await supabase
        .from('support_inquires')
        .select('*')
        .order('created_at', { ascending: false });

      if (allError) {
        console.log('❌ 전체 문의 조회 실패:', allError.message);
      } else {
        console.log('✅ 전체 문의 조회 성공:', allInquiries?.length || 0, '건');
      }
    }

    // 5. 문제 해결 방안 제시
    console.log('\n💡 문제 해결 방안:');
    
    if (myInquiries && myInquiries.length === 0) {
      console.log('📋 현재 사용자의 문의가 없습니다.');
      console.log('1. 문의를 새로 작성해서 테스트해보세요.');
      console.log('2. 다른 사용자 계정으로 로그인해서 확인해보세요.');
    }

    console.log('3. 브라우저에서 문의하기 페이지의 콘솔 로그를 확인하세요.');
    console.log('4. Network 탭에서 API 요청이 실패하는지 확인하세요.');

  } catch (error) {
    console.error('\n💥 진단 중 오류 발생:', error);
  }

  process.exit(0);
}

// 실행
debugUserAuth().catch(console.error);