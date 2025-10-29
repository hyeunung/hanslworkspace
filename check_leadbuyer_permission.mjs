#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkPermissions() {
  console.log('🔍 Lead buyer 권한 확인\n');
  
  try {
    // 1. 현재 UPDATE 정책 확인
    const { data: policies, error: policiesError } = await supabase
      .from('pg_policies')
      .select('policyname, cmd, qual')
      .eq('tablename', 'purchase_request_items')
      .eq('cmd', 'UPDATE');
    
    if (policiesError) {
      console.error('❌ 정책 조회 실패:', policiesError);
    } else {
      console.log('📋 현재 purchase_request_items 테이블의 UPDATE 정책:');
      if (policies && policies.length > 0) {
        policies.forEach(policy => {
          console.log(`\n정책 이름: ${policy.policyname}`);
          console.log(`권한 조건: ${policy.qual}`);
        });
      } else {
        console.log('⚠️  UPDATE 정책이 없습니다!');
      }
    }
    
    // 2. 실제 권한 테스트를 위한 사용자 확인
    console.log('\n\n👥 lead buyer 권한을 가진 사용자들:');
    const { data: leadBuyers, error: leadBuyerError } = await supabase
      .from('employees')
      .select('name, email, purchase_role')
      .or('purchase_role.ilike.%lead buyer%,purchase_role.ilike.%raw_material_manager%,purchase_role.ilike.%consumable_manager%,purchase_role.ilike.%purchase_manager%');
    
    if (!leadBuyerError && leadBuyers) {
      leadBuyers.forEach(user => {
        console.log(`- ${user.name} (${user.email}): ${user.purchase_role}`);
      });
    }
    
    // 3. 마이그레이션 성공 여부 확인
    const { data: newPolicy, error: newPolicyError } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'purchase_request_items')
      .eq('policyname', 'Admins and lead buyers can update items')
      .single();
    
    if (newPolicy && !newPolicyError) {
      console.log('\n\n✅ 마이그레이션 성공!');
      console.log('새 정책 "Admins and lead buyers can update items"가 적용되었습니다.');
      console.log('app_admin과 lead buyer 모두 인쇄 완료 업데이트가 가능합니다.');
    } else {
      console.log('\n\n⚠️  새 정책이 적용되지 않았을 수 있습니다.');
      console.log('수동으로 SQL을 실행해보세요.');
    }
    
  } catch (error) {
    console.error('오류:', error);
  }
  
  process.exit(0);
}

checkPermissions();
