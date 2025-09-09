// 로그인 포함 대시보드 테스트
import puppeteer from 'puppeteer';

async function testDashboardWithLogin() {
  console.log('🚀 대시보드 테스트 시작 (로그인 포함)...');
  
  const browser = await puppeteer.launch({ 
    headless: false, // 브라우저 화면 표시
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 }
  });
  
  try {
    const page = await browser.newPage();
    
    // 콘솔 로그 캡처
    page.on('console', msg => {
      const text = msg.text();
      console.log('📋 브라우저 콘솔:', text);
    });
    
    console.log('📍 로그인 페이지 접속...');
    await page.goto('http://localhost:3000/login', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // 로그인 폼 대기
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    
    console.log('🔑 로그인 시도...');
    console.log('   (실제 계정 정보를 입력해주세요)');
    
    // 실제 계정 정보로 변경 필요
    const TEST_EMAIL = 'your-email@example.com'; // 실제 이메일로 변경
    const TEST_PASSWORD = 'your-password'; // 실제 비밀번호로 변경
    
    await page.type('input[type="email"]', TEST_EMAIL);
    await page.type('input[type="password"]', TEST_PASSWORD);
    
    // 로그인 버튼 클릭
    const loginButton = await page.$('button[type="submit"]');
    if (loginButton) {
      await loginButton.click();
      
      // 대시보드로 이동 대기
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // 대시보드 내용 확인
    const dashboardData = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // 승인 대기 섹션 찾기
      const pendingSection = Array.from(document.querySelectorAll('h2, h3')).find(el => 
        el.textContent && el.textContent.includes('내가 승인해야 할 항목')
      );
      
      // 승인 대기 카드들
      let pendingCards = [];
      if (pendingSection) {
        const section = pendingSection.closest('.card, [class*="Card"]');
        if (section) {
          const cards = section.querySelectorAll('.border.rounded-lg.p-4, [class*="border"][class*="rounded"]');
          pendingCards = Array.from(cards).map(card => ({
            text: card.innerText.substring(0, 100)
          }));
        }
      }
      
      // 통계 정보
      const stats = {
        pending: document.querySelector('[class*="승인 대기"]')?.parentElement?.querySelector('[class*="font-bold"]')?.innerText,
        myRequests: document.querySelector('[class*="내 요청"]')?.parentElement?.querySelector('[class*="font-bold"]')?.innerText
      };
      
      return {
        url: window.location.href,
        isLoginPage: bodyText.includes('로그인'),
        isDashboard: bodyText.includes('대시보드'),
        hasPendingSection: !!pendingSection,
        pendingCardsCount: pendingCards.length,
        pendingCards: pendingCards,
        stats: stats,
        sampleText: bodyText.substring(0, 500)
      };
    });
    
    console.log('\n📊 대시보드 분석 결과:');
    console.log('  - 현재 URL:', dashboardData.url);
    console.log('  - 대시보드 페이지:', dashboardData.isDashboard ? '✅' : '❌');
    console.log('  - 승인 대기 섹션:', dashboardData.hasPendingSection ? '✅' : '❌');
    console.log('  - 승인 대기 항목 수:', dashboardData.pendingCardsCount);
    
    if (dashboardData.pendingCardsCount > 0) {
      console.log('\n📋 승인 대기 항목들:');
      dashboardData.pendingCards.forEach((card, idx) => {
        console.log(`  ${idx + 1}. ${card.text}`);
      });
    } else if (dashboardData.hasPendingSection) {
      console.log('\n⚠️  승인 대기 섹션은 있지만 항목이 없음');
    }
    
    // 스크린샷
    await page.screenshot({ path: 'dashboard-logged-in.png', fullPage: true });
    console.log('\n📸 스크린샷 저장: dashboard-logged-in.png');
    
    // 10초 대기 (수동 확인용)
    console.log('\n⏰ 10초 동안 대기 중... (브라우저에서 직접 확인 가능)');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await browser.close();
    console.log('\n✅ 테스트 완료');
  }
}

// 사용법 안내
console.log('⚠️  주의: test-dashboard-with-login.mjs 파일을 열어서');
console.log('    TEST_EMAIL과 TEST_PASSWORD를 실제 계정 정보로 변경한 후 실행하세요.');
console.log('');
console.log('    또는 브라우저가 열리면 직접 로그인하세요 (headless: false)');
console.log('');

// 테스트 실행
testDashboardWithLogin().catch(console.error);