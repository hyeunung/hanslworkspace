/**
 * 이채령 브라우저에서 실행하여 실제 오류 확인
 * 영수증 관리 페이지에서 F12 → Console에서 실행
 */

console.log('🔍 이채령 영수증 인쇄완료 실제 오류 확인 시작');

// 실제 markAsPrinted 함수 시뮬레이션
async function debugMarkAsPrinted(receiptId) {
  console.log('📝 인쇄완료 처리 디버깅 시작...');
  console.log('대상 영수증 ID:', receiptId);
  
  try {
    // 1. 사용자 인증 확인
    console.log('🔐 1단계: 사용자 인증 확인...');
    const { data: { user }, error: authError } = await window.supabase.auth.getUser();
    
    if (authError) {
      console.error('❌ 인증 오류:', authError);
      return { step: 1, error: authError };
    }
    
    if (!user) {
      console.error('❌ 사용자 정보 없음');
      return { step: 1, error: 'No user' };
    }
    
    console.log('✅ 사용자 인증 성공:', {
      id: user.id,
      email: user.email,
      lastSignIn: user.last_sign_in_at
    });

    // 2. 직원 정보 조회
    console.log('👤 2단계: 직원 정보 조회...');
    const { data: employee, error: empError } = await window.supabase
      .from('employees')
      .select('name, purchase_role')
      .eq('email', user.email)
      .single();

    if (empError) {
      console.error('❌ 직원 정보 조회 실패:', empError);
      return { step: 2, error: empError };
    }

    if (!employee) {
      console.error('❌ 직원 정보 없음');
      return { step: 2, error: 'No employee' };
    }

    console.log('✅ 직원 정보 조회 성공:', {
      name: employee.name,
      purchase_role: employee.purchase_role
    });

    // 3. 권한 확인
    console.log('🔑 3단계: 권한 확인...');
    const role = employee.purchase_role || '';
    let roles = [];
    
    if (Array.isArray(role)) {
      roles = role.map(r => String(r).trim());
    } else {
      const roleString = String(role);
      roles = roleString.split(',').map(r => r.trim()).filter(r => r.length > 0);
    }

    const isAppAdmin = roles.includes('app_admin');
    const isHr = roles.includes('hr');
    const isLeadBuyer = roles.includes('lead buyer');
    const hasReceiptAccess = isAppAdmin || isHr || isLeadBuyer;

    console.log('권한 분석:', {
      roles,
      isAppAdmin,
      isHr,
      isLeadBuyer,
      hasReceiptAccess
    });

    if (!hasReceiptAccess) {
      console.error('❌ 영수증 관리 권한 없음');
      return { step: 3, error: 'No receipt access' };
    }

    // 4. 실제 업데이트 시도
    console.log('💾 4단계: 실제 업데이트 시도...');
    
    const updateData = {
      is_printed: true,
      printed_at: new Date().toISOString(),
      printed_by: user.id,
      printed_by_name: employee.name || user.email
    };
    
    console.log('업데이트할 데이터:', updateData);
    console.log('업데이트 조건: id =', receiptId);

    const { data: updateResult, error: updateError } = await window.supabase
      .from('purchase_receipts')
      .update(updateData)
      .eq('id', receiptId)
      .select(); // 결과도 받아보기

    if (updateError) {
      console.error('❌ 업데이트 실패!');
      console.error('오류 코드:', updateError.code);
      console.error('오류 메시지:', updateError.message);
      console.error('오류 상세:', updateError.details);
      console.error('오류 힌트:', updateError.hint);
      console.error('전체 오류 객체:', updateError);
      return { step: 4, error: updateError };
    }

    console.log('✅ 업데이트 성공!');
    console.log('업데이트된 데이터:', updateResult);
    return { step: 4, success: true, data: updateResult };

  } catch (error) {
    console.error('💥 예외 발생:', error);
    return { step: 'exception', error };
  }
}

// 5. 영수증 목록에서 테스트할 ID 찾기
async function findTestReceiptId() {
  console.log('🔍 테스트할 영수증 찾는 중...');
  
  const { data: receipts, error } = await window.supabase
    .from('purchase_receipts')
    .select('id, file_name, is_printed')
    .eq('is_printed', false)
    .limit(5);

  if (error) {
    console.error('❌ 영수증 목록 조회 실패:', error);
    return null;
  }

  if (!receipts || receipts.length === 0) {
    console.log('⚠️ 미인쇄 영수증이 없습니다');
    return null;
  }

  console.log('📋 미인쇄 영수증 목록:');
  receipts.forEach((receipt, index) => {
    console.log(`  ${index + 1}. ID: ${receipt.id} - ${receipt.file_name}`);
  });

  return receipts[0].id; // 첫 번째 영수증 ID 반환
}

// 6. 전체 테스트 실행
async function runFullTest() {
  console.log('🚀 전체 테스트 시작...');
  
  const receiptId = await findTestReceiptId();
  
  if (!receiptId) {
    console.log('❌ 테스트할 영수증이 없습니다');
    return;
  }

  console.log('🎯 테스트 대상 영수증 ID:', receiptId);
  
  const result = await debugMarkAsPrinted(receiptId);
  
  console.log('📊 최종 결과:', result);
  
  if (result.success) {
    console.log('🎉 성공! 인쇄완료 처리가 정상 작동합니다.');
    
    // 원복
    console.log('🔄 테스트 데이터 원복 중...');
    await window.supabase
      .from('purchase_receipts')
      .update({
        is_printed: false,
        printed_at: null,
        printed_by: null,
        printed_by_name: null
      })
      .eq('id', receiptId);
    console.log('✅ 원복 완료');
  } else {
    console.log('💥 실패! 단계:', result.step, '오류:', result.error);
  }
}

// 실행
console.log('실행 방법:');
console.log('1. runFullTest() - 전체 자동 테스트');
console.log('2. debugMarkAsPrinted("영수증ID") - 특정 영수증으로 테스트');

// 자동 실행
runFullTest();