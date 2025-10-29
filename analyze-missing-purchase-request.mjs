#!/usr/bin/env node

/**
 * 10/29 발주요청이 발주요청관리에서 안 보이는 문제 분석
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

async function analyzeMissingPurchaseRequest() {
  console.log('🔍 10/29 발주요청 미표시 문제 분석 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 분석 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 1. 10/29 날짜의 모든 발주요청 확인
    console.log('1️⃣ 10/29 날짜의 발주요청 전체 확인...');
    const today = '2025-10-29';
    
    const { data: todayRequests, error: todayError } = await supabase
      .from('purchase_requests')
      .select('*')
      .gte('request_date', today)
      .lt('request_date', '2025-10-30')
      .order('created_at', { ascending: false });

    if (todayError) {
      console.log('❌ 10/29 발주요청 조회 실패:', todayError.message);
      return;
    }

    console.log(`📊 10/29 발주요청 총 ${todayRequests?.length || 0}건 발견`);
    
    if (todayRequests && todayRequests.length > 0) {
      console.log('\n10/29 발주요청 목록:');
      todayRequests.forEach((req, index) => {
        console.log(`  ${index + 1}. ${req.purchase_order_number} (ID: ${req.id})`);
        console.log(`     - 요청자: ${req.requester_name}`);
        console.log(`     - 상태: ${req.middle_manager_status}/${req.final_manager_status}`);
        console.log(`     - 생성시간: ${req.created_at}`);
        console.log(`     - 요청일: ${req.request_date}`);
      });
    } else {
      console.log('⚠️ 10/29 발주요청이 없습니다.');
      console.log('   → 실제로 발주요청이 생성되지 않았을 수 있습니다.');
      return;
    }

    // 2. created_at 기준으로도 확인 (오늘 생성된 모든 요청)
    console.log('\n2️⃣ 오늘 생성된 발주요청 확인 (created_at 기준)...');
    const todayStart = '2025-10-29T00:00:00Z';
    const todayEnd = '2025-10-30T00:00:00Z';

    const { data: createdTodayRequests, error: createdTodayError } = await supabase
      .from('purchase_requests')
      .select('*')
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)
      .order('created_at', { ascending: false });

    if (createdTodayError) {
      console.log('❌ 오늘 생성된 발주요청 조회 실패:', createdTodayError.message);
    } else {
      console.log(`📊 오늘 생성된 발주요청 총 ${createdTodayRequests?.length || 0}건`);
      
      if (createdTodayRequests && createdTodayRequests.length > 0) {
        console.log('오늘 생성된 발주요청:');
        createdTodayRequests.forEach((req, index) => {
          console.log(`  ${index + 1}. ${req.purchase_order_number} (ID: ${req.id})`);
          console.log(`     - 생성시간: ${req.created_at}`);
          console.log(`     - 요청일: ${req.request_date}`);
        });
      }
    }

    // 3. 가장 최근 발주요청들 확인 (시간순)
    console.log('\n3️⃣ 가장 최근 발주요청 10건 확인...');
    const { data: recentRequests, error: recentError } = await supabase
      .from('purchase_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentError) {
      console.log('❌ 최근 발주요청 조회 실패:', recentError.message);
    } else {
      console.log('최근 발주요청 10건:');
      recentRequests?.forEach((req, index) => {
        const isToday = req.created_at.startsWith('2025-10-29');
        console.log(`  ${index + 1}. ${req.purchase_order_number} ${isToday ? '🆕' : ''}`);
        console.log(`     - 생성: ${req.created_at}`);
        console.log(`     - 요청일: ${req.request_date}`);
        console.log(`     - 요청자: ${req.requester_name}`);
      });
    }

    // 4. 발주요청관리 화면에서 사용하는 쿼리 시뮬레이션
    console.log('\n4️⃣ 발주요청관리 화면 쿼리 시뮬레이션...');
    
    // 실제 앱에서 사용하는 쿼리 재현
    const { data: dashboardData, error: dashboardError } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_items(
          id,
          line_number,
          item_name,
          specification,
          quantity,
          unit_price_value,
          unit_price_currency,
          amount_value,
          amount_currency,
          remark,
          link,
          is_received,
          received_quantity,
          received_date
        )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (dashboardError) {
      console.log('❌ 대시보드 쿼리 실패:', dashboardError.message);
      console.log('🎯 이것이 발주요청관리에서 안 보이는 원인일 수 있습니다!');
      console.log('오류 상세:', dashboardError);
    } else {
      console.log(`✅ 대시보드 쿼리 성공: ${dashboardData?.length || 0}건 조회`);
      
      // 10/29 데이터가 포함되어 있는지 확인
      const todayInDashboard = dashboardData?.filter(req => 
        req.created_at.startsWith('2025-10-29') || req.request_date === '2025-10-29'
      );
      
      console.log(`📊 대시보드 결과에 10/29 발주요청: ${todayInDashboard?.length || 0}건`);
      
      if (todayInDashboard && todayInDashboard.length > 0) {
        console.log('✅ 10/29 발주요청이 대시보드 쿼리에 포함됨');
        todayInDashboard.forEach(req => {
          console.log(`  - ${req.purchase_order_number}: 품목 ${req.purchase_request_items?.length || 0}개`);
        });
      } else {
        console.log('❌ 10/29 발주요청이 대시보드 쿼리에 포함되지 않음');
        console.log('🎯 조인 관련 문제이거나 RLS 정책 문제일 수 있습니다!');
      }
    }

    // 5. 품목 데이터 확인
    if (todayRequests && todayRequests.length > 0) {
      console.log('\n5️⃣ 10/29 발주요청의 품목 데이터 확인...');
      
      for (const req of todayRequests) {
        const { data: items, error: itemsError } = await supabase
          .from('purchase_request_items')
          .select('*')
          .eq('purchase_request_id', req.id);

        if (itemsError) {
          console.log(`❌ ${req.purchase_order_number} 품목 조회 실패:`, itemsError.message);
          console.log('🎯 품목 데이터 문제로 인해 발주요청이 안 보일 수 있습니다!');
        } else {
          console.log(`📦 ${req.purchase_order_number}: 품목 ${items?.length || 0}개`);
          if (!items || items.length === 0) {
            console.log('⚠️ 품목이 없습니다! 이것이 문제 원인일 수 있습니다.');
          }
        }
      }
    }

    // 6. RLS 정책 확인
    console.log('\n6️⃣ RLS 정책 확인...');
    
    // anon 키로 접근해보기 (실제 앱과 동일한 권한)
    const anonSupabase = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
    
    const { data: anonData, error: anonError } = await anonSupabase
      .from('purchase_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (anonError) {
      console.log('❌ anon 키로 발주요청 조회 실패:', anonError.message);
      console.log('🎯 RLS 정책 문제로 발주요청이 안 보일 수 있습니다!');
    } else {
      console.log(`✅ anon 키로 조회 성공: ${anonData?.length || 0}건`);
      
      const todayInAnon = anonData?.filter(req => 
        req.created_at.startsWith('2025-10-29') || req.request_date === '2025-10-29'
      );
      
      if (todayInAnon && todayInAnon.length > 0) {
        console.log('✅ anon 키로도 10/29 발주요청 접근 가능');
      } else {
        console.log('❌ anon 키로는 10/29 발주요청 접근 불가');
        console.log('🎯 RLS 정책이 특정 발주요청을 차단하고 있을 수 있습니다!');
      }
    }

    // 7. 필터링 조건 확인
    console.log('\n7️⃣ 발주요청관리 필터링 조건 확인...');
    console.log('일반적인 필터링 조건들:');
    console.log('- 날짜 범위 필터');
    console.log('- 상태 필터 (승인대기, 완료 등)');
    console.log('- 요청자 필터');
    console.log('- 검색어 필터');
    
    if (todayRequests && todayRequests.length > 0) {
      const req = todayRequests[0];
      console.log('\n첫 번째 10/29 발주요청 상세 정보:');
      console.log(`- ID: ${req.id}`);
      console.log(`- 발주번호: ${req.purchase_order_number}`);
      console.log(`- 요청자: ${req.requester_name}`);
      console.log(`- 중간관리자 상태: ${req.middle_manager_status}`);
      console.log(`- 최종관리자 상태: ${req.final_manager_status}`);
      console.log(`- 생성일시: ${req.created_at}`);
      console.log(`- 요청일: ${req.request_date}`);
      console.log(`- 업체: ${req.vendor_name}`);
      console.log(`- 금액: ${req.total_amount}`);
    }

    console.log('\n📋 분석 결과 요약:');
    console.log('='.repeat(50));
    
    if (!todayRequests || todayRequests.length === 0) {
      console.log('🎯 주요 발견: 10/29 발주요청이 실제로 존재하지 않음');
      console.log('   → 발주요청이 실제로 생성되지 않았거나 다른 날짜로 생성됨');
    } else {
      console.log('✅ 10/29 발주요청 존재 확인됨');
      console.log('🔍 추가 조사 필요 영역:');
      
      if (dashboardError) {
        console.log('   1. 대시보드 쿼리 오류 - 조인 관련 문제');
      }
      
      console.log('   2. 프론트엔드 필터링 로직');
      console.log('   3. 날짜/시간 표시 로직');
      console.log('   4. 사용자 권한 및 RLS 정책');
    }

  } catch (error) {
    console.error('\n💥 분석 중 오류 발생:', error);
  }

  console.log(`\n🕒 분석 완료 시간: ${new Date().toLocaleString()}`);
  process.exit(0);
}

// 실행
analyzeMissingPurchaseRequest().catch(console.error);