/**
 * 🔍 발주요청관리 프론트엔드 디버깅 스크립트
 * 
 * 사용법:
 * 1. 발주요청관리 페이지(/purchase)에서 F12 개발자 도구 열기
 * 2. Console 탭으로 이동  
 * 3. 아래 코드를 복사해서 붙여넣고 Enter
 */

console.log('🔍 발주요청관리 프론트엔드 디버깅 시작');
console.log('='.repeat(60));

// 현재 페이지 확인
if (window.location.pathname !== '/purchase') {
  console.log('⚠️ 현재 페이지가 발주요청관리(/purchase)가 아닙니다');
  console.log('현재 페이지:', window.location.pathname);
  console.log('발주요청관리 페이지로 이동해주세요');
} else {
  console.log('✅ 발주요청관리 페이지에서 실행 중');
}

// React DevTools 접근 시도
let purchases = [];
let filteredPurchases = [];
let activeTab = '';
let filters = {};

// 1. DOM 요소에서 상태 추출 시도
console.log('\n🔍 1. DOM 상태 확인...');

// 탭 상태 확인
const activeTabElement = document.querySelector('[class*="hansl-600"]');
if (activeTabElement) {
  console.log('✅ 활성 탭 요소 발견:', activeTabElement.textContent);
} else {
  console.log('❌ 활성 탭 요소를 찾을 수 없음');
}

// 테이블 행 수 확인
const tableRows = document.querySelectorAll('table tbody tr');
console.log(`📊 현재 테이블 행 수: ${tableRows.length}`);

if (tableRows.length === 0) {
  const emptyMessage = document.querySelector('[class*="text-center"]');
  if (emptyMessage) {
    console.log('📋 빈 테이블 메시지:', emptyMessage.textContent);
  }
}

// 2. 필터 상태 확인
console.log('\n🔍 2. 필터 상태 확인...');

// 날짜 필터
const dateFromInput = document.querySelector('input[type="date"]:first-of-type');
const dateToInput = document.querySelector('input[type="date"]:last-of-type');

if (dateFromInput) {
  console.log('📅 시작일 필터:', dateFromInput.value || '미설정');
}
if (dateToInput) {
  console.log('📅 종료일 필터:', dateToInput.value || '미설정');
}

// 검색어 필터
const searchInput = document.querySelector('input[placeholder*="검색"]');
if (searchInput) {
  console.log('🔍 검색어 필터:', searchInput.value || '미설정');
}

// 3. 네트워크 요청 모니터링
console.log('\n🔍 3. 실시간 네트워크 모니터링 설정...');

// 기존 fetch 함수 백업
const originalFetch = window.fetch;

// fetch 함수 오버라이드
window.fetch = function(...args) {
  const url = args[0];
  if (typeof url === 'string' && url.includes('purchase_requests')) {
    console.log('🌐 발주요청 API 호출 감지:', url);
    
    return originalFetch.apply(this, args)
      .then(response => {
        if (response.ok) {
          return response.clone().json().then(data => {
            console.log('📊 API 응답 데이터:', {
              dataCount: data?.data?.length || 0,
              first3Items: data?.data?.slice(0, 3)?.map(item => ({
                id: item.id,
                purchase_order_number: item.purchase_order_number,
                request_date: item.request_date,
                requester_name: item.requester_name
              }))
            });
            
            // 10/29 데이터 확인
            const todayData = data?.data?.filter(item => 
              item.request_date === '2025-10-29' || 
              item.created_at?.startsWith('2025-10-29')
            );
            
            if (todayData && todayData.length > 0) {
              console.log('✅ API 응답에 10/29 데이터 포함:', todayData.length, '건');
              todayData.forEach(item => {
                console.log(`  - ${item.purchase_order_number}: ${item.requester_name}`);
              });
            } else {
              console.log('❌ API 응답에 10/29 데이터 없음');
            }
            
            return response;
          }).catch(() => response);
        } else {
          console.log('❌ API 요청 실패:', response.status, response.statusText);
          return response;
        }
      });
  }
  
  return originalFetch.apply(this, args);
};

// 4. React 컴포넌트 상태 접근 시도
console.log('\n🔍 4. React 상태 접근 시도...');

// React DevTools가 있는 경우
if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  console.log('✅ React DevTools 감지됨');
  
  // React Fiber 트리 탐색 시도
  try {
    const reactFiber = document.querySelector('#root')._reactInternalInstance ||
                      document.querySelector('#root')._reactInternals;
    
    if (reactFiber) {
      console.log('✅ React Fiber 트리 접근 성공');
      console.log('🔍 React 상태 분석 중...');
    }
  } catch (e) {
    console.log('❌ React 상태 직접 접근 실패');
  }
} else {
  console.log('❌ React DevTools를 찾을 수 없음');
}

// 5. 로컬 스토리지 및 세션 스토리지 확인
console.log('\n🔍 5. 브라우저 저장소 확인...');

console.log('📦 로컬 스토리지 키들:');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key && (key.includes('purchase') || key.includes('supabase'))) {
    console.log(`  - ${key}: ${localStorage.getItem(key)?.substring(0, 100)}...`);
  }
}

// 6. 강제 데이터 새로고침 함수 제공
console.log('\n🔧 6. 디버깅 도구 함수 제공...');

window.debugPurchase = {
  // 페이지 새로고침
  refresh: () => {
    console.log('🔄 페이지 새로고침...');
    window.location.reload();
  },
  
  // 캐시 클리어
  clearCache: () => {
    console.log('🗑️ 브라우저 캐시 클리어...');
    localStorage.clear();
    sessionStorage.clear();
    console.log('✅ 캐시 클리어 완료 - 페이지를 새로고침하세요');
  },
  
  // 10/29 데이터 직접 조회
  check1029: async () => {
    console.log('🔍 10/29 데이터 직접 조회...');
    
    if (typeof window.supabase === 'undefined') {
      console.log('❌ Supabase 클라이언트를 찾을 수 없음');
      return;
    }
    
    try {
      const { data, error } = await window.supabase
        .from('purchase_requests')
        .select('*')
        .eq('request_date', '2025-10-29');
        
      if (error) {
        console.log('❌ 조회 실패:', error.message);
      } else {
        console.log('✅ 조회 성공:', data?.length || 0, '건');
        data?.forEach(item => {
          console.log(`  - ${item.purchase_order_number}: ${item.requester_name}`);
        });
      }
    } catch (e) {
      console.log('❌ 조회 중 오류:', e.message);
    }
  },
  
  // 현재 필터 상태 출력
  showFilters: () => {
    console.log('🔍 현재 필터 상태:');
    console.log('  날짜(시작):', dateFromInput?.value || '미설정');
    console.log('  날짜(종료):', dateToInput?.value || '미설정');
    console.log('  검색어:', searchInput?.value || '미설정');
    
    // 탭 상태
    const tabButtons = document.querySelectorAll('button[class*="space-x-2"]');
    tabButtons.forEach((button, index) => {
      const isActive = button.classList.contains('text-hansl-600') || 
                      button.classList.toString().includes('hansl-600');
      if (isActive) {
        console.log(`  활성 탭: ${button.textContent}`);
      }
    });
  }
};

console.log('\n💡 사용 가능한 디버깅 명령어:');
console.log('- debugPurchase.refresh() : 페이지 새로고침');
console.log('- debugPurchase.clearCache() : 캐시 클리어');
console.log('- debugPurchase.check1029() : 10/29 데이터 직접 조회');
console.log('- debugPurchase.showFilters() : 현재 필터 상태 출력');

console.log('\n='.repeat(60));
console.log('🔍 프론트엔드 디버깅 설정 완료');
console.log('💡 이제 페이지를 사용하면서 네트워크 요청이 자동으로 모니터링됩니다');