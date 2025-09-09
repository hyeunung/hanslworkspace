// 대시보드 테스트 스크립트
import puppeteer from 'puppeteer';

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
      if (text.includes('roles:') || 
          text.includes('Pending') ||
          text.includes('Dashboard') ||
          text.includes('Filtered')) {
        console.log('📋 브라우저 콘솔:', text);
      }
    });
    
    // 에러 캡처
    page.on('pageerror', err => {
      console.error('❌ 페이지 에러:', err.message);
    });
    
    console.log('📍 http://localhost:3000 접속 중...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // 페이지 타이틀 확인
    const title = await page.title();
    console.log('📄 페이지 타이틀:', title);
    
    // 2초 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 로그인 여부 확인 후 대시보드 내용 확인
    const pageContent = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // 주요 요소 찾기
      const pendingApprovalSection = Array.from(document.querySelectorAll('*')).find(el => 
        el.textContent && el.textContent.includes('내가 승인해야 할 항목')
      );
      
      const pendingCards = document.querySelectorAll('.border.rounded-lg.p-4');
      
      return {
        isLoginPage: bodyText.includes('로그인'),
        hasDashboard: bodyText.includes('대시보드'),
        hasPendingSection: bodyText.includes('내가 승인해야 할 항목'),
        hasNoPendingMessage: bodyText.includes('승인 대기 중인 항목이 없습니다'),
        pendingCardsCount: pendingCards.length,
        pageTextSample: bodyText.substring(0, 300),
        url: window.location.href
      };
    });
    
    console.log('\n📊 페이지 분석 결과:');
    console.log('  - 현재 URL:', pageContent.url);
    console.log('  - 로그인 페이지:', pageContent.isLoginPage ? '예' : '아니오');
    console.log('  - 대시보드 페이지:', pageContent.hasDashboard ? '✅' : '❌');
    console.log('  - 승인 대기 섹션:', pageContent.hasPendingSection ? '✅' : '❌');
    console.log('  - 승인 대기 없음 메시지:', pageContent.hasNoPendingMessage ? '있음' : '없음');
    console.log('  - 발견된 카드 수:', pageContent.pendingCardsCount);
    
    if (pageContent.hasPendingSection && !pageContent.hasNoPendingMessage) {
      // 승인 대기 항목이 있어야 하는데 없는 경우
      console.log('\n⚠️  승인 대기 섹션은 있지만 항목이 표시되지 않음');
      
      // 네트워크 요청 확인
      const requests = [];
      page.on('response', response => {
        if (response.url().includes('purchase_requests')) {
          requests.push({
            url: response.url(),
            status: response.status()
          });
        }
      });
      
      // 페이지 새로고침하여 네트워크 요청 캡처
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('\n🌐 네트워크 요청:');
      requests.forEach(req => {
        console.log(`  - ${req.url}: ${req.status}`);
      });
    }
    
    // 페이지 내용 샘플
    console.log('\n📝 페이지 내용 샘플:');
    console.log(pageContent.pageTextSample);
    
    // 스크린샷 저장
    await page.screenshot({ path: 'dashboard-test.png', fullPage: true });
    console.log('\n📸 스크린샷 저장: dashboard-test.png');
    
    // 개발자 도구 콘솔 실행
    const consoleData = await page.evaluate(() => {
      // localStorage에서 사용자 정보 확인
      const user = localStorage.getItem('sb-localhost-auth-token');
      
      return {
        hasAuthToken: !!user,
        windowLocation: window.location.href
      };
    });
    
    console.log('\n🔍 추가 디버깅 정보:');
    console.log('  - 인증 토큰:', consoleData.hasAuthToken ? '있음' : '없음');
    console.log('  - 현재 위치:', consoleData.windowLocation);
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await browser.close();
    console.log('\n✅ 테스트 완료');
  }
}

// 테스트 실행
testDashboard().catch(console.error);