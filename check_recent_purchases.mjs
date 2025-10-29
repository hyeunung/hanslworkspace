#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fssavlwvnhhplnhhsqgn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzc2F2bHd2bmhocGxuaGhzcWduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjA0NjkxODcsImV4cCI6MjAzNjA0NTE4N30.l_T5KMPMUKsVA1OfSkGH0p5YPGfqrj2o3bLPCjKLuHc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecentPurchases() {
  console.log('\n🔍 최근 발주요청 확인 중...\n');
  
  // 오늘 날짜
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  console.log(`📅 오늘 날짜: ${todayStr}`);
  
  // 최근 7일간의 발주요청 조회
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  console.log('\n📋 최근 7일간 생성된 발주요청:');
  console.log('=====================================');
  
  const { data: recentRequests, error } = await supabase
    .from('purchase_requests')
    .select('id, purchase_order_number, requester_name, request_date, created_at, middle_manager_status, final_manager_status')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('❌ 조회 실패:', error);
    return;
  }
  
  if (!recentRequests || recentRequests.length === 0) {
    console.log('⚠️  최근 7일간 생성된 발주요청이 없습니다.');
  } else {
    recentRequests.forEach((req, index) => {
      console.log(`\n${index + 1}. 발주번호: ${req.purchase_order_number}`);
      console.log(`   요청자: ${req.requester_name}`);
      console.log(`   청구일: ${req.request_date}`);
      console.log(`   생성시간: ${req.created_at}`);
      console.log(`   승인상태: 중간관리자(${req.middle_manager_status}), 최종승인자(${req.final_manager_status})`);
    });
  }
  
  // 오늘 생성된 발주요청만 확인
  console.log('\n\n📋 오늘 생성된 발주요청:');
  console.log('=====================================');
  
  const { data: todayRequests, error: todayError } = await supabase
    .from('purchase_requests')
    .select('*')
    .gte('created_at', todayStr + 'T00:00:00')
    .lte('created_at', todayStr + 'T23:59:59')
    .order('created_at', { ascending: false });
    
  if (todayError) {
    console.error('❌ 오늘 데이터 조회 실패:', todayError);
    return;
  }
  
  if (!todayRequests || todayRequests.length === 0) {
    console.log('⚠️  오늘 생성된 발주요청이 없습니다.');
  } else {
    console.log(`✅ 오늘 생성된 발주요청: ${todayRequests.length}건`);
    todayRequests.forEach((req, index) => {
      console.log(`\n${index + 1}. 발주번호: ${req.purchase_order_number}`);
      console.log(`   상세 정보:`);
      console.log(`   - ID: ${req.id}`);
      console.log(`   - 요청자: ${req.requester_name}`);
      console.log(`   - 청구일: ${req.request_date}`);
      console.log(`   - 생성시간: ${req.created_at}`);
      console.log(`   - 결제종류: ${req.payment_category}`);
      console.log(`   - 진행구분: ${req.progress_type}`);
    });
  }
  
  // 3개월 필터 확인
  console.log('\n\n📊 3개월 필터 테스트:');
  console.log('=====================================');
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  console.log(`3개월 전 날짜: ${threeMonthsAgo.toISOString()}`);
  
  const { data: filteredData, error: filterError } = await supabase
    .from('purchase_requests')
    .select('id')
    .gte('request_date', threeMonthsAgo.toISOString());
    
  if (!filterError && filteredData) {
    console.log(`✅ 3개월 필터로 조회된 발주요청: ${filteredData.length}건`);
  }
  
  // 전체 발주요청 수 확인
  const { count: totalCount } = await supabase
    .from('purchase_requests')
    .select('id', { count: 'exact', head: true });
    
  console.log(`📊 전체 발주요청 수: ${totalCount}건`);
}

checkRecentPurchases();
