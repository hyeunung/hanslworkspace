import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import fs from 'fs'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('=== 품목별 입고 컬럼 마이그레이션 실행 ===\n')

// SQL 파일 읽기
const sql = fs.readFileSync('scripts/migrations/20250122_add_item_receipt_columns.sql', 'utf8')

// 각 명령을 개별적으로 실행
const commands = sql
  .split(';')
  .filter(cmd => cmd.trim() && \!cmd.trim().startsWith('--'))
  .map(cmd => cmd.trim() + ';')

let successCount = 0
let errorCount = 0

for (const command of commands) {
  if (command.includes('ALTER TABLE') || command.includes('CREATE INDEX') || command.includes('COMMENT ON')) {
    console.log('실행 중:', command.substring(0, 50) + '...')
    
    try {
      const { error } = await supabase.rpc('execute_sql', { query: command }).catch(() => ({ error: 'No RPC' }))
      
      if (error === 'No RPC') {
        // RPC가 없으면 수동으로 실행 필요
        console.log('⚠️  RPC 없음 - Supabase 대시보드에서 직접 실행 필요')
      } else if (error) {
        console.log('❌ 실패:', error)
        errorCount++
      } else {
        console.log('✅ 성공')
        successCount++
      }
    } catch (e) {
      console.log('⚠️  수동 실행 필요')
    }
  }
}

console.log('\n=== 마이그레이션 요약 ===')
console.log('성공:', successCount, '건')
console.log('실패:', errorCount, '건')

if (successCount === 0) {
  console.log('\n⚠️  RPC가 없어서 자동 실행 실패')
  console.log('📋 다음 단계:')
  console.log('1. Supabase 대시보드 > SQL Editor로 이동')
  console.log('2. scripts/migrations/20250122_add_item_receipt_columns.sql 내용 복사')
  console.log('3. SQL Editor에 붙여넣고 실행')
}

// 컬럼 확인
console.log('\n=== 컬럼 존재 여부 확인 ===')
const { data: test, error: testError } = await supabase
  .from('purchase_request_items')
  .select('id, is_received, delivery_status, received_quantity, received_at')
  .limit(1)

if (testError) {
  console.log('❌ 일부 컬럼이 아직 없습니다:', testError.message)
  console.log('\n📋 Supabase 대시보드에서 SQL을 직접 실행해주세요:')
  console.log('파일: scripts/migrations/20250122_add_item_receipt_columns.sql')
} else {
  console.log('✅ 모든 입고 관련 컬럼이 존재합니다\!')
  console.log('- is_received')
  console.log('- delivery_status')  
  console.log('- received_quantity')
  console.log('- received_at')
}

process.exit(0)
