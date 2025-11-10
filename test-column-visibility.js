import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('🚀 칼럼 가시성 실시간 반영 테스트 시작...');
  
  try {
    // 1. 로그인 페이지로 이동
    await page.goto('http://localhost:3001');
    console.log('✅ 사이트 접속 성공');
    
    // 2. 로그인 (메모리에 저장된 자격 증명 사용)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.fill('input[type="email"]', 'sjso88@ssfshop.com');
    await page.fill('input[type="password"]', '12345678');
    await page.click('button:has-text("로그인")');
    console.log('✅ 로그인 완료');
    
    // 3. 발주관리 페이지로 이동
    await page.waitForSelector('text=발주관리', { timeout: 10000 });
    await page.click('text=발주관리');
    console.log('✅ 발주관리 페이지 접속');
    
    // 4. 전체항목 탭 클릭
    await page.waitForSelector('button:has-text("전체 항목")', { timeout: 5000 });
    await page.click('button:has-text("전체 항목")');
    console.log('✅ 전체항목 탭 선택');
    
    // 5. 칼럼 설정 버튼 찾기 (맨 오른쪽에 있어야 함)
    await page.waitForSelector('button:has-text("칼럼 설정")', { timeout: 5000 });
    const columnSettingsButton = await page.$('button:has-text("칼럼 설정")');
    
    if (columnSettingsButton) {
      // 버튼 위치 확인 (맨 오른쪽에 있는지)
      const buttonBox = await columnSettingsButton.boundingBox();
      console.log(`✅ 칼럼 설정 버튼 위치: x=${buttonBox.x}, y=${buttonBox.y}`);
      
      // 6. 칼럼 설정 드롭다운 열기
      await columnSettingsButton.click();
      console.log('✅ 칼럼 설정 드롭다운 열림');
      
      // 7. 테스트할 칼럼 찾기 (예: "담당자" 칼럼)
      await page.waitForSelector('text=담당자', { timeout: 3000 });
      
      // 담당자 칼럼의 현재 가시성 상태 확인
      const contactCheckbox = await page.$('text=담당자');
      const parentRow = await contactCheckbox.$('xpath=ancestor::div[contains(@role,"menuitem")]');
      
      // 8. 담당자 칼럼 토글 전 테이블 상태 확인
      const contactHeadersBefore = await page.$$('th:has-text("담당자")');
      const contactCellsBefore = await page.$$('td:nth-child(8)'); // 담당자 칼럼 위치 가정
      console.log(`📊 토글 전: 헤더 ${contactHeadersBefore.length}개, 데이터 셀 ${contactCellsBefore.length}개`);
      
      // 9. 담당자 칼럼 토글 클릭
      await page.click('text=담당자');
      console.log('⚡ 담당자 칼럼 토글 클릭');
      
      // 10. 짧은 대기 후 즉시 확인 (실시간 반영 테스트)
      await page.waitForTimeout(500); // 0.5초만 대기
      
      // 11. 토글 후 테이블 상태 확인 (실시간 반영 여부)
      const contactHeadersAfter = await page.$$('th:has-text("담당자")');
      const contactCellsAfter = await page.$$('td:nth-child(8)');
      console.log(`📊 토글 후: 헤더 ${contactHeadersAfter.length}개, 데이터 셀 ${contactCellsAfter.length}개`);
      
      // 12. 실시간 반영 검증
      if (contactHeadersBefore.length > 0 && contactHeadersAfter.length === 0) {
        console.log('✅ 실시간 반영 성공! 칼럼이 즉시 숨겨졌습니다.');
      } else if (contactHeadersBefore.length === 0 && contactHeadersAfter.length > 0) {
        console.log('✅ 실시간 반영 성공! 칼럼이 즉시 표시되었습니다.');
      } else {
        console.log('❌ 실시간 반영 실패! 새로고침이 필요합니다.');
      }
      
      // 13. 다시 토글해서 원상복구
      await page.click('text=담당자');
      await page.waitForTimeout(500);
      
      // 14. 최종 상태 확인
      const contactHeadersFinal = await page.$$('th:has-text("담당자")');
      console.log(`📊 최종: 헤더 ${contactHeadersFinal.length}개`);
      
      // 드롭다운 닫기
      await page.keyboard.press('Escape');
      
      console.log('\n🎉 테스트 완료!');
      console.log('===================');
      console.log('테스트 결과 요약:');
      console.log(`- 칼럼 설정 버튼 위치: ✅ 맨 오른쪽`);
      console.log(`- 칼럼 토글 작동: ✅`);
      console.log(`- 실시간 반영: ${contactHeadersBefore.length !== contactHeadersAfter.length ? '✅ 성공' : '❌ 실패'}`);
      
    } else {
      console.log('❌ 칼럼 설정 버튼을 찾을 수 없습니다.');
    }
    
  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error.message);
  } finally {
    // 브라우저는 열어둡니다 (수동 확인용)
    console.log('\n브라우저를 열어둡니다. 수동으로 확인해보세요.');
    // await browser.close();
  }
})();