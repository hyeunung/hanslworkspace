#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function findReceiptTable() {
  console.log('🔍 영수증 관련 테이블 및 컬럼 찾기\n');
  
  try {
    // 1. receipt 관련 테이블 찾기
    console.log('📋 receipt 관련 테이블 찾기...');
    const { data: receiptTables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .ilike('table_name', '%receipt%')
      .eq('table_schema', 'public');
    
    if (receiptTables && receiptTables.length > 0) {
      console.log('\n영수증 관련 테이블:');
      receiptTables.forEach(t => console.log(`  - ${t.table_name}`));
    } else {
      console.log('⚠️  receipt 이름을 포함한 테이블이 없습니다.');
    }
    
    // 2. is_printed 컬럼 찾기
    console.log('\n\n📋 is_printed 컬럼을 가진 테이블 찾기...');
    const { data: printedColumns, error: colError } = await supabase
      .from('information_schema.columns')
      .select('table_name, column_name, data_type')
      .eq('column_name', 'is_printed')
      .eq('table_schema', 'public');
    
    if (printedColumns && printedColumns.length > 0) {
      console.log('\nis_printed 컬럼을 가진 테이블:');
      printedColumns.forEach(c => {
        console.log(`  - ${c.table_name} (타입: ${c.data_type})`);
      });
      
      // 3. 해당 테이블의 RLS 정책 확인
      for (const col of printedColumns) {
        console.log(`\n\n🔍 ${col.table_name} 테이블의 RLS 정책 확인...`);
        
        const { data: policies, error: policyError } = await supabase.rpc('exec_sql', {
          sql: `
            SELECT 
              policyname,
              cmd,
              qual
            FROM pg_policies 
            WHERE tablename = '${col.table_name}'
            AND schemaname = 'public'
            AND cmd = 'UPDATE'
            ORDER BY policyname;
          `
        });
        
        if (policies && policies.length > 0) {
          console.log(`${col.table_name} 테이블의 UPDATE 정책:`);
          policies.forEach(p => {
            console.log(`  - ${p.policyname}`);
            console.log(`    조건: ${p.qual || '없음'}`);
          });
        } else {
          console.log(`❌ ${col.table_name} 테이블에 UPDATE 정책이 없습니다!`);
        }
      }
    } else {
      console.log('⚠️  is_printed 컬럼이 어떤 테이블에도 없습니다.');
    }
    
    // 4. purchase_request_items 테이블의 컬럼 확인
    console.log('\n\n📋 purchase_request_items 테이블 컬럼 확인...');
    const { data: itemColumns, error: itemColError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'purchase_request_items')
      .eq('table_schema', 'public')
      .order('ordinal_position');
    
    if (itemColumns && itemColumns.length > 0) {
      console.log('\npurchase_request_items 테이블 컬럼:');
      const printRelated = itemColumns.filter(c => 
        c.column_name.includes('print') || 
        c.column_name.includes('receipt')
      );
      
      if (printRelated.length > 0) {
        console.log('인쇄/영수증 관련 컬럼:');
        printRelated.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));
      }
      
      // is_printed가 있는지 확인
      const isPrintedCol = itemColumns.find(c => c.column_name === 'is_printed');
      if (isPrintedCol) {
        console.log(`\n✅ purchase_request_items 테이블에 is_printed 컬럼이 있습니다!`);
      }
    }
    
  } catch (error) {
    console.error('오류:', error);
  }
  
  process.exit(0);
}

findReceiptTable();
