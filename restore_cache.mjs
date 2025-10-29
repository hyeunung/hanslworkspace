#!/usr/bin/env node
console.log('📌 캐시 복구 안내');
console.log('=====================================\n');

console.log('문제가 해결되었다면 캐시를 다시 활성화하세요:\n');

console.log('1. src/hooks/usePurchaseData.ts 파일 열기');
console.log('2. 77번째 줄 수정:');
console.log('   현재: CACHE_DURATION: 0 // 캐시 비활성화 (디버깅)');
console.log('   변경: CACHE_DURATION: 5 * 60 * 1000 // 5분\n');

console.log('또는 다음 명령 실행:');
console.log('   sed -i "" "s/CACHE_DURATION: 0/CACHE_DURATION: 5 * 60 * 1000/g" src/hooks/usePurchaseData.ts\n');

console.log('✅ 캐시 활성화의 장점:');
console.log('   - 페이지 로딩 속도 향상');
console.log('   - 서버 부하 감소');
console.log('   - 네트워크 사용량 감소');

process.exit(0);
