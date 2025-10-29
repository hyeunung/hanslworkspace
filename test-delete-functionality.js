#!/usr/bin/env node

/**
 * 발주요청 삭제 기능 실제 DB 테스트 스크립트
 * 실제 Supabase 환경에서 삭제 기능을 테스트합니다.
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local 파일 로드
config({ path: join(__dirname, '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 테스트 결과 저장
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, message) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${name}: ${message}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}: ${message}`);
  }
  testResults.tests.push({ name, passed, message });
}

async function createTestData() {
  console.log('\n🔧 테스트 데이터 생성 중...');
  
  try {
    // 먼저 실제 employee ID를 가져와서 사용
    const { data: existingEmployee, error: empError } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('email', 'test@hansl.com')
      .single();
    
    if (empError || !existingEmployee) {
      throw new Error('테스트용 employee를 찾을 수 없습니다. test@hansl.com 계정이 필요합니다.');
    }

    // 실제 vendor ID를 가져와서 사용
    const { data: existingVendor, error: vendorError } = await supabase
      .from('vendors')
      .select('id, vendor_name')
      .limit(1)
      .single();
    
    if (vendorError || !existingVendor) {
      throw new Error('테스트용 vendor를 찾을 수 없습니다.');
    }
    
    // 1. 테스트용 발주요청 생성
    const testPurchaseRequest = {
      purchase_order_number: `TEST-${Date.now()}`,
      request_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD 형식
      delivery_request_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      progress_type: '일반',
      payment_category: '구매 요청',
      currency: 'KRW',
      unit_price_currency: 'KRW', // 필수 필드 추가
      po_template_type: '일반', // 필수 필드 추가
      request_type: '소모품',
      requester_id: existingEmployee.id, // 실제 UUID 사용
      requester_name: existingEmployee.name,
      requester_phone: '010-0000-0000',
      requester_address: '테스트 주소',
      vendor_id: existingVendor.id, // 실제 vendor ID 추가
      vendor_name: existingVendor.vendor_name,
      project_vendor: '테스트프로젝트',
      sales_order_number: 'SO-TEST-001',
      project_item: '테스트품목',
      total_amount: 100000,
      middle_manager_status: 'pending',
      final_manager_status: 'pending',
      is_received: false,
      is_payment_completed: false,
      is_po_download: false
    };

    const { data: purchaseData, error: purchaseError } = await supabase
      .from('purchase_requests')
      .insert(testPurchaseRequest)
      .select()
      .single();

    if (purchaseError) throw purchaseError;

    // 2. 테스트용 품목 생성
    const testItems = [
      {
        purchase_request_id: purchaseData.id,
        line_number: 1,
        item_name: '테스트품목1',
        specification: '테스트규격1',
        quantity: 10,
        unit_price_value: 5000,
        unit_price_currency: 'KRW',
        amount_value: 50000,
        amount_currency: 'KRW',
        remark: '테스트용 품목1'
      },
      {
        purchase_request_id: purchaseData.id,
        line_number: 2,
        item_name: '테스트품목2',
        specification: '테스트규격2',
        quantity: 5,
        unit_price_value: 10000,
        unit_price_currency: 'KRW',
        amount_value: 50000,
        amount_currency: 'KRW',
        remark: '테스트용 품목2'
      }
    ];

    const { data: itemsData, error: itemsError } = await supabase
      .from('purchase_request_items')
      .insert(testItems)
      .select();

    if (itemsError) throw itemsError;

    console.log(`✅ 테스트 데이터 생성 완료:`);
    console.log(`   - 발주요청 ID: ${purchaseData.id}`);
    console.log(`   - 발주요청번호: ${purchaseData.purchase_order_number}`);
    console.log(`   - 품목 수: ${itemsData.length}개`);

    return { purchaseRequest: purchaseData, items: itemsData };

  } catch (error) {
    console.error('❌ 테스트 데이터 생성 실패:', error.message);
    throw error;
  }
}

async function testDeleteFunctionality(testData) {
  console.log('\n🧪 삭제 기능 테스트 시작...');
  
  const { purchaseRequest, items } = testData;

  try {
    // 1. 삭제 전 데이터 존재 확인
    const { data: beforeDelete, error: beforeError } = await supabase
      .from('purchase_requests')
      .select('*, purchase_request_items(*)')
      .eq('id', purchaseRequest.id)
      .single();

    if (beforeError) throw beforeError;
    
    logTest(
      '삭제 전 데이터 존재 확인',
      beforeDelete && beforeDelete.purchase_request_items.length === 2,
      `발주요청 및 ${beforeDelete.purchase_request_items.length}개 품목 확인`
    );

    // 2. 품목 삭제 테스트
    const { error: itemsDeleteError } = await supabase
      .from('purchase_request_items')
      .delete()
      .eq('purchase_request_id', purchaseRequest.id);

    if (itemsDeleteError) throw itemsDeleteError;

    logTest(
      '품목 삭제',
      true,
      '모든 품목이 성공적으로 삭제됨'
    );

    // 3. 품목 삭제 확인
    const { data: itemsAfterDelete, error: itemsCheckError } = await supabase
      .from('purchase_request_items')
      .select('*')
      .eq('purchase_request_id', purchaseRequest.id);

    if (itemsCheckError) throw itemsCheckError;

    logTest(
      '품목 삭제 확인',
      itemsAfterDelete.length === 0,
      `삭제 후 품목 수: ${itemsAfterDelete.length}개`
    );

    // 4. 발주요청 삭제 테스트
    const { error: requestDeleteError } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', purchaseRequest.id);

    if (requestDeleteError) throw requestDeleteError;

    logTest(
      '발주요청 삭제',
      true,
      '발주요청이 성공적으로 삭제됨'
    );

    // 5. 발주요청 삭제 확인
    const { data: requestAfterDelete, error: requestCheckError } = await supabase
      .from('purchase_requests')
      .select('*')
      .eq('id', purchaseRequest.id);

    if (requestCheckError) throw requestCheckError;

    logTest(
      '발주요청 삭제 확인',
      requestAfterDelete.length === 0,
      `삭제 후 발주요청 수: ${requestAfterDelete.length}개`
    );

  } catch (error) {
    logTest(
      '삭제 기능 오류',
      false,
      `삭제 중 오류 발생: ${error.message}`
    );
    throw error;
  }
}

async function testPermissionLogic() {
  console.log('\n🔐 권한 로직 테스트...');

  try {
    // 실제 employee 정보 가져오기
    const { data: testEmployee, error: testEmpError } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('email', 'test@hansl.com')
      .single();
    
    if (testEmpError || !testEmployee) {
      throw new Error('테스트용 employee를 찾을 수 없습니다.');
    }

    // 실제 vendor ID를 가져와서 사용
    const { data: testVendor, error: testVendorError } = await supabase
      .from('vendors')
      .select('id, vendor_name')
      .limit(1)
      .single();
    
    if (testVendorError || !testVendor) {
      throw new Error('테스트용 vendor를 찾을 수 없습니다.');
    }

    // 미승인 요청 권한 테스트 데이터 생성
    const pendingRequest = {
      purchase_order_number: `TEST-PENDING-${Date.now()}`,
      request_date: new Date().toISOString().split('T')[0],
      requester_name: testEmployee.name,
      final_manager_status: 'pending',
      middle_manager_status: 'pending',
      // 기본 필수 필드들
      delivery_request_date: new Date().toISOString().split('T')[0],
      progress_type: '일반',
      payment_category: '구매 요청',
      currency: 'KRW',
      unit_price_currency: 'KRW',
      po_template_type: '일반',
      request_type: '소모품',
      requester_id: testEmployee.id,
      requester_phone: '010-0000-0000',
      requester_address: '테스트 주소',
      vendor_id: testVendor.id,
      vendor_name: testVendor.vendor_name,
      project_vendor: '테스트프로젝트',
      sales_order_number: 'SO-TEST-002',
      project_item: '테스트품목',
      total_amount: 50000,
      is_received: false,
      is_payment_completed: false,
      is_po_download: false
    };

    const { data: pendingData, error: pendingError } = await supabase
      .from('purchase_requests')
      .insert(pendingRequest)
      .select()
      .single();

    if (pendingError) throw pendingError;

    // 승인된 요청 테스트 데이터 생성
    const approvedRequest = {
      ...pendingRequest,
      purchase_order_number: `TEST-APPROVED-${Date.now()}`,
      final_manager_status: 'approved'
    };

    const { data: approvedData, error: approvedError } = await supabase
      .from('purchase_requests')
      .insert(approvedRequest)
      .select()
      .single();

    if (approvedError) throw approvedError;

    // 권한 로직 시뮬레이션
    const testCases = [
      {
        name: '요청자-미승인요청 삭제권한',
        userRoles: [],
        currentUserName: testEmployee.name,
        purchase: pendingData,
        expectedCanDelete: true
      },
      {
        name: '요청자-승인된요청 삭제권한',
        userRoles: [],
        currentUserName: testEmployee.name,
        purchase: approvedData,
        expectedCanDelete: false
      },
      {
        name: '관리자-승인된요청 삭제권한',
        userRoles: ['app_admin'],
        currentUserName: '관리자',
        purchase: approvedData,
        expectedCanDelete: true
      },
      {
        name: '타인-미승인요청 삭제권한',
        userRoles: [],
        currentUserName: '다른사용자',
        purchase: pendingData,
        expectedCanDelete: false
      }
    ];

    for (const testCase of testCases) {
      const canEdit = testCase.userRoles.includes('final_approver') || 
                      testCase.userRoles.includes('app_admin') || 
                      testCase.userRoles.includes('ceo');
      
      const isApproved = testCase.purchase.final_manager_status === 'approved';
      const canDelete = isApproved 
        ? canEdit
        : (canEdit || (testCase.purchase.requester_name === testCase.currentUserName));

      logTest(
        testCase.name,
        canDelete === testCase.expectedCanDelete,
        `예상: ${testCase.expectedCanDelete}, 실제: ${canDelete}`
      );
    }

    // 테스트 데이터 정리
    await supabase.from('purchase_requests').delete().eq('id', pendingData.id);
    await supabase.from('purchase_requests').delete().eq('id', approvedData.id);

  } catch (error) {
    logTest(
      '권한 로직 테스트 오류',
      false,
      `권한 테스트 중 오류: ${error.message}`
    );
  }
}

async function testErrorCases() {
  console.log('\n🔴 예외 상황 테스트...');

  try {
    // 1. 존재하지 않는 발주요청 삭제 시도
    const { error: nonExistentError } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', 999999999);

    logTest(
      '존재하지 않는 요청 삭제',
      !nonExistentError,
      '존재하지 않는 요청 삭제 시도가 에러 없이 처리됨'
    );

    // 실제 employee 정보 가져오기
    const { data: testEmployee, error: testEmpError } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('email', 'test@hansl.com')
      .single();
    
    if (testEmpError || !testEmployee) {
      throw new Error('테스트용 employee를 찾을 수 없습니다.');
    }

    // 실제 vendor ID를 가져와서 사용
    const { data: emptyVendor, error: emptyVendorError } = await supabase
      .from('vendors')
      .select('id, vendor_name')
      .limit(1)
      .single();
    
    if (emptyVendorError || !emptyVendor) {
      throw new Error('테스트용 vendor를 찾을 수 없습니다.');
    }

    // 2. 품목이 없는 발주요청 삭제
    const emptyRequest = {
      purchase_order_number: `TEST-EMPTY-${Date.now()}`,
      request_date: new Date().toISOString().split('T')[0],
      delivery_request_date: new Date().toISOString().split('T')[0],
      progress_type: '일반',
      payment_category: '구매 요청',
      currency: 'KRW',
      unit_price_currency: 'KRW',
      po_template_type: '일반',
      request_type: '소모품',
      requester_id: testEmployee.id,
      requester_name: testEmployee.name,
      requester_phone: '010-0000-0000',
      requester_address: '테스트 주소',
      vendor_id: emptyVendor.id,
      vendor_name: emptyVendor.vendor_name,
      project_vendor: '테스트프로젝트',
      sales_order_number: 'SO-TEST-003',
      project_item: '테스트품목',
      total_amount: 0,
      is_received: false,
      is_payment_completed: false,
      is_po_download: false,
      middle_manager_status: 'pending',
      final_manager_status: 'pending'
    };

    const { data: emptyData, error: emptyError } = await supabase
      .from('purchase_requests')
      .insert(emptyRequest)
      .select()
      .single();

    if (emptyError) throw emptyError;

    // 품목 없이 바로 발주요청 삭제
    const { error: emptyDeleteError } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', emptyData.id);

    logTest(
      '품목 없는 요청 삭제',
      !emptyDeleteError,
      '품목이 없는 발주요청이 성공적으로 삭제됨'
    );

  } catch (error) {
    logTest(
      '예외 상황 테스트 오류',
      false,
      `예외 테스트 중 오류: ${error.message}`
    );
  }
}

async function runTests() {
  console.log('🚀 발주요청 삭제 기능 실제 DB 테스트 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 테스트 시작 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 데이터베이스 연결 확인
    const { data: connectionTest, error: connectionError } = await supabase
      .from('purchase_requests')
      .select('count')
      .limit(1);

    if (connectionError) throw new Error(`DB 연결 실패: ${connectionError.message}`);
    
    console.log('✅ 데이터베이스 연결 확인 완료\n');

    // 1. 테스트 데이터 생성
    const testData = await createTestData();

    // 2. 삭제 기능 테스트
    await testDeleteFunctionality(testData);

    // 3. 권한 로직 테스트
    await testPermissionLogic();

    // 4. 예외 상황 테스트
    await testErrorCases();

  } catch (error) {
    console.error(`\n💥 테스트 실행 중 치명적 오류: ${error.message}`);
    testResults.failed++;
  }

  // 최종 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log('📊 테스트 결과 요약');
  console.log('='.repeat(60));
  console.log(`총 테스트 수: ${testResults.total}`);
  console.log(`성공: ${testResults.passed} ✅`);
  console.log(`실패: ${testResults.failed} ❌`);
  console.log(`성공률: ${testResults.total > 0 ? Math.round((testResults.passed / testResults.total) * 100) : 0}%`);
  console.log(`🕒 테스트 완료 시간: ${new Date().toLocaleString()}`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ 실패한 테스트:');
    testResults.tests
      .filter(test => !test.passed)
      .forEach(test => console.log(`   - ${test.name}: ${test.message}`));
  } else {
    console.log('\n🎉 모든 테스트가 성공적으로 완료되었습니다!');
  }
  
  console.log('='.repeat(60));
  
  // 테스트 결과에 따른 종료 코드
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// 메인 실행
runTests().catch(console.error);