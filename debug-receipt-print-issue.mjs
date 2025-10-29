#!/usr/bin/env node

/**
 * 영수증 인쇄완료 버튼 문제 분석 스크립트
 * 이채령 vs 정현웅 사용자 권한 및 데이터 비교
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

async function analyzeReceiptPrintIssue() {
  console.log('🔍 영수증 인쇄완료 버튼 문제 분석 시작\n');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`🕒 분석 시간: ${new Date().toLocaleString()}\n`);

  try {
    // 1. 두 사용자의 직원 정보 비교
    console.log('1️⃣ 사용자 권한 및 직원 정보 확인...');
    
    const users = ['이채령', '정현웅'];
    const userInfo = {};
    
    for (const userName of users) {
      const { data: employee, error } = await supabase
        .from('employees')
        .select('*')
        .eq('name', userName)
        .single();
        
      if (error) {
        console.log(`❌ ${userName} 직원 정보 조회 실패:`, error.message);
        userInfo[userName] = null;
      } else {
        userInfo[userName] = employee;
        console.log(`✅ ${userName} 직원 정보:`, {
          id: employee.id,
          email: employee.email,
          purchase_role: employee.purchase_role,
          created_at: employee.created_at
        });
      }
    }
    
    // 2. 권한 분석
    console.log('\n2️⃣ 권한 분석...');
    
    for (const userName of users) {
      const employee = userInfo[userName];
      if (!employee) continue;
      
      const role = employee.purchase_role || '';
      const isAppAdmin = role.includes('app_admin');
      const isHr = role.includes('hr');
      const isLeadBuyer = role.includes('lead buyer');
      const hasReceiptAccess = isAppAdmin || isHr || isLeadBuyer;
      
      console.log(`👤 ${userName} 권한 분석:`);
      console.log(`  - purchase_role: "${role}"`);
      console.log(`  - app_admin: ${isAppAdmin}`);
      console.log(`  - hr: ${isHr}`);
      console.log(`  - lead buyer: ${isLeadBuyer}`);
      console.log(`  - 영수증 접근 권한: ${hasReceiptAccess}`);
      console.log(`  - 인쇄완료 처리 권한: ${hasReceiptAccess ? '✅ 있음' : '❌ 없음'}`);
    }
    
    // 3. 최근 영수증 인쇄 기록 확인
    console.log('\n3️⃣ 최근 영수증 인쇄 기록 확인...');
    
    const { data: recentPrints, error: printsError } = await supabase
      .from('purchase_receipts')
      .select('id, file_name, is_printed, printed_at, printed_by, printed_by_name')
      .not('printed_at', 'is', null)
      .order('printed_at', { ascending: false })
      .limit(10);
    
    if (printsError) {
      console.log('❌ 인쇄 기록 조회 실패:', printsError.message);
    } else {
      console.log('최근 인쇄 완료 기록:');
      recentPrints?.forEach((record, index) => {
        console.log(`  ${index + 1}. ${record.file_name}`);
        console.log(`     - 인쇄자: ${record.printed_by_name || record.printed_by}`);
        console.log(`     - 인쇄일: ${record.printed_at}`);
      });
    }
    
    // 4. 각 사용자별 인쇄 기록 확인
    console.log('\n4️⃣ 사용자별 인쇄 기록...');
    
    for (const userName of users) {
      const { data: userPrints, error: userPrintsError } = await supabase
        .from('purchase_receipts')
        .select('id, file_name, is_printed, printed_at')
        .eq('printed_by_name', userName)
        .order('printed_at', { ascending: false })
        .limit(5);
        
      if (userPrintsError) {
        console.log(`❌ ${userName} 인쇄 기록 조회 실패:`, userPrintsError.message);
      } else {
        console.log(`📊 ${userName} 인쇄 기록: ${userPrints?.length || 0}건`);
        userPrints?.forEach((record, index) => {
          console.log(`  ${index + 1}. ${record.file_name} (${record.printed_at})`);
        });
      }
    }
    
    // 5. 권한별 RLS 정책 테스트 시뮬레이션
    console.log('\n5️⃣ RLS 정책 테스트...');
    
    // 샘플 영수증 하나 선택
    const { data: sampleReceipt, error: sampleError } = await supabase
      .from('purchase_receipts')
      .select('id, file_name, is_printed')
      .eq('is_printed', false)
      .limit(1)
      .single();
    
    if (sampleError) {
      console.log('⚠️ 테스트용 미인쇄 영수증을 찾을 수 없음');
    } else {
      console.log(`🧪 테스트 대상 영수증: ${sampleReceipt.file_name} (ID: ${sampleReceipt.id})`);
      
      for (const userName of users) {
        const employee = userInfo[userName];
        if (!employee) continue;
        
        // 실제 업데이트는 하지 않고 권한만 테스트
        console.log(`\n🔬 ${userName} 권한으로 업데이트 테스트:`);
        
        // 현재 시각으로 업데이트 시뮬레이션
        const updateData = {
          is_printed: true,
          printed_at: new Date().toISOString(),
          printed_by: `user_${employee.id}`,
          printed_by_name: employee.name
        };
        
        console.log('  업데이트 시도할 데이터:', updateData);
        
        // 실제 업데이트는 주석 처리 (테스트만)
        /*
        const { error: updateError } = await supabase
          .from('purchase_receipts')
          .update(updateData)
          .eq('id', sampleReceipt.id);
        
        if (updateError) {
          console.log(`  ❌ 업데이트 실패: ${updateError.message}`);
        } else {
          console.log(`  ✅ 업데이트 성공`);
        }
        */
      }
    }
    
    // 6. 데이터베이스 스키마 확인
    console.log('\n6️⃣ purchase_receipts 테이블 구조 확인...');
    
    const { data: tableInfo, error: tableError } = await supabase
      .rpc('get_table_info', { table_name: 'purchase_receipts' })
      .catch(() => null);
    
    if (tableInfo) {
      console.log('테이블 구조:', tableInfo);
    }
    
    // 7. RLS 정책 확인
    console.log('\n7️⃣ RLS 정책 정보...');
    console.log('purchase_receipts 테이블의 RLS 정책을 확인하세요:');
    console.log('- SELECT 정책: 누가 영수증을 조회할 수 있는가?');
    console.log('- UPDATE 정책: 누가 영수증 정보를 수정할 수 있는가?');
    console.log('- 특히 is_printed, printed_at, printed_by 컬럼 업데이트 권한');
    
    // 8. 분석 결과 요약
    console.log('\n📋 분석 결과 요약:');
    console.log('='.repeat(50));
    
    const chaeryeong = userInfo['이채령'];
    const hyeonwoong = userInfo['정현웅'];
    
    if (!chaeryeong) {
      console.log('🎯 주요 발견: 이채령 직원 정보가 없음');
      console.log('   → employees 테이블에 이채령 정보가 등록되지 않았을 수 있음');
    } else if (!hyeonwoong) {
      console.log('🎯 주요 발견: 정현웅 직원 정보가 없음');
    } else {
      console.log('✅ 두 사용자 모두 직원 정보 존재');
      
      const chaeryeongRole = chaeryeong.purchase_role || '';
      const hyeonwoongRole = hyeonwoong.purchase_role || '';
      
      console.log(`\n👤 권한 비교:`);
      console.log(`  이채령: "${chaeryeongRole}"`);
      console.log(`  정현웅: "${hyeonwoongRole}"`);
      
      const chaeryeongHasAccess = chaeryeongRole.includes('app_admin') || 
                                  chaeryeongRole.includes('hr') || 
                                  chaeryeongRole.includes('lead buyer');
      const hyeonwoongHasAccess = hyeonwoongRole.includes('app_admin') || 
                                  hyeonwoongRole.includes('hr') || 
                                  hyeonwoongRole.includes('lead buyer');
      
      if (!chaeryeongHasAccess && hyeonwoongHasAccess) {
        console.log('🎯 문제 원인: 이채령에게 영수증 관리 권한이 없음');
        console.log('   → purchase_role에 app_admin, hr, 또는 lead buyer 권한 필요');
      } else if (chaeryeongHasAccess && !hyeonwoongHasAccess) {
        console.log('🎯 문제 원인: 정현웅에게 영수증 관리 권한이 없음 (하지만 작동한다고 함)');
        console.log('   → RLS 정책이나 다른 권한 체계 확인 필요');
      } else if (!chaeryeongHasAccess && !hyeonwoongHasAccess) {
        console.log('🎯 문제 원인: 두 사용자 모두 영수증 관리 권한이 없음');
        console.log('   → 권한 체계 재검토 필요');
      } else {
        console.log('✅ 두 사용자 모두 권한이 있음');
        console.log('🔍 추가 조사 필요 영역:');
        console.log('   1. 브라우저별 차이 (로그인 세션, 캐시)');
        console.log('   2. RLS 정책의 세부 조건');
        console.log('   3. 네트워크 요청 실패');
        console.log('   4. 브라우저 개발자 도구 콘솔 오류');
      }
    }
    
  } catch (error) {
    console.error('\n💥 분석 중 오류 발생:', error);
  }

  console.log(`\n🕒 분석 완료 시간: ${new Date().toLocaleString()}`);
  process.exit(0);
}

// 실행
analyzeReceiptPrintIssue().catch(console.error);