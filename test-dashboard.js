// 대시보드 테스트 스크립트
const puppeteer = require('puppeteer');

async function testDashboard() {
  console.log('🚀 대시보드 테스트 시작...');
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // 콘솔 로그 캡처
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Employee roles:') || 
          text.includes('Pending approvals') ||
          text.includes('Dashboard')) {
        console.log('📋 콘솔:', text);
      }
    });
    
    // 에러 캡처
    page.on('error', err => {
      console.error('❌ 페이지 에러:', err);
    });
    
    console.log('📍 http://localhost:3000 접속 중...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // 페이지 타이틀 확인
    const title = await page.title();
    console.log('📄 페이지 타이틀:', title);
    
    // 로그인 상태 확인
    const isLoginPage = await page.evaluate(() => {
      return document.body.textContent.includes('로그인');
    });
    
    if (isLoginPage) {
      console.log('🔐 로그인 페이지 감지됨');
      
      // 로그인 시도
      const emailInput = await page.$('input[type="email"]');
      const passwordInput = await page.$('input[type="password"]');
      
      if (emailInput && passwordInput) {
        console.log('🔑 로그인 폼 발견, 자동 로그인 시도...');
        await emailInput.type('test@example.com');
        await passwordInput.type('test123');
        
        const loginButton = await page.$('button[type="submit"]');
        if (loginButton) {
          await loginButton.click();
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }
      }
    }
    
    // 대시보드 확인
    await page.waitForTimeout(2000);
    
    const dashboardContent = await page.evaluate(() => {
      const pendingSection = document.querySelector('h2')?.parentElement?.parentElement;
      const pendingItems = document.querySelectorAll('[role="article"], .border.rounded-lg');
      
      return {
        hasDashboard: document.body.textContent.includes('대시보드'),
        hasPendingSection: document.body.textContent.includes('내가 승인해야 할 항목'),
        pendingItemsCount: pendingItems.length,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    
    console.log('\n📊 대시보드 분석 결과:');
    console.log('  - 대시보드 페이지:', dashboardContent.hasDashboard ? '✅' : '❌');
    console.log('  - 승인 대기 섹션:', dashboardContent.hasPendingSection ? '✅' : '❌');
    console.log('  - 승인 대기 항목 수:', dashboardContent.pendingItemsCount);
    
    if (!dashboardContent.hasPendingSection) {
      console.log('\n📝 페이지 내용 (처음 500자):');
      console.log(dashboardContent.bodyText);
    }
    
    // 스크린샷 저장
    await page.screenshot({ path: 'dashboard-test.png', fullPage: true });
    console.log('\n📸 스크린샷 저장: dashboard-test.png');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await browser.close();
    console.log('\n✅ 테스트 완료');
  }
}

// 테스트 실행
testDashboard().catch(console.error);