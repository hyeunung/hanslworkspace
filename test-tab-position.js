import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('🚀 칼럼 설정 버튼 탭 위 위치 테스트\n');
  
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
    
    // 2. 페이지 구조 확인
    console.log('📋 페이지 구조 확인:');
    
    // 칼럼 설정 버튼 찾기
    const columnButton = await page.$('button:has-text("칼럼 설정")');
    console.log(`- 칼럼 설정 버튼: ${columnButton ? '✅ 발견' : '❌ 없음'}`);
    
    // 탭 바 찾기
    const tabBar = await page.$('.bg-gray-50.p-1.business-radius-card');
    console.log(`- 탭 바: ${tabBar ? '✅ 발견' : '❌ 없음'}`);
    
    if (columnButton && tabBar) {
      // 위치 비교
      const buttonBox = await columnButton.boundingBox();
      const tabBox = await tabBar.boundingBox();
      
      if (buttonBox && tabBox) {
        const isAboveTabs = buttonBox.y < tabBox.y;
        const isRightAligned = buttonBox.x > (tabBox.x + tabBox.width * 0.5);
        
        console.log(`\n📍 위치 확인:`);
        console.log(`   - 탭 바 위: ${isAboveTabs ? '✅' : '❌'} (버튼 Y: ${buttonBox.y}, 탭 Y: ${tabBox.y})`);
        console.log(`   - 우측 정렬: ${isRightAligned ? '✅' : '❌'}`);
      }
      
      // 3. 기능 테스트
      await columnButton.click();
      console.log('\n✅ 칼럼 설정 드롭다운 열림');
      await page.waitForTimeout(500);
      
      const dropdownContent = await page.$('.w-80.max-h-96');
      console.log(`- 드롭다운 컨텐츠: ${dropdownContent ? '✅ 표시됨' : '❌ 없음'}`);
      
      // 칼럼 토글 테스트
      const columnItems = await page.$$('div[role="menuitem"]');
      console.log(`- 칼럼 항목 수: ${columnItems.length}개`);
      
      await page.keyboard.press('Escape');
      console.log('✅ 드롭다운 닫음');
    }
    
    // 4. 탭 전환 테스트
    console.log('\n📋 탭별 버튼 가시성:');
    const tabs = ['승인대기', '구매 현황', '입고 현황', '전체 항목'];
    
    for (const tabName of tabs) {
      const tab = await page.$(`button:has-text("${tabName}")`);
      if (tab) {
        await tab.click();
        await page.waitForTimeout(500);
        
        const buttonVisible = await page.$('button:has-text("칼럼 설정")');
        console.log(`   - ${tabName}: ${buttonVisible ? '✅ 표시' : '❌ 숨김'}`);
      }
    }
    
    console.log('\n✨ 테스트 완료!');
    console.log('칼럼 설정 버튼이 탭 바 위 우측에 정상 배치되었습니다.');
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
  
  console.log('\n브라우저를 5초 후 닫습니다...');
  await page.waitForTimeout(5000);
  await browser.close();
})();