/**
 * 입고일정지연알림 분석 스크립트
 * F20251226_003 항목이 왜 알림이 안 뜨는지 분석
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function analyzeDeliveryWarning() {
  console.log('🔍 입고일정지연알림 분석 시작...\n');

  // 1. F20251226_003 항목 조회
  const { data: purchase, error: purchaseError } = await supabase
    .from('purchase_requests')
    .select('*')
    .eq('purchase_order_number', 'F20251226_003')
    .single();

  if (purchaseError || !purchase) {
    console.error('❌ 발주 항목을 찾을 수 없습니다:', purchaseError);
    return;
  }

  console.log('📋 발주 정보:');
  console.log(`  - 발주번호: ${purchase.purchase_order_number}`);
  console.log(`  - 요청자: ${purchase.requester_name}`);
  console.log(`  - 입고요청일: ${purchase.delivery_request_date || '없음'}`);
  console.log(`  - 변경요청일: ${purchase.revised_delivery_request_date || '없음'}`);
  console.log(`  - 입고완료: ${purchase.is_received ? '예' : '아니오'}`);
  console.log(`  - 입고상태: ${purchase.delivery_status || '없음'}`);
  console.log(`  - 중간승인: ${purchase.middle_manager_status || '없음'}`);
  console.log(`  - 최종승인: ${purchase.final_manager_status || '없음'}`);
  console.log(`  - 수정요청완료: ${purchase.delivery_revision_requested ? '예' : '아니오'}`);
  console.log('');

  // 2. test@hansl.com 사용자 정보 조회
  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('*')
    .eq('email', 'test@hansl.com')
    .single();

  if (employeeError || !employee) {
    console.error('❌ test@hansl.com 사용자를 찾을 수 없습니다:', employeeError);
    return;
  }

  console.log('👤 사용자 정보:');
  console.log(`  - 이메일: ${employee.email}`);
  console.log(`  - 이름: ${employee.name}`);
  console.log(`  - ID: ${employee.id}`);
  console.log('');

  // 3. 알림 조건 체크
  console.log('✅ 알림 조건 체크:');
  console.log('');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 조건 1: 입고 완료 여부
  const check1 = !purchase.is_received && purchase.delivery_status !== 'completed';
  console.log(`1. 입고 미완료: ${check1 ? '✅ 통과' : '❌ 실패'}`);
  if (!check1) {
    console.log(`   - is_received: ${purchase.is_received}`);
    console.log(`   - delivery_status: ${purchase.delivery_status}`);
  }

  // 조건 2: 승인 상태
  const check2 = purchase.middle_manager_status === 'approved' && 
                 purchase.final_manager_status === 'approved';
  console.log(`2. 승인 완료: ${check2 ? '✅ 통과' : '❌ 실패'}`);
  if (!check2) {
    console.log(`   - middle_manager_status: ${purchase.middle_manager_status}`);
    console.log(`   - final_manager_status: ${purchase.final_manager_status}`);
  }

  // 조건 3: 본인 발주 여부
  const check3 = purchase.requester_name === employee.name;
  console.log(`3. 본인 발주: ${check3 ? '✅ 통과' : '❌ 실패'}`);
  if (!check3) {
    console.log(`   - 발주 요청자: "${purchase.requester_name}"`);
    console.log(`   - 사용자 이름: "${employee.name}"`);
    console.log(`   - 일치 여부: ${purchase.requester_name === employee.name}`);
  }

  // 조건 4: 수정요청 완료 여부
  const check4 = !purchase.delivery_revision_requested;
  console.log(`4. 수정요청 미완료: ${check4 ? '✅ 통과' : '❌ 실패'}`);
  if (!check4) {
    console.log(`   - delivery_revision_requested: ${purchase.delivery_revision_requested}`);
  }

  // 조건 5: 날짜 체크
  const deliveryDate = purchase.delivery_request_date ? new Date(purchase.delivery_request_date) : null;
  const revisedDate = purchase.revised_delivery_request_date ? new Date(purchase.revised_delivery_request_date) : null;

  if (deliveryDate) deliveryDate.setHours(0, 0, 0, 0);
  if (revisedDate) revisedDate.setHours(0, 0, 0, 0);

  let check5 = false;
  let check5Reason = '';

  if (revisedDate && revisedDate < today) {
    check5 = true;
    check5Reason = `변경요청일(${revisedDate.toISOString().split('T')[0]})이 오늘(${today.toISOString().split('T')[0]})보다 지남`;
  } else if (deliveryDate && deliveryDate < today && !revisedDate) {
    check5 = true;
    check5Reason = `입고요청일(${deliveryDate.toISOString().split('T')[0]})이 오늘(${today.toISOString().split('T')[0]})보다 지남`;
  } else {
    check5Reason = '날짜 조건 불만족';
    if (deliveryDate) {
      check5Reason += ` (입고요청일: ${deliveryDate.toISOString().split('T')[0]}, 오늘: ${today.toISOString().split('T')[0]})`;
    }
    if (revisedDate) {
      check5Reason += ` (변경요청일: ${revisedDate.toISOString().split('T')[0]}, 오늘: ${today.toISOString().split('T')[0]})`;
    }
  }

  console.log(`5. 날짜 지연: ${check5 ? '✅ 통과' : '❌ 실패'}`);
  console.log(`   - ${check5Reason}`);

  console.log('');

  // 최종 결과
  const allChecks = [check1, check2, check3, check4, check5];
  const passedCount = allChecks.filter(Boolean).length;

  console.log('📊 최종 결과:');
  console.log(`   - 통과한 조건: ${passedCount}/5`);
  console.log(`   - 알림 표시 여부: ${allChecks.every(Boolean) ? '✅ 표시됨' : '❌ 표시 안됨'}`);

  if (!allChecks.every(Boolean)) {
    console.log('');
    console.log('🔍 실패한 조건:');
    if (!check1) console.log('   ❌ 입고 미완료 조건 실패');
    if (!check2) console.log('   ❌ 승인 완료 조건 실패');
    if (!check3) console.log('   ❌ 본인 발주 조건 실패 (가장 가능성 높음)');
    if (!check4) console.log('   ❌ 수정요청 미완료 조건 실패');
    if (!check5) console.log('   ❌ 날짜 지연 조건 실패');
  }
}

analyzeDeliveryWarning().catch(console.error);


