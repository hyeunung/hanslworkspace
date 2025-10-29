/**
 * affectedRows: 0 문제 정확한 원인 분석
 * 영수증 관리 페이지에서 F12 → Console에서 실행
 */

console.log('🔍 affectedRows: 0 문제 정확한 원인 분석 시작');

async function debugAffectedRowsZero() {
  try {
    // 1. 영수증 ID 24 실제 존재 확인
    console.log('1️⃣ 영수증 ID 24 존재 확인...');
    
    const { data: receipt, error: selectError } = await window.supabase
      .from('purchase_receipts')
      .select('*')
      .eq('id', 24)
      .single();

    if (selectError) {
      console.log('❌ 영수증 조회 실패:', selectError);
      return;
    }

    if (!receipt) {
      console.log('❌ 영수증 ID 24가 존재하지 않습니다!');
      return;
    }

    console.log('✅ 영수증 24 존재 확인:', {
      id: receipt.id,
      file_name: receipt.file_name,
      is_printed: receipt.is_printed,
      printed_at: receipt.printed_at,
      printed_by: receipt.printed_by,
      printed_by_name: receipt.printed_by_name
    });

    // 2. 현재 상태 확인
    if (receipt.is_printed === true) {
      console.log('⚠️ 이미 인쇄완료 상태입니다!');
      console.log('이전 인쇄 정보:', {
        printed_at: receipt.printed_at,
        printed_by: receipt.printed_by,
        printed_by_name: receipt.printed_by_name
      });
    } else {
      console.log('✅ 아직 미인쇄 상태 - 업데이트 가능');
    }

    // 3. 강제로 다른 값으로 업데이트 시도
    console.log('2️⃣ 강제 업데이트 테스트...');
    
    const { data: { user } } = await window.supabase.auth.getUser();
    const { data: employee } = await window.supabase
      .from('employees')
      .select('name')
      .eq('email', user.email)
      .single();

    // 먼저 false로 설정
    const { data: resetResult, error: resetError } = await window.supabase
      .from('purchase_receipts')
      .update({
        is_printed: false,
        printed_at: null,
        printed_by: null,
        printed_by_name: null
      })
      .eq('id', 24)
      .select();

    if (resetError) {
      console.log('❌ 리셋 실패:', resetError);
    } else {
      console.log('✅ 리셋 성공:', {
        affectedRows: resetResult?.length || 0,
        data: resetResult?.[0]
      });
    }

    // 그 다음 true로 설정
    const { data: updateResult, error: updateError } = await window.supabase
      .from('purchase_receipts')
      .update({
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: user.id,
        printed_by_name: employee?.name || user.email
      })
      .eq('id', 24)
      .select();

    if (updateError) {
      console.log('❌ 업데이트 실패:', updateError);
    } else {
      console.log('✅ 업데이트 성공:', {
        affectedRows: updateResult?.length || 0,
        data: updateResult?.[0]
      });
    }

    // 4. RLS 정책 때문인지 확인 - 다른 영수증으로 테스트
    console.log('3️⃣ 다른 영수증으로 RLS 정책 테스트...');
    
    const { data: otherReceipts, error: otherError } = await window.supabase
      .from('purchase_receipts')
      .select('id, file_name, is_printed')
      .neq('id', 24)
      .limit(3);

    if (otherError) {
      console.log('❌ 다른 영수증 조회 실패:', otherError);
    } else {
      console.log('📋 다른 영수증들:', otherReceipts);
      
      if (otherReceipts && otherReceipts.length > 0) {
        const testReceipt = otherReceipts[0];
        console.log(`🧪 ${testReceipt.file_name} (ID: ${testReceipt.id})로 테스트...`);
        
        const { data: testResult, error: testError } = await window.supabase
          .from('purchase_receipts')
          .update({ is_printed: !testReceipt.is_printed })
          .eq('id', testReceipt.id)
          .select();

        if (testError) {
          console.log('❌ 다른 영수증 업데이트 실패:', testError);
        } else {
          console.log('✅ 다른 영수증 업데이트 성공:', {
            affectedRows: testResult?.length || 0
          });
          
          // 원복
          await window.supabase
            .from('purchase_receipts')
            .update({ is_printed: testReceipt.is_printed })
            .eq('id', testReceipt.id);
          console.log('📝 테스트 데이터 원복 완료');
        }
      }
    }

  } catch (error) {
    console.error('💥 분석 중 오류:', error);
  }
}

// 실행
debugAffectedRowsZero();