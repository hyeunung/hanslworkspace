/**
 * 실제 사용자별 영수증 인쇄완료 처리 테스트
 * 브라우저 콘솔에서 실행
 */

console.log('🔍 실제 사용자별 영수증 처리 테스트 시작');

async function testDifferentUsers() {
  try {
    // 1. 현재 로그인한 사용자 확인
    console.log('1️⃣ 현재 로그인 사용자 확인...');
    
    const { data: { user }, error: authError } = await window.supabase.auth.getUser();
    
    if (authError || !user) {
      console.log('❌ 사용자 인증 실패');
      return;
    }

    console.log('👤 현재 사용자:', {
      id: user.id,
      email: user.email
    });

    // 2. 직원 정보 확인
    const { data: employee, error: empError } = await window.supabase
      .from('employees')
      .select('*')
      .eq('email', user.email)
      .single();

    if (empError || !employee) {
      console.log('❌ 직원 정보 조회 실패');
      return;
    }

    console.log('👨‍💼 직원 정보:', {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      purchase_role: employee.purchase_role
    });

    // 3. 미인쇄 영수증 찾기
    console.log('2️⃣ 미인쇄 영수증 찾기...');
    
    const { data: receipts, error: receiptError } = await window.supabase
      .from('purchase_receipts')
      .select('id, file_name, is_printed, printed_by_name')
      .eq('is_printed', false)
      .limit(1);

    if (receiptError || !receipts || receipts.length === 0) {
      console.log('⚠️ 미인쇄 영수증이 없습니다');
      
      // 인쇄완료된 영수증 중 하나를 false로 리셋해서 테스트
      const { data: printedReceipts } = await window.supabase
        .from('purchase_receipts')
        .select('id, file_name, is_printed, printed_by_name')
        .eq('is_printed', true)
        .limit(1);

      if (printedReceipts && printedReceipts.length > 0) {
        const testReceipt = printedReceipts[0];
        console.log(`🔄 테스트를 위해 ${testReceipt.file_name} (ID: ${testReceipt.id})를 미인쇄 상태로 리셋...`);
        
        await window.supabase
          .from('purchase_receipts')
          .update({
            is_printed: false,
            printed_at: null,
            printed_by: null,
            printed_by_name: null
          })
          .eq('id', testReceipt.id);

        console.log('✅ 리셋 완료');
        
        // 리셋된 영수증으로 테스트
        receipts = [{ ...testReceipt, is_printed: false, printed_by_name: null }];
      } else {
        console.log('❌ 테스트할 영수증이 없습니다');
        return;
      }
    }

    const testReceipt = receipts[0];
    console.log(`🎯 테스트 대상: ${testReceipt.file_name} (ID: ${testReceipt.id})`);

    // 4. 실제 인쇄완료 처리 (현재 로그인한 사용자로)
    console.log('3️⃣ 실제 인쇄완료 처리...');
    
    const updateData = {
      is_printed: true,
      printed_at: new Date().toISOString(),
      printed_by: user.id,
      printed_by_name: employee.name
    };

    console.log('📝 업데이트 데이터:', updateData);

    const { data: updateResult, error: updateError } = await window.supabase
      .from('purchase_receipts')
      .update(updateData)
      .eq('id', testReceipt.id)
      .select('*');

    if (updateError) {
      console.log('❌ 업데이트 실패:', updateError);
    } else {
      console.log('✅ 업데이트 성공:', {
        affectedRows: updateResult?.length || 0,
        result: updateResult?.[0]
      });

      // 5. 업데이트된 결과 확인
      console.log('4️⃣ 업데이트 결과 상세 확인...');
      
      const { data: updatedReceipt } = await window.supabase
        .from('purchase_receipts')
        .select('*')
        .eq('id', testReceipt.id)
        .single();

      console.log('📋 최종 상태:', {
        id: updatedReceipt.id,
        file_name: updatedReceipt.file_name,
        is_printed: updatedReceipt.is_printed,
        printed_at: updatedReceipt.printed_at,
        printed_by: updatedReceipt.printed_by,
        printed_by_name: updatedReceipt.printed_by_name
      });

      // 6. 다른 사용자와 비교
      console.log('5️⃣ 다른 사용자들의 인쇄 기록 확인...');
      
      const { data: allPrintedReceipts } = await window.supabase
        .from('purchase_receipts')
        .select('id, file_name, printed_by_name, printed_at')
        .eq('is_printed', true)
        .order('printed_at', { ascending: false })
        .limit(5);

      console.log('📊 최근 인쇄 기록들:');
      allPrintedReceipts?.forEach((receipt, index) => {
        console.log(`  ${index + 1}. ${receipt.file_name} - ${receipt.printed_by_name} (${receipt.printed_at})`);
      });
    }

  } catch (error) {
    console.error('💥 테스트 중 오류:', error);
  }
}

// 실행
testDifferentUsers();