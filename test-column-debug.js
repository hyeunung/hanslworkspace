import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    devtools: true // 개발자 도구 열기
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // 콘솔 로그 수집
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ 콘솔 에러:', msg.text());
    } else if (msg.text().includes('[useColumnSettings]')) {
      console.log('📝 칼럼설정:', msg.text());
    }
  });
  
  console.log('🚀 칼럼 설정 디버그 테스트...\n');
  
  try {
    // 1. 발주관리 페이지로 이동
    await page.goto('http://localhost:3001/purchase');
    console.log('✅ 페이지 접속');
    
    // 로그인 처리
    if (await page.$('input[type="email"]')) {
      await page.fill('input[type="email"]', 'sjso88@ssfshop.com');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button:has-text("로그인")');
      console.log('✅ 로그인 완료');
      await page.waitForTimeout(3000);
    }
    
    // 2. 페이지 구조 확인
    console.log('\n📋 페이지 구조 확인:');
    
    // 탭 확인
    const tabs = await page.$$eval('button', buttons => 
      buttons.filter(b => ['승인대기', '구매 현황', '입고 현황', '전체 항목'].some(text => 
        b.textContent?.includes(text)
      )).map(b => b.textContent?.trim())
    );
    console.log('- 탭 목록:', tabs);
    
    // 현재 활성 탭
    const activeTabElement = await page.$('button.text-hansl-600');
    const activeTab = activeTabElement ? await activeTabElement.textContent() : '알 수 없음';
    console.log('- 현재 활성 탭:', activeTab);
    
    // 필터 툴바 버튼들
    const toolbarButtons = await page.$$eval('.button-base', buttons => 
      buttons.map(b => b.textContent?.trim()).filter(Boolean)
    );
    console.log('- 툴바 버튼:', toolbarButtons);
    
    // 3. 칼럼 설정 버튼 찾기
    console.log('\n🔍 칼럼 설정 버튼 검색:');
    
    // 방법 1: 텍스트로 찾기
    const columnButton1 = await page.$('button:has-text("칼럼 설정")');
    console.log('- 텍스트 검색:', columnButton1 ? '찾음' : '못찾음');
    
    // 방법 2: Settings 아이콘으로 찾기
    const columnButton2 = await page.$('button:has(svg.lucide-settings)');
    console.log('- 아이콘 검색:', columnButton2 ? '찾음' : '못찾음');
    
    // 방법 3: 클래스로 찾기
    const allButtons = await page.$$('button.button-base');
    console.log('- 전체 button-base 수:', allButtons.length);
    
    // 4. 전체 항목 탭 클릭
    const doneTabButton = await page.$('button:has-text("전체 항목")');
    if (doneTabButton) {
      await doneTabButton.click();
      console.log('\n✅ 전체 항목 탭 클릭');
      await page.waitForTimeout(2000);
      
      // 다시 칼럼 설정 버튼 찾기
      const columnButtonAfter = await page.$('button:has-text("칼럼 설정")');
      console.log('- 전체 항목 탭 후 칼럼 설정 버튼:', columnButtonAfter ? '찾음' : '못찾음');
      
      if (columnButtonAfter) {
        const buttonText = await columnButtonAfter.textContent();
        console.log('- 버튼 텍스트:', buttonText);
        
        // 버튼 위치 확인
        const box = await columnButtonAfter.boundingBox();
        if (box) {
          console.log(`- 버튼 위치: x=${box.x}, y=${box.y}, width=${box.width}`);
        }
      }
    }
    
    // 5. HTML 구조 확인
    const filterToolbarHTML = await page.$eval('div.mb-3', el => {
      return el.innerHTML.substring(0, 500); // 첫 500자만
    });
    console.log('\n📄 FilterToolbar HTML (일부):');
    console.log(filterToolbarHTML);
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
  
  console.log('\n브라우저를 열어둡니다. 개발자 도구를 확인하세요.');
  // await browser.close();
})();