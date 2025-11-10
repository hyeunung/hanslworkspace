import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('🚀 칼럼 설정 버튼 위치 및 기능 최종 테스트\n');
  
  try {
    // 1. 발주관리 페이지 접속
    await page.goto('http://localhost:3001/purchase');
    await page.waitForTimeout(2000);
    
    // 로그인 처리
    if (await page.$('input[type="email"]')) {
      await page.fill('input[type="email"]', 'sjso88@ssfshop.com');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button:has-text("로그인")');
      console.log('✅ 로그인 완료');
      await page.waitForTimeout(3000);
    }
    
    // 2. 전체 항목 탭으로 이동
    const doneTab = await page.$('button:has-text("전체 항목")');
    if (doneTab) {
      await doneTab.click();
      console.log('✅ 전체 항목 탭 클릭');
      await page.waitForTimeout(1000);
    }
    
    // 3. 칼럼 설정 버튼 찾기 (테이블 위에 있어야 함)
    const columnButton = await page.$('button:has-text("칼럼 설정")');
    
    if (!columnButton) {
      console.log('❌ 칼럼 설정 버튼을 찾을 수 없습니다.');
      await browser.close();
      return;
    }
    
    console.log('✅ 칼럼 설정 버튼 발견');
    
    // 버튼 위치 확인
    const buttonBox = await columnButton.boundingBox();
    const tableCard = await page.$('.overflow-hidden.border.border-gray-200');
    const tableBox = await tableCard?.boundingBox();
    
    if (buttonBox && tableBox) {
      const isAboveTable = buttonBox.y < tableBox.y;
      const isRightAligned = buttonBox.x > (tableBox.x + tableBox.width * 0.7);
      
      console.log(`\n📍 위치 확인:`);
      console.log(`   - 테이블 위: ${isAboveTable ? '✅' : '❌'}`);
      console.log(`   - 우측 정렬: ${isRightAligned ? '✅' : '❌'}`);
    }
    
    // 4. 칼럼 설정 기능 테스트
    await columnButton.click();
    console.log('\n✅ 칼럼 설정 드롭다운 열림');
    await page.waitForTimeout(500);
    
    // 헤더 개수 확인 (토글 전)
    const headersBefore = await page.$$eval('th', (headers) => 
      headers.filter(h => h.textContent?.includes('담당자')).length
    );
    
    // 담당자 칼럼 토글
    const contactItem = await page.$('text="담당자"');
    if (contactItem) {
      await contactItem.click();
      console.log('⚡ 담당자 칼럼 토글');
      await page.waitForTimeout(500);
      
      // 헤더 개수 확인 (토글 후)
      const headersAfter = await page.$$eval('th', (headers) => 
        headers.filter(h => h.textContent?.includes('담당자')).length
      );
      
      const isRealTime = headersBefore !== headersAfter;
      console.log(`\n📊 실시간 반영: ${isRealTime ? '✅ 성공' : '❌ 실패'}`);
      console.log(`   - 토글 전: ${headersBefore}개`);
      console.log(`   - 토글 후: ${headersAfter}개`);
      
      // 원상복구
      await contactItem.click();
      await page.waitForTimeout(500);
    }
    
    await page.keyboard.press('Escape');
    
    // 5. 다른 탭에서도 테스트
    console.log('\n📋 다른 탭에서 칼럼 설정 버튼 확인:');
    
    const tabs = ['승인대기', '구매 현황', '입고 현황'];
    for (const tabName of tabs) {
      const tab = await page.$(`button:has-text("${tabName}")`);
      if (tab) {
        await tab.click();
        await page.waitForTimeout(500);
        
        const buttonInTab = await page.$('button:has-text("칼럼 설정")');
        console.log(`   - ${tabName}: ${buttonInTab ? '✅ 있음' : '❌ 없음'}`);
      }
    }
    
    console.log('\n✨ 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
  
  console.log('\n브라우저를 5초 후 닫습니다...');
  await page.waitForTimeout(5000);
  await browser.close();
})();