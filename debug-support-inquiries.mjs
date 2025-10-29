#!/usr/bin/env node

/**
 * 문의하기 내역 표시 문제 진단 스크립트
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

async function diagnoseSupportInquiries() {
  console.log('🔍 문의하기 내역 표시 문제 진단 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 진단 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 1. support_inquires 테이블 존재 확인
    console.log('1️⃣ support_inquires 테이블 존재 확인...');
    const { data: tableCheck, error: tableError } = await supabase
      .from('support_inquires')
      .select('count(*)')
      .limit(1);

    if (tableError) {
      console.log('❌ 테이블 접근 실패:', tableError.message);
      if (tableError.message.includes('does not exist')) {
        console.log('🎯 support_inquires 테이블이 존재하지 않습니다!');
        console.log('   → 테이블을 생성해야 합니다.');
        return;
      }
    } else {
      console.log('✅ support_inquires 테이블 접근 가능');
    }

    // 2. 전체 문의 데이터 확인
    console.log('\n2️⃣ 전체 문의 데이터 확인...');
    const { data: allInquiries, error: allError } = await supabase
      .from('support_inquires')
      .select('*')
      .order('created_at', { ascending: false });

    if (allError) {
      console.log('❌ 전체 문의 조회 실패:', allError.message);
      console.log('오류 상세:', allError);
    } else {
      console.log(`✅ 전체 문의 수: ${allInquiries?.length || 0}건`);
      
      if (allInquiries && allInquiries.length > 0) {
        console.log('최근 문의 3건:');
        allInquiries.slice(0, 3).forEach((inquiry, index) => {
          console.log(`  ${index + 1}. [${inquiry.inquiry_type}] ${inquiry.subject}`);
          console.log(`     - 작성자: ${inquiry.user_name || inquiry.user_email}`);
          console.log(`     - 작성일: ${inquiry.created_at}`);
          console.log(`     - 상태: ${inquiry.status}`);
        });
      } else {
        console.log('📋 등록된 문의가 없습니다.');
      }
    }

    // 3. 사용자별 문의 확인
    console.log('\n3️⃣ 사용자별 문의 분포 확인...');
    const { data: userStats, error: userError } = await supabase
      .from('support_inquires')
      .select('user_email, user_name')
      .not('user_email', 'is', null);

    if (userError) {
      console.log('❌ 사용자별 통계 조회 실패:', userError.message);
    } else {
      const userCounts = {};
      userStats?.forEach(inquiry => {
        const key = inquiry.user_email || 'unknown';
        userCounts[key] = (userCounts[key] || 0) + 1;
      });

      console.log('사용자별 문의 수:');
      Object.entries(userCounts).forEach(([email, count]) => {
        console.log(`  - ${email}: ${count}건`);
      });
    }

    // 4. RLS 정책 확인
    console.log('\n4️⃣ RLS 정책 문제 확인...');
    
    // 테스트용 사용자로 문의 조회 시도
    const testEmails = ['test@hansl.com', 'admin@hansl.com'];
    
    for (const email of testEmails) {
      console.log(`\n🧪 ${email} 계정으로 문의 조회 테스트...`);
      
      // 해당 이메일의 user_id 찾기
      const { data: userData, error: userQueryError } = await supabase
        .from('support_inquires')
        .select('user_id, user_email')
        .eq('user_email', email)
        .limit(1);

      if (userQueryError) {
        console.log(`❌ ${email} 문의 조회 실패:`, userQueryError.message);
      } else if (userData && userData.length > 0) {
        const userId = userData[0].user_id;
        console.log(`✅ ${email} 사용자 ID: ${userId}`);
        
        // 해당 사용자의 문의 수 확인
        const { data: userInquiries, error: userInquiryError } = await supabase
          .from('support_inquires')
          .select('*')
          .eq('user_id', userId);

        if (userInquiryError) {
          console.log(`❌ ${email} 사용자 문의 조회 실패:`, userInquiryError.message);
        } else {
          console.log(`📊 ${email} 사용자 문의 수: ${userInquiries?.length || 0}건`);
        }
      } else {
        console.log(`⚠️ ${email} 사용자의 문의가 없습니다.`);
      }
    }

    // 5. 테이블 스키마 확인
    console.log('\n5️⃣ 테이블 스키마 확인...');
    const { data: sampleData, error: sampleError } = await supabase
      .from('support_inquires')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.log('❌ 샘플 데이터 조회 실패:', sampleError.message);
    } else if (sampleData && sampleData.length > 0) {
      console.log('✅ 테이블 컬럼 구조:');
      const sample = sampleData[0];
      Object.keys(sample).forEach(key => {
        const value = sample[key];
        const type = value === null ? 'null' : typeof value;
        console.log(`  - ${key}: ${type}`);
      });
    } else {
      console.log('⚠️ 테이블에 데이터가 없어서 스키마를 확인할 수 없습니다.');
    }

    // 6. 권한 문제 진단
    console.log('\n6️⃣ 권한 문제 진단...');
    
    // anon 키로 접근 시도 (실제 앱에서 사용하는 방식)
    const anonSupabase = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
    
    const { data: anonData, error: anonError } = await anonSupabase
      .from('support_inquires')
      .select('*')
      .limit(1);

    if (anonError) {
      console.log('❌ anon 키로 접근 실패:', anonError.message);
      if (anonError.message.includes('RLS') || anonError.message.includes('permission')) {
        console.log('🎯 RLS 정책 문제로 추정됩니다!');
        console.log('   → Supabase 대시보드에서 RLS 정책을 확인해야 합니다.');
      }
    } else {
      console.log('✅ anon 키로 접근 가능');
    }

    console.log('\n📋 진단 결과 요약:');
    console.log('1. 테이블 존재 여부 확인 완료');
    console.log('2. 데이터 존재 여부 확인 완료'); 
    console.log('3. 사용자별 분포 확인 완료');
    console.log('4. RLS 정책 문제 확인 완료');
    console.log('5. 테이블 스키마 확인 완료');
    console.log('6. 권한 문제 진단 완료');

    console.log('\n💡 문제 해결 방안:');
    console.log('- 브라우저 콘솔에서 에러 메시지 확인');
    console.log('- Network 탭에서 API 요청 실패 여부 확인');
    console.log('- RLS 정책이 올바르게 설정되어 있는지 확인');
    console.log('- 사용자 인증 상태 확인');

  } catch (error) {
    console.error('\n💥 진단 중 오류 발생:', error);
  }

  console.log(`\n🕒 진단 완료 시간: ${new Date().toLocaleString()}`);
  process.exit(0);
}

// 실행
diagnoseSupportInquiries().catch(console.error);