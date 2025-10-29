#!/usr/bin/env node

/**
 * 날짜 필터링 로직 확인 스크립트
 */

console.log('📅 발주요청관리 날짜 필터링 로직 확인\n');

// 현재 코드의 날짜 계산 로직
const today = new Date();
const threeMonthsAgo = new Date();
threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

console.log('현재 시간:', today.toISOString());
console.log('3개월 전:', threeMonthsAgo.toISOString());
console.log('3개월 전 날짜만:', threeMonthsAgo.toISOString().split('T')[0]);

// 10/29 날짜 확인
const targetDate = '2025-10-29';
const targetDateTime = new Date(targetDate);

console.log('\n🎯 10/29 발주요청 날짜 비교:');
console.log('타겟 날짜:', targetDate);
console.log('타겟 날짜 (ISO):', targetDateTime.toISOString());

// 필터 조건 확인
const isWithinFilter = targetDateTime >= threeMonthsAgo;
console.log('\n📊 필터 조건 확인:');
console.log(`${targetDate} >= ${threeMonthsAgo.toISOString().split('T')[0]} : ${isWithinFilter}`);

if (isWithinFilter) {
  console.log('✅ 10/29 발주요청은 필터 조건을 만족합니다.');
  console.log('   → 다른 원인이 있을 가능성');
} else {
  console.log('❌ 10/29 발주요청이 필터 조건을 만족하지 않습니다!');
  console.log('   → 이것이 문제의 원인입니다!');
}

// 월 계산의 문제 확인
console.log('\n🔍 월 계산 세부 분석:');
console.log('현재 월:', today.getMonth() + 1, '월'); // getMonth()는 0부터 시작
console.log('3개월 전 월:', threeMonthsAgo.getMonth() + 1, '월');

// 7월(7) -> 4월(4)이면 정상, 하지만 경계 케이스 확인
const currentMonth = today.getMonth();
const targetMonth = currentMonth - 3;

console.log('\n🧮 월 계산 로직:');
console.log('현재 월 인덱스 (0-11):', currentMonth);
console.log('3개월 전 계산값:', targetMonth);

if (targetMonth < 0) {
  console.log('⚠️ 음수 월 발생 - 연도 넘어감 처리 확인 필요');
}

process.exit(0);