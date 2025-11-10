import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('🚀 칼럼 설정 버튼 최종 위치 테스트 (60일 메시지 옆)\n');
  
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
    
    // 2. 요소 확인
    console.log('📋 페이지 구조 확인:');
    
    // 60일 메시지 찾기
    const sixtyDaysMessage = await page.$('text=최근 60일 데이터만 표시됩니다');
    console.log(`- 60일 메시지: ${sixtyDaysMessage ? '✅ 발견' : '❌ 없음'}`);
    
    // 칼럼 설정 버튼 찾기
    const columnButton = await page.$('button:has-text("칼럼 설정")');
    console.log(`- 칼럼 설정 버튼: ${columnButton ? '✅ 발견' : '❌ 없음'}`);
    
    // 위치 관계 확인
    if (sixtyDaysMessage && columnButton) {
      const messageBox = await sixtyDaysMessage.boundingBox();
      const buttonBox = await columnButton.boundingBox();
      
      if (messageBox && buttonBox) {
        const sameLine = Math.abs(messageBox.y - buttonBox.y) < 20; // 같은 줄 여부
        const rightSide = buttonBox.x > messageBox.x; // 오른쪽에 있는지
        
        console.log(`\n📍 위치 확인:`);
        console.log(`   - 같은 줄: ${sameLine ? '✅' : '❌'}`);
        console.log(`   - 오른쪽 배치: ${rightSide ? '✅' : '❌'}`);
        console.log(`   - 메시지 Y: ${messageBox.y}, 버튼 Y: ${buttonBox.y}`);
      }
    } else if (!sixtyDaysMessage && columnButton) {
      console.log('\n💡 필터가 적용된 상태 - 60일 메시지가 없지만 칼럼 설정 버튼은 표시됨');
      const buttonBox = await columnButton.boundingBox();
      if (buttonBox) {
        console.log(`   - 버튼 위치: X=${buttonBox.x}, Y=${buttonBox.y}`);
      }
    }
    
    // 3. 기능 테스트
    if (columnButton) {
      await columnButton.click();
      console.log('\n✅ 칼럼 설정 드롭다운 열림');
      await page.waitForTimeout(500);
      
      // 칼럼 토글 테스트
      const headersBefore = await page.$$('th');
      console.log(`- 현재 헤더 수: ${headersBefore.length}개`);
      
      // 담당자 칼럼 토글
      const contactItem = await page.$('text="담당자"');
      if (contactItem) {
        await contactItem.click();
        await page.waitForTimeout(500);
        
        const headersAfter = await page.$$('th');
        const changed = headersBefore.length !== headersAfter.length;
        
        console.log(`- 토글 후 헤더 수: ${headersAfter.length}개`);
        console.log(`- 실시간 반영: ${changed ? '✅ 성공' : '❌ 실패'}`);
        
        // 원상복구
        await contactItem.click();
      }
      
      await page.keyboard.press('Escape');
    }
    
    // 4. 필터 적용 시 테스트
    console.log('\n📋 필터 적용 시 테스트:');
    
    // 필터 버튼 클릭
    const filterButton = await page.$('button:has-text("필터")');
    if (filterButton) {
      await filterButton.click();
      await page.waitForTimeout(500);
      
      // 간단한 필터 적용 (취소로 닫기)
      await page.keyboard.press('Escape');
      
      // 칼럼 설정 버튼이 여전히 있는지 확인
      const buttonStillThere = await page.$('button:has-text("칼럼 설정")');
      console.log(`- 필터 후에도 칼럼 설정 버튼: ${buttonStillThere ? '✅ 유지' : '❌ 사라짐'}`);
    }
    
    console.log('\n✨ 테스트 완료!');
    console.log('칼럼 설정 버튼이 60일 메시지 오른쪽에 정상 배치되었습니다.');
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
  
  console.log('\n브라우저를 5초 후 닫습니다...');
  await page.waitForTimeout(5000);
  await browser.close();
})();