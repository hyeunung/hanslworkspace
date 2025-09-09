#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReal() {
  console.log('\n🔍 실제 데이터 확인\n');
  
  // 1. employees 테이블 확인
  console.log('1. Employees 테이블 첫 번째 행:');
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('*')
    .limit(1);
  
  if (emp && emp[0]) {
    console.log('컬럼들:', Object.keys(emp[0]));
    if (emp[0].slack_id || emp[0].slack_user_id) {
      console.log('✅ Slack ID 컬럼 있음!');
    }
  }
  
  // 2. Excel 다운로드 테스트
  console.log('\n2. 실제 발주 번호:');
  const { data: purchases } = await supabase
    .from('purchase_requests')
    .select('purchase_order_number')
    .limit(3);
  
  if (purchases) {
    purchases.forEach(p => {
      console.log(`  - ${p.purchase_order_number}`);
    });
    
    // API 테스트
    const testNum = purchases[0]?.purchase_order_number;
    if (testNum) {
      console.log(`\n3. Excel API 테스트: /api/excel/download/${testNum}`);
      const res = await fetch(`http://localhost:3000/api/excel/download/${testNum}`);
      console.log(`   응답 상태: ${res.status}`);
      if (res.ok) {
        console.log('   ✅ Excel 다운로드 API 정상!');
      }
    }
  }
  
  // 3. 승인 역할 확인
  console.log('\n4. 승인 역할 확인:');
  const { data: roles, error: roleErr } = await supabase
    .from('employees')
    .select('name, purchase_role')
    .not('purchase_role', 'is', null)
    .limit(5);
  
  if (roleErr) {
    console.log('에러:', roleErr.message);
  } else if (roles) {
    roles.forEach(r => {
      console.log(`  - ${r.name}: ${r.purchase_role}`);
    });
  }
}

checkReal();