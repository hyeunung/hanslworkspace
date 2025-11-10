import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('🚀 칼럼 가시성 간단 테스트 시작...\n');
  
  try {
    // 1. 발주관리 페이지로 직접 이동 (이미 로그인된 경우 가정)
    await page.goto('http://localhost:3001/purchase');
    console.log('✅ 발주관리 페이지 접속');
    
    // 로그인 필요한 경우
    if (await page.$('input[type="email"]')) {
      await page.fill('input[type="email"]', 'sjso88@ssfshop.com');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button:has-text("로그인")');
      console.log('✅ 로그인 완료');
      await page.waitForTimeout(2000);
    }
    
    // 2. 전체 항목 탭 확인 및 클릭
    await page.waitForTimeout(2000);
    const doneTab = await page.$('button:has-text("전체 항목")');
    if (doneTab) {
      await doneTab.click();
      console.log('✅ 전체 항목 탭 클릭');
    } else {
      // 이미 전체 항목 탭일 수 있음
      console.log('ℹ️ 전체 항목 탭 이미 선택됨');
    }
    
    await page.waitForTimeout(1000);
    
    // 3. 칼럼 설정 버튼 찾기
    const columnButton = await page.$('button:has-text("칼럼 설정")');
    
    if (!columnButton) {
      console.log('❌ 칼럼 설정 버튼을 찾을 수 없음');
      await browser.close();
      return;
    }
    
    // 버튼 위치 확인
    const buttonBox = await columnButton.boundingBox();
    const pageWidth = await page.evaluate(() => window.innerWidth);
    const isRightAligned = buttonBox.x > (pageWidth * 0.7);
    console.log(`✅ 칼럼 설정 버튼 발견 (위치: ${isRightAligned ? '오른쪽' : '왼쪽'})`);
    
    // 4. 칼럼 설정 드롭다운 열기
    await columnButton.click();
    console.log('✅ 칼럼 설정 드롭다운 열림');
    await page.waitForTimeout(500);
    
    // 5. 테스트할 칼럼 선택 (담당자)
    const testColumn = '담당자';
    
    // 테이블에서 담당자 헤더 개수 확인 (토글 전)
    const headersBefore = await page.$$eval('th', (headers) => {
      return headers.filter(h => h.textContent?.includes('담당자')).length;
    });
    console.log(`\n📊 토글 전 '${testColumn}' 헤더: ${headersBefore}개`);
    
    // 6. 칼럼 토글 클릭
    const columnItem = await page.$(`text="${testColumn}"`);
    if (columnItem) {
      await columnItem.click();
      console.log(`⚡ '${testColumn}' 칼럼 토글 클릭`);
    }
    
    // 7. 즉시 확인 (0.5초만 대기)
    await page.waitForTimeout(500);
    
    // 테이블에서 담당자 헤더 개수 확인 (토글 후)
    const headersAfter = await page.$$eval('th', (headers) => {
      return headers.filter(h => h.textContent?.includes('담당자')).length;
    });
    console.log(`📊 토글 후 '${testColumn}' 헤더: ${headersAfter}개`);
    
    // 8. 실시간 반영 검증
    const isRealTimeUpdate = headersBefore !== headersAfter;
    
    if (isRealTimeUpdate) {
      console.log(`\n✅ 실시간 반영 성공!`);
      if (headersBefore > headersAfter) {
        console.log(`   → '${testColumn}' 칼럼이 즉시 숨겨졌습니다.`);
      } else {
        console.log(`   → '${testColumn}' 칼럼이 즉시 표시되었습니다.`);
      }
    } else {
      console.log(`\n❌ 실시간 반영 실패!`);
      console.log(`   → 칼럼 개수가 변경되지 않았습니다. 새로고침이 필요합니다.`);
    }
    
    // 9. 다시 토글 (원상복구)
    await columnItem?.click();
    await page.waitForTimeout(500);
    
    const headersFinal = await page.$$eval('th', (headers) => {
      return headers.filter(h => h.textContent?.includes('담당자')).length;
    });
    console.log(`📊 원상복구 후 '${testColumn}' 헤더: ${headersFinal}개`);
    
    // ESC로 드롭다운 닫기
    await page.keyboard.press('Escape');
    
    // 10. 최종 결과
    console.log('\n' + '='.repeat(50));
    console.log('📋 테스트 결과 요약:');
    console.log('='.repeat(50));
    console.log(`✅ 칼럼 설정 버튼 위치: ${isRightAligned ? '오른쪽 (정상)' : '왼쪽 (비정상)'}`);
    console.log(`✅ 칼럼 토글 작동: ${headersBefore !== headersAfter ? '정상' : '비정상'}`);
    console.log(`${isRealTimeUpdate ? '✅' : '❌'} 실시간 반영: ${isRealTimeUpdate ? '성공' : '실패 (새로고침 필요)'}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ 테스트 중 오류:', error.message);
  }
  
  console.log('\n브라우저를 5초 후 닫습니다...');
  await page.waitForTimeout(5000);
  await browser.close();
})();