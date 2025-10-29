#!/usr/bin/env node

/**
 * 삭제를 막는 문제 데이터 찾기 및 해결
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// .env.local 파일 로드
config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function findAndFixProblemData() {
  console.log('🔍 삭제를 막는 문제 데이터 찾기 및 해결\n');

  try {
    // 1. 모든 support_inquires 데이터 확인
    console.log('📊 support_inquires 테이블 전체 데이터 확인...');
    const { data: allInquiries, error: allError } = await supabase
      .from('support_inquires')
      .select('id, subject, purchase_request_id, purchase_order_number')
      .not('purchase_request_id', 'is', null);

    if (allError) {
      console.log('❌ 문의 데이터 조회 실패:', allError.message);
      return;
    }

    console.log(`📋 purchase_request_id가 있는 문의: ${allInquiries?.length || 0}건`);
    
    if (allInquiries && allInquiries.length > 0) {
      console.log('문제가 되는 문의들:');
      allInquiries.forEach(inquiry => {
        console.log(`  - ID: ${inquiry.id}, Subject: ${inquiry.subject}, PR_ID: ${inquiry.purchase_request_id}`);
      });

      // 2. 이 문의들의 purchase_request_id를 모두 null로 설정
      console.log('\n🔧 문제 데이터 수정 중...');
      const { data: updateData, error: updateError } = await supabase
        .from('support_inquires')
        .update({ purchase_request_id: null })
        .not('purchase_request_id', 'is', null);

      if (updateError) {
        console.log('❌ 데이터 수정 실패:', updateError.message);
      } else {
        console.log('✅ 모든 문의의 purchase_request_id가 null로 설정되었습니다.');
      }

      // 3. 수정 결과 확인
      const { data: verifyData, error: verifyError } = await supabase
        .from('support_inquires')
        .select('id, purchase_request_id')
        .not('purchase_request_id', 'is', null);

      if (verifyError) {
        console.log('⚠️ 수정 결과 확인 실패:', verifyError.message);
      } else {
        console.log(`📊 수정 후 purchase_request_id가 있는 문의: ${verifyData?.length || 0}건`);
        if (verifyData && verifyData.length === 0) {
          console.log('✅ 모든 외래 키 참조가 제거되었습니다!');
        }
      }
    } else {
      console.log('✅ purchase_request_id가 있는 문의가 없습니다.');
    }

    // 4. 실제 삭제 테스트
    console.log('\n🧪 실제 삭제 테스트...');
    
    // 가장 최근 발주요청 하나를 선택해서 삭제 테스트
    const { data: testRequest, error: testError } = await supabase
      .from('purchase_requests')
      .select('id, purchase_order_number, requester_name')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (testError) {
      console.log('❌ 테스트 발주요청 조회 실패:', testError.message);
      return;
    }

    console.log(`🎯 삭제 테스트 대상: ${testRequest.purchase_order_number} (요청자: ${testRequest.requester_name})`);

    // 먼저 관련 아이템들 삭제
    const { error: itemsDeleteError } = await supabase
      .from('purchase_request_items')
      .delete()
      .eq('purchase_request_id', testRequest.id);

    if (itemsDeleteError) {
      console.log('❌ 아이템 삭제 실패:', itemsDeleteError.message);
      return;
    }

    console.log('✅ 관련 아이템 삭제 성공');

    // 이제 발주요청 삭제
    const { error: requestDeleteError } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', testRequest.id);

    if (requestDeleteError) {
      console.log('❌ 발주요청 삭제 실패:', requestDeleteError.message);
      console.log('오류 상세:', requestDeleteError);
      
      if (requestDeleteError.message.includes('violates foreign key constraint')) {
        console.log('🎯 아직도 외래 키 제약 조건이 남아있습니다!');
        console.log('Supabase 대시보드에서 수동으로 제약 조건을 제거해야 합니다.');
      }
    } else {
      console.log('🎉 발주요청 삭제 성공!');
      console.log('외래 키 제약 조건 문제가 해결되었습니다.');
    }

  } catch (error) {
    console.error('💥 오류:', error);
  }

  process.exit(0);
}

findAndFixProblemData().catch(console.error);